//! The dictionaries Orden's own Chromium checks a word against, several at once (#771).
//!
//! Chromium reads no page's `lang` to choose a dictionary: it checks every word against
//! each one in its profile's `spellcheck.dictionaries`, and fetches one it has not got
//! the first time the list names it. Orden never wrote that list, so a note was checked in
//! the one dictionary the profile started with, which is the locale's - English, on the
//! NixOS laptop of the reader who asked for several. The window says which are on, and
//! this writes them into every profile a page of the app's is drawn from: its own
//! windows', so a note is checked in them, and a web tab's, so a field in a page is too,
//! the way one browser's dictionaries serve all of its tabs.
//!
//! The other engines keep no such list of their own to write - `WebView2` checks in
//! Windows' languages and `WKWebView` in the Mac's - so there it is nothing, and the
//! window says so; see lib/spell-languages.ts.

use tauri::{AppHandle, Manager as _};

/// The dictionaries to check in, by Chromium's tags (`de-DE`, `en-US`). Nothing when
/// the list is empty: a checker with no language is the window's switch for spelling,
/// not this.
#[tauri::command]
pub fn spell_languages(app: AppHandle, languages: Vec<String>) {
    let languages: Vec<String> = languages.into_iter().filter(|one| tag(one)).collect();
    if languages.is_empty() {
        return;
    }
    for page in app.webviews().into_values() {
        let languages = languages.clone();
        let _ = page.with_webview(move |platform| engine::use_dictionaries(&platform, &languages));
    }
}

/// Whether a tag is one Chromium could name a dictionary by: a language and an optional
/// region, letters only, so nothing else is written into the profile's preferences.
fn tag(said: &str) -> bool {
    let mut parts = said.split('-');
    let language = parts.next().unwrap_or_default();
    let region = parts.next();
    (2..=3).contains(&language.len())
        && language.chars().all(|one| one.is_ascii_lowercase())
        && region.is_none_or(|one| one.len() == 2 && one.chars().all(|c| c.is_ascii_uppercase()))
        && parts.next().is_none()
}

#[cfg(feature = "cef")]
mod engine {
    use cef::{
        CefString, ImplBrowser as _, ImplBrowserHost as _, ImplListValue as _,
        ImplPreferenceManager as _, ImplValue as _,
    };

    /// The preference Chromium's spellcheck service reads, and watches: a change is
    /// taken up at once, and a dictionary it has not got is fetched then.
    const DICTIONARIES: &str = "spellcheck.dictionaries";

    /// The page's profile told which dictionaries to check against. On CEF's UI thread,
    /// the only one a profile's preferences may be written on: anywhere else the write is
    /// refused, and with no reason given.
    pub fn use_dictionaries(platform: &tauri::webview::PlatformWebview, languages: &[String]) {
        let Some(context) = platform
            .downcast_ref::<tauri_runtime_cef::Webview>()
            .and_then(|view| view.browser().host())
            .and_then(|host| host.request_context())
        else {
            return;
        };
        let languages = languages.to_vec();
        let posted = crate::agents::engines::cef::on_ui(move || {
            let (Some(mut list), Some(mut value)) = (cef::list_value_create(), cef::value_create())
            else {
                return;
            };
            for (at, language) in languages.iter().enumerate() {
                list.set_string(at, Some(&CefString::from(language.as_str())));
            }
            value.set_list(Some(&mut list));
            // Something in it from the start: an empty `CefString` reaches CEF as no string
            // at all, and CEF refuses every write whose `error` is missing, before it reads
            // the name - which is how every write here was refused, with nothing said.
            let mut error = CefString::from(" ");
            if context.set_preference(
                Some(&CefString::from(DICTIONARIES)),
                Some(&mut value),
                Some(&mut error),
            ) == 0
            {
                eprintln!("spelling: the dictionaries were refused: {error}");
            }
        });
        if !posted {
            eprintln!("spelling: the engine's thread could not be reached");
        }
    }
}

#[cfg(not(feature = "cef"))]
mod engine {
    /// Nothing to tell: the platform's own checker reads the platform's languages.
    pub fn use_dictionaries(_platform: &tauri::webview::PlatformWebview, _languages: &[String]) {}
}

#[cfg(test)]
mod tests {
    use super::tag;

    #[test]
    fn only_a_language_and_a_region_are_written_into_the_profile() {
        for good in ["de-DE", "en-US", "nl", "pt-BR", "fil"] {
            assert!(tag(good), "{good}");
        }
        for bad in ["", "de-de", "DE", "en-US-x", "en_US", "de-DE\"", "x"] {
            assert!(!tag(bad), "{bad}");
        }
    }
}
