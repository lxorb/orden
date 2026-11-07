#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(any(windows, test))]
mod toast;
#[cfg(windows)]
mod windows;

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _, Manager as _};

#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
const PRESSED: &str = "orden://notice";

const LONGEST_TAG: usize = 64;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub tag: String,
    pub title: String,
    pub body: String,
    #[cfg_attr(
        not(any(windows, test)),
        allow(dead_code, reason = "only a Windows toast has a line for it")
    )]
    pub from: String,
    #[cfg_attr(
        not(any(windows, target_os = "macos", test)),
        allow(
            dead_code,
            reason = "Linux shows the plugin's notification, with its own sound"
        )
    )]
    pub silent: bool,
    #[cfg_attr(
        not(any(windows, target_os = "macos", test)),
        allow(
            dead_code,
            reason = "Linux shows a notification with nothing to type in"
        )
    )]
    pub reply: Option<Reply>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(
    not(any(windows, target_os = "macos", test)),
    allow(
        dead_code,
        reason = "Linux shows a notification with nothing to type in"
    )
)]
pub struct Reply {
    pub placeholder: String,
    pub send: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
pub enum Act {
    Open,
    Reply,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
struct Answer {
    id: String,
    act: Act,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

static WINDOWS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn in_windows<T>(alter: impl FnOnce(&mut HashMap<String, String>) -> T) -> T {
    let mut held = WINDOWS.lock().unwrap_or_else(PoisonError::into_inner);
    alter(held.get_or_insert_with(HashMap::new))
}

const KEPT: usize = 64;

fn plain(notice: &Notice) -> bool {
    let word = |text: &str, most: usize| {
        !text.is_empty()
            && text.len() <= most
            && text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    word(&notice.id, 64) && word(&notice.tag, LONGEST_TAG)
}

fn probing() -> bool {
    crate::placement::away().is_some()
}

#[tauri::command(async)]
pub fn notice_show(webview: tauri::Webview, app: AppHandle, notice: Notice) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    if !plain(&notice) {
        return Err("a notice is named by plain characters".into());
    }
    if probing() && !(cfg!(windows) && std::env::var_os("ORDEN_PROBE_NOTICES").is_some()) {
        return Ok(());
    }
    in_windows(|windows| {
        if windows.len() >= KEPT {
            windows.clear();
        }
        windows.insert(notice.id.clone(), webview.window().label().to_string());
    });
    shown(&app, &notice)
}

#[tauri::command(async)]
pub fn notice_clear(webview: tauri::Webview, app: AppHandle, tag: String) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    #[cfg(windows)]
    windows::clear(&app, &tag)?;
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::clear(&tag);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = (app, tag);
    Ok(())
}

pub fn clear_all(app: &AppHandle) {
    #[cfg(windows)]
    windows::clear_all(app);
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::clear_all();
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = app;
}

#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(
        clippy::unnecessary_wraps,
        reason = "Linux hands the plugin a notification that cannot fail to be asked for"
    )
)]
fn shown(app: &AppHandle, notice: &Notice) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows::show(app, notice, probing())
    }
    #[cfg(target_os = "macos")]
    {
        macos::show(app, notice)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let (app, title, body) = (app.clone(), notice.title.clone(), notice.body.clone());
        let on_the_window = app.clone();
        let _ = on_the_window
            .run_on_main_thread(move || crate::agents::shell::notify(&app, title, body));
        Ok(())
    }
}

#[cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(dead_code, reason = "Linux hears no presses")
)]
pub fn answered(app: &AppHandle, id: &str, act: Act, text: Option<String>) {
    let label = in_windows(|windows| windows.get(id).cloned());
    let window = label
        .as_deref()
        .and_then(|label| app.get_window(label))
        .or_else(|| crate::agents::shell::host(app));
    let Some(window) = window else {
        return;
    };
    if act == Act::Open {
        let _ = window.show();
        crate::placement::raised(&window);
    }
    let answer = Answer {
        id: id.to_string(),
        act,
        text,
    };
    let _ = app.emit_to(window.label(), PRESSED, answer);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(id: &str, tag: &str) -> Notice {
        Notice {
            id: id.into(),
            tag: tag.into(),
            title: String::new(),
            body: String::new(),
            from: String::new(),
            silent: true,
            reply: None,
        }
    }

    #[test]
    fn a_notice_is_named_by_plain_characters() {
        assert!(plain(&notice(
            "00ff00ff00ff00ff",
            "c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e"
        )));
        assert!(plain(&notice("ab", "terminal-12")));
        assert!(!plain(&notice("", "a")));
        assert!(!plain(&notice("ab", "")));
        assert!(!plain(&notice("ab", "a b")));
        assert!(!plain(&notice("ab", &"x".repeat(65))));
        assert!(!plain(&notice("a\"b", "a")));
    }

    #[test]
    fn the_page_reads_a_notice_as_it_writes_one() {
        let read: Notice = serde_json::from_value(serde_json::json!({
            "id": "00ff", "tag": "c_1", "title": "Lucile", "body": "Hi", "from": "#thesis",
            "silent": false, "reply": { "placeholder": "Reply", "send": "Send" },
        }))
        .expect("the page's shape");
        assert_eq!(read.reply.map(|reply| reply.send), Some("Send".to_string()));
        let answer = serde_json::to_value(Answer {
            id: "00ff".into(),
            act: Act::Reply,
            text: Some("ok".into()),
        })
        .expect("an answer");
        assert_eq!(
            answer,
            serde_json::json!({ "id": "00ff", "act": "reply", "text": "ok" })
        );
    }
}
