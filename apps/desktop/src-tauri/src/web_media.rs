//! A video or a sound a page in a web tab will not play, said to the window (#1021).
//!
//! The CEF Orden ships has no H.264, HEVC or AAC (packaging/linux.md), so most of the web's
//! MP4s fail with nothing but a player that spins. A script in nib's world in every page and
//! frame (`SCRIPT`, `web_media.js`) hears a media element fail for want of a decoder and asks
//! through `web_opens::BINDING`, under `UNPLAYABLE`. The window then offers the page in the
//! system's browser, which has the decoders; see `apps/desktop/src/lib/web-tab/heard.ts`.
//!
//! Only on Orden's own Chromium: `WebView2` and `WKWebView` have the decoders. The script
//! asks the engine first, so a CEF built with them says nothing and needs nothing here
//! taken out.

// Elsewhere nothing but the tests reads any of it.
#![cfg_attr(not(feature = "cef"), allow(dead_code))]

/// Orden's script for every page and frame, as the file holds it; see `web_media.js`.
const SCRIPT: &str = include_str!("web_media.js");

/// The name the script asks under, through `web_opens::BINDING`.
pub const UNPLAYABLE: &str = "nib-media-unplayable";

/// What the window hears, for the tab that asked.
const HEARD: &str = "nib://web-unplayable";

/// The script as a page is handed it; see `web_swipe::script`.
pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}

/// Says to its window that `tab` holds something it will not play. The caller knows the tab
/// from where it was listening; nothing the page says names it.
pub fn heard(app: &tauri::AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let _ = app.emit_to(window, HEARD, serde_json::json!({ "tab": tab }));
}

#[cfg(test)]
mod tests {
    use super::{script, SCRIPT, UNPLAYABLE};

    #[test]
    fn the_script_asks_under_the_name_the_crate_reads() {
        assert!(SCRIPT.contains(UNPLAYABLE));
    }

    #[test]
    fn the_script_is_one_function_called_on_the_spot() {
        assert!(script().starts_with("(function () {"));
        assert!(script().ends_with("})()"));
    }
}
