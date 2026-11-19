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
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Foot {
    Even(f64),
    Apart(f64, f64),
}
impl Foot {
    #[must_use]
    pub fn sides(self) -> (f64, f64) {
        match self {
            Self::Even(one) => (one, one),
            Self::Apart(left, right) => (left, right),
        }
    }
}
pub type Piece = (i32, i32, i32, i32, i32, i32);
pub type Row = (i32, i32, i32, i32);
pub type Shape = Option<Vec<Piece>>;
#[allow(clippy::cast_possible_truncation)]
fn pixels(length: f64, scale: f64) -> i32 {
    (length * scale).round() as i32
}
#[must_use]
pub fn shape_of(cut: Option<&Cut>, wide: u32, tall: u32, scale: f64, corner: Foot) -> Shape {
    if cut.is_some_and(|one| one.all) {
        return Some(Vec::new());
    }
    let wide = i32::try_from(wide).unwrap_or(i32::MAX);
    let tall = i32::try_from(tall).unwrap_or(i32::MAX);
    let round = |one: f64| pixels(one.max(0.0) * 2.0, scale).clamp(0, wide.min(tall).max(0));
    let (left, right) = corner.sides();
    let (left, right) = (round(left), round(right));
    let whole = (0, 0, wide, tall, left, right);
    let Some(cut) = cut else {
        return (left > 0 || right > 0).then(|| vec![whole]);
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
                pixels(one.radius * 2.0, scale).max(0),
            )
        })
        .filter(|&(left, top, right, bottom, _, _)| {
            left < right && top < bottom && left < wide && right > 0 && top < tall && bottom > 0
        })
        .collect();
    if pieces.is_empty() && left == 0 && right == 0 {
        return None;
    }
    let mut all = vec![whole];
    all.extend(pieces);
    Some(all)
}
#[must_use]
pub fn rectangles(left: i32, top: i32, right: i32, bottom: i32, round: i32) -> Vec<Row> {
    let wide = right - left;
    let tall = bottom - top;
    if wide <= 0 || tall <= 0 {
        return Vec::new();
    }
    let radius = (round / 2).clamp(0, wide.min(tall) / 2);
    let mut all = vec![(left, top + radius, wide, tall - 2 * radius)];
    for line in 0..radius {
        let inset = inset(radius, line);
        all.push((left + inset, top + line, wide - 2 * inset, 1));
        all.push((left + inset, bottom - 1 - line, wide - 2 * inset, 1));
    }
    all
}
#[must_use]
pub fn lower(left: i32, top: i32, right: i32, bottom: i32, foot: (i32, i32)) -> Vec<Row> {
    let wide = right - left;
    let tall = bottom - top;
    if wide <= 0 || tall <= 0 {
        return Vec::new();
    }
    let radius = |round: i32| (round / 2).clamp(0, wide.min(tall) / 2);
    let (on_left, on_right) = (radius(foot.0), radius(foot.1));
    let deep = on_left.max(on_right);
    let mut all = vec![(left, top, wide, tall - deep)];
    for line in 0..deep {
        let side = |radius: i32| {
            if line < radius {
                inset(radius, line)
            } else {
                0
            }
        };
        let (start, end) = (side(on_left), side(on_right));
        all.push((left + start, bottom - 1 - line, wide - start - end, 1));
    }
    all
}
#[allow(clippy::cast_possible_truncation)]
fn inset(radius: i32, line: i32) -> i32 {
    let r = f64::from(radius);
    let off = r - f64::from(line) - 0.5;
    (r - (r * r - off * off).max(0.0).sqrt()).round() as i32
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
type Given = HashMap<String, (Option<Cut>, Foot, Shape)>;
fn given<T>(look: impl FnOnce(&mut Given) -> T) -> T {
    look(&mut GIVEN.held())
}
pub fn apply(view: &Webview, cut: Option<Cut>, wide: u32, tall: u32, scale: f64, corner: Foot) {
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
    let kept = given(|all| all.get(view.label()).map(|(cut, corner, _)| (cut.clone(), *corner)));
    if let Some((cut, corner)) = kept.filter(|(cut, corner)| {
        let (left, right) = corner.sides();
        cut.is_some() || left > 0.0 || right > 0.0
    }) {
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
                x.shape_mask(SO::SET, SK::BOUNDING, window, 0, 0, x11rb::NONE).ok()?;
            }
            Some(pieces) => {
                let (whole, hollows) = match pieces.split_first() {
                    None => (Vec::new(), &[][..]),
                    Some((&(left, top, right, bottom, on_left, on_right), hollows)) => {
                        (rows(super::lower(left, top, right, bottom, (on_left, on_right))), hollows)
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
                    .flat_map(|&(left, top, right, bottom, round, _)| {
                        rows(super::rectangles(left, top, right, bottom, round))
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
    fn rows(all: Vec<super::Row>) -> Vec<Rectangle> {
        all.into_iter()
            .map(|(x, y, width, height)| Rectangle {
                x: clamp16(x),
                y: clamp16(y),
                width: u16::try_from(width.max(0)).unwrap_or(u16::MAX),
                height: u16::try_from(height.max(0)).unwrap_or(u16::MAX),
            })
            .collect()
    }
    fn clamp16(value: i32) -> i16 {
        i16::try_from(value.clamp(i32::from(i16::MIN), i32::from(i16::MAX))).unwrap_or(0)
    }
}
#[cfg(windows)]
mod engine {
    use tauri::Webview;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF,
        RGN_OR,
    };

    use super::{Piece, Shape};

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
    #[allow(unsafe_code, reason = "the page's window is given its region through GDI")]
    fn give(window: HWND, shape: Option<&[Piece]>) {
        unsafe {
            let Some(pieces) = shape else {
                SetWindowRgn(window, HRGN::default(), BOOL::from(true));
                return;
            };
            let region = match pieces.split_first() {
                None => CreateRectRgn(0, 0, 0, 0),
                Some((&(left, top, right, bottom, on_left, on_right), hollows)) => {
                    let whole = CreateRectRgn(0, 0, 0, 0);
                    for (x, y, width, height) in
                        super::lower(left, top, right, bottom, (on_left, on_right))
                    {
                        let row = CreateRectRgn(x, y, x + width, y + height);
                        CombineRgn(whole, whole, row, RGN_OR);
                        let _ = DeleteObject(row);
                    }
                    for &(left, top, right, bottom, round, _) in hollows {
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
        let bounds = page.bounds();
        let (whole, hollows) = match shape {
            None => (None, None),
            Some([]) => (None, Some(vec![(bounds, 0.0)])),
            Some([(left, top, right, bottom, on_left, on_right), hollows @ ..]) => {
                let by = if *right > 0 { bounds.size.width / f64::from(*right) } else { 1.0 };
                let at = |one: i32| f64::from(one) * by;
                let rect = |left: i32, top: i32, right: i32, bottom: i32| {
                    let y =
                        if page.isFlipped() { at(top) } else { bounds.size.height - at(bottom) };
                    NSRect::new(
                        NSPoint::new(at(left), y),
                        NSSize::new(at(right - left), at(bottom - top)),
                    )
                };
                let whole: Vec<NSRect> =
                    super::lower(*left, *top, *right, *bottom, (*on_left, *on_right))
                        .into_iter()
                        .map(|(x, y, width, height)| rect(x, y, x + width, y + height))
                        .collect();
                let hollows: Hollows = hollows
                    .iter()
                    .map(|&(left, top, right, bottom, round, _)| {
                        let one = rect(left, top, right, bottom);
                        let corner = (at(round) / 2.0)
                            .min(one.size.width / 2.0)
                            .min(one.size.height / 2.0)
                            .max(0.0);
                        (one, corner)
                    })
                    .collect();
                (Some(whole), (!hollows.is_empty()).then_some(hollows))
            }
        };
        mask(page, whole.as_deref(), hollows.as_deref());
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
    fn mask(page: &NSView, whole: Option<&[NSRect]>, hollows: Option<&[(NSRect, f64)]>) {
        unsafe {
            if whole.is_none() && hollows.is_none() {
                let layer: *mut AnyObject = msg_send![page, layer];
                if let Some(layer) = layer.as_ref() {
                    let () = msg_send![layer, setMask: std::ptr::null::<AnyObject>()];
                }
                return;
            }
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
            for &row in whole.unwrap_or(std::slice::from_ref(&bounds)) {
                CGPathAddRect(path, std::ptr::null(), row);
            }
            for &(hollow, corner) in hollows.unwrap_or_default() {
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
                std::ptr::from_ref::<NSView>(page).cast::<AnyObject>().cast_mut(),
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
}
#[cfg(test)]
mod tests {
    use super::{lower, rectangles, shape_of, Cut, Foot, Hollow};

    fn cut(all: bool, hollows: &[(f64, f64, f64, f64, f64)]) -> Cut {
        let hollows = hollows
            .iter()
            .map(|&(x, y, width, height, radius)| Hollow { x, y, width, height, radius })
            .collect();
        Cut { all, hollows }
    }
    #[test]
    fn the_page_is_cut_round_its_corner_and_what_lies_over_it_in_screen_pixels() {
        let menu = cut(false, &[(10.0, 20.0, 200.0, 100.0, 0.0)]);
        for (over, (width, height), scale, corner, shape) in [
            (None, (800, 600), 1.5, 10.0, Some(vec![(0, 0, 800, 600, 30, 30)])),
            (None, (800, 600), 1.5, 0.0, None),
            (None, (800, 600), 1.0, 0.0, None),
            (None, (8, 600), 1.0, 10.0, Some(vec![(0, 0, 8, 600, 8, 8)])),
            (Some(Cut::default()), (800, 600), 1.0, 0.0, None),
            (Some(cut(true, &[])), (800, 600), 1.0, 10.0, Some(Vec::new())),
            (Some(cut(true, &[])), (800, 600), 1.0, 0.0, Some(Vec::new())),
            (
                Some(menu),
                (800, 600),
                1.0,
                10.0,
                Some(vec![(0, 0, 800, 600, 20, 20), (10, 20, 210, 120, 0, 0)]),
            ),
            (
                Some(cut(false, &[(10.0, 20.0, 200.0, 100.0, 8.0)])),
                (1200, 900),
                1.5,
                0.0,
                Some(vec![(0, 0, 1200, 900, 0, 0), (15, 30, 315, 180, 24, 24)]),
            ),
            (
                Some(cut(false, &[(-40.0, -10.0, 100.0, 50.0, 0.0)])),
                (800, 600),
                1.0,
                0.0,
                Some(vec![(0, 0, 800, 600, 0, 0), (-40, -10, 60, 40, 0, 0)]),
            ),
            (
                Some(cut(false, &[(-248.0, 85.0, 328.0, 240.0, 12.0)])),
                (1000, 700),
                1.0,
                0.0,
                Some(vec![(0, 0, 1000, 700, 0, 0), (-248, 85, 80, 325, 24, 24)]),
            ),
            (Some(cut(false, &[(900.0, 10.0, 100.0, 50.0, 0.0)])), (800, 600), 1.0, 0.0, None),
            (Some(cut(false, &[(-140.0, 10.0, 100.0, 50.0, 0.0)])), (800, 600), 1.0, 0.0, None),
        ] {
            assert_eq!(
                shape_of(over.as_ref(), width, height, scale, Foot::Even(corner)),
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
    #[test]
    fn a_page_is_rounded_at_each_bottom_corner_its_card_rounds() {
        assert_eq!(
            shape_of(None, 800, 600, 1.0, Foot::Apart(10.0, 0.0)),
            Some(vec![(0, 0, 800, 600, 20, 0)])
        );
        assert_eq!(
            shape_of(None, 800, 600, 2.0, Foot::Apart(0.0, 10.0)),
            Some(vec![(0, 0, 800, 600, 0, 40)])
        );
        assert_eq!(shape_of(None, 800, 600, 1.0, Foot::Apart(0.0, 0.0)), None);
        let said: Foot = serde_json::from_str("[10, 0]").expect("two corners");
        assert_eq!(said.sides(), (10.0, 0.0));
        let said: Foot = serde_json::from_str("10").expect("one corner");
        assert_eq!(said.sides(), (10.0, 10.0));
    }
    #[test]
    fn a_page_is_rounded_at_the_bottom_alone() {
        let page = lower(0, 0, 100, 50, (16, 16));
        assert_eq!(page.len(), 1 + 8);
        assert_eq!(page[0], (0, 0, 100, 42));
        let rows = &page[1..];
        assert!(rows.iter().all(|one| one.1 >= 42 && one.2 <= 100));
        let last = rows.iter().find(|one| one.1 == 49).expect("the bottom row");
        assert!(last.2 < 100 && last.0 > 0);
        assert!(last.0 + last.2 < 100);
        assert_eq!(lower(0, 0, 100, 50, (0, 0)).len(), 1);
    }
    #[test]
    fn a_page_square_at_one_bottom_corner_runs_to_it() {
        let page = lower(0, 0, 100, 50, (16, 0));
        let last = page.iter().find(|one| one.1 == 49).expect("the bottom row");
        assert!(last.0 > 0);
        assert_eq!(last.0 + last.2, 100);
        let page = lower(0, 0, 100, 50, (0, 16));
        let last = page.iter().find(|one| one.1 == 49).expect("the bottom row");
        assert_eq!(last.0, 0);
        assert!(last.2 < 100);
    }
    #[test]
    fn corners_are_rows_as_wide_as_the_curve() {
        let square = rectangles(10, 20, 110, 70, 0);
        assert_eq!(square, vec![(10, 20, 100, 50)]);
        let round = rectangles(0, 0, 100, 50, 16);
        assert_eq!(round.len(), 1 + 2 * 8);
        assert_eq!((round[0].1, round[0].3), (8, 34));
        let first = round[1];
        let last = round[2 * 7 + 1];
        assert!(first.2 < last.2, "{first:?} {last:?}");
        assert!(round.iter().all(|one| one.2 <= 100));
        assert!(rectangles(0, 0, 0, 10, 4).is_empty());
    }
}
