pub(crate) mod link;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux has no schedule to hand a notification to")
)]
pub(crate) mod schedule;
#[cfg(any(windows, test))]
mod toast;
#[cfg(windows)]
mod toasts;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};

use link::Act;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub id: String,
    pub at: i64,
    pub title: String,
    pub body: String,
    pub space: String,
    pub path: String,
    pub hash: String,
    pub line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "a Windows toast's snooze; a Mac's snoozes are fixed"
        )
    )]
    pub tomorrow: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux shows a reminder with no buttons")
)]
pub struct Words {
    pub done: String,
    pub snooze: String,
    pub minutes: String,
    pub hour: String,
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "a Windows toast's snooze; a Mac's snoozes are fixed"
        )
    )]
    pub tomorrow: String,
}

impl Default for Words {
    fn default() -> Self {
        Self {
            done: "Done".into(),
            snooze: "Snooze".into(),
            minutes: "15 min".into(),
            hour: "1 h".into(),
            tomorrow: "Tomorrow".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Pressed {
    pub act: Act,
    pub space: String,
    pub path: String,
    pub hash: String,
    pub line: u32,
}

const ANSWERED_FOR_MS: i64 = 7 * 86_400_000;

const PRESSED: &str = "nib://reminder";

static LAUNCHED_QUIETLY: AtomicBool = AtomicBool::new(false);

const FILE: &str = "reminders.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Kept {
    #[serde(flatten)]
    planned: Planned,
    nonce: String,
}

#[derive(Default)]
struct State {
    kept: Option<HashMap<String, Kept>>,
    pressed: Vec<Arrived>,
}

struct Arrived {
    act: Act,
    id: String,
    nonce: Option<String>,
}

static STATE: Mutex<State> = Mutex::new(State {
    kept: None,
    pressed: Vec::new(),
});

fn in_state<T>(alter: impl FnOnce(&mut State) -> T) -> T {
    alter(&mut STATE.lock().unwrap_or_else(PoisonError::into_inner))
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    crate::paths::config_dir(app).ok().map(|dir| dir.join(FILE))
}

fn kept<'a>(state: &'a mut State, app: &AppHandle) -> &'a mut HashMap<String, Kept> {
    state.kept.get_or_insert_with(|| {
        file(app)
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Vec<Kept>>(&bytes).ok())
            .map(|list| {
                list.into_iter()
                    .map(|one| (one.planned.id.clone(), one))
                    .collect()
            })
            .unwrap_or_default()
    })
}

fn moved(kept: &HashMap<String, Kept>, plan: &[Planned]) -> Vec<String> {
    plan.iter()
        .filter(|one| {
            kept.get(&one.id)
                .is_some_and(|held| held.planned.at != one.at)
        })
        .map(|one| one.id.clone())
        .collect()
}

fn merge(
    kept: &mut HashMap<String, Kept>,
    plan: Vec<Planned>,
    now: i64,
    nonce: impl Fn() -> String,
) -> Vec<(Planned, String)> {
    let wanted: Vec<String> = plan.iter().map(|one| one.id.clone()).collect();
    kept.retain(|id, one| {
        wanted.contains(id) || (one.planned.at <= now && now - one.planned.at < ANSWERED_FOR_MS)
    });
    plan.into_iter()
        .map(|one| {
            let entry = kept.entry(one.id.clone()).or_insert_with(|| Kept {
                planned: one.clone(),
                nonce: nonce(),
            });
            entry.planned = one.clone();
            (one, entry.nonce.clone())
        })
        .collect()
}

fn fresh_nonce() -> String {
    let mut bytes = [0u8; 8];
    if getrandom::fill(&mut bytes).is_err() {
        bytes = now_ms().to_le_bytes();
    }
    bytes
        .iter()
        .fold(String::with_capacity(16), |mut out, byte| {
            use std::fmt::Write as _;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
        })
}

fn save(app: &AppHandle, kept: &HashMap<String, Kept>) {
    let Some(path) = file(app) else {
        return;
    };
    let mut list: Vec<&Kept> = kept.values().collect();
    list.sort_by_key(|one| one.planned.at);
    if let Ok(bytes) = serde_json::to_vec(&list) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, bytes);
    }
}

fn may_schedule() -> bool {
    if crate::placement::away().is_some() {
        return std::env::var_os("NIB_PROBE_REMINDERS").is_some();
    }
    true
}

#[tauri::command(async)]
pub fn reminders_set(
    webview: tauri::Webview,
    app: AppHandle,
    reminders: Vec<Planned>,
    words: Words,
) -> Result<bool, String> {
    crate::agents::from_the_app(&webview)?;
    if !may_schedule() {
        return Ok(true);
    }

    let now = now_ms();
    let (wanted, moved) = in_state(|state| {
        let kept = kept(state, &app);
        let moved = moved(kept, &reminders);
        let wanted = merge(kept, reminders, now, fresh_nonce);
        save(&app, kept);
        (wanted, moved)
    });
    Ok(handed(&app, &wanted, &moved, &words, now))
}

fn handed(
    app: &AppHandle,
    wanted: &[(Planned, String)],
    moved: &[String],
    words: &Words,
    now: i64,
) -> bool {
    #[cfg(any(windows, target_os = "macos"))]
    {
        #[cfg(windows)]
        let system = toasts::Toasts::of(&app.config().identifier);
        #[cfg(target_os = "macos")]
        let system = macos::Requests::start(app, words);
        system
            .and_then(|system| schedule::make_so(&system, wanted, moved, words, now))
            .map_err(|error| eprintln!("nib: reminders: {error}"))
            .is_ok()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, wanted, moved, words, now);
        false
    }
}

#[tauri::command(async)]
pub fn reminders_taken(webview: tauri::Webview, app: AppHandle) -> Result<Vec<Pressed>, String> {
    crate::agents::from_the_app(&webview)?;
    Ok(in_state(|state| {
        let arrived = std::mem::take(&mut state.pressed);
        let kept = kept(state, &app);
        arrived
            .into_iter()
            .filter_map(|one| answered(kept, &one))
            .collect()
    }))
}

fn answered(kept: &HashMap<String, Kept>, press: &Arrived) -> Option<Pressed> {
    let one = kept
        .get(&press.id)
        .filter(|one| press.nonce.as_ref().is_none_or(|nonce| &one.nonce == nonce))?;
    Some(Pressed {
        act: press.act,
        space: one.planned.space.clone(),
        path: one.planned.path.clone(),
        hash: one.planned.hash.clone(),
        line: one.planned.line,
    })
}

pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if may_schedule() {
        macos::listen(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub fn pressed(app: &AppHandle, act: Act, id: &str, nonce: &str) {
    press(app, act, id, Some(nonce));
}

#[cfg(target_os = "macos")]
pub fn pressed_by_id(app: &AppHandle, act: Act, id: &str) {
    press(app, act, id, None);
    if crate::agents::shell::host(app).is_none() {
        crate::launch::reopen(app);
    }
}

fn press(app: &AppHandle, act: Act, id: &str, nonce: Option<&str>) {
    in_state(|state| {
        state.pressed.push(Arrived {
            act,
            id: id.to_string(),
            nonce: nonce.map(str::to_string),
        });
    });
    if act == Act::Open {
        if let Some(window) = crate::agents::shell::host(app) {
            let _ = window.show();
            crate::placement::raised(&window);
        }
    }
    if let Some(window) = crate::agents::shell::host(app) {
        let _ = app.emit_to(window.label(), PRESSED, ());
    }
}

pub fn answer_link(app: &AppHandle, url: &str) -> bool {
    if !link::is_reminder(url) {
        return false;
    }
    if let Some((act, id, nonce)) = link::parsed(url) {
        pressed(app, act, &id, &nonce);
    }
    true
}

#[tauri::command(async)]
pub fn reminders_quietly(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    let quiet = LAUNCHED_QUIETLY.swap(false, Ordering::Relaxed);
    let hidden =
        crate::agents::shell::host(&app).is_some_and(|window| !window.is_visible().unwrap_or(true));
    if goes_again(quiet, hidden, crate::agents::shell::in_tray()) {
        crate::lifecycle::quit_now(&app);
    }
    Ok(())
}

fn goes_again(launched_quietly: bool, hidden: bool, in_tray: bool) -> bool {
    launched_quietly && hidden && !in_tray
}

pub fn came_up_quietly() {
    LAUNCHED_QUIETLY.store(true, Ordering::Relaxed);
}

pub fn quiet_launch(urls: &[String]) -> bool {
    !urls.is_empty()
        && urls
            .iter()
            .all(|url| matches!(link::parsed(url), Some((Act::Done, _, _))))
}

#[cfg(test)]
mod tests {
    use super::schedule::tests::planned;
    use super::*;

    #[test]
    fn only_a_launch_for_a_done_goes_again_after_it() {
        assert!(goes_again(true, true, false));
        assert!(!goes_again(false, true, false));
        assert!(!goes_again(true, false, false));
        assert!(!goes_again(true, true, true));
    }

    #[test]
    fn a_reminder_keeps_its_nonce_and_one_that_rang_is_kept_a_week() {
        let mut kept = HashMap::new();
        let counter = std::cell::Cell::new(0);
        let nonce = || {
            counter.set(counter.get() + 1);
            format!("n{}", counter.get())
        };

        let first = merge(
            &mut kept,
            vec![planned("a", 2000), planned("b", 3000)],
            1000,
            nonce,
        );
        assert_eq!(first[0].1, "n1");
        assert_eq!(first[1].1, "n2");

        let second = merge(
            &mut kept,
            vec![planned("a", 2000), planned("c", 4000)],
            1500,
            nonce,
        );
        assert_eq!(second[0].1, "n1");
        assert_eq!(second[1].1, "n3");
        assert!(!kept.contains_key("b"));

        merge(&mut kept, vec![planned("c", 4000)], 2500, nonce);
        assert!(kept.contains_key("a"));
        merge(
            &mut kept,
            vec![planned("c", 4000)],
            2000 + ANSWERED_FOR_MS,
            nonce,
        );
        assert!(!kept.contains_key("a"));
    }

    #[test]
    fn a_reminder_is_moved_only_when_its_moment_is_another() {
        let mut kept = HashMap::new();
        merge(
            &mut kept,
            vec![planned("a", 2000), planned("b", 3000)],
            1000,
            || "n".to_owned(),
        );
        let plan = [planned("a", 2000), planned("b", 6600), planned("c", 4000)];
        assert_eq!(moved(&kept, &plan), ["b"]);
    }

    #[test]
    fn a_press_is_answered_only_with_its_own_nonce() {
        let mut kept = HashMap::new();
        merge(&mut kept, vec![planned("a", 2000)], 1000, || {
            "right".to_string()
        });
        let press = |nonce: Option<&str>| Arrived {
            act: Act::Done,
            id: "a".into(),
            nonce: nonce.map(str::to_string),
        };
        let answer = answered(&kept, &press(Some("right"))).expect("its own nonce");
        assert_eq!(
            (answer.act, answer.path.as_str(), answer.line),
            (Act::Done, "Plan.md", 2)
        );
        assert_eq!(answered(&kept, &press(Some("wrong"))), None);
        assert!(answered(&kept, &press(None)).is_some());
        assert_eq!(
            answered(
                &kept,
                &Arrived {
                    act: Act::Open,
                    id: "gone".into(),
                    nonce: None
                }
            ),
            None
        );
    }

    #[test]
    fn only_a_launch_for_nothing_but_a_done_is_quiet() {
        let done = link::link(Act::Done, "aa", "bb");
        let open = link::link(Act::Open, "aa", "bb");
        assert!(quiet_launch(std::slice::from_ref(&done)));
        assert!(!quiet_launch(&[done.clone(), open]));
        assert!(!quiet_launch(&[done, "nib://open?path=a".into()]));
        assert!(!quiet_launch(&[]));
    }

    #[test]
    fn a_nonce_is_sixteen_hex_digits() {
        let made = fresh_nonce();
        assert_eq!(made.len(), 16);
        assert!(made.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(made, fresh_nonce());
    }

    #[test]
    fn the_plan_reads_as_the_page_writes_it() {
        let read: Planned = serde_json::from_value(serde_json::json!({
            "id": "00ff00ff00ff00ff", "at": 1_790_000_000_000_i64, "title": "Call",
            "body": "Plan", "space": "Work", "path": "Plan.md", "hash": "abc", "line": 3,
            "tomorrow": 900,
        }))
        .expect("the page's shape");
        assert_eq!(read.tomorrow, Some(900));
        assert_eq!(read.line, 3);
    }
}
