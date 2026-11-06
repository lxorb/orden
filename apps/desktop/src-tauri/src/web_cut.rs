use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use serde::Deserialize;
use tauri::Webview;

#[cfg(target_os = "macos")]
pub mod under;

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

#[allow(
    clippy::cast_possible_truncation,
    reason = "a page is never anywhere near two billion pixels across"
)]
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

pub const CUTS: bool = cfg!(any(
    all(windows, not(feature = "cef")),
    all(target_os = "linux", feature = "cef")
));

#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq)]
#[serde(untagged)]
pub enum Layering {
    Cuts(bool),
    #[cfg_attr(
        not(any(all(windows, not(feature = "cef")), target_os = "macos")),
        allow(
            dead_code,
            reason = "only the system's engines on Windows and a Mac draw a page under the app yet"
        )
    )]
    Under(&'static str),
}

pub fn layering(label: &str) -> Layering {
    #[cfg(all(windows, not(feature = "cef")))]
    if crate::web_visual::is_drawn_under(label) {
        return Layering::Under("under");
    }
    #[cfg(target_os = "macos")]
    if under::under(label) {
        return Layering::Under("under");
    }
    let _ = label;
    Layering::Cuts(CUTS)
}

static GIVEN: LazyLock<Mutex<Given>> = LazyLock::new(Mutex::default);

type Given = HashMap<String, (Option<Cut>, f64, Shape)>;

fn given<T>(look: impl FnOnce(&mut Given) -> T) -> T {
    look(&mut GIVEN.lock().unwrap_or_else(PoisonError::into_inner))
}

pub fn apply(view: &Webview, cut: Option<Cut>, wide: u32, tall: u32, scale: f64, corner: f64) {
    if !CUTS {
        #[cfg(target_os = "macos")]
        under::cut(view, cut.as_ref());
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
    #[cfg(target_os = "macos")]
    under::forget(label);
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use tauri::Webview;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF,
        RGN_OR,
    };

    use super::Shape;

    pub fn round(_view: &Webview, _corner: f64) {}

    #[allow(
        unsafe_code,
        reason = "the controller's window is asked through WebView2's COM interface, and the region set through GDI"
    )]
    pub fn shape(view: &Webview, shape: Shape) {
        let _ = view.with_webview(move |platform| unsafe {
            let mut held = windows_com::Win32::Foundation::HWND::default();
            if platform.controller().ParentWindow(&raw mut held).is_err() {
                return;
            }
            let window = HWND(held.0);
            let Some(pieces) = shape else {
                SetWindowRgn(window, HRGN::default(), BOOL::from(true));
                return;
            };
            let region = match pieces.split_first() {
                None => CreateRectRgn(0, 0, 0, 0),
                Some((&(left, top, right, bottom, round), hollows)) => {
                    let whole = CreateRectRgn(left, top, right, bottom - round / 2);
                    if round > 0 {
                        let corners =
                            CreateRoundRectRgn(left, top, right + 1, bottom + 1, round, round);
                        CombineRgn(whole, whole, corners, RGN_OR);
                        let _ = DeleteObject(corners);
                    }
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
        });
    }
}

#[cfg(all(target_os = "linux", feature = "cef"))]
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
            let Some(window) = crate::web_keys::x11_window(&platform) else {
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

    #[allow(
        clippy::cast_possible_truncation,
        reason = "never more than the radius, which is a page's size at most"
    )]
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

#[cfg(target_os = "macos")]
mod engine {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_web_kit::WKWebView;
    use tauri::Webview;

    use super::Shape;

    pub fn shape(_view: &Webview, _shape: Shape) {}

    #[allow(
        unsafe_code,
        reason = "the page's layer is reached and rounded through the Objective-C runtime"
    )]
    pub fn round(view: &Webview, corner: f64) {
        let corner = corner.max(0.0);
        let _ = view.with_webview(move |platform| unsafe {
            let Some(page) = Retained::retain(platform.inner().cast::<WKWebView>()) else {
                return;
            };
            page.setWantsLayer(true);
            let layer: *mut AnyObject = msg_send![&*page, layer];
            let Some(layer) = layer.as_ref() else {
                return;
            };
            let flipped: bool = msg_send![layer, contentsAreFlipped];
            let bottom: usize = if flipped { 4 | 8 } else { 1 | 2 };
            let _: () = msg_send![layer, setCornerRadius: corner];
            let _: () = msg_send![layer, setMaskedCorners: bottom];
            let _: () = msg_send![layer, setMasksToBounds: corner > 0.0];
        });
    }
}

#[cfg(not(any(
    all(windows, not(feature = "cef")),
    all(target_os = "linux", feature = "cef"),
    target_os = "macos"
)))]
mod engine {
    use tauri::Webview;

    use super::Shape;

    pub fn shape(_view: &Webview, _shape: Shape) {}

    pub fn round(_view: &Webview, _corner: f64) {}
}

#[cfg(test)]
mod tests {
    use super::{shape_of, Cut, Hollow};

    fn hollow(x: f64, y: f64, width: f64, height: f64) -> Hollow {
        Hollow {
            x,
            y,
            width,
            height,
            radius: 0.0,
        }
    }

    #[test]
    fn the_page_wears_the_card_s_corner_at_its_bottom() {
        assert_eq!(
            shape_of(None, 800, 600, 1.5, 10.0),
            Some(vec![(0, 0, 800, 600, 30)])
        );
        assert_eq!(shape_of(None, 800, 600, 1.5, 0.0), None);
        let cut = Cut {
            all: false,
            hollows: vec![hollow(10.0, 20.0, 200.0, 100.0)],
        };
        assert_eq!(
            shape_of(Some(&cut), 800, 600, 1.0, 10.0),
            Some(vec![(0, 0, 800, 600, 20), (10, 20, 210, 120, 0)])
        );
        let all = Cut {
            all: true,
            hollows: Vec::new(),
        };
        assert_eq!(shape_of(Some(&all), 800, 600, 1.0, 10.0), Some(Vec::new()));
        assert_eq!(
            shape_of(None, 8, 600, 1.0, 10.0),
            Some(vec![(0, 0, 8, 600, 8)])
        );
    }

    #[test]
    fn nothing_over_the_page_is_the_whole_page() {
        assert_eq!(shape_of(None, 800, 600, 1.0, 0.0), None);
        assert_eq!(shape_of(Some(&Cut::default()), 800, 600, 1.0, 0.0), None);
    }

    #[test]
    fn a_sheet_over_everything_leaves_nothing() {
        let all = Cut {
            all: true,
            hollows: Vec::new(),
        };
        assert_eq!(shape_of(Some(&all), 800, 600, 1.0, 0.0), Some(Vec::new()));
    }

    #[test]
    fn a_menu_is_taken_out_of_the_page_in_screen_pixels() {
        let cut = Cut {
            all: false,
            hollows: vec![Hollow {
                radius: 8.0,
                ..hollow(10.0, 20.0, 200.0, 100.0)
            }],
        };
        assert_eq!(
            shape_of(Some(&cut), 1200, 900, 1.5, 0.0),
            Some(vec![(0, 0, 1200, 900, 0), (15, 30, 315, 180, 24)])
        );
    }

    #[test]
    fn a_layer_reaching_past_the_page_keeps_its_own_shape() {
        let cut = Cut {
            all: false,
            hollows: vec![hollow(-40.0, -10.0, 100.0, 50.0)],
        };
        assert_eq!(
            shape_of(Some(&cut), 800, 600, 1.0, 0.0),
            Some(vec![(0, 0, 800, 600, 0), (-40, -10, 60, 40, 0)])
        );
    }

    #[test]
    fn a_menu_over_the_page_s_edge_has_its_corners_where_the_menu_has_them() {
        let cut = Cut {
            all: false,
            hollows: vec![Hollow {
                radius: 12.0,
                ..hollow(-248.0, 85.0, 328.0, 240.0)
            }],
        };
        assert_eq!(
            shape_of(Some(&cut), 1000, 700, 1.0, 0.0),
            Some(vec![(0, 0, 1000, 700, 0), (-248, 85, 80, 325, 24)])
        );
    }

    #[test]
    fn a_layer_beside_the_page_is_no_cut() {
        let cut = Cut {
            all: false,
            hollows: vec![hollow(900.0, 10.0, 100.0, 50.0)],
        };
        assert_eq!(shape_of(Some(&cut), 800, 600, 1.0, 0.0), None);
        let left = Cut {
            all: false,
            hollows: vec![hollow(-140.0, 10.0, 100.0, 50.0)],
        };
        assert_eq!(shape_of(Some(&left), 800, 600, 1.0, 0.0), None);
    }
}
