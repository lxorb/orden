use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, PoisonError};
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
        self.typing
            .get(window)
            .filter(|page| self.shown.contains(*page))
            .map(String::as_str)
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
    look(&mut HOMES.lock().unwrap_or_else(PoisonError::into_inner))
}

fn now() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    u64::try_from(START.elapsed().as_millis()).unwrap_or(u64::MAX)
}

#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "a Mac's engine says it to the app's page itself")
)]
pub const IN_PAGE: &str = "orden://keyboard-in-page";

#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "a Mac's engine says it to the app's page itself")
)]
pub fn page_took(app: &AppHandle, window: &str, page: &str) {
    homes(|all| all.page_took(window, page));
    let _ = app.emit_to(window, IN_PAGE, ());
    crate::web_tabs::page_chosen(app, window, page);
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
    if native::holding(window).is_none() {
        let _ = native::take(app, window);
    }
}

pub fn closed(page: &str) {
    homes(|all| all.closed(page));
    native::let_go_of(page);
}

pub fn window_came_back(app: &AppHandle, window: &str) {
    if crate::placement::away().is_some() {
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

#[tauri::command]
pub fn keyboard_pressed(webview: Webview) {
    if webview.label() == webview.window().label() {
        let _ = native::take(webview.app_handle(), webview.label());
    }
}

#[tauri::command]
pub fn keyboard_watch(webview: Webview) {
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
    if crate::placement::away().is_some() || !native::in_front(&window) {
        return false;
    }
    match homes(|all| all.back(window.label(), now())) {
        Back::Page(page) => native::take(webview.app_handle(), &page),
        Back::Later => true,
        Back::Own => false,
    }
}

mod native {
    use std::collections::HashMap;
    use std::sync::{Mutex, PoisonError};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    static PAGES: Mutex<Vec<(String, String, u32)>> = Mutex::new(Vec::new());

    pub fn page(_app: &AppHandle, platform: &PlatformWebview, label: &str, window: &str) {
        let Some(x11) = crate::host::x11_page(platform) else {
            return;
        };
        let mut pages = PAGES.lock().unwrap_or_else(PoisonError::into_inner);
        pages.retain(|(one, _, _)| one != label);
        pages.push((label.to_string(), window.to_string(), x11));
    }

    pub fn let_go_of(label: &str) {
        PAGES
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|(one, _, _)| one != label);
    }

    #[cfg(target_os = "linux")]
    pub fn x11_took(app: &AppHandle, x11: u32) {
        let found = PAGES
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .find(|(_, _, one)| *one == x11)
            .map(|(label, window, _)| (label.clone(), window.clone()));
        if let Some((label, window)) = found {
            super::page_took(app, &window, &label);
        }
    }

    pub fn holding(window: &str) -> Option<String> {
        let pages: HashMap<u32, String> = PAGES
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .filter(|(_, holder, _)| holder == window)
            .map(|(label, _, x11)| (*x11, label.clone()))
            .collect();
        let found = crate::web_keys::focus_in(&pages.keys().copied().collect::<Vec<_>>())?;
        pages.get(&found).cloned()
    }

    pub fn take(app: &AppHandle, label: &str) -> bool {
        app.get_webview(label)
            .is_some_and(|page| page.set_focus().is_ok())
    }

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
    use super::{Back, Homes, OWED_MS};

    fn typing_in(window: &str, page: &str) -> Homes {
        let mut homes = Homes::default();
        homes.placed(page, true, 0);
        homes.page_took(window, page);
        homes
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
        let life = include_str!("lifecycle.rs");
        let focused = &life[life
            .find("event: WindowEvent::Focused(true)")
            .expect("the window's focus")..];
        let focused = &focused[..focused.find("RunEvent::").expect("its end")];
        assert!(focused.contains("crate::keyboard::window_came_back(app, &label)"));
        let source = include_str!("keyboard.rs");
        let back = &source[source
            .find("pub fn window_came_back(")
            .expect("window_came_back")..];
        let back = &back[..back.find("\n}\n").expect("its end")];
        assert!(back.contains("all.home(window)") && back.contains("native::take(app, window)"));
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
        assert!(
            cef.contains("super::page_took(app,"),
            "the X server's FocusIn is not passed on"
        );
        let keys = include_str!("web_keys.rs");
        assert!(keys.contains("Event::FocusIn(") && keys.contains("crate::keyboard::x11_took("));
        assert!(keys.contains("EventMask::FOCUS_CHANGE"));
        let told = &source[source.find("pub fn page_took(").expect("page_took")..];
        assert!(told[..told.find("\n}").expect("its end")].contains("emit_to(window, IN_PAGE"));
    }
}
