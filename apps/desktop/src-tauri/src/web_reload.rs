use tauri::Webview;

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "Stop is WebView2's own, reached through its COM interfaces"
)]
pub fn stop(view: &Webview) -> Result<(), String> {
    engine(view, |core| unsafe { core.Stop() })
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is reached through WebView2's COM interfaces"
)]
pub fn fresh(view: &Webview) -> Result<(), String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::w;

    engine(view, |core| {
        let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
        unsafe {
            core.CallDevToolsProtocolMethod(w!("Page.reload"), w!(r#"{"ignoreCache":true}"#), &done)
        }
    })
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the engine is reached through WebView2's controller, a COM interface"
)]
fn engine(
    view: &Webview,
    call: impl FnOnce(
            &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
        ) -> windows_core::Result<()>
        + Send
        + 'static,
) -> Result<(), String> {
    view.with_webview(move |platform| {
        if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
            let _ = call(&core);
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn stop(view: &Webview) -> Result<(), String> {
    view.eval("window.stop()")
        .map_err(|error| format!("that page could not be stopped: {error}"))
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn fresh(view: &Webview) -> Result<(), String> {
    view.reload()
        .map_err(|error| format!("that page could not be reloaded: {error}"))
}
