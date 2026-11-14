use orden_web_engine::NativeWindow;

pub fn out_of_sight(view: &tauri::Webview) {
    let _ = view.with_webview(|platform| {
        if let Some(page) = crate::host::page_id(&platform) {
            crate::host::system().hide(page);
        }
    });
}

pub fn no_ground(view: &tauri::Webview) {
    let _ = view.with_webview(|platform| {
        if let Some(page) = crate::host::page_id(&platform) {
            crate::host::system().bare(page);
        }
    });
}

pub fn no_ground_in(window: NativeWindow) {
    crate::host::system().bare(window);
}
