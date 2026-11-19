use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use cef::*;
use serde::Serialize;
use tauri_runtime::webview::PermissionKind;
use tauri_runtime::window::WindowId;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PermissionAsk {
  pub id: u64,
  pub origin: String,
  pub asks: Vec<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionEvent {
  Asked(PermissionAsk),
  Gone(u64),
}

pub type PermissionAskHandler = dyn Fn(PermissionEvent) -> bool + Send + Sync + 'static;

pub(crate) enum Waiting {
  Prompt(u64, PermissionPromptCallback),
  Media(u32, MediaAccessCallback, Option<BrowserHost>, Option<String>),
}

struct Asked {
  browser: i32,
  window: WindowId,
  handler: Arc<PermissionAskHandler>,
  waiting: Waiting,
}

static NEXT: AtomicU64 = AtomicU64::new(1);

thread_local! {
  static ASKED: RefCell<HashMap<u64, Asked>> = RefCell::new(HashMap::new());
}

#[must_use]
pub fn ask_of(kind: PermissionKind) -> Option<&'static str> {
  Some(match kind {
    PermissionKind::Camera => "camera",
    PermissionKind::Microphone => "microphone",
    PermissionKind::Geolocation => "location",
    PermissionKind::Notifications => "notifications",
    PermissionKind::ClipboardRead => "clipboard",
    PermissionKind::Sensors => "sensors",
    PermissionKind::AutomaticDownloads => "downloads",
    PermissionKind::LocalFonts => "fonts",
    PermissionKind::Midi => "midi",
    PermissionKind::WindowManagement => "windows",
    PermissionKind::DisplayCapture => "screen",
    PermissionKind::PointerLock => "pointer",
    PermissionKind::FileSystemAccess => "files",
    PermissionKind::MediaKeySystemAccess => "media-keys",
    _ => return None,
  })
}

pub(crate) fn ask(
  handler: &Arc<PermissionAskHandler>,
  window: WindowId,
  browser: i32,
  origin: String,
  asks: Vec<&'static str>,
  waiting: Waiting,
) -> Result<(), Waiting> {
  let id = NEXT.fetch_add(1, Ordering::Relaxed);
  let said = PermissionAsk { id, origin, asks };
  ASKED.with_borrow_mut(|all| {
    all.insert(id, Asked { browser, window, handler: handler.clone(), waiting })
  });
  if handler(PermissionEvent::Asked(said)) {
    return Ok(());
  }
  ASKED
    .with_borrow_mut(|all| all.remove(&id))
    .map_or(Ok(()), |asked| Err(asked.waiting))
}

pub fn answer_permission(id: u64, allow: bool) -> bool {
  let Some(asked) = ASKED.with_borrow_mut(|all| all.remove(&id)) else {
    return false;
  };
  answer(asked.waiting, allow);
  true
}

fn answer(waiting: Waiting, allow: bool) {
  match waiting {
    Waiting::Prompt(_, callback) => callback.cont(if allow {
      PermissionRequestResult::ACCEPT
    } else {
      PermissionRequestResult::DENY
    }),
    Waiting::Media(requested, callback, host, origin) => {
      if allow {
        crate::cef_impl::client::allow_media(host.as_ref(), origin.as_deref(), requested);
        callback.cont(requested);
      } else {
        callback.cont(0);
      }
    }
  }
}

pub(crate) fn dismissed(browser: i32, prompt: u64) {
  drop_where(|asked| {
    asked.browser == browser && matches!(asked.waiting, Waiting::Prompt(one, _) if one == prompt)
  });
}

pub(crate) fn drop_for_browser(browser: i32) {
  drop_where(|asked| asked.browser == browser);
}

pub(crate) fn drop_for_window(window: WindowId) {
  drop_where(|asked| asked.window == window);
}

fn drop_where(gone: impl Fn(&Asked) -> bool) {
  let dropped: Vec<(u64, Asked)> = ASKED.with_borrow_mut(|all| {
    let ids: Vec<u64> = all.iter().filter(|(_, one)| gone(one)).map(|(id, _)| *id).collect();
    ids.into_iter().filter_map(|id| all.remove(&id).map(|one| (id, one))).collect()
  });
  for (id, asked) in dropped {
    let handler = asked.handler.clone();
    answer(asked.waiting, false);
    handler(PermissionEvent::Gone(id));
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_permission_ask_is_said_by_the_app_s_names_and_its_going_by_id() {
    assert_eq!(ask_of(PermissionKind::Geolocation), Some("location"));
    assert_eq!(ask_of(PermissionKind::DisplayCapture), Some("screen"));
    assert_eq!(ask_of(PermissionKind::MediaKeySystemAccess), Some("media-keys"));
    assert_eq!(ask_of(PermissionKind::Other), None);
    let asked = PermissionEvent::Asked(PermissionAsk {
      id: 2,
      origin: "https://a.example".into(),
      asks: vec!["camera", "microphone"],
    });
    assert_eq!(
      serde_json::to_value(&asked).unwrap(),
      serde_json::json!({ "asked": { "id": 2, "origin": "https://a.example", "asks": ["camera", "microphone"] } })
    );
    assert_eq!(serde_json::to_value(PermissionEvent::Gone(2)).unwrap(), serde_json::json!({ "gone": 2 }));
    assert!(!answer_permission(u64::MAX, true));
  }
}
