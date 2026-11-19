use orden_base::Held as _;
use std::collections::HashMap;
use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter as _, Listener as _, Manager as _};

use crate::verbs::{Category, Event, EVENT};

const CONNECTED_FOR: Duration = Duration::from_secs(10 * 60);
const LOOK_EVERY: Duration = Duration::from_secs(30);
const LET_GO_AFTER: Duration = Duration::from_secs(2);
#[derive(Clone, Debug, Deserialize)]
pub struct Words {
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    pub show: String,
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    pub stop: String,
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    pub quit: String,
    pub stopped: String,
    pub closed: String,
    pub hidden: String,
    pub pairing: String,
}
impl Default for Words {
    fn default() -> Self {
        Self {
            show: "Open".into(),
            stop: "Stop agents".into(),
            quit: "Quit".into(),
            stopped: "Agents stopped".into(),
            closed: "Agent tabs closed".into(),
            hidden: "Orden is still running for your agents".into(),
            pairing: "{client} wants to connect".into(),
        }
    }
}
#[derive(Default)]
struct Shell {
    last: HashMap<(String, String), Instant>,
    said: Vec<String>,
    words: Words,
    key: Option<String>,
    hidden: Option<String>,
    told_hidden: bool,
    kept: bool,
}
static SHELL: Mutex<Option<Shell>> = Mutex::new(None);
static STARTED: Once = Once::new();
fn with<T>(run: impl FnOnce(&mut Shell) -> T) -> T {
    run(SHELL.held().get_or_insert_with(Shell::default))
}
pub fn hosts(app: &AppHandle, window: &tauri::Window) -> bool {
    orden_base::labels::host(app).is_some_and(|host| host.label() == window.label())
}
pub fn start(app: &AppHandle) {
    STARTED.call_once(|| {
        let notifying = app.clone();
        let _ = app.run_on_main_thread(move || {
            notifications(&notifying);
        });
        let hearing = app.clone();
        app.listen_any(EVENT, move |event| {
            if let Ok(event) = serde_json::from_str::<Event>(event.payload()) {
                news(&hearing, event);
            }
        });
        let looking = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(LOOK_EVERY);
            changed(&looking);
        });
    });
}
pub fn heard(app: &AppHandle, agent: &str, session: &str) {
    start(app);
    let fresh = with(|shell| heard_in(shell, agent, session, Instant::now()));
    if fresh {
        changed(app);
    }
}
fn heard_in(shell: &mut Shell, agent: &str, session: &str, now: Instant) -> bool {
    shell
        .last
        .retain(|_, at| now.saturating_duration_since(*at) < CONNECTED_FOR);
    let before = connected_in(shell, now);
    shell
        .last
        .insert((agent.to_owned(), session.to_owned()), now);
    connected_in(shell, now) != before
}
pub fn bye(app: &AppHandle, agent: &str, session: &str) -> bool {
    let last = with(|shell| left_in(shell, agent, session, Instant::now()));
    changed(app);
    last
}
fn left_in(shell: &mut Shell, agent: &str, session: &str, now: Instant) -> bool {
    shell.last.remove(&(agent.to_owned(), session.to_owned()));
    !connected_in(shell, now).iter().any(|one| one == agent)
}
pub fn connected() -> Vec<String> {
    with(|shell| connected_in(shell, Instant::now()))
}
fn connected_in(shell: &Shell, now: Instant) -> Vec<String> {
    let mut connected: Vec<String> = shell
        .last
        .iter()
        .filter(|(_, at)| now.saturating_duration_since(**at) < CONNECTED_FOR)
        .map(|((id, _), _)| id.clone())
        .collect();
    connected.sort();
    connected.dedup();
    connected
}
fn changed(app: &AppHandle) {
    let now = with(|shell| {
        let now = connected_in(shell, Instant::now());
        if now == shell.said {
            return None;
        }
        shell.said.clone_from(&now);
        Some(now)
    });
    let Some(agents) = now else {
        return;
    };
    crate::process::keep_only(&agents);
    let _ = app.emit(EVENT, Event::Connected { agents });
    settle(app);
}
fn settle(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let (agents, kept, words) =
            with(|shell| (!shell.said.is_empty(), shell.kept, shell.words.clone()));
        tray(&handle, agents || kept, agents, &words);
        key(&handle, agents);
        if !agents && !kept {
            let_go(&handle);
        }
    });
}
#[derive(Debug, Deserialize)]
pub struct TrayWords {
    show: String,
    quit: String,
}
#[tauri::command]
pub fn tray_keep(
    webview: tauri::Webview,
    app: AppHandle,
    on: bool,
    words: TrayWords,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    with(|shell| {
        shell.kept = on;
        shell.words.show = words.show;
        shell.words.quit = words.quit;
    });
    settle(&app);
    Ok(())
}
pub fn in_tray() -> bool {
    cfg!(any(windows, target_os = "macos")) && with(|shell| shell.kept || !shell.said.is_empty())
}
#[tauri::command]
pub fn agents_shell(
    webview: tauri::Webview,
    app: AppHandle,
    key: Option<String>,
    words: Words,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    with(|shell| {
        shell.key = key;
        shell.words = words;
    });
    settle(&app);
    Ok(())
}
#[tauri::command]
pub fn agents_hold(webview: tauri::Webview, app: AppHandle, hide: bool) -> Result<bool, String> {
    orden_base::labels::from_the_app(&webview)?;
    let window = webview.window();
    let holds = cfg!(any(windows, target_os = "macos")) && hosts(&app, &window);
    if !hide {
        return Ok(holds);
    }
    if !holds || !in_tray() {
        return Ok(false);
    }
    let _ = window.hide();
    let (say, words) = with(|shell| {
        shell.hidden = Some(window.label().to_string());
        let say = !shell.told_hidden && !shell.said.is_empty();
        shell.told_hidden |= say;
        (say, shell.words.clone())
    });
    if say {
        notify(&app, words.hidden, String::new());
    }
    Ok(true)
}
fn let_go(app: &AppHandle) {
    let Some(label) = with(|shell| shell.hidden.take()) else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(LET_GO_AFTER);
        if in_tray() {
            return;
        }
        if let Some(window) = handle.get_window(&label) {
            if !window.is_visible().unwrap_or(true) {
                let _ = window.close();
            }
        }
    });
}
fn news(app: &AppHandle, event: Event) {
    let words = with(|shell| shell.words.clone());
    let question = matches!(event, Event::Asked { .. });
    let (title, body) = match event {
        Event::Asked { approval } if approval.category == Category::Pairing => (
            words.pairing.replace("{client}", &approval.summary),
            String::new(),
        ),
        Event::Asked { approval } => (approval.name, approval.summary),
        Event::Stopped { closed } => (
            if closed { words.closed } else { words.stopped },
            String::new(),
        ),
        _ => return,
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let windows = orden_base::labels::document_windows(&app);
        let in_front = windows
            .iter()
            .any(|window| window.is_focused().unwrap_or(false));
        let answerable = windows
            .iter()
            .any(|window| crate::host().is_some_and(|host| (host.page_up)(&app, window.label())));
        if !in_front && (answerable || !question) {
            notify(&app, title, body);
        }
    });
}
pub fn notifications(app: &AppHandle) -> bool {
    static ADDED: OnceLock<bool> = OnceLock::new();
    *ADDED.get_or_init(|| app.plugin(tauri_plugin_notification::init()).is_ok())
}
pub fn notify(app: &AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt as _;

    if orden_placement::placement::away().is_some() || !notifications(app) {
        return;
    }
    let mut built = app.notification().builder().title(title);
    if !body.is_empty() {
        built = built.body(body);
    }
    let _ = built.show();
}
fn key(app: &AppHandle, on: bool) {
    let wanted = with(|shell| if on { shell.key.clone() } else { None });
    if let Some(host) = crate::host() {
        let _ = (host.hold_stop)(app, wanted);
    }
}
#[cfg(any(windows, target_os = "macos"))]
const TRAY: &str = "orden-agents";
#[cfg(any(windows, target_os = "macos"))]
const OPEN: &str = "orden-agents-open";
#[cfg(any(windows, target_os = "macos"))]
const STOP: &str = "orden-agents-stop";
#[cfg(any(windows, target_os = "macos"))]
const QUIT: &str = "orden-agents-quit";
#[cfg(any(windows, target_os = "macos"))]
fn tray(app: &AppHandle, on: bool, agents: bool, words: &Words) {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    if !on || orden_placement::placement::away().is_some() {
        let _ = app.remove_tray_by_id(TRAY);
        return;
    }
    let Ok(menu) = rows(app, words, agents) else {
        return;
    };
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_menu(Some(menu));
        return;
    }
    let mut built = TrayIconBuilder::with_id(TRAY)
        .tooltip("Orden")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => open(app),
            STOP => {
                crate::stop::stop(app);
            }
            QUIT => {
                if let Some(host) = crate::host() {
                    (host.quit)(app);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open(tray.app_handle());
            }
        });
    #[cfg(target_os = "macos")]
    if let Some(icon) = menu_bar_mark() {
        built = built.icon(icon).icon_as_template(true);
    }
    #[cfg(windows)]
    if let Some(icon) = app.default_window_icon() {
        built = built.icon(icon.clone());
    }
    let _ = built.build(app);
}
#[cfg(any(test, target_os = "macos"))]
fn menu_bar_mark() -> Option<tauri::image::Image<'static>> {
    let bytes: &[u8] = include_bytes!("../../../icons/tray.png");
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().ok()?;
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut pixels).ok()?;
    let rows = usize::try_from(info.height).ok()?;
    if info.color_type != png::ColorType::Rgba
        || info.bit_depth != png::BitDepth::Eight
        || info.line_size != usize::try_from(info.width).ok()? * 4
    {
        return None;
    }
    pixels.truncate(info.line_size * rows);
    Some(tauri::image::Image::new_owned(
        pixels,
        info.width,
        info.height,
    ))
}
#[cfg(any(windows, target_os = "macos"))]
fn rows<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    words: &Words,
    agents: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};

    let open = MenuItem::with_id(app, OPEN, &words.show, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, STOP, &words.stop, true, None::<&str>)?;
    let line = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT, &words.quit, true, None::<&str>)?;
    let mut items: Vec<&dyn IsMenuItem<R>> = vec![&open];
    if agents {
        items.push(&stop);
    }
    items.push(&line);
    items.push(&quit);
    Menu::with_items(app, &items)
}
#[cfg(any(windows, target_os = "macos"))]
pub fn open(app: &AppHandle) {
    if let Some(window) = orden_base::labels::host(app) {
        let _ = window.show();
        orden_placement::placement::raised(&window);
    }
    with(|shell| shell.hidden = None);
}
#[cfg(not(any(windows, target_os = "macos")))]
fn tray(_app: &AppHandle, _on: bool, _agents: bool, _words: &Words) {}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_menu_bar_mark_is_black_on_clear_so_macos_tints_it_like_its_own() {
        let mark = menu_bar_mark().expect("the mark decodes");
        assert_eq!((mark.width(), mark.height()), (36, 36));
        let (pixels, _) = mark.rgba().as_chunks::<4>();
        assert!(pixels.iter().all(|one| one[..3] == [0, 0, 0]));
        let drawn = pixels.iter().filter(|one| one[3] > 128).count();
        assert!(
            drawn > 36 * 36 / 4 && drawn < 36 * 36 * 3 / 4,
            "{drawn} pixels drawn"
        );
    }
    #[test]
    fn the_app_is_kept_in_a_tray_only_where_there_is_one() {
        with(|shell| shell.kept = true);
        let kept = in_tray();
        with(|shell| shell.kept = false);
        assert_eq!(kept, cfg!(any(windows, target_os = "macos")));
    }
    #[test]
    fn an_agent_is_connected_for_ten_minutes_after_its_last_call() {
        let now = Instant::now();
        let mut shell = Shell::default();
        assert!(heard_in(&mut shell, "claude", "s1", now));
        assert!(heard_in(&mut shell, "codex", "s1", now));
        assert!(!heard_in(&mut shell, "claude", "s2", now));
        assert_eq!(connected_in(&shell, now), ["claude", "codex"]);
        let later = now + CONNECTED_FOR;
        assert!(heard_in(&mut shell, "codex", "s1", later));
        assert_eq!(connected_in(&shell, later), ["codex"]);
        assert_eq!(shell.last.len(), 1, "the sessions gone quiet are let go");
    }
    #[test]
    fn a_session_that_leaves_leaves_the_others_of_its_agent_connected() {
        let now = Instant::now();
        let mut shell = Shell::default();
        heard_in(&mut shell, "claude", "s1", now);
        heard_in(&mut shell, "claude", "s2", now);
        heard_in(&mut shell, "codex", "s1", now);
        assert!(!left_in(&mut shell, "claude", "s2", now));
        assert_eq!(connected_in(&shell, now), ["claude", "codex"]);
        assert!(left_in(&mut shell, "claude", "s1", now));
        assert_eq!(connected_in(&shell, now), ["codex"]);
    }
    #[test]
    fn the_words_are_english_until_the_window_says() {
        let words = Words::default();
        assert_eq!(
            words.pairing.replace("{client}", "Codex"),
            "Codex wants to connect"
        );
        let said: Words = serde_json::from_value(serde_json::json!({
            "show": "Öffnen", "stop": "Agenten anhalten", "quit": "Beenden",
            "stopped": "Agenten angehalten", "closed": "Agenten-Tabs geschlossen",
            "hidden": "Orden läuft weiter", "pairing": "{client} möchte sich verbinden",
        }))
        .expect("the window's words");
        assert_eq!(said.stop, "Agenten anhalten");
    }
}
