use tauri::{AppHandle, Manager as _, Webview, WebviewUrl, WebviewWindowBuilder};

use crate::appearance::PRESENTER;

const WIDTH: f64 = 1100.0;
const HEIGHT: f64 = 680.0;

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

fn built_window(app: &AppHandle, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    if app.get_webview_window(PRESENTER).is_some() {
        return Ok(());
    }
    let builder =
        WebviewWindowBuilder::new(app, PRESENTER, WebviewUrl::App("presenter.html".into()))
            .initialization_script(crate::old_home::script())
            .title("Orden")
            .inner_size(WIDTH, HEIGHT)
            .disable_drag_drop_handler();
    let builder = match (x, y) {
        (Some(x), Some(y)) => builder.position(x, y),
        _ => builder,
    };

    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.additional_browser_args(&crate::engine::browser_args(app));

    #[cfg(feature = "cef")]
    let builder = crate::engine::own_profile(builder);

    crate::placement::built(builder)
        .map(|_| ())
        .map_err(|error| format!("could not open the presenter's window: {error}"))
}
