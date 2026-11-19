use orden_base::Held as _;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde::Deserialize;
use tauri::Webview;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Hollow {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub radius: f64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Cut {
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub hollows: Vec<Hollow>,
}

pub type Piece = (i32, i32, i32, i32, i32);

pub type Shape = Option<Vec<Piece>>;

#[allow(clippy::cast_possible_truncation)]
fn pixels(length: f64, scale: f64) -> i32 {
    (length * scale).round() as i32
}

#[must_use]
pub fn shape_of(cut: Option<&Cut>, wide: u32, tall: u32, scale: f64, corner: f64) -> Shape {
    if cut.is_some_and(|one| one.all) {
        return Some(Vec::new());
    }

    let wide = i32::try_from(wide).unwrap_or(i32::MAX);
    let tall = i32::try_from(tall).unwrap_or(i32::MAX);
    let round = pixels(corner.max(0.0) * 2.0, scale).clamp(0, wide.min(tall).max(0));
    let Some(cut) = cut else {
        return (round > 0).then(|| vec![(0, 0, wide, tall, round)]);
    };
    let pieces: Vec<Piece> = cut
        .hollows
        .iter()
        .map(|one| {
            (
                pixels(one.x, scale),
                pixels(one.y, scale),
                pixels(one.x + one.width, scale),
                pixels(one.y + one.height, scale),
                pixels(one.radius * 2.0, scale).max(0),
            )
        })
        .filter(|&(left, top, right, bottom, _)| {
            left < right && top < bottom && left < wide && right > 0 && top < tall && bottom > 0
        })
        .collect();

    if pieces.is_empty() && round == 0 {
        return None;
    }
    let mut whole = vec![(0, 0, wide, tall, round)];
    whole.extend(pieces);
    Some(whole)
}

const CUTS: bool = cfg!(target_os = "linux");

const HOLLOWS: bool = cfg!(any(windows, target_os = "macos"));

#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq)]
#[serde(untagged)]
pub enum Layering {
    Cuts(bool),
    Hollows(&'static str),
}

pub fn layering(label: &str) -> Layering {
    let _ = label;
    if HOLLOWS {
        Layering::Hollows("hollows")
    } else {
        Layering::Cuts(CUTS)
    }
}

static GIVEN: LazyLock<Mutex<Given>> = LazyLock::new(Mutex::default);

type Given = HashMap<String, (Option<Cut>, f64, Shape)>;

fn given<T>(look: impl FnOnce(&mut Given) -> T) -> T {
    look(&mut GIVEN.held())
}

pub fn apply(view: &Webview, cut: Option<Cut>, wide: u32, tall: u32, scale: f64, corner: f64) {
    if !CUTS && !HOLLOWS {
        engine::round(view, corner);
        return;
    }
    let shape = shape_of(cut.as_ref(), wide, tall, scale, corner);
    let label = view.label().to_string();
    let changed = given(|all| {
        let before = all.get(&label).and_then(|(_, _, one)| one.clone());
        all.insert(label, (cut, corner, shape.clone()));
        before != shape
    });
    if changed {
        engine::shape(view, shape);
    }
}

pub fn refit(view: &Webview, wide: u32, tall: u32, scale: f64) {
    let kept = given(|all| {
        all.get(view.label())
            .map(|(cut, corner, _)| (cut.clone(), *corner))
    });
    if let Some((cut, corner)) = kept.filter(|(cut, corner)| cut.is_some() || *corner > 0.0) {
        apply(view, cut, wide, tall, scale, corner);
    }
}

pub fn uncut(label: &str) {
    given(|all| all.remove(label));
}

#[cfg(target_os = "linux")]
mod engine {
    use std::sync::LazyLock;

    use tauri::Webview;
    use x11rb::connection::Connection as _;
    use x11rb::protocol::shape::{ConnectionExt as _, SK, SO};
    use x11rb::protocol::xproto::{ClipOrdering, Rectangle};
    use x11rb::rust_connection::RustConnection;

    use super::{Piece, Shape};

    pub fn round(_view: &Webview, _corner: f64) {}

    static X: LazyLock<Option<RustConnection>> = LazyLock::new(|| {
        let (x, _) = x11rb::connect(None).ok()?;
        x.shape_query_version().ok()?.reply().ok()?;
        Some(x)
    });

    pub fn shape(view: &Webview, shape: Shape) {
        let _ = view.with_webview(move |platform| {
            let Some(window) = crate::host::x11_page(&platform) else {
                return;
            };
            let Some(x) = X.as_ref() else {
                return;
            };
            let _ = give(x, window, shape.as_deref());
        });
    }

    fn give(x: &RustConnection, window: u32, shape: Option<&[Piece]>) -> Option<()> {
        match shape {
            None => {
                x.shape_mask(SO::SET, SK::BOUNDING, window, 0, 0, x11rb::NONE)
                    .ok()?;
            }
            Some(pieces) => {
                let (whole, hollows) = match pieces.split_first() {
                    None => (Vec::new(), &[][..]),
                    Some((&(left, top, right, bottom, round), hollows)) => {
                        (lower(left, top, right, bottom, round), hollows)
                    }
                };
                x.shape_rectangles(
                    SO::SET,
                    SK::BOUNDING,
                    ClipOrdering::UNSORTED,
                    window,
                    0,
                    0,
                    &whole,
                )
                .ok()?;
                let cut: Vec<Rectangle> = hollows
                    .iter()
                    .flat_map(|&(left, top, right, bottom, round)| {
                        rectangles(left, top, right, bottom, round)
                    })
                    .collect();
                if !cut.is_empty() {
                    x.shape_rectangles(
                        SO::SUBTRACT,
                        SK::BOUNDING,
                        ClipOrdering::UNSORTED,
                        window,
                        0,
                        0,
                        &cut,
                    )
                    .ok()?;
                }
            }
        }
        x.flush().ok()
    }

    pub fn rectangles(left: i32, top: i32, right: i32, bottom: i32, round: i32) -> Vec<Rectangle> {
        let wide = right - left;
        let tall = bottom - top;
        if wide <= 0 || tall <= 0 {
            return Vec::new();
        }
        let radius = (round / 2).clamp(0, wide.min(tall) / 2);
        let rect = |x: i32, y: i32, width: i32, height: i32| Rectangle {
            x: clamp16(x),
            y: clamp16(y),
            width: u16::try_from(width.max(0)).unwrap_or(u16::MAX),
            height: u16::try_from(height.max(0)).unwrap_or(u16::MAX),
        };
        let mut all = vec![rect(left, top + radius, wide, tall - 2 * radius)];
        for line in 0..radius {
            let inset = inset(radius, line);
            all.push(rect(left + inset, top + line, wide - 2 * inset, 1));
            all.push(rect(left + inset, bottom - 1 - line, wide - 2 * inset, 1));
        }
        all
    }

    pub fn lower(left: i32, top: i32, right: i32, bottom: i32, round: i32) -> Vec<Rectangle> {
        let rows = rectangles(left, top, right, bottom, round);
        let Some(middle) = rows.first() else {
            return rows;
        };
        let wide = right - left;
        let radius = (round / 2).clamp(0, wide.min(bottom - top) / 2);
        let mut all = vec![Rectangle {
            y: clamp16(top),
            height: u16::try_from((bottom - top - radius).max(0)).unwrap_or(u16::MAX),
            ..*middle
        }];
        all.extend(rows.iter().skip(2).step_by(2).copied());
        all
    }

    #[allow(clippy::cast_possible_truncation)]
    fn inset(radius: i32, line: i32) -> i32 {
        let r = f64::from(radius);
        let off = r - f64::from(line) - 0.5;
        (r - (r * r - off * off).max(0.0).sqrt()).round() as i32
    }

    fn clamp16(value: i32) -> i16 {
        i16::try_from(value.clamp(i32::from(i16::MIN), i32::from(i16::MAX))).unwrap_or(0)
    }

    #[cfg(test)]
    mod tests {
        use super::{lower, rectangles};

        #[test]
        fn a_page_is_rounded_at_the_bottom_alone() {
            let page = lower(0, 0, 100, 50, 16);
            assert_eq!(page.len(), 1 + 8);
            assert_eq!(
                (page[0].x, page[0].y, page[0].width, page[0].height),
                (0, 0, 100, 42)
            );
            let rows = &page[1..];
            assert!(rows.iter().all(|one| one.y >= 42 && one.width <= 100));
            let last = rows.iter().find(|one| one.y == 49).expect("the bottom row");
            assert!(last.width < 100 && last.x > 0);
            assert_eq!(lower(0, 0, 100, 50, 0).len(), 1);
        }

        #[test]
        fn corners_are_rows_as_wide_as_the_curve() {
            let square = rectangles(10, 20, 110, 70, 0);
            assert_eq!(square.len(), 1);
            assert_eq!(
                (square[0].x, square[0].y, square[0].width, square[0].height),
                (10, 20, 100, 50)
            );

            let round = rectangles(0, 0, 100, 50, 16);
            assert_eq!(round.len(), 1 + 2 * 8);
            assert_eq!((round[0].y, round[0].height), (8, 34));
            let first = round[1];
            let last = round[2 * 7 + 1];
            assert!(first.width < last.width, "{first:?} {last:?}");
            assert!(round.iter().all(|one| one.width <= 100));
            assert!(rectangles(0, 0, 0, 10, 4).is_empty());
        }
    }
}

#[cfg(windows)]
mod engine {
    use tauri::Webview;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF,
    };

    use super::{Piece, Shape};

    pub fn round(_view: &Webview, _corner: f64) {}

    pub fn shape(view: &Webview, shape: Shape) {
        let _ = view.with_webview(move |platform| {
            let Some(page) =
                crate::host::page_id(&platform).and_then(|one| isize::try_from(one.0).ok())
            else {
                return;
            };
            give(HWND(page as _), shape.as_deref());
        });
    }

    #[allow(
        unsafe_code,
        reason = "the page's window is given its region through GDI"
    )]
    fn give(window: HWND, shape: Option<&[Piece]>) {
        unsafe {
            let region = match shape {
                None | Some([_]) => {
                    SetWindowRgn(window, HRGN::default(), BOOL::from(true));
                    return;
                }
                Some([]) => CreateRectRgn(0, 0, 0, 0),
                Some([(left, top, right, bottom, _), hollows @ ..]) => {
                    let whole = CreateRectRgn(*left, *top, *right, *bottom);
                    for &(left, top, right, bottom, round) in hollows {
                        let hollow =
                            CreateRoundRectRgn(left, top, right + 1, bottom + 1, round, round);
                        CombineRgn(whole, whole, hollow, RGN_DIFF);
                        let _ = DeleteObject(hollow);
                    }
                    whole
                }
            };
            if SetWindowRgn(window, region, BOOL::from(true)) == 0 {
                let _ = DeleteObject(region);
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod engine {
    use std::collections::HashMap;
    use std::ffi::{c_void, CString};
    use std::sync::{LazyLock, Mutex};

    use objc2::encode::{Encoding, RefEncode};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::{msg_send, sel};
    use objc2_app_kit::NSView;
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    use orden_base::Held as _;
    use tauri::Webview;

    use super::{Piece, Shape};

    const PREFIX: &str = "OrdenCut_";

    #[repr(C)]
    struct CGPath([u8; 0]);

    #[allow(unsafe_code)]
    unsafe impl RefEncode for CGPath {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("CGPath", &[]));
    }

    #[allow(unsafe_code)]
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPathCreateMutable() -> *mut CGPath;
        fn CGPathAddRect(path: *mut CGPath, transform: *const c_void, rect: NSRect);
        fn CGPathAddRoundedRect(
            path: *mut CGPath,
            transform: *const c_void,
            rect: NSRect,
            width: f64,
            height: f64,
        );
        fn CGPathRelease(path: *mut CGPath);
    }

    type Hollows = Vec<(NSRect, f64)>;

    static HELD: LazyLock<Mutex<HashMap<usize, Hollows>>> = LazyLock::new(Mutex::default);

    pub fn round(_view: &Webview, _corner: f64) {}

    #[allow(unsafe_code)]
    pub fn shape(view: &Webview, shape: Shape) {
        let _ = view.with_webview(move |platform| {
            let Some(page) =
                crate::host::page_id(&platform).and_then(|one| usize::try_from(one.0).ok())
            else {
                return;
            };
            let Some(page) = (unsafe { Retained::retain(page as *mut NSView) }) else {
                return;
            };
            give(&page, shape.as_deref());
        });
    }

    fn give(page: &NSView, shape: Option<&[Piece]>) {
        let key = std::ptr::from_ref(page).addr();
        let hollows = match shape {
            None | Some([_]) => None,
            Some([]) => Some(vec![(page.bounds(), 0.0)]),
            Some([(_, _, right, _, _), hollows @ ..]) => {
                let bounds = page.bounds();
                let by = if *right > 0 {
                    bounds.size.width / f64::from(*right)
                } else {
                    1.0
                };
                Some(
                    hollows
                        .iter()
                        .map(|&(left, top, right, bottom, round)| {
                            let at = |one: i32| f64::from(one) * by;
                            let (width, height) = (at(right - left), at(bottom - top));
                            let y = if page.isFlipped() {
                                at(top)
                            } else {
                                bounds.size.height - at(bottom)
                            };
                            let corner = (at(round) / 2.0)
                                .min(width / 2.0)
                                .min(height / 2.0)
                                .max(0.0);
                            (
                                NSRect::new(NSPoint::new(at(left), y), NSSize::new(width, height)),
                                corner,
                            )
                        })
                        .collect(),
                )
            }
        };
        mask(page, hollows.as_deref());
        let mut all = HELD.held();
        match hollows {
            Some(hollows) => {
                adopt(page);
                all.insert(key, hollows);
            }
            None => {
                all.remove(&key);
            }
        }
    }

    #[allow(unsafe_code)]
    fn mask(page: &NSView, hollows: Option<&[(NSRect, f64)]>) {
        unsafe {
            let Some(hollows) = hollows else {
                let layer: *mut AnyObject = msg_send![page, layer];
                if let Some(layer) = layer.as_ref() {
                    let () = msg_send![layer, setMask: std::ptr::null::<AnyObject>()];
                }
                return;
            };
            page.setWantsLayer(true);
            let layer: *mut AnyObject = msg_send![page, layer];
            let Some(layer) = layer.as_ref() else {
                return;
            };
            let Some(shapes) = AnyClass::get(c"CAShapeLayer") else {
                return;
            };
            let cut: *mut AnyObject = msg_send![shapes, layer];
            let Some(cut) = cut.as_ref() else {
                return;
            };
            let bounds: NSRect = msg_send![layer, bounds];
            let () = msg_send![cut, setFrame: bounds];
            let path = CGPathCreateMutable();
            CGPathAddRect(path, std::ptr::null(), bounds);
            for &(hollow, corner) in hollows {
                if corner > 0.0 {
                    CGPathAddRoundedRect(path, std::ptr::null(), hollow, corner, corner);
                } else {
                    CGPathAddRect(path, std::ptr::null(), hollow);
                }
            }
            let () = msg_send![cut, setPath: path.cast_const()];
            CGPathRelease(path);
            let () = msg_send![cut, setFillRule: &*NSString::from_str("even-odd")];
            let () = msg_send![layer, setMask: cut];
        }
    }

    fn within(page: &NSView, point: NSPoint) -> bool {
        let key = std::ptr::from_ref(page).addr();
        HELD.held().get(&key).is_some_and(|hollows| {
            hollows.iter().any(|(one, _)| {
                point.x >= one.origin.x
                    && point.x < one.origin.x + one.size.width
                    && point.y >= one.origin.y
                    && point.y < one.origin.y + one.size.height
            })
        })
    }

    fn original_of(view: &NSView) -> Option<&'static AnyClass> {
        let mut class = view.class();
        loop {
            if class.name().to_bytes().starts_with(PREFIX.as_bytes()) {
                return class.superclass();
            }
            class = class.superclass()?;
        }
    }

    #[allow(unsafe_code)]
    extern "C-unwind" fn hit(this: &NSView, _: Sel, point: NSPoint) -> *mut NSView {
        let Some(original) = original_of(this) else {
            return std::ptr::null_mut();
        };
        let inside = unsafe {
            let above = this.superview();
            this.convertPoint_fromView(point, above.as_deref())
        };
        if within(this, inside) {
            return std::ptr::null_mut();
        }
        unsafe { msg_send![super(this, original), hitTest: point] }
    }

    #[allow(unsafe_code)]
    fn adopt(page: &NSView) {
        if original_of(page).is_some() {
            return;
        }
        let base = page.class();
        let Ok(name) = CString::new(format!("{PREFIX}{}", base.name().to_string_lossy())) else {
            return;
        };
        let class = if let Some(made) = AnyClass::get(&name) {
            made
        } else {
            let Some(mut builder) = ClassBuilder::new(&name, base) else {
                return;
            };
            unsafe {
                builder.add_method(sel!(hitTest:), hit as extern "C-unwind" fn(_, _, _) -> _);
            }
            builder.register()
        };
        unsafe {
            objc2::ffi::object_setClass(
                std::ptr::from_ref::<NSView>(page)
                    .cast::<AnyObject>()
                    .cast_mut(),
                std::ptr::from_ref::<AnyClass>(class),
            );
        }
    }
}

#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
mod engine {
    use tauri::Webview;

    use super::Shape;

    pub fn shape(_view: &Webview, _shape: Shape) {}

    pub fn round(_view: &Webview, _corner: f64) {}
}

#[cfg(test)]
mod tests {
    use super::{shape_of, Cut, Hollow};

    fn cut(all: bool, hollows: &[(f64, f64, f64, f64, f64)]) -> Cut {
        let hollows = hollows
            .iter()
            .map(|&(x, y, width, height, radius)| Hollow {
                x,
                y,
                width,
                height,
                radius,
            })
            .collect();
        Cut { all, hollows }
    }

    #[test]
    fn the_page_is_cut_round_its_corner_and_what_lies_over_it_in_screen_pixels() {
        let menu = cut(false, &[(10.0, 20.0, 200.0, 100.0, 0.0)]);
        for (over, (width, height), scale, corner, shape) in [
            (
                None,
                (800, 600),
                1.5,
                10.0,
                Some(vec![(0, 0, 800, 600, 30)]),
            ),
            (None, (800, 600), 1.5, 0.0, None),
            (None, (800, 600), 1.0, 0.0, None),
            (None, (8, 600), 1.0, 10.0, Some(vec![(0, 0, 8, 600, 8)])),
            (Some(Cut::default()), (800, 600), 1.0, 0.0, None),
            (
                Some(cut(true, &[])),
                (800, 600),
                1.0,
                10.0,
                Some(Vec::new()),
            ),
            (Some(cut(true, &[])), (800, 600), 1.0, 0.0, Some(Vec::new())),
            (
                Some(menu),
                (800, 600),
                1.0,
                10.0,
                Some(vec![(0, 0, 800, 600, 20), (10, 20, 210, 120, 0)]),
            ),
            (
                Some(cut(false, &[(10.0, 20.0, 200.0, 100.0, 8.0)])),
                (1200, 900),
                1.5,
                0.0,
                Some(vec![(0, 0, 1200, 900, 0), (15, 30, 315, 180, 24)]),
            ),
            (
                Some(cut(false, &[(-40.0, -10.0, 100.0, 50.0, 0.0)])),
                (800, 600),
                1.0,
                0.0,
                Some(vec![(0, 0, 800, 600, 0), (-40, -10, 60, 40, 0)]),
            ),
            (
                Some(cut(false, &[(-248.0, 85.0, 328.0, 240.0, 12.0)])),
                (1000, 700),
                1.0,
                0.0,
                Some(vec![(0, 0, 1000, 700, 0), (-248, 85, 80, 325, 24)]),
            ),
            (
                Some(cut(false, &[(900.0, 10.0, 100.0, 50.0, 0.0)])),
                (800, 600),
                1.0,
                0.0,
                None,
            ),
            (
                Some(cut(false, &[(-140.0, 10.0, 100.0, 50.0, 0.0)])),
                (800, 600),
                1.0,
                0.0,
                None,
            ),
        ] {
            assert_eq!(
                shape_of(over.as_ref(), width, height, scale, corner),
                shape,
                "{over:?}"
            );
        }
    }

    #[test]
    fn each_system_says_how_a_page_meets_what_lies_over_it() {
        let said = serde_json::to_value(super::layering("page")).expect("said");
        let wanted = if cfg!(target_os = "linux") {
            serde_json::json!(true)
        } else if cfg!(any(windows, target_os = "macos")) {
            serde_json::json!("hollows")
        } else {
            serde_json::json!(false)
        };
        assert_eq!(said, wanted);
    }
}
