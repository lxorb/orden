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
pub fn page_scheme_seen(webview: Webview<orden_base::Engine>, scheme: Scheme) {
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

pub fn wear(page: &Webview<orden_base::Engine>) {
    let Some(scheme) = said() else {
        return;
    };
    let Ok(engine) = crate::engine::engine() else {
        return;
    };
    let wear = engine.wear;
    let _ = page.with_webview(move |platform| wear(&platform, scheme));
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
