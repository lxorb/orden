#![cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]

use serde_json::{json, Value};

pub fn first_window(app: &tauri::AppHandle) {
    use tauri::Manager as _;

    if let Some(window) = app.get_webview_window("main") {
        let_through(window.as_ref());
    }
}

#[cfg(windows)]
pub fn let_through(webview: &tauri::Webview) {
    let _ = webview.with_webview(|platform| pinch_zoom_on(&platform));
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the page's settings are WebView2's own, reached through its COM interfaces"
)]
fn pinch_zoom_on(platform: &tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows_core::Interface as _;

    unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        if let Ok(five) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = five.SetIsPinchZoomEnabled(true);
        }
    }
}

#[cfg(not(windows))]
pub fn let_through(_webview: &tauri::Webview) {}

#[cfg(windows)]
pub fn web_page(platform: &tauri::webview::PlatformWebview, _app: &tauri::AppHandle, _label: &str) {
    pinch_zoom_on(platform);
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the runtime hands the page over as a bare pointer, and WKWebView's magnification is set through it"
)]
pub fn web_page(platform: &tauri::webview::PlatformWebview, _app: &tauri::AppHandle, _label: &str) {
    use objc2::rc::Retained;
    use objc2_web_kit::WKWebView;

    if let Some(view) = unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) } {
        unsafe { view.setAllowsMagnification(true) };
    }
}

#[cfg(feature = "cef")]
pub use gestures::web_page;

#[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
pub fn web_page(
    _platform: &tauri::webview::PlatformWebview,
    _app: &tauri::AppHandle,
    _label: &str,
) {
}

#[cfg_attr(not(windows), allow(dead_code))]
const CONTROL: u32 = 0x0008;
#[cfg_attr(not(windows), allow(dead_code))]
const TURN_PER_E: f64 = 600.0;
const SPEED: u32 = 4000;
const STILL: f64 = 1e-4;

#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_pinch(keys: u32, ctrl_held: bool, fingers: u32, from_touch: bool) -> bool {
    keys & CONTROL != 0 && (!ctrl_held || fingers >= 2 || from_touch)
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn scale_of_turn(turn: i16) -> f64 {
    (f64::from(turn) / TURN_PER_E).exp()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Asked {
    pub at: (f64, f64),
    pub scale: f64,
}

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

#[derive(Debug)]
pub struct Owed {
    flying: bool,
    scale: f64,
    at: (f64, f64),
}

impl Default for Owed {
    fn default() -> Self {
        Self {
            flying: false,
            scale: 1.0,
            at: (0.0, 0.0),
        }
    }
}

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
        let asked = Asked {
            at: self.at,
            scale: self.scale,
        };
        self.scale = 1.0;
        Some(asked)
    }

    pub fn landed(&mut self) {
        self.flying = false;
    }
}

#[cfg(feature = "cef")]
mod gestures {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock, PoisonError};
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{AppHandle, Manager as _};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xinput::{self, ConnectionExt as _, Device, Fp1616, XIEventMask};
    use x11rb::protocol::Event;
    use x11rb::rust_connection::RustConnection;

    use super::Owed;

    const GESTURES: u32 = (1 << 27) | (1 << 28) | (1 << 29);
    const PATIENCE: Duration = Duration::from_secs(2);

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
                let pinches = Arc::new(Pinches {
                    x,
                    pages: Mutex::new(HashMap::new()),
                });
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
        let Some(page) = crate::web_keys::x11_window(platform) else {
            return;
        };
        let Some(pinches) = pinches() else {
            return;
        };
        pinches
            .pages
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(page, (app.clone(), label.to_string()));
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
            let pages = self.pages.lock().unwrap_or_else(PoisonError::into_inner);
            let (app, label) = pages.get(&window)?;
            let found = app.get_webview(label);
            if found.is_none() {
                drop(pages);
                self.pages
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .remove(&window);
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
                    let ratio = self
                        .page_at(began.event)
                        .map_or(1.0, |view| page_ratio(&view));
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
}

#[cfg(test)]
mod tests {
    use super::{is_pinch, scale_of_turn, Asked, Owed};

    #[test]
    fn a_ctrl_wheel_with_ctrl_not_held_is_a_pinch() {
        assert!(
            is_pinch(0x0008, false, 0, false),
            "Windows' pinch, Ctrl never pressed"
        );
        assert!(is_pinch(0x0008, true, 2, false), "two fingers on the pad");
        assert!(is_pinch(0x0008, true, 0, true), "marked as the pad's own");
        assert!(
            !is_pinch(0x0008, true, 0, false),
            "Ctrl and a mouse's wheel"
        );
        assert!(!is_pinch(0x0008, true, 1, false));
        assert!(!is_pinch(0, false, 2, true), "a plain scroll");
        assert!(!is_pinch(0x0004, false, 2, false), "Shift and the wheel");
    }

    #[test]
    fn a_turn_out_magnifies_and_back_undoes_it() {
        assert!(scale_of_turn(120) > 1.1 && scale_of_turn(120) < 1.4);
        assert!(scale_of_turn(-120) < 1.0);
        assert!((scale_of_turn(120) * scale_of_turn(-120) - 1.0).abs() < 1e-12);
        assert!((scale_of_turn(0) - 1.0).abs() < f64::EPSILON);
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
        let params = Asked {
            at: (100.5, 40.0),
            scale: 1.25,
        }
        .params();
        assert_eq!(params["gestureSourceType"], "mouse");
        assert_eq!(params["x"], 100.5);
        assert_eq!(params["y"], 40.0);
        assert_eq!(params["scaleFactor"], 1.25);
        assert!(params["relativeSpeed"]
            .as_u64()
            .is_some_and(|speed| speed >= 1000));
    }
}
