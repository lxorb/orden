pub(crate) fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    use tauri_runtime_cef::WebviewCefExt as _;
    view.with_cef_webview(move |page| {
        if let Some(host) = page.browser().host() {
            host.set_audio_muted(i32::from(muted));
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}
