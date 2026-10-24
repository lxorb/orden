//! A web tab's page taken out of sight without a frame of it white, on Linux.
//!
//! A reader on Hyprland was flashed white at every switch of tab (#762), and a film of
//! the screen at sixty frames a second showed it: the page that went was drawn white
//! for a frame or more before it went, and again after. Two things did it, both in the
//! order things were done. The page was moved to the place the window gave it while it
//! was still on screen, so Chromium laid it out again and drew a blank one at the new
//! size; and the runtime hides a page by first telling Chromium it is hidden, which
//! throws its last frame away, and only then taking its window off the screen. Each
//! left a window on screen with nothing drawn in it, which is white.
//!
//! So a page is taken off the screen first (`out_of_sight`, its X11 window unmapped),
//! and only then told it is hidden and moved; one coming back is moved while it is out
//! of sight, as it always was, and then shown.
//!
//! And the X server's own white: a window shown, or a window uncovered by one taken
//! away, is filled with its background until its client draws, and every window CEF and
//! GTK make has a white one - the page's as it came back, and the app's own under a page
//! as it went. So none of the app's windows or its pages' has a background at all
//! (`no_ground`): the X server leaves what was drawn there until the new frame comes,
//! which is what a compositing desktop shows too.

#[cfg(feature = "cef")]
mod engine {
    use std::sync::LazyLock;

    use tauri::Webview;
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{ChangeWindowAttributesAux, ConnectionExt as _};
    use x11rb::rust_connection::RustConnection;
    use x11rb::wrapper::ConnectionExt as _;

    /// The crate's own connection to the X server for this, made the first time a page
    /// is put out of sight; `None` where there is no X server.
    static X: LazyLock<Option<RustConnection>> =
        LazyLock::new(|| x11rb::connect(None).ok().map(|(x, _)| x));

    /// `window` and every window inside it given no background.
    pub fn bare(window: u32) {
        let Some(x) = X.as_ref() else {
            return;
        };
        let none = ChangeWindowAttributesAux::new().background_pixmap(x11rb::NONE);
        let mut todo = vec![window];
        let mut seen = 0;
        while let Some(one) = todo.pop() {
            seen += 1;
            if seen > 256 {
                break;
            }
            let _ = x.change_window_attributes(one, &none);
            if let Ok(Ok(tree)) = x.query_tree(one).map(|cookie| cookie.reply()) {
                todo.extend(tree.children);
            }
        }
        let _ = x.flush();
    }

    pub fn page(view: &Webview) {
        let _ = view.with_webview(|platform| {
            if let Some(window) = crate::web_keys::x11_window(&platform) {
                bare(window);
            }
        });
    }

    pub fn out_of_sight(view: &Webview) {
        let _ = view.with_webview(|platform| {
            let (Some(window), Some(x)) = (crate::web_keys::x11_window(&platform), X.as_ref())
            else {
                return;
            };
            let _ = x.unmap_window(window);
            // Off the screen before anything else is done to it.
            let _ = x.sync();
        });
    }
}

/// Takes a page's window off the screen before it is told it is hidden or moved; see the
/// top of this file. Nothing where the engine hides a page in one step of its own.
pub fn out_of_sight(view: &tauri::Webview) {
    #[cfg(feature = "cef")]
    engine::out_of_sight(view);
    #[cfg(not(feature = "cef"))]
    let _ = view;
}

/// Gives a page's windows no background, so the X server draws nothing of its own
/// in them; see the top of this file.
pub fn no_ground(view: &tauri::Webview) {
    #[cfg(feature = "cef")]
    engine::page(view);
    #[cfg(not(feature = "cef"))]
    let _ = view;
}

/// The same for a window of the app's own, by its X11 window, and everything in it.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn no_ground_in(window: u32) {
    #[cfg(feature = "cef")]
    engine::bare(window);
    #[cfg(not(feature = "cef"))]
    let _ = window;
}
