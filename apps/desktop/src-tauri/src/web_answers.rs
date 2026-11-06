pub const NOT_ANSWERING: &str = "that page is not answering";

pub fn said(app: &tauri::AppHandle) {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let Ok(mut last) = LAST.lock() else { return };
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
        return;
    }
    *last = Some(Instant::now());
    crate::logs::say(
        app,
        "warn",
        "stall: a web page's browser is not answering; the page waits rather than the window",
    );
}

#[cfg(all(windows, not(feature = "cef")))]
pub fn answers(view: &tauri::Webview) -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let answered = Arc::new(AtomicBool::new(true));
    let telling = answered.clone();
    let _ = view.with_webview(move |platform| {
        let mut held = windows_com::Win32::Foundation::HWND::default();
        let mut browser = 0u32;
        #[allow(
            unsafe_code,
            reason = "the controller and its page are WebView2's COM interfaces"
        )]
        let named = unsafe {
            let controller = platform.controller();
            controller.ParentWindow(&raw mut held).is_ok()
                && controller
                    .CoreWebView2()
                    .is_ok_and(|core| core.BrowserProcessId(&raw mut browser).is_ok())
        };
        if named && browser != 0 {
            telling.store(engine::answers(held.0 as isize, browser), Ordering::SeqCst);
        }
    });
    answered.load(Ordering::SeqCst)
}

#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn answers(_view: &tauri::Webview) -> bool {
    true
}

#[cfg(all(windows, not(feature = "cef")))]
pub fn put_away(view: &tauri::Webview) {
    let _ = view.with_webview(|platform| {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
        };

        const AWAY: i32 = -100_000;

        let mut held = windows_com::Win32::Foundation::HWND::default();
        #[allow(
            unsafe_code,
            reason = "the holder is named by WebView2's COM interface and moved through Win32"
        )]
        unsafe {
            if platform.controller().ParentWindow(&raw mut held).is_ok() {
                let _ = SetWindowPos(
                    windows::Win32::Foundation::HWND(held.0),
                    None,
                    AWAY,
                    AWAY,
                    0,
                    0,
                    SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                );
            }
        }
    });
}

#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn put_away(_view: &tauri::Webview) {}

pub fn close_when_answering(app: &tauri::AppHandle, label: String) {
    #[cfg(feature = "cef")]
    use tauri::Manager as _;
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let (told, heard) = std::sync::mpsc::channel();
        let asking = app.clone();
        let named = label.clone();
        let posted = app.run_on_main_thread(move || {
            use tauri::Manager as _;
            let done = match asking.get_webview(&named) {
                None => true,
                Some(view) if answers(&view) => {
                    let _ = view.close();
                    true
                }
                Some(_) => false,
            };
            let _ = told.send(done);
        });
        if posted.is_err() || heard.recv().unwrap_or(true) {
            return;
        }
    });
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetWindowThreadProcessId, IsWindow, SendMessageTimeoutW,
        SMTO_ABORTIFHUNG, SMTO_BLOCK, SMTO_ERRORONEXIT, WM_NULL,
    };

    const MOMENT: u32 = 150;

    struct Looking {
        browser: u32,
        found: isize,
    }

    #[allow(
        unsafe_code,
        reason = "a window of another process is found and asked through Win32"
    )]
    pub fn answers(holder: isize, browser: u32) -> bool {
        unsafe extern "system" fn of_the_browser(window: HWND, looking: LPARAM) -> BOOL {
            let looking = unsafe { &mut *(looking.0 as *mut Looking) };
            let mut process = 0u32;
            unsafe { GetWindowThreadProcessId(window, Some(&raw mut process)) };
            if process == looking.browser {
                looking.found = window.0 as isize;
                return BOOL(0);
            }
            BOOL(1)
        }

        let mut looking = Looking { browser, found: 0 };
        unsafe {
            let _ = EnumChildWindows(
                HWND(holder as *mut core::ffi::c_void),
                Some(of_the_browser),
                LPARAM(&raw mut looking as isize),
            );
        }
        let found = looking.found;
        if found == 0 {
            return true;
        }
        let mut result = 0usize;
        let sent = unsafe {
            SendMessageTimeoutW(
                HWND(found as *mut core::ffi::c_void),
                WM_NULL,
                WPARAM(0),
                LPARAM(0),
                SMTO_ABORTIFHUNG | SMTO_BLOCK | SMTO_ERRORONEXIT,
                MOMENT,
                Some(&raw mut result),
            )
        };
        sent.0 != 0 || !unsafe { IsWindow(HWND(found as *mut core::ffi::c_void)) }.as_bool()
    }
}
