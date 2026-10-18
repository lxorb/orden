//! Places Linux web-tab pages over the app's webview instead of beside it in GTK's box.
//!
//! `Window::add_child` puts every child in one GTK box. When the app adds a browser page,
//! GTK shares the box's height between the app and the page, ignoring the page's bounds.
//! The page therefore appears in the lower half of the window. Move it into an overlay
//! that wraps the box and size it there in the window's own layout pixels.
//!
//! And the overlay is told each page's rectangle outright (`exactly`), rather than left to
//! work one out. Left to itself, GTK gives an overlaid widget the size it would like, up
//! to the window's edge, and a `WebKitWebView` would like more than its hole: a page made
//! smaller - the window narrowed, or moved to a screen of another scale - stayed out over
//! its pane's edge to the window's own (headless sway, 2026-10-17: the window's last
//! eight pixels at scales 1, 1.5, 1.75 and 2, and on the first page of a launch).

use gtk::glib::object::{Cast as _, ObjectExt as _};
use gtk::prelude::{ContainerExt as _, OverlayExt as _, WidgetExt as _};
use gtk::OverlaySignals as _;

/// Puts a page over the window's app webview at GTK's own pixel coordinates, on GTK's
/// event-loop thread.
pub fn page_over(view: &tauri::Webview, (left, top, width, height): (i32, i32, u32, u32)) {
    let _ = view.with_webview(move |platform| {
        let page: gtk::Widget = platform.inner().upcast();
        over(&page, left, top, width, height);
    });
}

fn over(page: &gtk::Widget, left: i32, top: i32, width: u32, height: u32) {
    let Some(parent) = page.parent() else {
        return;
    };
    if !parent.is::<gtk::Overlay>() {
        let Ok(column) = parent.downcast::<gtk::Box>() else {
            return;
        };
        let Some(overlay) = overlay_round(&column) else {
            return;
        };
        column.remove(page);
        // Bounds are measured from the window's top left, even in right-to-left locales.
        page.set_direction(gtk::TextDirection::Ltr);
        // Filled to the rectangle `exactly` hands the overlay, whatever size the page
        // would like to be.
        page.set_halign(gtk::Align::Fill);
        page.set_valign(gtk::Align::Fill);
        overlay.add_overlay(page);
    }
    // Where the page goes is kept on the page itself, which is where `exactly` reads it.
    page.set_margin_start(left.max(0));
    page.set_margin_top(top.max(0));
    page.set_size_request(
        i32::try_from(width).unwrap_or(i32::MAX),
        i32::try_from(height).unwrap_or(i32::MAX),
    );
}

/// Wraps the box that owns the window's main webview in an overlay, once.
fn overlay_round(column: &gtk::Box) -> Option<gtk::Overlay> {
    let holder = column.parent()?;
    if let Ok(overlay) = holder.clone().downcast::<gtk::Overlay>() {
        return Some(overlay);
    }
    let holder = holder.downcast::<gtk::Container>().ok()?;
    let overlay = gtk::Overlay::new();
    overlay.connect_get_child_position(|_, page| Some(exactly(page)));
    holder.remove(column);
    overlay.add(column);
    holder.add(&overlay);
    overlay.show();
    Some(overlay)
}

/// The rectangle a page is given in the overlay, in the overlay's own pixels: from the
/// overlay's corner to the far corner of the page's own rectangle. GTK takes the page's
/// margins off the near side of it, which leaves the page's left, top, width and height
/// as they were set, to the pixel.
fn exactly(page: &gtk::Widget) -> gtk::gdk::Rectangle {
    let (width, height) = page.size_request();
    let (right, bottom) = reach((page.margin_start(), page.margin_top()), (width, height));
    gtk::gdk::Rectangle::new(0, 0, right, bottom)
}

/// The far corner of a rectangle at `corner` of `size`, where a size not set yet is
/// none.
fn reach((left, top): (i32, i32), (width, height): (i32, i32)) -> (i32, i32) {
    (
        left.saturating_add(width.max(0)),
        top.saturating_add(height.max(0)),
    )
}

#[cfg(test)]
mod tests {
    use super::reach;

    #[test]
    fn a_page_reaches_its_own_far_corner_and_no_further() {
        assert_eq!(reach((260, 75), (1332, 917)), (1592, 992));
        // A page whose size was never set is at its corner and nothing more.
        assert_eq!(reach((260, 75), (-1, -1)), (260, 75));
        assert_eq!(reach((i32::MAX, 0), (10, 10)), (i32::MAX, 10));
    }
}
