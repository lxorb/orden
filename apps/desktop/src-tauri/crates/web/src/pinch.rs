use serde_json::{json, Value};

pub fn first_window(app: &tauri::AppHandle) {
    use tauri::Manager as _;

    if let Some(window) = app.get_webview_window("main") {
        let_through(window.as_ref());
    }
}
pub fn let_through(_webview: &tauri::Webview) {}
#[cfg(target_os = "linux")]
pub use gestures::web_page;

#[cfg(windows)]
pub use wheels::web_page;

#[cfg(not(any(target_os = "linux", windows)))]
pub fn web_page(
    _platform: &tauri::webview::PlatformWebview,
    _app: &tauri::AppHandle,
    _label: &str,
) {
}
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
const SPEED: u32 = 4000;
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
const STILL: f64 = 1e-4;
#[cfg(any(target_os = "linux", windows))]
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg_attr(not(windows), allow(dead_code))]
const MK_CONTROL: usize = 0x0008;
#[cfg_attr(not(windows), allow(dead_code))]
const NOTCH: f64 = 120.0;
#[cfg_attr(not(windows), allow(dead_code))]
const PER_NOTCH: f64 = 1.25;
#[cfg_attr(not(windows), allow(dead_code))]
fn half(word: usize) -> i16 {
    i16::from_ne_bytes(u16::try_from(word & 0xFFFF).unwrap_or(0).to_ne_bytes())
}
#[cfg_attr(not(windows), allow(dead_code))]
fn pinched(wparam: usize, lparam: isize, ctrl_held: bool) -> Option<(f64, (i32, i32))> {
    if wparam & MK_CONTROL == 0 || ctrl_held {
        return None;
    }
    let delta = half(wparam >> 16);
    let place = usize::from_ne_bytes(lparam.to_ne_bytes());
    let at = (i32::from(half(place)), i32::from(half(place >> 16)));
    (delta != 0).then(|| (PER_NOTCH.powf(f64::from(delta) / NOTCH), at))
}
#[cfg(any(target_os = "linux", windows))]
fn page_ratio(view: &tauri::Webview) -> f64 {
    crate::engine::devtools::call(
        view,
        None,
        "Runtime.evaluate",
        &json!({ "expression": "devicePixelRatio", "returnByValue": true }),
        PATIENCE,
    )
    .ok()
    .and_then(|said| said.pointer("/result/value").and_then(Value::as_f64))
    .filter(|ratio| *ratio > 0.0)
    .unwrap_or(1.0)
}
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Asked {
    pub at: (f64, f64),
    pub scale: f64,
}
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
impl Asked {
    pub fn params(self) -> Value {
        json!({
            "x": self.at.0,
            "y": self.at.1,
            "scaleFactor": self.scale,
            "relativeSpeed": SPEED,
            "gestureSourceType": "mouse",
        })
    }
}
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
#[derive(Debug)]
pub struct Owed {
    flying: bool,
    scale: f64,
    at: (f64, f64),
}
impl Default for Owed {
    fn default() -> Self {
        Self { flying: false, scale: 1.0, at: (0.0, 0.0) }
    }
}
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
impl Owed {
    pub fn gather(&mut self, by: f64, at: (f64, f64)) {
        if by.is_finite() && by > 0.0 {
            self.scale *= by;
            self.at = at;
        }
    }
    pub fn take(&mut self) -> Option<Asked> {
        if self.flying || (self.scale - 1.0).abs() < STILL {
            return None;
        }
        self.flying = true;
        let asked = Asked { at: self.at, scale: self.scale };
        self.scale = 1.0;
        Some(asked)
    }
    pub fn landed(&mut self) {
        self.flying = false;
    }
}
#[cfg(target_os = "linux")]
mod gestures {
    use orden_base::Held as _;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};

    use tauri::{AppHandle, Manager as _};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xinput::{self, ConnectionExt as _, Device, Fp1616, XIEventMask};
    use x11rb::protocol::Event;
    use x11rb::rust_connection::RustConnection;

    use super::{page_ratio, Owed, PATIENCE};

    const GESTURES: u32 = (1 << 27) | (1 << 28) | (1 << 29);
    struct Pinches {
        x: RustConnection,
        pages: Mutex<HashMap<u32, (AppHandle, String)>>,
    }
    static PINCHES: OnceLock<Option<Arc<Pinches>>> = OnceLock::new();
    fn pinches() -> Option<Arc<Pinches>> {
        PINCHES
            .get_or_init(|| {
                let (x, _) = x11rb::connect(None).ok()?;
                let version = x.xinput_xi_query_version(2, 4).ok()?.reply().ok()?;
                if (version.major_version, version.minor_version) < (2, 4) {
                    return None;
                }
                let pinches = Arc::new(Pinches { x, pages: Mutex::new(HashMap::new()) });
                let hearing = Arc::clone(&pinches);
                std::thread::Builder::new()
                    .name("pinch".into())
                    .spawn(move || hearing.hear_pinches())
                    .ok()?;
                Some(pinches)
            })
            .clone()
    }
    pub fn web_page(platform: &tauri::webview::PlatformWebview, app: &AppHandle, label: &str) {
        let Some(page) = crate::host::x11_page(platform) else {
            return;
        };
        let Some(pinches) = pinches() else {
            return;
        };
        pinches.pages.held().insert(page, (app.clone(), label.to_string()));
        let mask = xinput::EventMask {
            deviceid: Device::ALL_MASTER.into(),
            mask: vec![XIEventMask::from(GESTURES)],
        };
        let _ = pinches.x.xinput_xi_select_events(page, &[mask]);
        let _ = pinches.x.flush();
    }
    fn fixed_point(value: Fp1616) -> f64 {
        f64::from(value) / 65536.0
    }
    struct Pinch {
        page: u32,
        last: f64,
        ratio: f64,
        owed: Owed,
    }
    impl Pinches {
        fn page_at(&self, window: u32) -> Option<tauri::Webview> {
            let pages = self.pages.held();
            let (app, label) = pages.get(&window)?;
            let found = app.get_webview(label);
            if found.is_none() {
                drop(pages);
                self.pages.held().remove(&window);
            }
            found
        }
        fn hear_pinches(&self) {
            let mut pinch: Option<Pinch> = None;
            while let Ok(first) = self.x.wait_for_event() {
                let mut event = Some(first);
                while let Some(one) = event.take() {
                    self.pinch_heard(&mut pinch, one);
                    event = self.x.poll_for_event().ok().flatten();
                }
                let Some(going) = pinch.as_mut() else {
                    continue;
                };
                let Some(view) = self.page_at(going.page) else {
                    pinch = None;
                    continue;
                };
                while let Some(asked) = going.owed.take() {
                    let _ = crate::engine::devtools::call(
                        &view,
                        None,
                        "Input.synthesizePinchGesture",
                        &asked.params(),
                        PATIENCE,
                    );
                    going.owed.landed();
                }
            }
        }
        fn pinch_heard(&self, pinch: &mut Option<Pinch>, event: Event) {
            match event {
                Event::XinputGesturePinchBegin(began) => {
                    let ratio = self.page_at(began.event).map_or(1.0, |view| page_ratio(&view));
                    *pinch = Some(Pinch {
                        page: began.event,
                        last: fixed_point(began.scale).max(f64::EPSILON),
                        ratio,
                        owed: Owed::default(),
                    });
                }
                Event::XinputGesturePinchUpdate(moved) | Event::XinputGesturePinchEnd(moved) => {
                    let Some(going) = pinch.as_mut().filter(|one| one.page == moved.event) else {
                        return;
                    };
                    let scale = fixed_point(moved.scale);
                    if scale > 0.0 {
                        let at = (
                            fixed_point(moved.event_x) / going.ratio,
                            fixed_point(moved.event_y) / going.ratio,
                        );
                        going.owed.gather(scale / going.last, at);
                        going.last = scale;
                    }
                }
                _ => {}
            }
        }
    }
}
#[cfg(windows)]
mod wheels {
    use orden_base::Held as _;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Mutex, OnceLock};

    use tauri::{AppHandle, Manager as _};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetKeyState, VK_CONTROL};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, IsChild, SetWindowsHookExW, HC_ACTION, HHOOK, MSG, PM_REMOVE,
        WH_GETMESSAGE, WM_MOUSEWHEEL, WM_NULL,
    };

    use super::{page_ratio, Owed, PATIENCE};

    struct Turn {
        page: isize,
        scale: f64,
        at: (i32, i32),
    }
    static PAGES: Mutex<Vec<(isize, AppHandle, String)>> = Mutex::new(Vec::new());
    static TURNS: OnceLock<Option<Sender<Turn>>> = OnceLock::new();
    pub fn web_page(platform: &tauri::webview::PlatformWebview, app: &AppHandle, label: &str) {
        let Some(page) = crate::host::page_id(platform).and_then(|one| isize::try_from(one.0).ok())
        else {
            return;
        };
        if turns().is_none() {
            return;
        }
        let mut pages = PAGES.held();
        pages.retain(|(_, app, label)| app.get_webview(label).is_some());
        pages.push((page, app.clone(), label.to_string()));
    }
    #[allow(unsafe_code)]
    fn turns() -> Option<&'static Sender<Turn>> {
        TURNS
            .get_or_init(|| {
                let (sending, hearing) = channel();
                std::thread::Builder::new()
                    .name("pinch".into())
                    .spawn(move || hear(&hearing))
                    .ok()?;
                let hooked = unsafe {
                    SetWindowsHookExW(
                        WH_GETMESSAGE,
                        Some(heard),
                        HINSTANCE::default(),
                        GetCurrentThreadId(),
                    )
                };
                hooked.ok().map(|_| sending)
            })
            .as_ref()
    }
    #[allow(unsafe_code)]
    unsafe extern "system" fn heard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if u32::try_from(code) == Ok(HC_ACTION) && usize::try_from(PM_REMOVE.0) == Ok(wparam.0) {
            if let Some(message) = unsafe { (lparam.0 as *mut MSG).as_mut() } {
                if message.message == WM_MOUSEWHEEL && took(message) {
                    message.message = WM_NULL;
                }
            }
        }
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }
    #[allow(unsafe_code)]
    fn took(message: &MSG) -> bool {
        let control = i32::from(VK_CONTROL.0);
        let held = unsafe { GetKeyState(control) < 0 || GetAsyncKeyState(control) < 0 };
        let Some((scale, (x, y))) = super::pinched(message.wParam.0, message.lParam.0, held) else {
            return false;
        };
        let Some(page) = page_under(message.hwnd) else {
            return false;
        };
        let mut at = POINT { x, y };
        let _ = unsafe { ScreenToClient(HWND(page as _), &raw mut at) };
        turns().is_some_and(|turns| turns.send(Turn { page, scale, at: (at.x, at.y) }).is_ok())
    }
    #[allow(unsafe_code)]
    fn page_under(under: HWND) -> Option<isize> {
        PAGES.held().iter().map(|(page, _, _)| *page).find(|page| {
            let page = HWND(*page as _);
            page == under || unsafe { IsChild(page, under) }.as_bool()
        })
    }
    fn view_of(page: isize) -> Option<tauri::Webview> {
        let pages = PAGES.held();
        let (_, app, label) = pages.iter().find(|(one, _, _)| *one == page)?;
        app.get_webview(label)
    }
    fn hear(turns: &Receiver<Turn>) {
        let mut waiting: Option<Turn> = None;
        loop {
            let Some(first) = waiting.take().or_else(|| turns.recv().ok()) else {
                return;
            };
            let Some(view) = view_of(first.page) else {
                continue;
            };
            let ratio = page_ratio(&view);
            let at = |turn: &Turn| (f64::from(turn.at.0) / ratio, f64::from(turn.at.1) / ratio);
            let mut owed = Owed::default();
            owed.gather(first.scale, at(&first));
            loop {
                if waiting.is_none() {
                    while let Ok(turn) = turns.try_recv() {
                        if turn.page != first.page {
                            waiting = Some(turn);
                            break;
                        }
                        owed.gather(turn.scale, at(&turn));
                    }
                }
                let Some(asked) = owed.take() else {
                    break;
                };
                let _ = crate::engine::devtools::call(
                    &view,
                    None,
                    "Input.synthesizePinchGesture",
                    &asked.params(),
                    PATIENCE,
                );
                owed.landed();
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{pinched, Asked, Owed};

    fn word(high: u16, low: u16) -> usize {
        usize::from(high) * 0x1_0000 + usize::from(low)
    }
    const CTRL: u16 = 0x0008;
    #[test]
    fn a_wheel_marked_with_ctrl_that_no_key_holds_is_a_touchpad_s_pinch() {
        let at = isize::from_ne_bytes(word(300, 200).to_ne_bytes());
        let (wider, place) = pinched(word(120, CTRL), at, false).expect("a pinch apart");
        assert!(wider > 1.0);
        assert_eq!(place, (200, 300));
        let (narrower, _) = pinched(word(0xFF88, CTRL), at, false).expect("a pinch together");
        assert!(narrower < 1.0 && (wider * narrower - 1.0).abs() < 1e-9);
        let left = isize::from_ne_bytes(word(20, 0xFFF6).to_ne_bytes());
        assert_eq!(pinched(word(120, CTRL), left, false).map(|one| one.1), Some((-10, 20)));
    }
    #[test]
    fn ctrl_held_on_the_keyboard_or_no_ctrl_at_all_is_a_wheel() {
        assert_eq!(pinched(word(120, CTRL), 0, true), None);
        assert_eq!(pinched(word(120, 0), 0, false), None);
        assert_eq!(pinched(word(0, CTRL), 0, false), None);
    }
    #[test]
    fn one_pinch_is_in_flight_and_the_rest_wait_for_it_as_one() {
        let mut owed = Owed::default();
        owed.gather(1.1, (10.0, 20.0));
        let first = owed.take().expect("the first step goes at once");
        assert!((first.scale - 1.1).abs() < 1e-12);
        assert_eq!(first.at, (10.0, 20.0));
        owed.gather(1.2, (11.0, 21.0));
        owed.gather(1.5, (12.0, 22.0));
        assert_eq!(owed.take(), None, "nothing more until the first lands");
        owed.landed();
        let next = owed.take().expect("what waited goes as one");
        assert!((next.scale - 1.8).abs() < 1e-12);
        assert_eq!(next.at, (12.0, 22.0));
        owed.landed();
        assert_eq!(owed.take(), None, "nothing is owed");
    }
    #[test]
    fn a_pinch_that_came_back_to_where_it_began_asks_nothing() {
        let mut owed = Owed::default();
        owed.gather(2.0, (0.0, 0.0));
        owed.gather(0.5, (0.0, 0.0));
        assert_eq!(owed.take(), None);
        owed.gather(f64::NAN, (0.0, 0.0));
        owed.gather(0.0, (0.0, 0.0));
        assert_eq!(owed.take(), None);
    }
    #[test]
    fn the_engine_is_asked_for_a_touchpad_s_pinch_at_the_fingers() {
        let params = Asked { at: (100.5, 40.0), scale: 1.25 }.params();
        assert_eq!(params["gestureSourceType"], "mouse");
        assert_eq!(params["x"], 100.5);
        assert_eq!(params["y"], 40.0);
        assert_eq!(params["scaleFactor"], 1.25);
        assert!(params["relativeSpeed"].as_u64().is_some_and(|speed| speed >= 1000));
    }
}
