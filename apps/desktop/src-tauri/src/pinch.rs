pub fn first_window(app: &tauri::AppHandle) {
    use tauri::Manager as _;

    if let Some(window) = app.get_webview_window("main") {
        let_through(window.as_ref());
    }
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the page's settings are WebView2's own, reached through its COM interfaces"
)]
pub fn let_through(webview: &tauri::Webview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows_core::Interface as _;

    let _ = webview.with_webview(|platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        if let Ok(five) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = five.SetIsPinchZoomEnabled(true);
        }
    });
}

#[cfg(not(windows))]
pub fn let_through(_webview: &tauri::Webview) {}
