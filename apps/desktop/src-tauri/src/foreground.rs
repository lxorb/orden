#[cfg(any(windows, test))]
const NO_ACTIVATE: u32 = 0x0800_0000;
#[cfg(any(windows, test))]
const TOOL_WINDOW: u32 = 0x0000_0080;
#[cfg(any(windows, test))]
const APP_WINDOW: u32 = 0x0004_0000;
#[cfg(any(windows, test))]
const CHILD: u32 = 0x4000_0000;

pub fn hold() -> bool {
    #[cfg(windows)]
    if crate::placement::asked_away() {
        let locked = held::lock();
        held::on_this_thread();
        held::every_thread_or_say();
        return locked;
    }
    false
}

#[cfg(any(windows, test))]
const PARKED: i32 = -32_000;

#[cfg(any(windows, test))]
fn kept_off(to: (i32, i32), on_a_screen: bool) -> (i32, i32) {
    if on_a_screen {
        (PARKED, PARKED)
    } else {
        to
    }
}

#[cfg(any(windows, test))]
fn kept_back(asked: u32) -> u32 {
    (asked | NO_ACTIVATE | TOOL_WINDOW) & !APP_WINDOW
}

#[cfg(any(windows, test))]
fn top_level(style: u32, for_messages: bool) -> bool {
    style & CHILD == 0 && !for_messages
}

#[cfg(windows)]
mod held {
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{MonitorFromRect, MONITOR_DEFAULTTONULL};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetDesktopWindow, GetWindowLongW, GetWindowRect,
        LockSetForegroundWindow, SetWindowLongW, SetWindowPos, SetWindowsHookExW, CBT_CREATEWNDW,
        CHILDID_SELF, EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW, GA_PARENT, GWL_EXSTYLE,
        HCBT_ACTIVATE, HCBT_CREATEWND, HHOOK, HWND_MESSAGE, LSFW_LOCK, OBJID_WINDOW, STYLESTRUCT,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WH_CBT, WINDOWPOS, WINDOW_EX_STYLE,
        WINEVENT_INCONTEXT, WM_NCCREATE, WM_NCDESTROY, WM_STYLECHANGING, WM_WINDOWPOSCHANGING,
    };

    const SUBCLASS: usize = 0x6e69_6200;

    #[allow(unsafe_code, reason = "locking the foreground is a Win32 call")]
    pub fn lock() -> bool {
        unsafe { LockSetForegroundWindow(LSFW_LOCK) }.is_ok()
    }

    #[allow(unsafe_code, reason = "setting a window hook is a Win32 call")]
    pub fn on_this_thread() {
        let _ = unsafe {
            SetWindowsHookExW(
                WH_CBT,
                Some(watching),
                HINSTANCE::default(),
                GetCurrentThreadId(),
            )
        };
    }

    #[allow(unsafe_code, reason = "setting an event hook is a Win32 call")]
    pub fn on_every_thread(thread: u32) -> Option<HWINEVENTHOOK> {
        unsafe {
            let module = GetModuleHandleW(None).ok()?;
            let hook = SetWinEventHook(
                EVENT_OBJECT_CREATE,
                EVENT_OBJECT_SHOW,
                module,
                Some(made),
                GetCurrentProcessId(),
                thread,
                WINEVENT_INCONTEXT,
            );
            (!hook.is_invalid()).then_some(hook)
        }
    }

    pub fn every_thread_or_say() {
        if on_every_thread(0).is_none() {
            eprintln!(
                "nib: the system refused the window-event hook ({}); a window another \
                 thread makes is not held off the screens",
                in_context_refusal()
                    .map_or_else(|| "this module".to_owned(), |code| code.to_string())
            );
        }
    }

    #[allow(
        unsafe_code,
        reason = "setting and removing an event hook are Win32 calls"
    )]
    pub fn in_context_refusal() -> Option<u32> {
        use windows::core::w;
        use windows::Win32::Foundation::GetLastError;
        use windows::Win32::UI::Accessibility::UnhookWinEvent;

        unsafe extern "system" fn nothing(
            _hook: HWINEVENTHOOK,
            _event: u32,
            _window: HWND,
            _object: i32,
            _child: i32,
            _thread: u32,
            _time: u32,
        ) {
        }

        unsafe {
            let module = GetModuleHandleW(w!("user32.dll")).ok()?;
            let hook = SetWinEventHook(
                EVENT_OBJECT_CREATE,
                EVENT_OBJECT_CREATE,
                module,
                Some(nothing),
                GetCurrentProcessId(),
                0,
                WINEVENT_INCONTEXT,
            );
            if hook.is_invalid() {
                return Some(GetLastError().0);
            }
            let _ = UnhookWinEvent(hook);
            None
        }
    }

    #[allow(
        unsafe_code,
        reason = "an event hook is a callback the system calls with a window it names"
    )]
    unsafe extern "system" fn made(
        _hook: HWINEVENTHOOK,
        event: u32,
        window: HWND,
        object: i32,
        child: i32,
        _thread: u32,
        _time: u32,
    ) {
        let itself = object == OBJID_WINDOW.0 && u32::try_from(child) == Ok(CHILDID_SELF);
        if !itself || !(event == EVENT_OBJECT_CREATE || event == EVENT_OBJECT_SHOW) {
            return;
        }
        if !top_level_now(window) {
            return;
        }
        unsafe {
            let _ = SetWindowSubclass(window, Some(holding), SUBCLASS, 0);
            let now = u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
            let _ = SetWindowLongW(
                window,
                GWL_EXSTYLE,
                i32::from_ne_bytes(super::kept_back(now).to_ne_bytes()),
            );
        }
        let mut now = RECT::default();
        if unsafe { GetWindowRect(window, &raw mut now) }.is_err() {
            return;
        }
        let to = super::kept_off((now.left, now.top), on_a_screen(&now));
        if to != (now.left, now.top) {
            let _ = unsafe {
                SetWindowPos(
                    window,
                    HWND::default(),
                    to.0,
                    to.1,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                )
            };
        }
    }

    #[allow(unsafe_code, reason = "asking a window's parent is a Win32 call")]
    fn top_level_now(window: HWND) -> bool {
        unsafe { GetAncestor(window, GA_PARENT) == GetDesktopWindow() }
    }

    #[allow(
        unsafe_code,
        reason = "asking which screen a rectangle is on is a Win32 call"
    )]
    fn on_a_screen(rectangle: &RECT) -> bool {
        if rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top {
            return false;
        }
        !unsafe { MonitorFromRect(rectangle, MONITOR_DEFAULTTONULL) }.is_invalid()
    }

    #[allow(unsafe_code, reason = "reading where a window is now is a Win32 call")]
    fn kept_away(window: HWND, going: &mut WINDOWPOS) {
        if !top_level_now(window) {
            return;
        }
        let mut now = RECT::default();
        if unsafe { GetWindowRect(window, &raw mut now) }.is_err() {
            return;
        }
        let (left, top) = if going.flags.contains(SWP_NOMOVE) {
            (now.left, now.top)
        } else {
            (going.x, going.y)
        };
        let (width, height) = if going.flags.contains(SWP_NOSIZE) {
            (now.right - now.left, now.bottom - now.top)
        } else {
            (going.cx, going.cy)
        };
        let lands = RECT {
            left,
            top,
            right: left.saturating_add(width),
            bottom: top.saturating_add(height),
        };
        let to = super::kept_off((left, top), on_a_screen(&lands));
        if to != (left, top) {
            (going.x, going.y) = to;
            going.flags &= !SWP_NOMOVE;
        }
    }

    #[allow(
        unsafe_code,
        reason = "a window hook is a callback the system calls with pointers it owns"
    )]
    unsafe extern "system" fn watching(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match u32::try_from(code) {
            Ok(HCBT_ACTIVATE) => return LRESULT(1),
            Ok(HCBT_CREATEWND) => unsafe {
                let told = lparam.0 as *const CBT_CREATEWNDW;
                if let Some(making) = told.as_ref().and_then(|told| told.lpcs.as_mut()) {
                    let style = u32::from_ne_bytes(making.style.to_ne_bytes());
                    if super::top_level(style, making.hwndParent == HWND_MESSAGE) {
                        making.dwExStyle = WINDOW_EX_STYLE(super::kept_back(making.dwExStyle.0));
                        making.x = super::PARKED;
                        making.y = super::PARKED;
                        let _ = SetWindowSubclass(HWND(wparam.0 as _), Some(holding), SUBCLASS, 0);
                    }
                }
            },
            _ => {}
        }
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }

    #[allow(
        unsafe_code,
        reason = "a subclass procedure is a callback the system calls with pointers it owns"
    )]
    unsafe extern "system" fn holding(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        let index = isize::from_ne_bytes(wparam.0.to_ne_bytes());
        if message == WM_STYLECHANGING && i32::try_from(index) == Ok(GWL_EXSTYLE.0) {
            if let Some(changing) = unsafe { (lparam.0 as *mut STYLESTRUCT).as_mut() } {
                changing.styleNew = super::kept_back(changing.styleNew);
            }
        }
        if message == WM_WINDOWPOSCHANGING {
            if let Some(going) = unsafe { (lparam.0 as *mut WINDOWPOS).as_mut() } {
                kept_away(window, going);
            }
        }
        if message == WM_NCDESTROY {
            let _ = unsafe { RemoveWindowSubclass(window, Some(holding), SUBCLASS) };
        }
        let answer = unsafe { DefSubclassProc(window, message, wparam, lparam) };
        if message == WM_NCCREATE {
            unsafe {
                let now = u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
                let _ = SetWindowLongW(
                    window,
                    GWL_EXSTYLE,
                    i32::from_ne_bytes(super::kept_back(now).to_ne_bytes()),
                );
            }
        }
        answer
    }
}

#[cfg(test)]
mod tests {
    use super::{
        kept_back, kept_off, top_level, APP_WINDOW, CHILD, NO_ACTIVATE, PARKED, TOOL_WINDOW,
    };

    #[test]
    fn a_window_is_held_back_whatever_style_it_asked_for() {
        for asked in [
            0,
            APP_WINDOW,
            NO_ACTIVATE,
            APP_WINDOW | 0x0010_0000,
            u32::MAX,
        ] {
            let kept = kept_back(asked);
            assert_eq!(
                kept & NO_ACTIVATE,
                NO_ACTIVATE,
                "{asked:#x} can be activated"
            );
            assert_eq!(kept & TOOL_WINDOW, TOOL_WINDOW, "{asked:#x} is in Alt+Tab");
            assert_eq!(kept & APP_WINDOW, 0, "{asked:#x} has a taskbar button");
        }
        assert_eq!(kept_back(0x0010_0000) & 0x0010_0000, 0x0010_0000);
    }

    #[test]
    fn the_app_holds_itself_back_before_it_makes_anything() {
        let lib = include_str!("lib.rs");
        let start = lib.find("pub fn run_on(").expect("run_on");
        let held = lib[start..]
            .find("foreground::hold()")
            .expect("run_on holds the process back");
        for later in ["generate_context!", ".plugin("] {
            let at = lib[start..].find(later).expect(later);
            assert!(held < at, "{later} comes before the process is held back");
        }
    }

    #[test]
    fn a_window_that_would_be_on_a_screen_is_parked_and_any_other_left_alone() {
        assert_eq!(kept_off((100, 200), true), (PARKED, PARKED));
        assert_eq!(kept_off((-5000, 40), false), (-5000, 40));
        assert_eq!(kept_off((PARKED, PARKED), false), (PARKED, PARKED));
    }

    #[test]
    fn only_a_top_level_window_is_held_back() {
        assert!(top_level(0x0000_0000, false));
        assert!(top_level(0x9000_0000, false), "a popup is top level");
        assert!(!top_level(CHILD, false));
        assert!(
            !top_level(0, true),
            "a window for messages is on no desktop"
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_styles_are_the_system_s() {
        use windows::Win32::UI::WindowsAndMessaging::{
            WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };

        assert_eq!(NO_ACTIVATE, WS_EX_NOACTIVATE.0);
        assert_eq!(TOOL_WINDOW, WS_EX_TOOLWINDOW.0);
        assert_eq!(APP_WINDOW, WS_EX_APPWINDOW.0);
        assert_eq!(CHILD, WS_CHILD.0);
    }

    #[cfg(windows)]
    #[test]
    fn a_real_window_is_held_back_and_never_activated() {
        let plain = std::thread::spawn(|| made_and_asked(false))
            .join()
            .expect("the plain thread");
        assert!(
            plain.activated,
            "the system refused by itself; the test proves nothing"
        );
        assert_eq!(plain.made & APP_WINDOW, APP_WINDOW);

        let held = std::thread::spawn(|| made_and_asked(true))
            .join()
            .expect("the held thread");
        for (when, style) in [("made", held.made), ("restyled", held.restyled)] {
            assert_eq!(
                style & (NO_ACTIVATE | TOOL_WINDOW),
                NO_ACTIVATE | TOOL_WINDOW,
                "{when}: can be activated or is in Alt+Tab"
            );
            assert_eq!(style & APP_WINDOW, 0, "{when}: has a taskbar button");
        }
        assert!(!held.activated, "activated");
    }

    #[cfg(windows)]
    struct Asked {
        made: u32,
        restyled: u32,
        activated: bool,
    }

    #[cfg(windows)]
    #[allow(unsafe_code, reason = "making, restyling and activating a real window")]
    fn made_and_asked(holding: bool) -> Asked {
        use windows::core::w;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetActiveWindow, SetActiveWindow};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowLongW, SetWindowLongW, GWL_EXSTYLE,
            WS_EX_APPWINDOW, WS_POPUP,
        };

        if holding {
            super::held::on_this_thread();
        }
        unsafe {
            let window = CreateWindowExW(
                WS_EX_APPWINDOW,
                w!("STATIC"),
                w!("held back"),
                WS_POPUP,
                -32_000,
                -32_000,
                100,
                100,
                None,
                None,
                None,
                None,
            )
            .expect("a window");
            let style = || u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
            let made = style();
            SetWindowLongW(
                window,
                GWL_EXSTYLE,
                i32::from_ne_bytes(APP_WINDOW.to_ne_bytes()),
            );
            let restyled = style();
            let _ = SetActiveWindow(window);
            let activated = GetActiveWindow() == window;
            DestroyWindow(window).expect("destroyed");
            Asked {
                made,
                restyled,
                activated,
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_dialog_any_thread_raises_is_never_on_a_screen() {
        if let Some(code) = super::held::in_context_refusal() {
            eprintln!(
                "skipped: this system refuses every in-context event hook (error {code}), \
                 whatever the module; a Windows runner holds this test"
            );
            return;
        }
        let plain = a_message_box_watched(false);
        assert!(plain.seen, "the plain dialog never appeared");
        assert!(
            plain.on_a_screen,
            "the system kept the dialog off the screens by itself; the test proves nothing"
        );

        let held = a_message_box_watched(true);
        assert!(held.seen, "the held dialog never appeared");
        assert!(!held.on_a_screen, "the held dialog was on a screen");
    }

    #[cfg(windows)]
    struct Watched {
        seen: bool,
        on_a_screen: bool,
    }

    #[cfg(windows)]
    #[allow(
        unsafe_code,
        reason = "a message box, a move and a close are Win32 calls"
    )]
    fn a_message_box_watched(holding: bool) -> Watched {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        use windows::core::w;
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::System::StationsAndDesktops::{CloseDesktop, HDESK};
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::Accessibility::UnhookWinEvent;
        use windows::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, PostMessageW, SetWindowPos, MB_OK, SWP_NOACTIVATE, SWP_NOSIZE,
            SWP_NOZORDER, WM_CLOSE,
        };

        let desktop = own_desktop(holding);
        let (told, thread) = mpsc::channel();
        let (go, going) = mpsc::channel::<()>();
        let maker = on_desktop(desktop, move || {
            told.send(unsafe { GetCurrentThreadId() }).expect("told");
            going.recv().expect("go");
            unsafe {
                MessageBoxW(
                    None,
                    w!("An extension could not be loaded."),
                    w!("Load error"),
                    MB_OK,
                );
            }
        });
        let raising = thread.recv().expect("the maker's thread");
        let (hooked, hearing) = mpsc::channel();
        let (done, ending) = mpsc::channel::<()>();
        let hooking = on_desktop(desktop, move || {
            let hook = holding.then(|| super::held::on_every_thread(raising).expect("the hook"));
            hooked.send(()).expect("hooked");
            ending.recv().expect("done");
            if let Some(hook) = hook {
                let _ = unsafe { UnhookWinEvent(hook) };
            }
        });
        hearing.recv().expect("hooked");
        go.send(()).expect("go");

        let mut watched = Watched {
            seen: false,
            on_a_screen: false,
        };
        let mut first: Option<Instant> = None;
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until && !maker.is_finished() {
            for (window, on_a_screen) in shown(desktop, raising) {
                let window = HWND(window as _);
                watched.seen = true;
                watched.on_a_screen |= on_a_screen;
                let since = *first.get_or_insert_with(|| {
                    let _ = unsafe {
                        SetWindowPos(
                            window,
                            HWND::default(),
                            100,
                            100,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                    };
                    Instant::now()
                });
                if since.elapsed() > Duration::from_millis(400) {
                    let _ = unsafe { PostMessageW(window, WM_CLOSE, WPARAM(0), LPARAM(0)) };
                }
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        maker.join().expect("the maker");
        done.send(()).expect("done");
        hooking.join().expect("the hooker");
        let _ = unsafe { CloseDesktop(HDESK(desktop as _)) };
        watched
    }

    #[cfg(windows)]
    #[allow(unsafe_code, reason = "making a desktop is a Win32 call")]
    fn own_desktop(which: bool) -> isize {
        use windows::core::PCWSTR;
        use windows::Win32::System::StationsAndDesktops::{CreateDesktopW, DESKTOP_CONTROL_FLAGS};

        const EVERYTHING: u32 = 0x1000_0000;

        let name: Vec<u16> = format!(
            "nib-foreground-test-{}-{}",
            std::process::id(),
            u8::from(which)
        )
        .encode_utf16()
        .chain([0])
        .collect();
        let desktop = unsafe {
            CreateDesktopW(
                PCWSTR(name.as_ptr()),
                None,
                None,
                DESKTOP_CONTROL_FLAGS(0),
                EVERYTHING,
                None,
            )
        }
        .expect("a desktop of the test's own");
        desktop.0 as isize
    }

    #[cfg(windows)]
    #[allow(unsafe_code, reason = "moving a thread to a desktop is a Win32 call")]
    fn on_desktop(
        desktop: isize,
        work: impl FnOnce() + Send + 'static,
    ) -> std::thread::JoinHandle<()> {
        use windows::Win32::System::StationsAndDesktops::{SetThreadDesktop, HDESK};

        std::thread::spawn(move || {
            unsafe { SetThreadDesktop(HDESK(desktop as _)) }.expect("on the test's desktop");
            work();
        })
    }

    #[cfg(windows)]
    #[allow(unsafe_code, reason = "listing a desktop's windows is a Win32 call")]
    fn shown(desktop: isize, thread: u32) -> Vec<(isize, bool)> {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
        use windows::Win32::Graphics::Gdi::{MonitorFromRect, MONITOR_DEFAULTTONULL};
        use windows::Win32::System::StationsAndDesktops::{EnumDesktopWindows, HDESK};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        };

        unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
            unsafe { (*(found.0 as *mut Vec<isize>)).push(window.0 as isize) };
            BOOL(1)
        }

        let mut found: Vec<isize> = Vec::new();
        let _ = unsafe {
            EnumDesktopWindows(
                HDESK(desktop as _),
                Some(each),
                LPARAM(&raw mut found as isize),
            )
        };
        found
            .into_iter()
            .filter_map(|one| {
                let window = HWND(one as _);
                unsafe {
                    if GetWindowThreadProcessId(window, None) != thread
                        || !IsWindowVisible(window).as_bool()
                    {
                        return None;
                    }
                    let mut place = RECT::default();
                    GetWindowRect(window, &raw mut place).ok()?;
                    let on = !MonitorFromRect(&raw const place, MONITOR_DEFAULTTONULL).is_invalid();
                    Some((one, on))
                }
            })
            .collect()
    }
}
