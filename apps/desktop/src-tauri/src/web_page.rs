use serde::Serialize;
use tauri::AppHandle;

const SAID: &str = "orden://web-page";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "said", rename_all = "lowercase")]
pub enum Said {
    Zoom { factor: f64 },
    Crashed,
}

#[derive(Clone, Serialize)]
struct Heard {
    tab: String,
    #[serde(flatten)]
    said: Said,
}

pub fn ended(view: &tauri::Webview) {
    use tauri::{Emitter, Manager};

    let Some(tab) = crate::web_tabs::tab_of(view.label()) else {
        return;
    };
    let window = view.window().label().to_string();
    let heard = Heard {
        tab,
        said: Said::Crashed,
    };
    let _ = view.app_handle().emit_to(window.as_str(), SAID, heard);
}

pub fn actual_size(app: &AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    if view.set_zoom(crate::page_scale::web(1.0)).is_ok() {
        let heard = Heard {
            tab: tab.to_string(),
            said: Said::Zoom { factor: 1.0 },
        };
        let _ = app.emit_to(window, SAID, heard);
    }
}

#[tauri::command]
pub fn web_mute(app: AppHandle, tab: String, muted: bool) -> Result<(), String> {
    mute(&crate::web_tabs::found(&app, &tab)?, muted)
}

#[tauri::command]
pub fn web_unfill(app: AppHandle, tab: String) -> Result<(), String> {
    crate::web_tabs::found(&app, &tab)?
        .eval("if (document.fullscreenElement) document.exitFullscreen()")
        .map_err(|error| format!("that page could not be reached: {error}"))
}

pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    use tauri_runtime_cef::WebviewCefExt as _;
    view.with_cef_webview(move |page| {
        if let Some(host) = page.browser().host() {
            host.set_audio_muted(i32::from(muted));
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}
