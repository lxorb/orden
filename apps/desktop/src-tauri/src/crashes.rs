use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

#[cfg(feature = "cef")]
use tauri::Manager as _;
use tauri::{AppHandle, Emitter, Webview};

mod exit;
pub mod freeze;
mod load;
mod native;
mod panics;
mod renderer;
mod report;
mod stacks;

use report::{App, Facts, Report, System};

const FOLDER: &str = "crash-reports";

const TOLD: &str = "nib://crash-report";

const CLAIM: Duration = Duration::from_secs(120);

const MOST_JS: usize = 10;

const ALIVE_EVERY: Duration = Duration::from_secs(30);

const DRILL: &str = "NIB_CRASH_DRILL";

const QUIET: [&str; 4] = [
    "write_log",
    "crash_alive",
    "crash_context",
    "crash_reports_waiting",
];

static APP: OnceLock<AppHandle> = OnceLock::new();

static CLAIMED: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

static JS_SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);

static ALIVE_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn dir() -> Option<PathBuf> {
    report::facts().map(|facts| facts.dir.clone())
}

pub fn start(app: &AppHandle) {
    let Ok(logs) = crate::paths::log_dir(app) else {
        return;
    };
    let _ = APP.set(app.clone());
    let dir = logs.join(FOLDER);
    let _ = crate::paths::made(&dir);
    let version = app.package_info().version.to_string();
    report::settle(Facts {
        dir: dir.clone(),
        log: logs.join("nib.log"),
        app: App {
            version: version.clone(),
            channel: String::new(),
            build: "desktop".to_owned(),
        },
        system: System {
            os: std::env::consts::OS.to_owned(),
            os_version: tauri_plugin_os::version().to_string(),
            arch: std::env::consts::ARCH.to_owned(),
            engine: engine(app),
        },
    });
    stacks::start();
    stacks::mark_main();
    panics::install();
    native::install(&dir, &version);

    let before = exit::Before {
        last: exit::read(&dir),
        booted: exit::booted(),
        version: version.clone(),
    };
    for report in exit::after_last_run(&dir, &before) {
        let _ = report::keep_in(&dir, &report, false);
    }
    exit::begin(&dir, &version);
}

#[cfg(feature = "cef")]
fn engine(app: &AppHandle) -> String {
    format!("CEF {}", app.webview_version().unwrap_or_default())
}

#[cfg(all(windows, not(feature = "cef")))]
fn engine(_app: &AppHandle) -> String {
    format!("WebView2 {}", wry::webview_version().unwrap_or_default())
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
fn engine(_app: &AppHandle) -> String {
    format!("WKWebView {}", wry::webview_version().unwrap_or_default())
}

#[cfg(all(not(any(windows, target_os = "macos")), not(feature = "cef")))]
fn engine(_app: &AppHandle) -> String {
    "WebKitGTK".to_owned()
}

fn told() {
    if let Some(app) = APP.get() {
        let _ = app.emit(TOLD, ());
    }
}

pub fn crumb(command: &str) {
    if !QUIET.contains(&command) {
        report::crumb(command);
    }
}

pub fn tick(window_answers: bool) {
    renderer::look(window_answers);
    let mut alive = ALIVE_AT.lock().unwrap_or_else(PoisonError::into_inner);
    if alive.is_none_or(|at| at.elapsed() >= ALIVE_EVERY) {
        *alive = Some(Instant::now());
        drop(alive);
        exit::alive();
    }
}

pub fn ended_well() {
    exit::ended_well();
}

pub fn window_gone(label: &str) {
    renderer::gone(label);
    if let Some(seen) = PAGES_SEEN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        seen.remove(label);
    }
    report::windows(renderer_count());
}

fn renderer_count() -> usize {
    PAGES_SEEN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map_or(0, HashSet::len)
}

static PAGES_SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn whose(label: &str) -> &'static str {
    if label == "main" {
        "The window’s"
    } else {
        "A window’s"
    }
}

enum Ended {
    Failed {
        whose: String,
        kind: i32,
        what: String,
        doing: Option<String>,
    },
    Gone {
        whose: &'static str,
        doing: Option<String>,
    },
}

fn ends() -> &'static std::sync::mpsc::Sender<Ended> {
    static ENDS: OnceLock<std::sync::mpsc::Sender<Ended>> = OnceLock::new();
    ENDS.get_or_init(|| crate::lane::lane(ended_report))
}

fn ended_report(ended: Ended) {
    let report = match ended {
        Ended::Failed {
            whose,
            kind,
            what,
            doing,
        } => {
            let mut report = report::fresh("engine", &format!("{whose} page {what}"));
            report.process = Some(
                match kind {
                    0 => "browser",
                    3 => "frame",
                    4 => "utility",
                    5 => "sandbox",
                    6 => "gpu",
                    7 | 8 => "plugin",
                    _ => "renderer",
                }
                .to_owned(),
            );
            report.reason = Some("exited".to_owned());
            report.doing = doing;
            report
        }
        Ended::Gone { whose, doing } => {
            let mut report = report::fresh("engine", &format!("{whose} page ended"));
            report.process = Some("renderer".to_owned());
            report.reason = Some("crashed".to_owned());
            report.doing = doing;
            report
        }
    };
    report::keep_now(&report, false);
}

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 says which of its processes failed")
)]
pub fn page_failed(whose: &str, kind: i32, what: &str) {
    if kind == 2 {
        return;
    }
    let _ = ends().send(Ended::Failed {
        whose: whose.to_owned(),
        kind,
        what: what.to_owned(),
        doing: crate::stall::doing_now(),
    });
}

#[cfg_attr(
    not(any(feature = "cef", target_os = "macos")),
    allow(
        dead_code,
        reason = "only CEF and WKWebView say a page's process ended"
    )
)]
pub fn page_ended(label: &str) {
    let _ = ends().send(Ended::Gone {
        whose: whose(label),
        doing: crate::stall::doing_now(),
    });
}

fn claimed(id: &str) -> bool {
    let mut held = CLAIMED.lock().unwrap_or_else(PoisonError::into_inner);
    let claims = held.get_or_insert_with(HashMap::new);
    claims.retain(|_, at| at.elapsed() < CLAIM);
    if claims.contains_key(id) {
        return true;
    }
    claims.insert(id.to_owned(), Instant::now());
    false
}

fn unclaimed(id: &str) {
    if let Some(claims) = CLAIMED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        claims.remove(id);
    }
}

#[tauri::command(async)]
pub fn crash_reports_waiting() -> Vec<Report> {
    let Some(dir) = dir() else {
        return Vec::new();
    };
    report::waiting_in(&dir)
        .into_iter()
        .filter(|one| !claimed(&one.id))
        .collect()
}

#[tauri::command(async)]
pub fn crash_report_sent(id: String) -> Result<(), String> {
    let dir = dir().ok_or_else(|| "crash reports are not kept here".to_owned())?;
    report::drop_in(&dir, &id)?;
    unclaimed(&id);
    Ok(())
}

#[tauri::command(async)]
pub fn crash_report_unsent(id: String) {
    unclaimed(&id);
}

fn first_seen(message: &str) -> bool {
    let mut held = JS_SEEN.lock().unwrap_or_else(PoisonError::into_inner);
    let seen = held.get_or_insert_with(HashSet::new);
    if seen.len() >= MOST_JS {
        return false;
    }
    seen.insert(message.chars().take(160).collect())
}

pub fn js_report(message: &str, stack: &str) -> Option<Report> {
    let first = message.lines().next().unwrap_or_default().trim();
    if first.is_empty() || !first_seen(first) {
        return None;
    }
    let mut report = report::fresh("js", first);
    report.stack = Some(stack.chars().take(16 * 1024).collect());
    report.doing = crate::stall::doing_now();
    Some(report)
}

#[tauri::command(async)]
pub fn crash_report_js(message: String, stack: String) {
    if let Some(report) = js_report(&message, &stack) {
        report::keep(&report, false);
    }
}

#[tauri::command(async)]
pub fn crash_alive(webview: Webview, visible: bool) {
    let label = webview.label().to_owned();
    let fresh = PAGES_SEEN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashSet::new)
        .insert(label.clone());
    if fresh {
        report::windows(renderer_count());
    }
    renderer::heard(&label, whose(&label), visible);
}

#[tauri::command(async)]
pub fn crash_context(kinds: BTreeMap<String, u32>) {
    report::shape(
        kinds
            .into_iter()
            .filter(|(kind, _)| {
                kind.len() <= 24
                    && kind
                        .chars()
                        .all(|one| one.is_ascii_lowercase() || one == '-')
            })
            .take(32)
            .collect(),
    );
}

#[tauri::command(async)]
pub fn crash_leaving() {
    exit::leaving();
}

#[tauri::command(async)]
pub fn crash_drill(app: AppHandle, webview: Webview, what: String) -> Result<(), String> {
    if std::env::var_os(DRILL).is_none_or(|said| said.is_empty() || said == "0") {
        return Err(format!("set {DRILL}=1 to drill crashes"));
    }
    match what.as_str() {
        "panic" => panic!("a crash drill asked for a panic"),
        "crash" => {
            drilled_crash();
            Ok(())
        }
        "freeze" => app
            .run_on_main_thread(drilled_freeze)
            .map_err(|error| error.to_string()),
        "hang" => webview
            .eval("{const end = Date.now() + 20000; while (Date.now() < end) {}}")
            .map_err(|error| error.to_string()),
        _ => Err(format!("no drill named {what}")),
    }
}

fn drilled_freeze() {
    let end = Instant::now() + Duration::from_secs(15);
    while Instant::now() < end {
        std::hint::spin_loop();
    }
}

#[allow(
    unsafe_code,
    reason = "a crash drill writes through a null pointer on purpose"
)]
fn drilled_crash() {
    unsafe {
        std::hint::black_box(std::ptr::null_mut::<u8>()).write_volatile(1);
    }
}

#[cfg(test)]
mod tests {
    use super::js_report;

    #[test]
    fn a_js_error_is_reported_once_and_only_so_many_are() {
        let first = js_report("TypeError: x is undefined\nmore", "at a (index-AbC.js:1:2)")
            .expect("a report");
        assert_eq!(first.kind, "js");
        assert_eq!(first.summary, "TypeError: x is undefined");
        assert!(js_report("TypeError: x is undefined", "").is_none());
        for index in 0..20 {
            let _ = js_report(&format!("Error {index}"), "");
        }
        assert!(js_report("Error at the end", "").is_none());
    }
}
