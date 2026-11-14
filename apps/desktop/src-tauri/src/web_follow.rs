use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};

use serde::Deserialize;
use tauri::{Manager as _, PhysicalPosition, PhysicalSize, Rect, Window, WindowEvent};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Extent {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Frame {
    pub window: Extent,
    pub area: Bounds,
    pub pane: Bounds,
}

const SAME: f64 = 0.5;

fn along(
    hole: (f64, f64),
    pane: (f64, f64),
    area: (f64, f64),
    extent: f64,
    now: f64,
) -> (f64, f64) {
    let (start, end) = area;
    let width = end - start;
    let grown = (now - extent).max(start - end);
    let scale = if width > 0.0 {
        (width + grown) / width
    } else {
        1.0
    };
    let at = |edge: f64| start + (edge - start) * scale;
    (
        at(pane.0) + (hole.0 - pane.0),
        at(pane.1) + (hole.1 - pane.1),
    )
}

#[must_use]
pub fn fitted(hole: Bounds, frame: &Frame, now: Extent) -> Bounds {
    if (now.width - frame.window.width).abs() < SAME
        && (now.height - frame.window.height).abs() < SAME
    {
        return hole;
    }

    let (left, right) = along(
        (hole.x, hole.x + hole.width),
        (frame.pane.x, frame.pane.x + frame.pane.width),
        (frame.area.x, frame.area.x + frame.area.width),
        frame.window.width,
        now.width,
    );
    let (top, bottom) = along(
        (hole.y, hole.y + hole.height),
        (frame.pane.y, frame.pane.y + frame.pane.height),
        (frame.area.y, frame.area.y + frame.area.height),
        frame.window.height,
        now.height,
    );
    Bounds {
        x: left,
        y: top,
        width: (right - left).max(1.0),
        height: (bottom - top).max(1.0),
    }
}

#[derive(Clone, Copy)]
struct Followed {
    hole: Bounds,
    frame: Frame,
}

static FOLLOWING: LazyLock<Mutex<HashMap<String, (String, Followed)>>> =
    LazyLock::new(Mutex::default);

fn following<T>(look: impl FnOnce(&mut HashMap<String, (String, Followed)>) -> T) -> T {
    look(&mut FOLLOWING.lock().unwrap_or_else(PoisonError::into_inner))
}

#[must_use]
pub fn extent(width: u32, height: u32, scale: f64) -> Option<Extent> {
    if width == 0 || height == 0 || scale <= 0.0 {
        return None;
    }
    Some(Extent {
        width: f64::from(width) / scale,
        height: f64::from(height) / scale,
    })
}

pub fn extent_of(window: &Window) -> Option<Extent> {
    let scale = crate::page_scale::of(window).ok()?;
    let size = window.inner_size().ok()?;
    extent(size.width, size.height, scale)
}

pub fn placed(
    window: &Window,
    label: &str,
    hole: Bounds,
    frame: Option<Frame>,
    shown: bool,
) -> Bounds {
    let Some(frame) = frame.filter(|_| shown) else {
        unfollow(label);
        return hole;
    };
    following(|all| {
        all.insert(
            label.to_string(),
            (window.label().to_string(), Followed { hole, frame }),
        )
    });
    extent_of(window).map_or(hole, |now| fitted(hole, &frame, now))
}

pub fn unfollow(label: &str) {
    following(|all| all.remove(label));
}

#[must_use]
#[allow(
    clippy::cast_possible_truncation,
    reason = "a page is never anywhere near two billion pixels across"
)]
pub fn edges(bounds: Bounds, scale: f64) -> (i32, i32, u32, u32) {
    let at = |length: f64| (length * scale).round() as i32;
    let (left, top) = (at(bounds.x), at(bounds.y));
    let (right, bottom) = (at(bounds.x + bounds.width), at(bounds.y + bounds.height));
    (
        left,
        top,
        right.saturating_sub(left).max(1).unsigned_abs(),
        bottom.saturating_sub(top).max(1).unsigned_abs(),
    )
}

pub fn put(view: &tauri::Webview, bounds: Bounds, scale: f64) -> tauri::Result<()> {
    view.set_bounds(rect_of(edges(bounds, scale)))
}

#[must_use]
pub fn rect_of((left, top, width, height): (i32, i32, u32, u32)) -> Rect {
    Rect {
        position: PhysicalPosition::new(left, top).into(),
        size: PhysicalSize::new(width, height).into(),
    }
}

pub fn heard(window: &Window, event: &WindowEvent) {
    let (now, scale) = match event {
        WindowEvent::Resized(_) => {
            let Ok(scale) = crate::page_scale::of(window) else {
                return;
            };
            (extent_of(window), scale)
        }
        WindowEvent::ScaleFactorChanged {
            scale_factor,
            new_inner_size,
            ..
        } => {
            let scale = crate::page_scale::of(window).unwrap_or(*scale_factor);
            (
                extent(new_inner_size.width, new_inner_size.height, scale),
                scale,
            )
        }
        _ => return,
    };
    let Some(now) = now else {
        return;
    };
    let mine: Vec<(String, Followed)> = following(|all| {
        all.iter()
            .filter(|(_, (held, _))| held == window.label())
            .map(|(label, (_, one))| (label.clone(), *one))
            .collect()
    });
    for (label, one) in mine {
        if let Some(view) = window.app_handle().get_webview(&label) {
            let bounds = fitted(one.hole, &one.frame, now);
            let (_, _, width, height) = edges(bounds, scale);
            let _ = put(&view, bounds, scale);
            crate::web_cut::refit(&view, width, height, scale);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{edges, extent, fitted, Bounds, Extent, Frame};

    fn near(found: Bounds, wanted: Bounds) {
        let off = [
            found.x - wanted.x,
            found.y - wanted.y,
            found.width - wanted.width,
            found.height - wanted.height,
        ];
        assert!(
            off.iter().all(|one| one.abs() < 0.01),
            "{found:?} is not {wanted:?}"
        );
    }

    fn at(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    fn one_pane() -> (Bounds, Frame) {
        let area = at(240.0, 36.0, 960.0, 724.0);
        let frame = Frame {
            window: Extent {
                width: 1200.0,
                height: 800.0,
            },
            area,
            pane: area,
        };
        (at(240.0, 76.0, 960.0, 684.0), frame)
    }

    #[test]
    fn the_same_size_is_the_same_place() {
        let (hole, frame) = one_pane();
        assert_eq!(fitted(hole, &frame, frame.window), hole);
    }

    #[test]
    fn one_pane_keeps_the_sidebar_and_the_bars_and_takes_the_rest() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1500.0,
                height: 900.0,
            },
        );
        near(now, at(240.0, 76.0, 1260.0, 784.0));
    }

    #[test]
    fn a_window_made_smaller_shrinks_the_page_and_nothing_else() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1000.0,
                height: 700.0,
            },
        );
        near(now, at(240.0, 76.0, 760.0, 584.0));
    }

    #[test]
    fn a_pane_of_two_keeps_its_share() {
        let area = at(240.0, 36.0, 960.0, 724.0);
        let frame = Frame {
            window: Extent {
                width: 1200.0,
                height: 800.0,
            },
            area,
            pane: at(720.0, 36.0, 480.0, 724.0),
        };
        let hole = at(720.0, 76.0, 480.0, 684.0);
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1440.0,
                height: 800.0,
            },
        );
        near(now, at(840.0, 76.0, 600.0, 684.0));
    }

    #[test]
    fn a_page_never_folds_to_nothing() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 100.0,
                height: 50.0,
            },
        );
        assert!(now.width >= 1.0 && now.height >= 1.0);
    }

    #[test]
    fn a_page_filling_the_window_fills_it_at_every_size() {
        let whole = at(0.0, 0.0, 1200.0, 800.0);
        let frame = Frame {
            window: Extent {
                width: 1200.0,
                height: 800.0,
            },
            area: whole,
            pane: whole,
        };
        let now = fitted(
            whole,
            &frame,
            Extent {
                width: 1920.0,
                height: 1080.0,
            },
        );
        near(now, at(0.0, 0.0, 1920.0, 1080.0));
    }

    #[test]
    fn half_a_pixel_of_rounding_is_no_resize() {
        let (hole, frame) = one_pane();
        let now = fitted(
            hole,
            &frame,
            Extent {
                width: 1200.4,
                height: 799.7,
            },
        );
        assert_eq!(now, hole);
    }

    #[test]
    fn a_minimised_window_says_nothing_about_the_layout() {
        assert_eq!(extent(0, 0, 1.5), None);
        assert_eq!(extent(1200, 0, 1.0), None);
        assert_eq!(
            extent(1800, 1200, 1.5),
            Some(Extent {
                width: 1200.0,
                height: 800.0,
            })
        );
    }

    #[test]
    fn a_page_s_edges_are_rounded_where_the_hole_s_are() {
        assert_eq!(
            edges(at(100.3, 40.2, 200.3, 560.2), 1.5),
            (150, 60, 301, 841)
        );
        assert_eq!(
            edges(at(240.0, 76.0, 960.0, 684.0), 1.0),
            (240, 76, 960, 684)
        );
        assert_eq!(edges(at(-10.0, -10.0, 0.1, 0.1), 2.0), (-20, -20, 1, 1));
    }
}
