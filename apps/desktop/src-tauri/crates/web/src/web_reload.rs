use tauri::Webview;

pub fn stop(view: &Webview) -> Result<(), String> {
    view.eval("window.stop()")
        .map_err(|error| format!("that page could not be stopped: {error}"))
}

pub fn fresh(view: &Webview) -> Result<(), String> {
    view.reload()
        .map_err(|error| format!("that page could not be reloaded: {error}"))
}
