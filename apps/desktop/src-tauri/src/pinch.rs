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

#[cfg(not(target_os = "linux"))]
pub fn web_page(
    _platform: &tauri::webview::PlatformWebview,
    _app: &tauri::AppHandle,
    _label: &str,
) {
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SPEED: u32 = 4000;
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const STILL: f64 = 1e-4;

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Asked {
    pub at: (f64, f64),
    pub scale: f64,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
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

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
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

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
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

#[cfg(target_os = "linux")]
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
        let Some(page) = crate::host::x11_page(platform) else {
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
    use super::{Asked, Owed};

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
