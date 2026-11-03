//! The window a presenter reads their notes in (`slides/presenter.ts`, docs/slides.md):
//! its own page, `presenter.html`, that hears the deck over a broadcast channel and is
//! granted nothing.
//!
//! **Built here and not by the page**, which the plugin would allow: on CEF a broadcast
//! channel reaches only its own profile, and a profile is asked for when a webview is built,
//! from Rust. A window the page built came up in the profile the web's extensions run in,
//! where it heard no deck and showed nothing, with the app's commands in reach of any of
//! their scripts; see `engine::own_profile`. And on `WebView2` the first window's switches
//! are what lets a second one onto the same data folder at all; see `engine::BROWSER_ARGS`.
//!
//! **Async, and the building posted to the window's own event loop**, as `web_open` does and
//! for its reason: on `WebView2` a webview built inside the callback a sync command runs in
//! is a deadlock of the whole app. Posted rather than built from the command's own thread,
//! because `placement::built_away` on Windows watches the thread that builds.

use tauri::{AppHandle, Manager as _, Webview, WebviewUrl, WebviewWindowBuilder};

use crate::appearance::PRESENTER;

/// How big it opens: wide enough for the slide, the one after it and the notes beside them.
const WIDTH: f64 = 1100.0;
const HEIGHT: f64 = 680.0;

/// The window, opened at this place where the page picked one, from the page of a document
/// window. Standing already, it is left where it is; the page brings that one forward.
#[tauri::command]
pub async fn presenter_open(
    app: AppHandle,
    webview: Webview,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    if !crate::launch::is_document_window(webview.label()) {
        return Err("only a document window presents".to_string());
    }
    let (sending, mut waiting) = tauri::async_runtime::channel(1);
    let building = app.clone();
    app.run_on_main_thread(move || {
        let _ = sending.try_send(built_window(&building, x, y));
    })
    .map_err(|error| format!("could not open the presenter's window: {error}"))?;
    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("could not open the presenter's window".to_string()))
}

/// See `presenter_open`: on the window's own thread, outside any callback of the engine's.
fn built_window(app: &AppHandle, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    if app.get_webview_window(PRESENTER).is_some() {
        return Ok(());
    }
    let builder =
        WebviewWindowBuilder::new(app, PRESENTER, WebviewUrl::App("presenter.html".into()))
            .title("Orden")
            .inner_size(WIDTH, HEIGHT)
            // A drop is the page's, and never a pick; see `window_builder` in launch.rs.
            .disable_drag_drop_handler();
    let builder = match (x, y) {
        (Some(x), Some(y)) => builder.position(x, y),
        _ => builder,
    };

    // The same switches as the first window; see this file's comment.
    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.additional_browser_args(&crate::engine::browser_args(app));

    // And on CEF the interface's profile; see this file's comment.
    #[cfg(feature = "cef")]
    let builder = crate::engine::own_profile(builder);

    // Off the screen with every other window where a drive sent them there.
    crate::placement::built(builder)
        .map(|_| ())
        .map_err(|error| format!("could not open the presenter's window: {error}"))
}
