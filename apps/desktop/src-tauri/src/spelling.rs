use tauri::{AppHandle, Manager as _};

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

fn tag(said: &str) -> bool {
    let mut parts = said.split('-');
    let language = parts.next().unwrap_or_default();
    let region = parts.next();
    (2..=3).contains(&language.len())
        && language.chars().all(|one| one.is_ascii_lowercase())
        && region.is_none_or(|one| one.len() == 2 && one.chars().all(|c| c.is_ascii_uppercase()))
        && parts.next().is_none()
}

mod engine {
    use cef::{
        CefString, ImplBrowser as _, ImplBrowserHost as _, ImplListValue as _,
        ImplPreferenceManager as _, ImplValue as _,
    };

    const DICTIONARIES: &str = "spellcheck.dictionaries";

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
