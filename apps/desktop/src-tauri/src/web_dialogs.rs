use serde::Serialize;

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const DIALOG: &str = "nib://web-dialog";

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Alert,
    Confirm,
    Prompt,
    Leave,
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Debug, Serialize)]
struct Opened {
    tab: String,
    id: u64,
    kind: Kind,
    message: String,
    text: String,
    origin: String,
}

#[tauri::command]
pub fn web_dialog_answer(app: tauri::AppHandle, id: u64, accept: bool, text: Option<String>) {
    #[cfg(all(windows, not(feature = "cef")))]
    let _ = app.run_on_main_thread(move || engine::answer(id, accept, text.as_deref()));
    #[cfg(not(all(windows, not(feature = "cef"))))]
    let _ = (app, id, accept, text);
}

#[cfg(all(windows, not(feature = "cef")))]
pub use engine::{forget, leave, listen};

pub fn dismiss(app: &tauri::AppHandle, tab: &str) {
    #[cfg(feature = "cef")]
    use tauri::Manager as _;

    let tab = tab.to_owned();
    let _ = app.run_on_main_thread(move || leave(&tab));
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicU64, Ordering};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2ScriptDialogOpeningEventArgs,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND, COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD, COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
    };
    use webview2_com::{
        ContentLoadingEventHandler, NavigationCompletedEventHandler,
        ScriptDialogOpeningEventHandler,
    };
    use windows_core::{HSTRING, PWSTR};

    use super::{Kind, Opened, DIALOG};

    struct Waiting {
        tab: String,
        args: ICoreWebView2ScriptDialogOpeningEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    thread_local! {
        static WAITING: RefCell<HashMap<u64, Waiting>> = RefCell::new(HashMap::new());
        static LEAVING: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    }

    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn kind_of(kind: COREWEBVIEW2_SCRIPT_DIALOG_KIND) -> Option<Kind> {
        match kind {
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT => Some(Kind::Alert),
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM => Some(Kind::Confirm),
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => Some(Kind::Prompt),
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => Some(Kind::Leave),
            _ => None,
        }
    }

    fn read(get: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
        let mut value = PWSTR::null();
        match get(&raw mut value) {
            Ok(()) => webview2_com::take_pwstr(value),
            Err(_) => String::new(),
        }
    }

    #[allow(
        unsafe_code,
        reason = "a page's dialogs are WebView2's own, reached through its COM interfaces"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(settings) = core.Settings() else {
                return;
            };
            if settings.SetAreDefaultScriptDialogsEnabled(false).is_err() {
                return;
            }

            let loading = ContentLoadingEventHandler::create(Box::new({
                let tab = tab.clone();
                move |_, _| {
                    arrived(&tab);
                    Ok(())
                }
            }));
            let settled = NavigationCompletedEventHandler::create(Box::new({
                let tab = tab.clone();
                move |_, _| {
                    arrived(&tab);
                    Ok(())
                }
            }));
            let mut token = 0i64;
            let _ = core.add_ContentLoading(&loading, &raw mut token);
            let _ = core.add_NavigationCompleted(&settled, &raw mut token);

            let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                if LEAVING.with_borrow(|left| left.contains(&tab)) {
                    return Ok(());
                }
                let deferral = args.GetDeferral()?;

                let mut raw = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
                args.Kind(&raw mut raw)?;
                let Some(kind) = kind_of(raw) else {
                    return deferral.Complete();
                };

                let id = NEXT.fetch_add(1, Ordering::Relaxed);
                let opened = Opened {
                    tab: tab.clone(),
                    id,
                    kind,
                    message: read(|out| args.Message(out)),
                    text: read(|out| args.DefaultText(out)),
                    origin: read(|out| args.Uri(out)),
                };
                WAITING.with_borrow_mut(|held| {
                    held.insert(
                        id,
                        Waiting {
                            tab: tab.clone(),
                            args,
                            deferral,
                        },
                    )
                });

                if app.emit_to(window.as_str(), DIALOG, opened).is_err() {
                    answer(id, false, None);
                }
                Ok(())
            }));

            let mut token = 0i64;
            let _ = core.add_ScriptDialogOpening(&handler, &raw mut token);
        }
    }

    #[allow(
        unsafe_code,
        reason = "a dialog is answered through WebView2's own COM interfaces"
    )]
    pub fn answer(id: u64, accept: bool, text: Option<&str>) {
        let Some(waiting) = WAITING.with_borrow_mut(|held| held.remove(&id)) else {
            return;
        };

        unsafe {
            if accept {
                if let Some(text) = text {
                    let _ = waiting.args.SetResultText(&HSTRING::from(text));
                }
                let _ = waiting.args.Accept();
            }
            let _ = waiting.deferral.Complete();
        }
    }

    fn arrived(tab: &str) {
        LEAVING.with_borrow_mut(|left| left.remove(tab));
    }

    pub fn leave(tab: &str) {
        LEAVING.with_borrow_mut(|left| left.insert(tab.to_owned()));
        forget(tab);
    }

    pub fn forget(tab: &str) {
        let gone: Vec<u64> = WAITING.with_borrow(|held| {
            held.iter()
                .filter(|(_, one)| one.tab == tab)
                .map(|(id, _)| *id)
                .collect()
        });
        for id in gone {
            answer(id, false, None);
        }
    }
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: tauri::AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn forget(_tab: &str) {}

#[cfg(any(not(windows), feature = "cef"))]
fn leave(_tab: &str) {}

#[cfg(test)]
mod tests {
    use super::{Kind, Opened};

    #[test]
    fn the_window_hears_which_dialog_and_what_it_says() {
        let said = serde_json::to_value(Opened {
            tab: "t1".into(),
            id: 7,
            kind: Kind::Prompt,
            message: "Your name?".into(),
            text: "Ada".into(),
            origin: "https://a.example/form".into(),
        })
        .expect("json");
        assert_eq!(
            said,
            serde_json::json!({
                "tab": "t1",
                "id": 7,
                "kind": "prompt",
                "message": "Your name?",
                "text": "Ada",
                "origin": "https://a.example/form",
            })
        );
    }

    #[test]
    fn a_page_left_asks_as_leave() {
        for (kind, word) in [
            (Kind::Alert, "alert"),
            (Kind::Confirm, "confirm"),
            (Kind::Prompt, "prompt"),
            (Kind::Leave, "leave"),
        ] {
            assert_eq!(serde_json::to_value(kind).expect("json"), word);
        }
    }
}
