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

#[cfg(feature = "cef")]
mod engine {
    use std::sync::LazyLock;

    use tauri::Webview;
    use x11rb::protocol::xproto::ConnectionExt as _;
    use x11rb::rust_connection::RustConnection;
    use x11rb::wrapper::ConnectionExt as _;

    /// The crate's own connection to the X server for this, made the first time a page
    /// is put out of sight; `None` where there is no X server.
    static X: LazyLock<Option<RustConnection>> =
        LazyLock::new(|| x11rb::connect(None).ok().map(|(x, _)| x));

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
