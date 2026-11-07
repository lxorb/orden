const INPUT_WINDOW: &str = "Chrome_RenderWidgetHostHWND";

const WHEEL: u32 = 0x020A;
const TILT: u32 = 0x020E;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    Ctrl,
    Shift,
    Left,
    Right,
    Middle,
    Back,
    Forward,
}

impl Hold {
    pub const ALL: [Self; 7] = [
        Self::Left,
        Self::Right,
        Self::Shift,
        Self::Ctrl,
        Self::Middle,
        Self::Back,
        Self::Forward,
    ];

    pub fn flag(self) -> u16 {
        match self {
            Self::Left => 0x0001,
            Self::Right => 0x0002,
            Self::Shift => 0x0004,
            Self::Ctrl => 0x0008,
            Self::Middle => 0x0010,
            Self::Back => 0x0020,
            Self::Forward => 0x0040,
        }
    }

    pub fn wired(self, swapped: bool) -> Self {
        match (self, swapped) {
            (Self::Left, true) => Self::Right,
            (Self::Right, true) => Self::Left,
            (one, _) => one,
        }
    }
}

pub fn is_wheel(message: u32) -> bool {
    message == WHEEL || message == TILT
}

pub fn is_input_window(class: &str) -> bool {
    class == INPUT_WINDOW
}

pub fn keys(held: impl Fn(Hold) -> bool) -> u16 {
    Hold::ALL
        .into_iter()
        .filter(|one| held(*one))
        .fold(0, |all, one| all | one.flag())
}

pub fn wparam(delta: i16, keys: u16) -> usize {
    (usize::from(u16::from_ne_bytes(delta.to_ne_bytes())) << 16) | usize::from(keys)
}

pub fn lparam(x: i32, y: i32) -> isize {
    let word = |at: i32| {
        let [low, high, ..] = at.to_le_bytes();
        u32::from(u16::from_le_bytes([low, high]))
    };
    let packed = usize::try_from((word(y) << 16) | word(x)).unwrap_or_default();
    isize::from_ne_bytes(packed.to_ne_bytes())
}

pub fn delta(mouse_data: u32) -> i16 {
    let [.., low, high] = mouse_data.to_le_bytes();
    i16::from_le_bytes([low, high])
}

#[cfg(all(windows, not(feature = "cef")))]
pub use hook::arm;

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a wheel is seen before Windows delivers it only through a low-level hook, and the windows it is aimed at are asked through user32"
)]
mod hook {
    use std::sync::Once;

    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, VK_SHIFT, VK_XBUTTON1,
        VK_XBUTTON2,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetClassNameW, GetMessageW, GetParent, GetSystemMetrics,
        GetWindowThreadProcessId, PostMessageW, SetWindowsHookExW, WindowFromPoint, GA_ROOT,
        HC_ACTION, HHOOK, MSG, MSLLHOOKSTRUCT, SM_SWAPBUTTON, WH_MOUSE_LL,
    };

    use super::{delta, is_input_window, is_wheel, keys, lparam, wparam, Hold};

    pub fn arm() {
        static ARMED: Once = Once::new();
        ARMED.call_once(|| {
            let _ = std::thread::Builder::new()
                .name("wheel".into())
                .spawn(listen);
        });
    }

    fn listen() {
        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            if SetWindowsHookExW(WH_MOUSE_LL, Some(heard), HINSTANCE::from(module), 0).is_err() {
                return;
            }
            let mut message = MSG::default();
            while GetMessageW(&raw mut message, HWND::default(), 0, 0).as_bool() {}
        }
    }

    unsafe extern "system" fn heard(code: i32, message: WPARAM, info: LPARAM) -> LRESULT {
        if code == i32::try_from(HC_ACTION).unwrap_or(-1) {
            let kind = u32::try_from(message.0).unwrap_or(0);
            if is_wheel(kind) && sent(kind, unsafe { &*(info.0 as *const MSLLHOOKSTRUCT) }) {
                return LRESULT(1);
            }
        }
        unsafe { CallNextHookEx(HHOOK::default(), code, message, info) }
    }

    fn sent(kind: u32, event: &MSLLHOOKSTRUCT) -> bool {
        let under = unsafe { WindowFromPoint(event.pt) };
        aim(under, kind, delta(event.mouseData), event.pt, keys(held))
    }

    pub fn aim(under: HWND, kind: u32, turn: i16, at: POINT, keys: u16) -> bool {
        if under.is_invalid() || !is_input_window(&class_of(under)) || !ours(under) {
            return false;
        }
        let Ok(page) = (unsafe { GetParent(under) }) else {
            return false;
        };
        unsafe {
            PostMessageW(
                page,
                kind,
                WPARAM(wparam(turn, keys)),
                LPARAM(lparam(at.x, at.y)),
            )
        }
        .is_ok()
    }

    fn class_of(window: HWND) -> String {
        let mut name = [0u16; 64];
        let length = unsafe { GetClassNameW(window, &mut name) };
        String::from_utf16_lossy(&name[..usize::try_from(length).unwrap_or(0)])
    }

    fn ours(window: HWND) -> bool {
        let mut owner = 0u32;
        unsafe {
            GetWindowThreadProcessId(GetAncestor(window, GA_ROOT), Some(&raw mut owner));
            owner == GetCurrentProcessId()
        }
    }

    fn held(one: Hold) -> bool {
        let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
        let key = match one.wired(swapped) {
            Hold::Ctrl => VK_CONTROL,
            Hold::Shift => VK_SHIFT,
            Hold::Left => VK_LBUTTON,
            Hold::Right => VK_RBUTTON,
            Hold::Middle => VK_MBUTTON,
            Hold::Back => VK_XBUTTON1,
            Hold::Forward => VK_XBUTTON2,
        };
        unsafe { GetAsyncKeyState(i32::from(key.0)) < 0 }
    }

    #[cfg(test)]
    mod tests {
        use std::cell::Cell;

        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW,
            RegisterClassW, HMENU, MSG, PM_REMOVE, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
            WNDPROC, WS_CHILD, WS_EX_TRANSPARENT, WS_OVERLAPPED,
        };

        use super::super::Hold;
        use super::super::WHEEL;
        use super::aim;

        thread_local! {
            static HEARD: Cell<Vec<(usize, isize)>> = const { Cell::new(Vec::new()) };
        }

        unsafe extern "system" fn plain(
            window: HWND,
            message: u32,
            first: WPARAM,
            second: LPARAM,
        ) -> LRESULT {
            unsafe { DefWindowProcW(window, message, first, second) }
        }

        unsafe extern "system" fn page(
            window: HWND,
            message: u32,
            first: WPARAM,
            second: LPARAM,
        ) -> LRESULT {
            if message == WHEEL {
                HEARD.with(|heard| {
                    let mut all = heard.take();
                    all.push((first.0, second.0));
                    heard.set(all);
                });
                return LRESULT(0);
            }
            unsafe { DefWindowProcW(window, message, first, second) }
        }

        struct Windows {
            top: HWND,
            page: HWND,
            input: HWND,
            other: HWND,
        }

        impl Windows {
            fn built() -> Self {
                unsafe {
                    let module =
                        HINSTANCE::from(GetModuleHandleW(None).expect("the test's own module"));
                    let classes: [(PCWSTR, WNDPROC); 4] = [
                        (w!("Orden test top"), Some(plain)),
                        (w!("Orden test page"), Some(page)),
                        (w!("Chrome_RenderWidgetHostHWND"), Some(plain)),
                        (w!("Orden test other"), Some(plain)),
                    ];
                    for (name, answer) in classes {
                        RegisterClassW(&WNDCLASSW {
                            lpfnWndProc: answer,
                            hInstance: module,
                            lpszClassName: name,
                            ..Default::default()
                        });
                    }
                    let make =
                        |extra: WINDOW_EX_STYLE, class: PCWSTR, style: WINDOW_STYLE, parent| {
                            CreateWindowExW(
                                extra,
                                class,
                                PCWSTR::null(),
                                style,
                                0,
                                0,
                                400,
                                300,
                                parent,
                                HMENU::default(),
                                module,
                                None,
                            )
                            .expect("a window of the test's own")
                        };
                    let none = WINDOW_EX_STYLE::default();
                    let top = make(none, w!("Orden test top"), WS_OVERLAPPED, HWND::default());
                    let page = make(none, w!("Orden test page"), WS_CHILD, top);
                    let input = make(
                        WS_EX_TRANSPARENT,
                        w!("Chrome_RenderWidgetHostHWND"),
                        WS_CHILD,
                        page,
                    );
                    let other = make(none, w!("Orden test other"), WS_CHILD, page);
                    Self {
                        top,
                        page,
                        input,
                        other,
                    }
                }
            }

            fn heard(&self) -> Vec<(usize, isize)> {
                unsafe {
                    let mut message = MSG::default();
                    while PeekMessageW(&raw mut message, self.page, 0, 0, PM_REMOVE).as_bool() {
                        DispatchMessageW(&raw const message);
                    }
                }
                HEARD.with(Cell::take)
            }
        }

        impl Drop for Windows {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.top);
                }
            }
        }

        #[test]
        fn a_wheel_over_a_page_goes_to_the_page_s_own_window_once() {
            let windows = Windows::built();
            let at = POINT { x: -21_000, y: 480 };
            let ctrl = Hold::Ctrl.flag();

            assert!(aim(windows.input, WHEEL, -120, at, ctrl));
            let heard = windows.heard();

            assert_eq!(heard.len(), 1, "one notch, one wheel: {heard:?}");
            let (first, second) = heard[0];
            assert_eq!(
                first,
                (0xFF88 << 16) | 0x0008,
                "a notch down with Ctrl held"
            );
            assert_eq!(
                second,
                (0x01E0 << 16) | 0xADF8,
                "the point, as Windows packs it"
            );
        }

        #[test]
        fn a_wheel_over_anything_else_is_left_alone() {
            let windows = Windows::built();
            let at = POINT { x: 10, y: 10 };

            assert!(!aim(windows.other, WHEEL, -120, at, 0));
            assert!(!aim(windows.page, WHEEL, -120, at, 0));
            assert!(!aim(windows.top, WHEEL, -120, at, 0));
            assert!(!aim(HWND::default(), WHEEL, -120, at, 0));
            assert!(windows.heard().is_empty());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{delta, is_input_window, is_wheel, keys, lparam, wparam, Hold};

    #[test]
    fn only_the_two_wheel_messages_are_wheels() {
        assert!(is_wheel(0x020A));
        assert!(is_wheel(0x020E));
        assert!(!is_wheel(0x0200), "a move");
        assert!(!is_wheel(0x0201), "a press");
    }

    #[test]
    fn only_the_engine_s_input_window_is_aimed_past() {
        assert!(is_input_window("Chrome_RenderWidgetHostHWND"));
        assert!(
            !is_input_window("Chrome_WidgetWin_1"),
            "the page's own window"
        );
        assert!(!is_input_window("Chrome_WidgetWin_0"));
        assert!(!is_input_window("WRY_WEBVIEW"));
        assert!(!is_input_window("Tauri Window"));
    }

    #[test]
    fn the_keys_held_are_the_flags_windows_writes() {
        assert_eq!(keys(|_| false), 0);
        assert_eq!(keys(|one| one == Hold::Ctrl), 0x0008, "Ctrl, which zooms");
        assert_eq!(
            keys(|one| one == Hold::Shift),
            0x0004,
            "Shift, which scrolls sideways"
        );
        assert_eq!(keys(|one| one == Hold::Left), 0x0001, "a drag");
        assert_eq!(keys(|_| true), 0x007F);
    }

    #[test]
    fn swapped_buttons_are_read_off_the_other_key() {
        assert_eq!(Hold::Left.wired(false), Hold::Left);
        assert_eq!(Hold::Left.wired(true), Hold::Right);
        assert_eq!(Hold::Right.wired(true), Hold::Left);
        assert_eq!(Hold::Middle.wired(true), Hold::Middle);
        assert_eq!(Hold::Ctrl.wired(true), Hold::Ctrl);
    }

    #[test]
    fn a_turn_is_the_high_word_and_keeps_its_sign_and_its_fraction() {
        assert_eq!(delta(0xFF88_0000), -120, "a notch towards the reader");
        assert_eq!(delta(0x0078_0000), 120, "a notch away");
        assert_eq!(
            delta(0xFFE2_0000),
            -30,
            "a quarter notch of a free-spinning wheel"
        );
        assert_eq!(delta(0x0000_0000), 0);
    }

    #[test]
    fn the_message_words_are_packed_as_windows_packs_them() {
        assert_eq!(wparam(-120, 0), 0xFF88 << 16);
        assert_eq!(wparam(120, 0x0008), (0x0078 << 16) | 0x0008);
        assert_eq!(wparam(-30, 0x0004), (0xFFE2 << 16) | 0x0004);
        assert_eq!(lparam(0x0064, 0x00C8), (0x00C8 << 16) | 0x0064);
        assert_eq!(lparam(-1, -2), (0xFFFE << 16) | 0xFFFF);
        assert_eq!(lparam(-21_000, 480), (0x01E0 << 16) | 0xADF8);
    }

    #[test]
    fn a_page_reads_back_the_turn_and_the_point_it_was_sent() {
        for (turn, x, y) in [(-120, 640, 400), (120, -2000, -300), (-30, 0, 0)] {
            let first = wparam(turn, 0);
            let second = lparam(x, y);
            let signed = |word: u16| i16::from_ne_bytes(word.to_ne_bytes());
            let high = u16::try_from(first >> 16).expect("one word");
            assert_eq!(signed(high), turn, "GET_WHEEL_DELTA_WPARAM");
            let low =
                |word: isize| i32::from(signed(u16::try_from(word & 0xFFFF).expect("one word")));
            assert_eq!(low(second), x, "GET_X_LPARAM");
            assert_eq!(low(second >> 16), y, "GET_Y_LPARAM");
        }
    }
}
