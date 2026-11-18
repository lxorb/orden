#[tauri::command]
pub fn web_dialog_answer(app: tauri::AppHandle, id: u64, accept: bool, text: Option<String>) {
    let _ = (app, id, accept, text);
}

pub fn dismiss(app: &tauri::AppHandle, tab: &str) {
    use tauri::Manager as _;

    let tab = tab.to_owned();
    let _ = app.run_on_main_thread(move || leave(&tab));
}

pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: tauri::AppHandle,
    _tab: String,
    _window: String,
) {
}

pub fn forget(_tab: &str) {}

fn leave(_tab: &str) {}
