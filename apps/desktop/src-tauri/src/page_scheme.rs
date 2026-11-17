use std::sync::Mutex;

use tauri::{Manager as _, Webview};

pub const SCRIPT: &str = include_str!("page_scheme.js");

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    Light,
    Dark,
}

static SAID: Mutex<Option<Scheme>> = Mutex::new(None);

fn said() -> Option<Scheme> {
    *SAID
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[tauri::command]
pub fn page_scheme_seen(webview: Webview<crate::Engine>, scheme: Scheme) {
    let before = SAID
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .replace(scheme);
    if before == Some(scheme) {
        return;
    }
    for page in webview.app_handle().webviews().into_values() {
        if page.label() != page.window().label() {
            wear(&page);
        }
    }
}

pub fn wear(page: &Webview<crate::Engine>) {
    let Some(scheme) = said() else {
        return;
    };
    let _ = page.with_webview(move |platform| engine::wear(&platform, scheme));
}

mod engine {
    use cef::{ImplBrowser as _, ImplBrowserHost as _, ImplRequestContext as _, ImplView as _};

    use super::Scheme;

    pub fn wear(platform: &tauri::webview::PlatformWebview, scheme: Scheme) {
        let Some(view) = platform.downcast_ref::<tauri_runtime_cef::Webview>() else {
            return;
        };
        let mut browser = view.browser();
        let Some(context) = browser.host().and_then(|host| host.request_context()) else {
            return;
        };
        let variant = match scheme {
            Scheme::Light => cef::sys::cef_color_variant_t::CEF_COLOR_VARIANT_LIGHT,
            Scheme::Dark => cef::sys::cef_color_variant_t::CEF_COLOR_VARIANT_DARK,
        };
        context.set_chrome_color_scheme(cef::ColorVariant::from(variant), 0);
        ground(&mut browser);
        crate::agents::engines::cef::on_ui(move || ground(&mut browser));
    }

    fn ground(browser: &mut cef::Browser) {
        if let Some(view) = cef::browser_view_get_for_browser(Some(browser)) {
            view.set_background_color(WHITE);
        }
    }

    const WHITE: u32 = 0xFFFF_FFFF;
}

#[cfg(test)]
mod tests {
    use super::{Scheme, SCRIPT};

    #[test]
    fn the_script_says_the_scheme_the_app_wears() {
        assert!(SCRIPT.contains("'page_scheme_seen'"));
        assert!(SCRIPT.contains("data-theme"));
    }

    #[test]
    fn a_scheme_is_read_as_the_page_says_it() {
        assert_eq!(
            serde_json::from_str::<Scheme>("\"dark\"").ok(),
            Some(Scheme::Dark)
        );
        assert_eq!(
            serde_json::from_str::<Scheme>("\"light\"").ok(),
            Some(Scheme::Light)
        );
        assert!(serde_json::from_str::<Scheme>("\"system\"").is_err());
    }
}
