use tauri::{Runtime, Window};

#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "only a Windows window has the strip this decides")
)]
fn resizes_from_top(maximized: bool, minimized: bool, sizing_frame: bool) -> bool {
    sizing_frame && !maximized && !minimized
}

pub fn mind<R: Runtime>(window: &Window<R>) {
    #[cfg(windows)]
    strip::mind(window);
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
mod strip {
    use tauri::{Runtime, Window};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, GetWindowLongW, IsIconic, IsZoomed, ShowWindow, GWL_STYLE, SW_HIDE,
        SW_SHOWNA, WM_NCDESTROY, WM_SIZE, WM_STYLECHANGED, WS_THICKFRAME, WS_VISIBLE,
    };

    const OURS: usize = 0x746f_7065;

    #[allow(
        unsafe_code,
        reason = "a window's size and style are heard through a Win32 subclass, which only the Win32 API installs"
    )]
    pub fn mind<R: Runtime>(window: &Window<R>) {
        use tauri::Manager as _;
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || {
            let window = HWND(hwnd as *mut core::ffi::c_void);
            unsafe {
                let _ = SetWindowSubclass(window, Some(listened), OURS, 0);
            }
            matched(window);
        });
    }

    #[allow(
        unsafe_code,
        reason = "a subclass procedure is called by Windows with the window's own message"
    )]
    unsafe extern "system" fn listened(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        let answer = unsafe { DefSubclassProc(window, message, wparam, lparam) };
        match message {
            WM_SIZE | WM_STYLECHANGED => matched(window),
            WM_NCDESTROY => {
                let _ = unsafe { RemoveWindowSubclass(window, Some(listened), OURS) };
            }
            _ => {}
        }
        answer
    }

    #[allow(
        unsafe_code,
        reason = "the strip is a Win32 child window that Tauri hands out no handle to"
    )]
    fn matched(window: HWND) {
        unsafe {
            let Ok(strip) = FindWindowExW(
                window,
                HWND::default(),
                w!("TAURI_DRAG_RESIZE_BORDERS"),
                w!("TAURI_DRAG_RESIZE_WINDOW"),
            ) else {
                return;
            };
            let style = |of| u32::from_ne_bytes(GetWindowLongW(of, GWL_STYLE).to_ne_bytes());
            let wanted = super::resizes_from_top(
                IsZoomed(window).as_bool(),
                IsIconic(window).as_bool(),
                style(window) & WS_THICKFRAME.0 != 0,
            );
            if (style(strip) & WS_VISIBLE.0 != 0) != wanted {
                let _ = ShowWindow(strip, if wanted { SW_SHOWNA } else { SW_HIDE });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::resizes_from_top;

    #[test]
    fn a_window_in_its_own_size_resizes_from_its_top() {
        assert!(resizes_from_top(false, false, true));
    }

    #[test]
    fn a_maximised_window_does_not() {
        assert!(!resizes_from_top(true, false, true));
    }

    #[test]
    fn a_full_screen_window_has_no_frame_to_resize_by() {
        assert!(!resizes_from_top(false, false, false));
    }

    #[test]
    fn a_minimised_window_does_not() {
        assert!(!resizes_from_top(false, true, true));
        assert!(!resizes_from_top(true, true, true));
    }
}
