//! A touchpad's pinch, let through to the app's own page on Windows (#410).
//!
//! Emil, 2026-10-18, on Windows: *"still doesn't work, literally nothing happens"* - two
//! fingers pinched on a canvas or a page note did not zoom it. A pinch reaches a page as
//! wheel events with Ctrl held, the same on every engine, and the canvas and the page note
//! answer those (`wheelZoom` in camera.ts) and prevent their default. But wry turns
//! `WebView2`'s `IsPinchZoomEnabled` off along with the zoom hotkeys, which the app's
//! window keeps off so that Ctrl and the wheel are the app's text size and not the
//! engine's page zoom; and with pinch zoom off, `WebView2` drops a touchpad pinch before
//! the page hears anything of it. So pinch zoom is turned back on for the app's own page,
//! and only that: the hotkeys stay off, and every Ctrl-wheel the app does not answer
//! itself is prevented at the window (`watchTextSize` in text-size.ts), so a pinch over the
//! sidebar zooms nothing rather than the whole window.
//!
//! A web tab's page has the engine's own zoom, pinch and all, as Edge does; see
//! `web_tabs.rs`.

/// The first window's page, however it was built; see `ready` in lib.rs.
pub fn first_window(app: &tauri::AppHandle) {
    use tauri::Manager as _;

    if let Some(window) = app.get_webview_window("main") {
        let_through(window.as_ref());
    }
}

/// Lets a touchpad's pinch through to the page as Ctrl and the wheel. On the window's
/// thread, as its page is built.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the page's settings are WebView2's own, reached through its COM interfaces"
)]
pub fn let_through(webview: &tauri::Webview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows_core::Interface as _;

    let _ = webview.with_webview(|platform| {
        // Safe: the controller is this webview's, used on its own thread.
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
    });
}

/// Elsewhere a pinch reaches the page already.
#[cfg(not(windows))]
pub fn let_through(_webview: &tauri::Webview) {}
