use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use super::cdp;
use super::verbs::{Dialog, Download, DownloadState};

pub(super) const DIALOG_PATIENCE: Duration = Duration::from_secs(30);

pub(super) const MOST_DOWNLOAD: i64 = 500 * 1024 * 1024;

pub(super) const STUBS: &str = r"(() => {
  const nothing = () => undefined
  try { Object.defineProperty(window, 'print', { value: nothing, writable: false, configurable: false }) } catch (_) {}
  for (const kind of [window.HTMLInputElement, window.HTMLSelectElement]) {
    try { if (kind && kind.prototype.showPicker) Object.defineProperty(kind.prototype, 'showPicker', { value: nothing, writable: false, configurable: false }) } catch (_) {}
  }
})()";

struct Held {
    dialog: Dialog,
    since: Instant,
}

static DIALOGS: Mutex<Option<HashMap<String, Held>>> = Mutex::new(None);

static DOWNLOADS: Mutex<Vec<(String, Download)>> = Mutex::new(Vec::new());

#[derive(Clone, Debug, Default)]
pub struct Said {
    pub accept: bool,
    pub text: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl Said {
    pub(super) fn only(accept: bool) -> Self {
        Said {
            accept,
            ..Said::default()
        }
    }

    pub(super) fn chosen<'a>(&self, offered: impl IntoIterator<Item = &'a str>) -> Option<usize> {
        if !self.accept {
            return None;
        }
        let wanted = self
            .text
            .as_deref()
            .map(str::trim)
            .filter(|one| !one.is_empty())
            .map(str::to_lowercase);
        let mut first = None;
        for (at, words) in offered.into_iter().enumerate() {
            first.get_or_insert(at);
            if wanted
                .as_deref()
                .is_some_and(|wanted| words.to_lowercase().contains(wanted))
            {
                return Some(at);
            }
        }
        if wanted.is_some() {
            None
        } else {
            first
        }
    }
}

pub(super) static NUMBER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Clone)]
pub struct Owner {
    pub agent: String,
    pub tab: String,
    pub label: String,
}

pub fn dialog_of(label: &str) -> Option<Dialog> {
    DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()?
        .get(label)
        .map(|held| Dialog {
            open_ms: u64::try_from(held.since.elapsed().as_millis()).unwrap_or(u64::MAX),
            ..held.dialog.clone()
        })
}

pub fn answer_dialog(app: &AppHandle, label: &str, said: Said) -> Result<(), String> {
    if dialog_of(label).is_none() {
        return Err("the page is holding no dialog".into());
    }
    super::engines::cef::answer_dialog(app, label, said)
}

pub(super) fn hold(label: &str, dialog: Dialog) {
    DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashMap::new)
        .insert(
            label.to_string(),
            Held {
                dialog,
                since: Instant::now(),
            },
        );
}

pub(super) fn release(label: &str) {
    if let Some(all) = DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(label);
    }
}

pub(super) fn destination(app: &AppHandle, agent: &str, suggested: &str) -> Option<PathBuf> {
    let name = std::path::Path::new(suggested)
        .file_name()
        .map_or_else(|| std::ffi::OsString::from("download"), ToOwned::to_owned);
    let folder = crate::downloads::folder(app)
        .ok()?
        .join("Orden agents")
        .join(agent);
    crate::paths::made(&folder).ok()?;
    let name = crate::downloads::clean_name(&name);
    let taken: Vec<String> = DOWNLOADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .filter(|(_, one)| one.state == DownloadState::Going)
        .map(|(_, one)| one.path.clone())
        .collect();
    Some(crate::downloads::free_path(&folder, &name, |path| {
        crate::downloads::on_disk(path) || taken.iter().any(|one| std::path::Path::new(one) == path)
    }))
}

pub(super) fn noted(agent: &str, download: Download) {
    let mut all = DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner);
    all.push((agent.to_string(), download));
    if all.len() > 500 {
        all.remove(0);
    }
}

pub(super) fn moved(agent: &str, path: &str, state: DownloadState) {
    let mut all = DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((_, one)) = all
        .iter_mut()
        .rev()
        .find(|(owner, one)| owner == agent && one.path == path)
    {
        if one.state == DownloadState::Going {
            one.state = state;
        }
    }
}

pub fn downloads_of(agent: &str, tab: Option<&str>) -> Vec<Download> {
    DOWNLOADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .filter(|(owner, one)| owner == agent && tab.is_none_or(|tab| one.tab == tab))
        .map(|(_, one)| one.clone())
        .collect()
}

pub(super) fn signing_in(realm: &str) -> String {
    let realm = realm.trim();
    if realm.is_empty() {
        "The site asks to sign in: answer with username and password".to_string()
    } else {
        format!("The site asks to sign in to {realm}: answer with username and password")
    }
}

pub(super) fn certificates<'a>(offered: impl IntoIterator<Item = &'a str>) -> String {
    let all: Vec<&str> = offered.into_iter().collect();
    if all.is_empty() {
        "The site asks for a client certificate, and none is installed that it takes: accept to go on without one"
            .to_string()
    } else {
        format!(
            "The site asks for a client certificate: accept to present the first, or name one in text. Offered: {}",
            all.join("; ")
        )
    }
}

pub(super) fn say(label: &str, level: &str, text: String) {
    cdp::heard(label)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .say(level, text);
}

pub fn forget(app: &AppHandle, label: &str) {
    release(label);
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::{certificates, signing_in, Said, STUBS};
    use crate::agents::verbs::{AnswerDialog, DialogKind};

    #[test]
    fn a_certificate_is_the_one_named_or_the_first() {
        let offered = ["CN=Ada Lovelace, O=Example", "CN=Build bot, O=Example"];
        let yes = Said::only(true);
        assert_eq!(yes.chosen(offered), Some(0));
        let named = Said {
            text: Some("build BOT".into()),
            ..Said::only(true)
        };
        assert_eq!(named.chosen(offered), Some(1));
        let missing = Said {
            text: Some("nobody".into()),
            ..Said::only(true)
        };
        assert_eq!(missing.chosen(offered), None);
        assert_eq!(Said::only(false).chosen(offered), None);
        assert_eq!(yes.chosen(std::iter::empty()), None);
    }

    #[test]
    fn the_agent_is_told_how_to_answer_a_sign_in_and_a_certificate() {
        assert!(signing_in("Staff").contains("sign in to Staff"));
        assert!(signing_in(" ").contains("username and password"));
        assert!(certificates(["CN=A", "CN=B"]).ends_with("CN=A; CN=B"));
        assert!(certificates(std::iter::empty()).contains("go on without one"));
    }

    #[test]
    fn browser_dialog_takes_a_user_name_and_a_password() {
        let answer: AnswerDialog = serde_json::from_value(serde_json::json!({
            "tab": "a1", "accept": true, "username": "ada", "password": "secret"
        }))
        .expect("an answer");
        assert_eq!(answer.username.as_deref(), Some("ada"));
        assert_eq!(answer.password.as_deref(), Some("secret"));
        assert_eq!(
            serde_json::to_value(DialogKind::SignIn).expect("json"),
            "sign_in"
        );
        assert_eq!(
            serde_json::to_value(DialogKind::Certificate).expect("json"),
            "certificate"
        );
        assert!(DialogKind::SignIn.signs_in() && DialogKind::Certificate.signs_in());
        assert!(!DialogKind::Prompt.signs_in());
    }

    #[test]
    fn the_stubs_touch_nothing_but_print_and_the_pickers() {
        assert!(STUBS.contains("'print'"));
        assert!(STUBS.contains("'showPicker'"));
        assert!(!STUBS.contains("alert"));
    }
}
