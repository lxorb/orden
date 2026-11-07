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

    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(
            dead_code,
            reason = "a Mac keeps a window's keyboard across activation itself"
        )
    )]
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

pub const IN_PAGE: &str = "orden://keyboard-in-page";

#[cfg_attr(
    not(any(windows, feature = "cef")),
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

#[cfg(feature = "cef")]
pub fn hold_for_layer(app: &AppHandle, window: &str) {
    if native::holding(window).is_none() {
        let _ = native::take(app, window);
    }
}

pub fn closed(page: &str) {
    homes(|all| all.closed(page));
    native::let_go_of(page);
}

#[cfg(feature = "cef")]
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
    #[cfg(windows)]
    watching::no_hidden_menu(window);
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
fn left(window: &str) {
    if let Some(page) = native::holding(window) {
        homes(|all| all.page_took(window, &page));
    }
}

#[cfg(windows)]
fn returned(window: &str) {
    let home = homes(|all| all.home(window).map(str::to_string));
    if crate::placement::away().is_some() {
        let own = if native::owns(window) {
            "kept"
        } else {
            "unknown"
        };
        eprintln!(
            "nib: keyboard: {window} back to {}, its own page {own}; held",
            home.as_deref().unwrap_or("its own page")
        );
        return;
    }
    match home {
        Some(page) => {
            if !native::take_now(&page) {
                native::take_own(window);
            }
        }
        None => native::take_own(window),
    }
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const PRESS_SCRIPT: &str = include_str!("keyboard_press.js");

#[tauri::command]
#[cfg_attr(
    not(feature = "cef"),
    allow(
        clippy::needless_pass_by_value,
        reason = "a command's arguments are its own"
    )
)]
pub fn keyboard_pressed(webview: Webview) {
    #[cfg(feature = "cef")]
    if webview.label() == webview.window().label() {
        let _ = native::take(webview.app_handle(), webview.label());
    }
    #[cfg(not(feature = "cef"))]
    let _ = webview;
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

#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "a window's messages are Windows' own")
)]
#[derive(Debug, PartialEq, Eq)]
enum Moment {
    Leaving,
    Back,
    Nothing,
}

#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "a window's messages are Windows' own")
)]
fn moment(message: u32, wparam: usize) -> Moment {
    const ACTIVATE: u32 = 0x0006;
    const SET_FOCUS: u32 = 0x0007;
    const EXIT_SIZE_MOVE: u32 = 0x0232;
    const INACTIVE: usize = 0;
    let how = wparam % 0x1_0000;
    match message {
        ACTIVATE if how == INACTIVE => Moment::Leaving,
        SET_FOCUS | EXIT_SIZE_MOVE => Moment::Back,
        _ => Moment::Nothing,
    }
}

#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "a window's messages are Windows' own")
)]
fn key_menu(message: u32, wparam: usize, lparam: isize) -> KeyMenu {
    const SYS_COMMAND: u32 = 0x0112;
    const KEY_MENU: usize = 0xF100;
    const SPACE: isize = 0x20;
    if message != SYS_COMMAND || wparam & 0xFFF0 != KEY_MENU {
        return KeyMenu::Not;
    }
    match lparam {
        0 => KeyMenu::Alone,
        SPACE => KeyMenu::WindowMenu,
        _ => KeyMenu::Not,
    }
}

#[derive(Debug, PartialEq, Eq)]
#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "a window's messages are Windows' own")
)]
enum KeyMenu {
    Not,
    Alone,
    WindowMenu,
}

#[cfg(windows)]
mod watching {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::{Webview, Window};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetFocus;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsChild, WM_NCDESTROY};

    use super::{key_menu, left, moment, returned, KeyMenu, Moment};

    const OURS: usize = 0x6b65_7973;

    const QUIET: usize = 0x6d65_6e75;

    thread_local! {
        static WINDOWS: RefCell<HashMap<isize, String>> = RefCell::new(HashMap::new());
    }

    #[allow(
        unsafe_code,
        reason = "a window's activation is heard through a Win32 subclass, which only the Win32 API installs"
    )]
    pub fn watch(webview: &Webview) {
        let window = webview.window();
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let (hwnd, label) = (hwnd.0 as isize, window.label().to_string());
        if WINDOWS.with_borrow_mut(|all| all.insert(hwnd, label).is_some()) {
            return;
        }
        unsafe {
            let _ = SetWindowSubclass(HWND(hwnd as *mut core::ffi::c_void), Some(heard), OURS, 0);
        }
    }

    #[allow(
        unsafe_code,
        reason = "a key's menu is heard through a Win32 subclass, which only the Win32 API installs"
    )]
    pub fn no_hidden_menu<R: tauri::Runtime>(window: &tauri::Window<R>) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        unsafe {
            let _ = SetWindowSubclass(
                HWND(hwnd.0 as isize as *mut core::ffi::c_void),
                Some(quiet),
                QUIET,
                0,
            );
        }
    }

    #[allow(
        unsafe_code,
        reason = "the subclass's own procedure, called by Win32 with the message's words"
    )]
    unsafe extern "system" fn quiet(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        match key_menu(message, wparam.0, lparam.0) {
            KeyMenu::Alone => return LRESULT(0),
            KeyMenu::WindowMenu => {
                window_menu(hwnd);
                return LRESULT(0);
            }
            KeyMenu::Not => {}
        }
        let answer = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if message == WM_NCDESTROY {
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(quiet), QUIET);
            }
        }
        answer
    }

    #[allow(
        unsafe_code,
        reason = "the window's own menu is Win32's, shown and answered through its calls"
    )]
    fn window_menu(hwnd: HWND) {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{
            EnableMenuItem, GetSystemMenu, GetWindowLongW, GetWindowRect, IsIconic, IsZoomed,
            PostMessageW, TrackPopupMenu, GWL_STYLE, MF_BYCOMMAND, MF_ENABLED, MF_GRAYED,
            SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE, TPM_RETURNCMD, TPM_RIGHTBUTTON,
            WM_SYSCOMMAND, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_THICKFRAME,
        };

        unsafe {
            let menu = GetSystemMenu(hwnd, false);
            if menu.is_invalid() {
                return;
            }
            let style = u32::from_ne_bytes(GetWindowLongW(hwnd, GWL_STYLE).to_ne_bytes());
            let (zoomed, iconic) = (IsZoomed(hwnd).as_bool(), IsIconic(hwnd).as_bool());
            let placed = !zoomed && !iconic;
            for (item, on) in [
                (SC_RESTORE, zoomed || iconic),
                (SC_MOVE, placed),
                (SC_SIZE, placed && style & WS_THICKFRAME.0 != 0),
                (SC_MINIMIZE, !iconic && style & WS_MINIMIZEBOX.0 != 0),
                (SC_MAXIMIZE, !zoomed && style & WS_MAXIMIZEBOX.0 != 0),
            ] {
                let _ = EnableMenuItem(
                    menu,
                    item,
                    MF_BYCOMMAND | if on { MF_ENABLED } else { MF_GRAYED },
                );
            }
            let mut at = RECT::default();
            if GetWindowRect(hwnd, &raw mut at).is_err() {
                return;
            }
            let chosen = TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON,
                at.left,
                at.top,
                0,
                hwnd,
                None,
            );
            if let Some(command) = usize::try_from(chosen.0).ok().filter(|one| *one != 0) {
                let _ = PostMessageW(hwnd, WM_SYSCOMMAND, WPARAM(command), LPARAM(0));
            }
        }
    }

    #[allow(
        unsafe_code,
        reason = "which window has the keyboard is Win32's to say"
    )]
    pub fn keyboard_in(host: isize) -> bool {
        let host = HWND(host as *mut core::ffi::c_void);
        unsafe {
            let focus = GetFocus();
            !focus.is_invalid() && (host == focus || IsChild(host, focus).as_bool())
        }
    }

    #[allow(unsafe_code, reason = "which window is in front is Win32's to say")]
    pub fn in_front(window: &Window) -> bool {
        let Ok(ours) = window.hwnd() else {
            return false;
        };
        let front = unsafe { GetForegroundWindow() };
        front.0 as isize == ours.0 as isize
    }

    #[allow(
        unsafe_code,
        reason = "the subclass's own procedure, called by Win32 with the message's words"
    )]
    unsafe extern "system" fn heard(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        let now = moment(message, wparam.0);
        let window = match now {
            Moment::Nothing => None,
            _ => WINDOWS.with_borrow(|all| all.get(&(hwnd.0 as isize)).cloned()),
        };
        if let (Some(window), Moment::Leaving) = (&window, &now) {
            left(window);
        }

        let answer = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };

        if let (Some(window), Moment::Back) = (&window, &now) {
            returned(window);
        }
        if message == WM_NCDESTROY {
            if let Some(gone) = WINDOWS.with_borrow_mut(|all| all.remove(&(hwnd.0 as isize))) {
                super::native::window_gone(&gone);
            }
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(heard), OURS);
            }
        }
        answer
    }
}

#[cfg(all(windows, not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Webview};
    use webview2_com::FocusChangedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
    };

    pub use super::watching::in_front;

    struct Page {
        window: String,
        controller: ICoreWebView2Controller,
    }

    thread_local! {
        static PAGES: RefCell<HashMap<String, Page>> = RefCell::new(HashMap::new());
        static OWN: RefCell<HashMap<String, ICoreWebView2Controller>> =
            RefCell::new(HashMap::new());
    }

    pub fn watch(webview: &Webview) {
        super::watching::watch(webview);
        let window = webview.window().label().to_string();
        let _ = webview.with_webview(move |platform| {
            OWN.with_borrow_mut(|all| all.insert(window, platform.controller()));
        });
    }

    pub fn owns(window: &str) -> bool {
        OWN.with_borrow(|all| all.contains_key(window))
    }

    pub fn window_gone(window: &str) {
        OWN.with_borrow_mut(|all| all.remove(window));
    }

    #[allow(
        unsafe_code,
        reason = "a page taking the keyboard is WebView2's own controller event, reached through COM"
    )]
    pub fn page(app: &AppHandle, platform: &PlatformWebview, label: &str, window: &str) {
        let controller = platform.controller();
        let (app, holder, named) = (app.clone(), window.to_string(), label.to_string());
        let got = FocusChangedEventHandler::create(Box::new(move |_, _| {
            super::page_took(&app, &holder, &named);
            Ok(())
        }));
        let mut token = 0i64;
        unsafe {
            let _ = controller.add_GotFocus(&got, &raw mut token);
        }
        let page = Page {
            window: window.to_string(),
            controller,
        };
        PAGES.with_borrow_mut(|all| all.insert(label.to_string(), page));
    }

    pub fn let_go_of(label: &str) {
        PAGES.with_borrow_mut(|all| all.remove(label));
    }

    #[allow(
        unsafe_code,
        reason = "a page's window is its WebView2 controller's to say, reached through COM"
    )]
    pub fn holding(window: &str) -> Option<String> {
        PAGES.with_borrow(|all| {
            all.iter().find_map(|(label, page)| {
                if page.window != window {
                    return None;
                }
                let mut parent = windows_com::Win32::Foundation::HWND::default();
                unsafe { page.controller.ParentWindow(&raw mut parent).ok()? };
                super::watching::keyboard_in(parent.0 as isize).then(|| label.clone())
            })
        })
    }

    #[allow(
        unsafe_code,
        reason = "a page is given the keyboard through its WebView2 controller, reached through COM"
    )]
    fn focus(controller: Option<ICoreWebView2Controller>) -> bool {
        controller.is_some_and(|controller| unsafe {
            controller
                .MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
                .is_ok()
        })
    }

    pub fn take_now(label: &str) -> bool {
        focus(PAGES.with_borrow(|all| all.get(label).map(|page| page.controller.clone())))
    }

    pub fn take(_app: &AppHandle, label: &str) -> bool {
        take_now(label)
    }

    pub fn take_own(window: &str) {
        focus(OWN.with_borrow(|all| all.get(window).cloned()));
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use objc2::rc::Retained;
    use objc2_app_kit::{NSView, NSWindow};
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    struct Page {
        window: String,
        view: Retained<WKWebView>,
        frame: Retained<NSWindow>,
    }

    thread_local! {
        static PAGES: RefCell<HashMap<String, Page>> = RefCell::new(HashMap::new());
    }

    #[allow(
        unsafe_code,
        reason = "the runtime hands the page and its window over as bare pointers"
    )]
    pub fn page(_app: &AppHandle, platform: &PlatformWebview, label: &str, window: &str) {
        let (view, frame) = unsafe {
            (
                Retained::retain(platform.inner().cast::<WKWebView>()),
                Retained::retain(platform.ns_window().cast::<NSWindow>()),
            )
        };
        if let (Some(view), Some(frame)) = (view, frame) {
            let page = Page {
                window: window.to_string(),
                view,
                frame,
            };
            PAGES.with_borrow_mut(|all| all.insert(label.to_string(), page));
        }
    }

    pub fn let_go_of(label: &str) {
        PAGES.with_borrow_mut(|all| all.remove(label));
    }

    pub fn holding(window: &str) -> Option<String> {
        PAGES.with_borrow(|all| {
            all.iter().find_map(|(label, page)| {
                if page.window != window {
                    return None;
                }
                let responder = page.frame.firstResponder()?;
                let view = responder.downcast::<NSView>().ok()?;
                view.isDescendantOf(&page.view).then(|| label.clone())
            })
        })
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

#[cfg(feature = "cef")]
mod native {
    use std::collections::HashMap;
    use std::sync::{Mutex, PoisonError};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    static PAGES: Mutex<Vec<(String, String, u32)>> = Mutex::new(Vec::new());

    pub fn page(_app: &AppHandle, platform: &PlatformWebview, label: &str, window: &str) {
        let Some(x11) = crate::web_keys::x11_window(platform) else {
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

#[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
mod native {
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview, Window};

    pub fn page(_app: &AppHandle, _platform: &PlatformWebview, _label: &str, _window: &str) {}

    pub fn let_go_of(_label: &str) {}

    pub fn holding(_window: &str) -> Option<String> {
        None
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
#[cfg(feature = "cef")]
pub use native::x11_took;

#[cfg(test)]
mod tests {
    use super::{key_menu, moment, Back, Homes, KeyMenu, Moment, OWED_MS};

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
    fn the_window_s_own_page_is_handed_the_keyboard_here_and_not_left_to_wry() {
        let source = include_str!("keyboard.rs");
        let from = source
            .find("#[cfg(all(windows, not(feature = \"cef\")))]\nmod native")
            .expect("the WebView2 module");
        let webview2 = &source[from..];
        let webview2 = &webview2[..webview2.find("\n}\n").expect("its end")];
        let own = &webview2[webview2.find("pub fn take_own(").expect("take_own")..];
        let own = &own[..own.find("\n    }").unwrap_or(own.len())];
        assert!(
            own.contains("focus(OWN."),
            "take_own leaves the app's own page to wry"
        );
        assert!(
            webview2.contains("all.insert(window, platform.controller())"),
            "the window's own page is never kept"
        );
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
    fn every_engine_tells_the_app_s_own_page_as_a_page_takes_the_keyboard() {
        let source = include_str!("keyboard.rs");
        let module = |mark: &str| {
            let from = source.find(mark).expect(mark);
            let rest = &source[from..];
            &rest[..rest.find("\n}\n").expect("its end")]
        };
        let webview2 = module("#[cfg(all(windows, not(feature = \"cef\")))]\nmod native");
        assert!(
            webview2.contains("add_GotFocus") && webview2.contains("super::page_took(&app,"),
            "WebView2's GotFocus is not passed on"
        );
        let cef = module("#[cfg(feature = \"cef\")]\nmod native");
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

    #[test]
    fn a_window_is_left_on_its_deactivation_and_home_on_its_focus_or_a_drag_s_end() {
        assert_eq!(moment(0x0006, 0), Moment::Leaving);
        assert_eq!(moment(0x0006, 0x0001_0000), Moment::Leaving);
        assert_eq!(moment(0x0006, 1), Moment::Nothing);
        assert_eq!(moment(0x0006, 2), Moment::Nothing);
        assert_eq!(moment(0x0007, 0), Moment::Back);
        assert_eq!(moment(0x0232, 0), Moment::Back);
        assert_eq!(moment(0x0008, 0), Moment::Nothing);
        assert_eq!(moment(0x0231, 0), Moment::Nothing);
    }

    #[test]
    fn alt_or_f10_alone_opens_no_menu_loop_and_alt_space_opens_the_window_menu_alone() {
        assert_eq!(key_menu(0x0112, 0xF100, 0), KeyMenu::Alone);
        assert_eq!(key_menu(0x0112, 0xF102, 0), KeyMenu::Alone);
        assert_eq!(key_menu(0x0112, 0xF100, 0x20), KeyMenu::WindowMenu);
        assert_eq!(key_menu(0x0112, 0xF100, 0x66), KeyMenu::Not);
        assert_eq!(key_menu(0x0112, 0xF060, 0), KeyMenu::Not);
        assert_eq!(key_menu(0x0112, 0xF020, 0), KeyMenu::Not);
        assert_eq!(key_menu(0x0105, 0x12, 0), KeyMenu::Not);
    }
}
