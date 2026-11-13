use orden_web_engine::NativeWindow;

pub fn out_of_sight(view: &tauri::Webview) {
    #[cfg(feature = "cef")]
    let _ = view.with_webview(|platform| {
        if let Some(page) = crate::host::page_id(&platform) {
            crate::host::system().hide(page);
        }
    });
    #[cfg(not(feature = "cef"))]
    let _ = view;
}

pub fn no_ground(view: &tauri::Webview) {
    #[cfg(feature = "cef")]
    let _ = view.with_webview(|platform| {
        if let Some(page) = crate::host::page_id(&platform) {
            crate::host::system().bare(page);
        }
    });
    #[cfg(not(feature = "cef"))]
    let _ = view;
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn no_ground_in(window: NativeWindow) {
    crate::host::system().bare(window);
}
