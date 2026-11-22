use orden_base::Held as _;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Emitter as _, Manager as _, Webview};

const OWED_MS: u64 = 1_000;
#[derive(Debug, Default)]
struct Homes {
    typing: HashMap<String, String>,
    shown: HashSet<String>,
    owed: Option<(String, u64)>,
}
#[derive(Debug, PartialEq, Eq)]
enum Back {
    Page(String),
    Later,
    Own,
}
impl Homes {
    fn page_took(&mut self, window: &str, page: &str) {
        self.typing.insert(window.to_string(), page.to_string());
        self.owed = None;
    }
    fn own_took(&mut self, window: &str) {
        self.typing.remove(window);
        self.owed = None;
    }
    fn placed(&mut self, page: &str, visible: bool, now: u64) -> bool {
        if !visible {
            self.shown.remove(page);
            return false;
        }
        self.shown.insert(page.to_string());
        match self.owed.take() {
            Some((owed, until)) if owed == page => now <= until,
            other => {
                self.owed = other;
                false
            }
        }
    }
    fn closed(&mut self, page: &str) {
        self.typing.retain(|_, one| one != page);
        self.shown.remove(page);
        if self.owed.as_ref().is_some_and(|(owed, _)| owed == page) {
            self.owed = None;
        }
    }
    fn home(&self, window: &str) -> Option<&str> {
        self.typing.get(window).filter(|page| self.shown.contains(*page)).map(String::as_str)
    }
    fn back(&mut self, window: &str, now: u64) -> Back {
        let Some(page) = self.typing.get(window) else {
            return Back::Own;
        };
        if self.shown.contains(page) {
            return Back::Page(page.clone());
        }
        self.owed = Some((page.clone(), now.saturating_add(OWED_MS)));
        Back::Later
    }
}
static HOMES: LazyLock<Mutex<Homes>> = LazyLock::new(Mutex::default);
fn homes<T>(look: impl FnOnce(&mut Homes) -> T) -> T {
    look(&mut HOMES.held())
}
#[derive(Debug, Default)]
struct Engine {
    focused: HashMap<String, String>,
}
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
impl Engine {
    fn got(&mut self, window: &str, label: &str) {
        if label == window {
            self.focused.remove(window);
        } else {
            self.focused.insert(window.to_string(), label.to_string());
        }
    }
    fn closed(&mut self, page: &str) {
        self.focused.retain(|_, one| one != page);
    }
    fn holding(&self, window: &str) -> Option<&str> {
        self.focused.get(window).map(String::as_str)
    }
}
static ENGINE: LazyLock<Mutex<Engine>> = LazyLock::new(Mutex::default);
fn engine<T>(look: impl FnOnce(&mut Engine) -> T) -> T {
    look(&mut ENGINE.held())
}
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn overlaps(page: [i32; 4], window: [i32; 4]) -> bool {
    let [left, top, right, bottom] = page;
    let [from_x, from_y, to_x, to_y] = window;
    left < right && top < bottom && left < to_x && right > from_x && top < to_y && bottom > from_y
}
fn now() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    u64::try_from(START.elapsed().as_millis()).unwrap_or(u64::MAX)
}
const IN_PAGE: &str = "orden://keyboard-in-page";
fn page_took(app: &AppHandle, window: &str, page: &str) {
    homes(|all| all.page_took(window, page));
    let _ = app.emit_to(window, IN_PAGE, ());
    crate::web_tabs::page_chosen(app, window, page);
}
pub fn page_pressed(window: &str, page: &str) {
    if native::holding(window).as_deref() != Some(page) {
        native::hand_over(page);
    }
}
pub fn built(page: &str) {
    homes(|all| all.placed(page, true, now()));
}
pub fn placed(app: &AppHandle, view: &Webview, visible: bool) {
    let page = view.label();
    if homes(|all| all.placed(page, visible, now())) && native::in_front(&view.window()) {
        native::take(app, page);
    }
}
pub fn hold_for_layer(app: &AppHandle, window: &str) {
    if cfg!(windows) || native::holding(window).is_none() {
        let _ = native::take(app, window);
    }
}
pub fn closed(page: &str) {
    homes(|all| all.closed(page));
    engine(|all| all.closed(page));
    native::let_go_of(page);
}
pub fn window_came_back(app: &AppHandle, window: &str) {
    if orden_placement::placement::away().is_some() {
        return;
    }
    let home = homes(|all| all.home(window).map(str::to_string));
    if !home.is_some_and(|page| native::take(app, &page)) {
        let _ = native::take(app, window);
    }
}
pub fn no_hidden_menu<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let _ = window;
}
pub const PRESS_SCRIPT: &str = include_str!("keyboard_press.js");
const INTO_SCRIPT: &str = include_str!("keyboard_into.js");
const LEFT: &str = "orden://keyboard-left-page";
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
#[derive(Clone, Debug, serde::Serialize)]
struct Left {
    tab: String,
    next: bool,
}
fn page_of(label: &str) -> Option<(AppHandle, String, String)> {
    let app = APP.get()?;
    let tab = crate::web_tabs::tab_of(label)?;
    let window = app.get_webview(label)?.window().label().to_string();
    Some((app.clone(), tab, window))
}
pub fn took(label: &str) {
    if !cfg!(windows) {
        return;
    }
    let own = APP
        .get()
        .and_then(|app| app.get_webview(label))
        .filter(|view| view.window().label() == label);
    if own.is_some() {
        engine(|all| all.got(label, label));
        return;
    }
    let Some((app, _, window)) = page_of(label) else {
        return;
    };
    engine(|all| all.got(&window, label));
    if !native::seen(label) {
        return;
    }
    let (telling, page) = (app.clone(), label.to_string());
    let _ = app.run_on_main_thread(move || page_took(&telling, &window, &page));
}
pub fn pressed(label: &str, press: crate::web_keys::Press) -> bool {
    let Some((app, _, window)) = page_of(label) else {
        return false;
    };
    let Some(said) = crate::web_keys::app_key(&window, press) else {
        return false;
    };
    let telling = app.clone();
    let _ = app.run_on_main_thread(move || {
        if !said.keeps_page() {
            if let Some(ours) = telling.get_webview(&window) {
                orden_placement::placement::keyboard_to(&ours);
            }
        }
        let _ = telling.emit_to(window.as_str(), crate::web_keys::PRESSED, said);
    });
    true
}
pub fn left(label: &str, next: bool) {
    let Some((app, tab, window)) = page_of(label) else {
        return;
    };
    let telling = app.clone();
    let _ = app.run_on_main_thread(move || {
        homes(|all| all.own_took(&window));
        if let Some(ours) = telling.get_webview(&window) {
            orden_placement::placement::keyboard_to(&ours);
        }
        let _ = telling.emit_to(window.as_str(), LEFT, Left { tab, next });
    });
}
#[tauri::command]
pub fn keyboard_into(webview: Webview, tab: String, last: bool) -> bool {
    let label = crate::web_tabs::label_of(&tab);
    let window = webview.window().label().to_string();
    let Some(page) = webview.app_handle().get_webview(&label) else {
        return false;
    };
    if page.window().label() != window || !native::take(webview.app_handle(), &label) {
        return false;
    }
    native::hand_over(&label);
    homes(|all| all.page_took(&window, &label));
    let _ = page.eval(format!("globalThis.ordenIntoLast = {last};\n{INTO_SCRIPT}"));
    true
}
#[tauri::command]
pub fn keyboard_pressed(webview: Webview) {
    if webview.label() == webview.window().label() {
        let _ = native::take(webview.app_handle(), webview.label());
    }
}
#[tauri::command]
pub fn keyboard_watch(webview: Webview) {
    let _ = APP.set(webview.app_handle().clone());
    native::watch(&webview);
}
#[tauri::command]
pub fn keyboard_here(webview: Webview) {
    homes(|all| all.own_took(webview.window().label()));
}
#[tauri::command]
pub fn keyboard_went(webview: Webview) -> bool {
    let window = webview.window().label().to_string();
    let Some(page) = native::holding(&window) else {
        return false;
    };
    homes(|all| all.page_took(&window, &page));
    crate::web_tabs::page_chosen(webview.app_handle(), &window, &page);
    true
}
#[tauri::command]
pub fn keyboard_back(webview: Webview, tab: Option<String>) -> bool {
    let window = webview.window();
    if let Some(tab) = tab {
        let page = crate::web_tabs::label_of(&tab);
        homes(|all| all.page_took(window.label(), &page));
    }
    if orden_placement::placement::away().is_some() || !native::in_front(&window) {
        return false;
    }
    match homes(|all| all.back(window.label(), now())) {
        Back::Page(page) => native::seen(&page) && native::take(webview.app_handle(), &page),
        Back::Later => true,
        Back::Own => false,
    }
}
mod native {
    use orden_base::Held as _;
    #[cfg(not(windows))]
    use std::collections::HashMap;
    use std::sync::Mutex;

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    static PAGES: Mutex<Vec<(String, String, u32)>> = Mutex::new(Vec::new());
    #[cfg(windows)]
    static WINDOWS: Mutex<Vec<(String, u64)>> = Mutex::new(Vec::new());
    pub fn page(app: &AppHandle, platform: &PlatformWebview, label: &str, window: &str) {
        let _ = super::APP.set(app.clone());
        #[cfg(windows)]
        if let Some(id) = crate::host::page_id(platform) {
            let mut windows = WINDOWS.held();
            windows.retain(|(one, _)| one != label);
            windows.push((label.to_string(), id.0));
        }
        let Some(x11) = crate::host::x11_page(platform) else {
            return;
        };
        let mut pages = PAGES.held();
        pages.retain(|(one, _, _)| one != label);
        pages.push((label.to_string(), window.to_string(), x11));
    }
    pub fn let_go_of(label: &str) {
        PAGES.held().retain(|(one, _, _)| one != label);
        #[cfg(windows)]
        WINDOWS.held().retain(|(one, _)| one != label);
    }
    #[cfg(windows)]
    pub fn window_of(label: &str) -> Option<windows::Win32::Foundation::HWND> {
        let id = WINDOWS.held().iter().find(|(one, _)| one == label).map(|(_, id)| *id)?;
        let id = usize::try_from(id).ok()?;
        Some(windows::Win32::Foundation::HWND(id as *mut _))
    }
    #[cfg(windows)]
    #[allow(unsafe_code, reason = "a page's window is read through Win32")]
    pub fn seen(label: &str) -> bool {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowRect, IsWindowVisible, GA_ROOT,
        };
        let Some(page) = window_of(label) else {
            return true;
        };
        let (mut at, mut whole) = (RECT::default(), RECT::default());
        let read = unsafe {
            IsWindowVisible(page).as_bool()
                && GetWindowRect(page, &raw mut at).is_ok()
                && GetWindowRect(GetAncestor(page, GA_ROOT), &raw mut whole).is_ok()
        };
        read && super::overlaps(
            [at.left, at.top, at.right, at.bottom],
            [whole.left, whole.top, whole.right, whole.bottom],
        )
    }
    #[cfg(not(windows))]
    pub fn seen(_label: &str) -> bool {
        true
    }
    #[cfg(target_os = "linux")]
    pub fn x11_took(app: &AppHandle, x11: u32) {
        let found = PAGES
            .held()
            .iter()
            .find(|(_, _, one)| *one == x11)
            .map(|(label, window, _)| (label.clone(), window.clone()));
        if let Some((label, window)) = found {
            super::page_took(app, &window, &label);
        }
    }
    #[cfg(windows)]
    pub fn holding(window: &str) -> Option<String> {
        let page = super::engine(|all| all.holding(window).map(str::to_string))?;
        let mine = super::APP
            .get()
            .and_then(|app| app.get_webview(&page))
            .is_some_and(|view| view.window().label() == window);
        (mine && seen(&page)).then_some(page)
    }
    #[cfg(not(windows))]
    pub fn holding(window: &str) -> Option<String> {
        let pages: HashMap<u32, String> = PAGES
            .held()
            .iter()
            .filter(|(_, holder, _)| holder == window)
            .map(|(label, _, x11)| (*x11, label.clone()))
            .collect();
        let found = crate::web_keys::focus_in(&pages.keys().copied().collect::<Vec<_>>())?;
        pages.get(&found).cloned()
    }
    pub fn hand_over(label: &str) {
        let found = PAGES.held().iter().find(|(one, _, _)| one == label).map(|(_, _, x11)| *x11);
        if let Some(x11) = found {
            crate::web_keys::focus_to(x11);
        }
    }
    pub fn take(app: &AppHandle, label: &str) -> bool {
        app.get_webview(label).is_some_and(|page| page.set_focus().is_ok())
    }
    #[cfg(windows)]
    #[allow(unsafe_code, reason = "the system's foreground window is read through Win32")]
    pub fn in_front(window: &Window) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
        let Ok(ours) = window.hwnd() else {
            return false;
        };
        let front = unsafe { GetForegroundWindow() };
        if front.0.is_null() {
            return false;
        }
        let root = unsafe { GetAncestor(front, GA_ROOT) };
        std::ptr::eq(front.0.cast_const(), ours.0.cast_const())
            || std::ptr::eq(root.0.cast_const(), ours.0.cast_const())
    }
    #[cfg(not(windows))]
    pub fn in_front(window: &Window) -> bool {
        window.is_focused().unwrap_or(false)
    }
    pub fn watch(_webview: &Webview) {}
}
pub use native::page;
#[cfg(target_os = "linux")]
pub use native::x11_took;

#[cfg(test)]
mod tests {
    use super::{Back, Engine, Homes, OWED_MS};

    fn typing_in(window: &str, page: &str) -> Homes {
        let mut homes = Homes::default();
        homes.placed(page, true, 0);
        homes.page_took(window, page);
        homes
    }
    #[test]
    fn a_page_put_off_the_window_is_not_seen() {
        let window = [0, 0, 1024, 768];
        assert!(super::overlaps([0, 76, 1024, 721], window));
        assert!(super::overlaps([-10, -10, 5, 5], window));
        assert!(!super::overlaps([-20000, -19999, -18976, -19354], window));
        assert!(!super::overlaps([1024, 0, 2048, 768], window));
        assert!(!super::overlaps([10, 10, 10, 400], window));
    }
    #[test]
    fn the_engine_s_last_focused_page_holds_the_keyboard_until_the_app_page_or_its_close_takes_it()
    {
        let mut engine = Engine::default();
        assert_eq!(engine.holding("orden-1"), None);
        engine.got("orden-1", "web-a");
        assert_eq!(engine.holding("orden-1"), Some("web-a"));
        engine.got("orden-1", "web-b");
        assert_eq!(engine.holding("orden-1"), Some("web-b"));
        engine.got("orden-1", "orden-1");
        assert_eq!(engine.holding("orden-1"), None);
        engine.got("orden-1", "web-a");
        engine.got("orden-2", "web-c");
        engine.closed("web-a");
        assert_eq!(engine.holding("orden-1"), None);
        assert_eq!(engine.holding("orden-2"), Some("web-c"));
        engine.got("orden-2", "orden-2");
        assert_eq!(engine.holding("orden-2"), None);
    }
    #[test]
    fn on_windows_keyboard_went_asks_the_engine_s_focus_and_never_the_system_s() {
        let source = include_str!("keyboard.rs");
        let native = &source[source.find("\nmod native").expect("native")..];
        let holding = &native
            [native.find("#[cfg(windows)]\n    pub fn holding(").expect("holding on windows")..];
        let holding = &holding[..holding.find("\n    }\n").expect("its end")];
        assert!(holding.contains("all.holding(window)") && holding.contains("seen(&page)"));
        assert!(!source.contains(&["Get", "Focus"].concat()));
        let took = &source[source.find("pub fn took(").expect("took")..];
        let took = &took[..took.find("\n}\n").expect("its end")];
        assert!(took.contains("all.got(label, label)") && took.contains("all.got(&window, label)"));
        let closed = &source[source.find("pub fn closed(").expect("closed")..];
        assert!(closed[..closed.find("\n}\n").expect("its end")]
            .contains("engine(|all| all.closed(page))"));
    }
    #[test]
    fn a_window_nobody_typed_in_a_page_of_is_typing_in_its_own() {
        let mut homes = Homes::default();
        assert_eq!(homes.home("main"), None);
        assert_eq!(homes.back("main", 0), Back::Own);
    }
    #[test]
    fn the_page_that_took_the_keyboard_is_where_it_goes_back() {
        let homes = typing_in("main", "web-a");
        assert_eq!(homes.home("main"), Some("web-a"));
        assert_eq!(homes.home("window-2"), None);
    }
    #[test]
    fn a_person_in_the_app_s_own_page_takes_it_from_the_page() {
        let mut homes = typing_in("main", "web-a");
        homes.own_took("main");
        assert_eq!(homes.home("main"), None);
    }
    #[test]
    fn the_last_page_to_take_it_wins() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-b", true, 0);
        homes.page_took("main", "web-b");
        assert_eq!(homes.home("main"), Some("web-b"));
    }
    #[test]
    fn a_page_out_of_sight_is_never_handed_it_as_the_window_comes_back() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.home("main"), None);
        homes.placed("web-a", true, 0);
        assert_eq!(homes.home("main"), Some("web-a"));
    }
    #[test]
    fn a_page_that_closed_is_forgotten() {
        let mut homes = typing_in("main", "web-a");
        homes.closed("web-a");
        assert_eq!(homes.home("main"), None);
        assert_eq!(homes.back("main", 0), Back::Own);
        homes.page_took("main", "web-a");
        assert_eq!(homes.home("main"), None);
    }
    #[test]
    fn a_layer_closing_hands_a_page_on_screen_the_keyboard_now() {
        let mut homes = typing_in("main", "web-a");
        assert_eq!(homes.back("main", 5), Back::Page("web-a".into()));
    }
    #[test]
    fn a_page_still_under_the_layer_takes_it_as_it_is_shown_again() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 100), Back::Later);
        assert!(!homes.placed("web-b", true, 200));
        assert!(homes.placed("web-a", true, 300));
        assert!(!homes.placed("web-a", true, 400));
    }
    #[test]
    fn a_debt_runs_out() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 100), Back::Later);
        assert!(!homes.placed("web-a", true, 101 + OWED_MS));
    }
    #[test]
    fn the_keyboard_going_anywhere_else_first_clears_the_debt() {
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 0), Back::Later);
        homes.own_took("main");
        assert!(!homes.placed("web-a", true, 10));
        let mut homes = typing_in("main", "web-a");
        homes.placed("web-a", false, 0);
        assert_eq!(homes.back("main", 0), Back::Later);
        homes.closed("web-a");
        assert!(!homes.placed("web-a", true, 10));
    }
    #[test]
    fn chromium_on_linux_gives_the_keyboard_back_as_its_window_comes_back() {
        let life = include_str!("../../../src/lifecycle.rs");
        let focused =
            &life[life.find("event: WindowEvent::Focused(true)").expect("the window's focus")..];
        let focused = &focused[..focused.find("RunEvent::").expect("its end")];
        assert!(focused.contains("orden_web::keyboard::window_came_back(app, &label)"));
        let source = include_str!("keyboard.rs");
        let back = &source[source.find("pub fn window_came_back(").expect("window_came_back")..];
        let back = &back[..back.find("\n}\n").expect("its end")];
        assert!(back.contains("all.home(window)") && back.contains("native::take(app, window)"));
    }
    #[test]
    fn a_page_hands_the_app_its_keys_and_the_keyboard_at_its_ends_through_the_engine() {
        let runtime = "../../../linux/tauri-runtime-cef/src/cef_impl/client";
        let keys = include_str!("../../../linux/tauri-runtime-cef/src/cef_impl/client/keyboard.rs");
        assert!(keys.contains("crate::keys::pressed(label, event)"), "{runtime}/keyboard.rs");
        let focus = include_str!("../../../linux/tauri-runtime-cef/src/cef_impl/client/focus.rs");
        assert!(focus.contains("crate::keys::left(label, next != 0)"), "{runtime}/focus.rs");
        let client = include_str!("../../../linux/tauri-runtime-cef/src/cef_impl/client/mod.rs");
        assert!(client.contains("fn focus_handler(&self)"));
        let engine = include_str!("../../../src/engine.rs");
        assert!(engine.contains("tauri_runtime_cef::hear_keys(pressed, orden_web::keyboard::left)"));
        assert!(engine.contains("orden_web::keyboard::pressed("));
        let lib = include_str!("../../../src/lib.rs");
        assert!(lib.contains("engine::hear_keys();"));
        assert!(lib.contains("orden_web::web_keys::web_keys_app,"));
        assert!(lib.contains("orden_web::keyboard::keyboard_into,"));
    }
    #[test]
    fn a_press_in_a_page_hands_it_the_x_server_s_keyboard_too() {
        let source = include_str!("keyboard.rs");
        let pressed = &source[source.find("pub fn page_pressed(").expect("page_pressed")..];
        let pressed = &pressed[..pressed.find("\n}\n").expect("its end")];
        assert!(pressed.contains("native::holding(window)") && pressed.contains("hand_over(page)"));
        let keys = include_str!("web_keys.rs");
        let to = &keys[keys.find("pub fn focus_to(page: u32)").expect("focus_to")..];
        assert!(to[..to.find("\n    }\n").expect("its end")].contains(".set_input_focus("));
        let opens = include_str!("web_opens.rs");
        let heard = &opens[opens.find("if name == PRESSED_IN {").expect("the press")..];
        let heard = &heard[..heard.find("return;").expect("its end")];
        assert!(heard.contains("crate::keyboard::page_pressed(window, &page)"));
        let into = &source[source.find("pub fn keyboard_into(").expect("keyboard_into")..];
        assert!(into[..into.find("\n}\n").expect("its end")].contains("native::hand_over(&label)"));
    }
    #[test]
    fn the_engine_tells_the_app_s_own_page_as_a_page_takes_the_keyboard() {
        let source = include_str!("keyboard.rs");
        let module = |mark: &str| {
            let from = source.find(mark).expect(mark);
            let rest = &source[from..];
            &rest[..rest.find("\n}\n").expect("its end")]
        };
        let cef = module("\nmod native");
        assert!(cef.contains("super::page_took(app,"), "the X server's FocusIn is not passed on");
        let keys = include_str!("web_keys.rs");
        assert!(keys.contains("Event::FocusIn(") && keys.contains("crate::keyboard::x11_took("));
        assert!(keys.contains("EventMask::FOCUS_CHANGE"));
        let told = &source[source.find("pub fn page_took(").expect("page_took")..];
        assert!(told[..told.find("\n}").expect("its end")].contains("emit_to(window, IN_PAGE"));
    }
}
