use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const FOUND: &str = "orden://web-found";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Look {
    Fresh,
    Next,
    Previous,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Found {
    #[serde(default)]
    tab: String,
    count: i32,
    at: i32,
}

const LOOKED: &str = r"(function (term, back, fresh) {
  try {
    var state = window.__ordenFound || (window.__ordenFound = { at: -1 })
    var selection = window.getSelection()
    if (fresh) {
      state.at = -1
      if (selection) selection.removeAllRanges()
    }

    var words = ((document.body && document.body.innerText) || '').toLowerCase()
    var want = term.toLowerCase()
    var count = 0
    for (var from = want ? words.indexOf(want) : -1; from >= 0; from = words.indexOf(want, from + want.length)) count++

    if (!count || typeof window.find !== 'function' || !window.find(term, false, back, true)) {
      return { count: count, at: -1 }
    }
    state.at = state.at < 0 ? (back ? count - 1 : 0) : (state.at + (back ? count - 1 : 1)) % count
    return { count: count, at: state.at }
  } catch (error) {
    return { count: 0, at: -1 }
  }
})(__TERM__, __BACK__, __FRESH__)";

const LEFT: &str =
    "(function () { var one = window.getSelection(); if (one) one.removeAllRanges() })()";

fn looked(term: &str, look: Look) -> String {
    let term = serde_json::to_string(term).unwrap_or_else(|_| "''".to_string());
    LOOKED
        .replace("__TERM__", &term)
        .replace(
            "__BACK__",
            if look == Look::Previous {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__FRESH__",
            if look == Look::Fresh { "true" } else { "false" },
        )
}

#[tauri::command]
pub fn web_find(app: AppHandle, tab: String, term: String, look: Look) -> Result<(), String> {
    let view = crate::web_tabs::found(&app, &tab)?;

    {
        let script = looked(&term, look);
        std::thread::spawn(move || {
            let found = crate::web_worlds::value(&view, &script)
                .and_then(|said| serde_json::from_value::<Found>(said).ok());
            if let Some(mut found) = found {
                found.tab = tab;
                let _ = view.emit_to(view.window().label(), FOUND, found);
            }
        });
        Ok(())
    }
}

#[tauri::command]
pub fn web_find_stop(app: AppHandle, tab: String) -> Result<(), String> {
    let view = crate::web_tabs::found(&app, &tab)?;

    {
        std::thread::spawn(move || crate::web_worlds::value(&view, LEFT));
        Ok(())
    }
}

pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

pub fn forget(_tab: &str) {}

#[cfg(test)]
mod tests {
    use super::{looked, Found, Look};

    #[test]
    fn a_word_is_handed_to_the_page_as_a_string_and_nothing_else() {
        let script = looked("it's \"quoted\"", Look::Fresh);
        assert!(script.ends_with(r#"("it's \"quoted\"", false, true)"#));
        assert!(!script.contains("__TERM__"));
    }

    #[test]
    fn the_previous_one_is_found_backwards() {
        assert!(looked("a", Look::Previous).ends_with(r#"("a", true, false)"#));
        assert!(looked("a", Look::Next).ends_with(r#"("a", false, false)"#));
    }

    #[test]
    fn the_page_s_answer_is_read_for_its_tally() {
        let found: Found = serde_json::from_str(r#"{"count":3,"at":1}"#).expect("an answer");
        assert_eq!((found.count, found.at), (3, 1));
    }
}
