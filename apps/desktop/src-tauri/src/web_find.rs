use serde::{Deserialize, Serialize};
#[cfg(not(feature = "cef"))]
use tauri::Webview;
use tauri::{AppHandle, Emitter};

const FOUND: &str = "nib://web-found";

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
    var state = window.__nibFound || (window.__nibFound = { at: -1 })
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

    #[cfg(all(windows, not(feature = "cef")))]
    {
        let asking = view.clone();
        app.run_on_main_thread(move || {
            if !native::seek(&tab, &term, look) {
                script(&asking, tab, &term, look);
            }
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }

    #[cfg(all(not(windows), not(feature = "cef")))]
    {
        script(&view, tab, &term, look);
        Ok(())
    }

    #[cfg(feature = "cef")]
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

    #[cfg(all(windows, not(feature = "cef")))]
    {
        let asking = view.clone();
        app.run_on_main_thread(move || {
            if !native::halt(&tab) {
                let _ = asking.eval(LEFT);
            }
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }

    #[cfg(all(not(windows), not(feature = "cef")))]
    return view
        .eval(LEFT)
        .map_err(|error| format!("that page could not be reached: {error}"));

    #[cfg(feature = "cef")]
    {
        std::thread::spawn(move || crate::web_worlds::value(&view, LEFT));
        Ok(())
    }
}

#[cfg(not(feature = "cef"))]
fn script(view: &Webview, tab: String, term: &str, look: Look) {
    let telling = view.clone();
    let _ = view.eval_with_callback(looked(term, look), move |answer| {
        let Ok(mut found) = serde_json::from_str::<Found>(&answer) else {
            return;
        };
        found.tab.clone_from(&tab);
        let _ = telling.emit_to(telling.window().label(), FOUND, found);
    });
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn forget(_tab: &str) {}

#[cfg(all(windows, not(feature = "cef")))]
pub use native::{forget, listen};

#[cfg(all(windows, not(feature = "cef")))]
mod native {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment15, ICoreWebView2Find, ICoreWebView2_28,
    };
    use webview2_com::{
        FindActiveMatchIndexChangedEventHandler, FindMatchCountChangedEventHandler,
        FindStartCompletedHandler,
    };
    use windows_core::{Interface, HSTRING};

    use super::{Found, Look, FOUND};

    struct Finder {
        find: ICoreWebView2Find,
        env: ICoreWebView2Environment15,
        tell: Rc<dyn Fn(&ICoreWebView2Find)>,
    }

    thread_local! {
        static FINDERS: RefCell<HashMap<String, Finder>> = RefCell::new(HashMap::new());
    }

    #[allow(
        unsafe_code,
        reason = "the engine's find and its events are reached through WebView2's COM interfaces"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(find) = core.cast::<ICoreWebView2_28>().and_then(|one| one.Find()) else {
                return;
            };
            let Ok(env) = webview.environment().cast::<ICoreWebView2Environment15>() else {
                return;
            };

            let named = tab.clone();
            let tell: Rc<dyn Fn(&ICoreWebView2Find)> = Rc::new(move |reading| {
                let mut count = 0i32;
                let mut at = 0i32;
                let _ = reading.MatchCount(&raw mut count);
                let _ = reading.ActiveMatchIndex(&raw mut at);
                let found = Found {
                    tab: named.clone(),
                    count,
                    at: at - 1,
                };
                let _ = app.emit_to(window.as_str(), FOUND, found);
            });

            let counted = Rc::clone(&tell);
            let count = FindMatchCountChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(one) = sender {
                    counted(&one);
                }
                Ok(())
            }));
            let lit = Rc::clone(&tell);
            let active =
                FindActiveMatchIndexChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(one) = sender {
                        lit(&one);
                    }
                    Ok(())
                }));
            let mut token = 0i64;
            let _ = find.add_MatchCountChanged(&count, &raw mut token);
            let _ = find.add_ActiveMatchIndexChanged(&active, &raw mut token);

            FINDERS.with_borrow_mut(|all| all.insert(tab, Finder { find, env, tell }));
        }
    }

    #[allow(
        unsafe_code,
        reason = "the engine's find is reached through its COM interfaces"
    )]
    pub fn seek(tab: &str, term: &str, look: Look) -> bool {
        FINDERS.with_borrow(|all| {
            let Some(finder) = all.get(tab) else {
                return false;
            };

            let done = unsafe {
                match look {
                    Look::Next => finder.find.FindNext(),
                    Look::Previous => finder.find.FindPrevious(),
                    Look::Fresh => opened_on(finder, term),
                }
            };
            done.is_ok()
        })
    }

    #[allow(
        unsafe_code,
        reason = "the engine's find is reached through its COM interfaces"
    )]
    unsafe fn opened_on(finder: &Finder, term: &str) -> windows_core::Result<()> {
        unsafe {
            let options = finder.env.CreateFindOptions()?;
            options.SetFindTerm(&HSTRING::from(term))?;
            options.SetIsCaseSensitive(false)?;
            options.SetShouldMatchWord(false)?;
            options.SetShouldHighlightAllMatches(true)?;
            options.SetSuppressDefaultFindDialog(true)?;

            let tell = Rc::clone(&finder.tell);
            let find = finder.find.clone();
            let started = FindStartCompletedHandler::create(Box::new(move |_| {
                tell(&find);
                Ok(())
            }));
            finder.find.Start(&options, &started)
        }
    }

    #[allow(
        unsafe_code,
        reason = "the engine's find is reached through its COM interfaces"
    )]
    pub fn halt(tab: &str) -> bool {
        FINDERS.with_borrow(|all| {
            all.get(tab)
                .is_some_and(|finder| unsafe { finder.find.Stop() }.is_ok())
        })
    }

    pub fn forget(tab: &str) {
        FINDERS.with_borrow_mut(|all| all.remove(tab));
    }
}

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
