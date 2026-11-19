use std::cell::RefCell;
use std::os::raw::c_int;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use cef::sys::cef_jsdialog_type_t;
use cef::*;
use serde::Serialize;
use tauri_runtime::window::WindowId;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JsDialog {
  pub id: u64,
  pub kind: &'static str,
  pub message: String,
  pub default: Option<String>,
  pub origin: Option<String>,
  pub reload: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JsDialogEvent {
  Asked(JsDialog),
  Gone(u64),
}

pub type JsDialogHandler = dyn Fn(JsDialogEvent) -> bool + Send + Sync + 'static;

static NEXT: AtomicU64 = AtomicU64::new(1);

struct Waiting {
  browser: i32,
  window: WindowId,
  handler: Arc<JsDialogHandler>,
  callback: JsdialogCallback,
}

thread_local! {
  static ASKED: RefCell<HashMap<u64, Waiting>> = RefCell::new(HashMap::new());
}

pub fn answer_js_dialog(id: u64, ok: bool, text: Option<&str>) -> bool {
  let Some(waiting) = ASKED.with_borrow_mut(|all| all.remove(&id)) else {
    return false;
  };
  let text = CefString::from(text.unwrap_or_default());
  waiting.callback.cont(c_int::from(ok), Some(&text));
  true
}

pub(crate) fn kind_of(kind: JsdialogType) -> &'static str {
  if kind == JsdialogType::from(cef_jsdialog_type_t::JSDIALOGTYPE_CONFIRM) {
    "confirm"
  } else if kind == JsdialogType::from(cef_jsdialog_type_t::JSDIALOGTYPE_PROMPT) {
    "prompt"
  } else {
    "alert"
  }
}

fn text(said: Option<&CefString>) -> Option<String> {
  said.map(ToString::to_string).filter(|one| !one.is_empty())
}

pub(crate) fn asked(
  handler: &Arc<JsDialogHandler>,
  window: WindowId,
  browser: Option<&mut Browser>,
  kind: &'static str,
  message: Option<&CefString>,
  default: Option<&CefString>,
  origin: Option<&CefString>,
  reload: bool,
  callback: Option<&mut JsdialogCallback>,
) -> bool {
  let (Some(browser), Some(callback)) = (browser, callback) else {
    return false;
  };
  let id = NEXT.fetch_add(1, Ordering::Relaxed);
  let dialog = JsDialog {
    id,
    kind,
    message: text(message).unwrap_or_default(),
    default: (kind == "prompt").then(|| text(default).unwrap_or_default()),
    origin: text(origin),
    reload,
  };
  ASKED.with_borrow_mut(|all| {
    all.insert(
      id,
      Waiting {
        browser: browser.identifier(),
        window,
        handler: handler.clone(),
        callback: callback.clone(),
      },
    )
  });
  if handler(JsDialogEvent::Asked(dialog)) {
    return true;
  }
  ASKED.with_borrow_mut(|all| all.remove(&id));
  false
}

pub(crate) fn drop_where(gone: impl Fn(i32, WindowId) -> bool) {
  let dropped: Vec<(u64, Waiting)> = ASKED.with_borrow_mut(|all| {
    let ids: Vec<u64> = all
      .iter()
      .filter(|(_, one)| gone(one.browser, one.window))
      .map(|(id, _)| *id)
      .collect();
    ids
      .into_iter()
      .filter_map(|id| all.remove(&id).map(|one| (id, one)))
      .collect()
  });
  for (id, waiting) in dropped {
    waiting.callback.cont(0, None);
    (waiting.handler)(JsDialogEvent::Gone(id));
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_dialog_is_said_by_kind_and_its_going_by_id() {
    let asked = JsDialogEvent::Asked(JsDialog {
      id: 3,
      kind: "prompt",
      message: "Name?".into(),
      default: Some(String::new()),
      origin: Some("https://a.example".into()),
      reload: false,
    });
    assert_eq!(
      serde_json::to_value(&asked).unwrap(),
      serde_json::json!({ "asked": { "id": 3, "kind": "prompt", "message": "Name?", "default": "",
        "origin": "https://a.example", "reload": false } })
    );
    assert_eq!(serde_json::to_value(JsDialogEvent::Gone(3)).unwrap(), serde_json::json!({ "gone": 3 }));
    assert!(!answer_js_dialog(u64::MAX, true, None));
  }
}
