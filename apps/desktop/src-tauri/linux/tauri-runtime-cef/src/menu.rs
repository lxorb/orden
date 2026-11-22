use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::CStr;
use std::os::raw::c_int;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use cef::sys::{
  cef_context_menu_media_type_t, cef_event_flags_t, cef_id_for_command_id_name, cef_key_event_type_t,
  cef_menu_item_type_t,
};
use cef::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ContextMenu {
  pub id: u64,
  pub x: f64,
  pub y: f64,
  pub zoom: f64,
  pub link: Option<String>,
  pub image: Option<String>,
  pub media: &'static str,
  pub selection: String,
  pub editable: bool,
  pub keys: bool,
  pub misspelled: Option<String>,
  pub suggestions: Vec<String>,
  pub items: Vec<ContextMenuItem>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ContextMenuItem {
  pub command: i32,
  pub label: String,
  pub kind: &'static str,
  pub enabled: bool,
  pub checked: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub does: Option<&'static str>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub items: Option<Vec<ContextMenuItem>>,
}

pub type ContextMenuHandler = dyn Fn(ContextMenu) -> bool + Send + Sync + 'static;

static NEXT: AtomicU64 = AtomicU64::new(1);

thread_local! {
  static ASKED: RefCell<HashMap<u64, RunContextMenuCallback>> = RefCell::new(HashMap::new());
  static KEYED: Cell<Option<(c_int, Instant)>> = const { Cell::new(None) };
}

const ANSWERED_BY_THE_APP: &[(&CStr, &str)] = &[
  (resources::IDC_CONTENT_CONTEXT_OPENLINKNEWTAB, "open-link"),
  (resources::IDC_CONTENT_CONTEXT_OPENIMAGENEWTAB, "open-image"),
];

fn answered_by_the_app() -> &'static [(c_int, &'static str)] {
  static IDS: OnceLock<Vec<(c_int, &'static str)>> = OnceLock::new();
  IDS.get_or_init(|| {
    ANSWERED_BY_THE_APP
      .iter()
      .map(|(name, does)| (unsafe { cef_id_for_command_id_name(name.as_ptr()) }, *does))
      .filter(|(id, _)| *id != -1)
      .collect()
  })
}

fn does(command: c_int) -> Option<&'static str> {
  answered_by_the_app().iter().find(|(id, _)| *id == command).map(|(_, does)| *does)
}

const MENU_KEY: c_int = 0x5D;
const F10: c_int = 0x79;
const MODIFIER_KEYS: &[c_int] = &[0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5];
const KEYED_FOR: Duration = Duration::from_secs(2);

pub(crate) fn heard_key(browser: c_int, event: &KeyEvent) {
  if event.type_ != KeyEventType::from(cef_key_event_type_t::KEYEVENT_RAWKEYDOWN) {
    return;
  }
  let code = event.windows_key_code;
  if MODIFIER_KEYS.contains(&code) {
    return;
  }
  #[cfg(windows)]
  let shift = (event.modifiers as i32 & cef_event_flags_t::EVENTFLAG_SHIFT_DOWN.0) != 0;
  #[cfg(not(windows))]
  let shift = (event.modifiers & cef_event_flags_t::EVENTFLAG_SHIFT_DOWN.0) != 0;
  let opens = code == MENU_KEY || (code == F10 && shift);
  KEYED.set(opens.then(|| (browser, Instant::now())));
}

fn opened_by_keys(browser: Option<c_int>) -> bool {
  let keyed = KEYED.take();
  browser.is_some_and(|browser| keyed.is_some_and(|(by, at)| by == browser && at.elapsed() < KEYED_FOR))
}

pub fn answer_context_menu(id: u64, command: Option<i32>) -> bool {
  let Some(callback) = ASKED.with_borrow_mut(|all| all.remove(&id)) else {
    return false;
  };
  match command {
    Some(command) => callback.cont(command, EventFlags::default()),
    None => callback.cancel(),
  }
  true
}

pub(crate) fn run(
  handler: &ContextMenuHandler,
  browser: Option<&mut Browser>,
  params: Option<&mut ContextMenuParams>,
  model: Option<&mut MenuModel>,
  callback: Option<&mut RunContextMenuCallback>,
) -> bool {
  let (Some(params), Some(model), Some(callback)) = (params, model, callback) else {
    return false;
  };
  let keys = opened_by_keys(browser.as_deref().map(|browser| browser.identifier()));
  let zoom = browser
    .and_then(|browser| browser.host())
    .map_or(1.0, |host| zoom_factor(host.zoom_level()));
  let id = NEXT.fetch_add(1, Ordering::Relaxed);
  let asked = ContextMenu {
    id,
    x: f64::from(params.xcoord()) / zoom,
    y: f64::from(params.ycoord()) / zoom,
    zoom,
    link: said(CefString::from(&params.link_url()).to_string()),
    image: (params.has_image_contents() != 0)
      .then(|| CefString::from(&params.source_url()).to_string())
      .and_then(said),
    media: media(params.media_type()),
    selection: CefString::from(&params.selection_text()).to_string(),
    editable: params.is_editable() != 0,
    keys,
    misspelled: said(CefString::from(&params.misspelled_word()).to_string()),
    suggestions: suggestions(params),
    items: items(model, 0),
  };
  ASKED.with_borrow_mut(|all| all.insert(id, callback.clone()));
  if handler(asked) {
    return true;
  }
  ASKED.with_borrow_mut(|all| all.remove(&id));
  false
}

fn said(text: String) -> Option<String> {
  (!text.is_empty()).then_some(text)
}

pub fn zoom_factor(level: f64) -> f64 {
  let factor = 1.2_f64.powf(level);
  if factor.is_finite() && factor > 0.0 { factor } else { 1.0 }
}

fn suggestions(params: &ContextMenuParams) -> Vec<String> {
  let mut list = CefStringList::new();
  if params.dictionary_suggestions(Some(&mut list)) == 0 {
    return Vec::new();
  }
  list.into_iter().collect()
}

fn media(kind: ContextMenuMediaType) -> &'static str {
  let is = |one: cef_context_menu_media_type_t| kind == ContextMenuMediaType::from(one);
  if is(cef_context_menu_media_type_t::CM_MEDIATYPE_IMAGE) {
    "image"
  } else if is(cef_context_menu_media_type_t::CM_MEDIATYPE_VIDEO) {
    "video"
  } else if is(cef_context_menu_media_type_t::CM_MEDIATYPE_AUDIO) {
    "audio"
  } else if is(cef_context_menu_media_type_t::CM_MEDIATYPE_CANVAS) {
    "canvas"
  } else if is(cef_context_menu_media_type_t::CM_MEDIATYPE_FILE) {
    "file"
  } else if is(cef_context_menu_media_type_t::CM_MEDIATYPE_PLUGIN) {
    "plugin"
  } else {
    "none"
  }
}

const DEEPEST: usize = 4;

fn items(model: &MenuModel, depth: usize) -> Vec<ContextMenuItem> {
  let kind_of = |index: usize| {
    let is = |one: cef_menu_item_type_t| model.type_at(index) == MenuItemType::from(one);
    if is(cef_menu_item_type_t::MENUITEMTYPE_SEPARATOR) {
      Some("separator")
    } else if is(cef_menu_item_type_t::MENUITEMTYPE_CHECK) {
      Some("check")
    } else if is(cef_menu_item_type_t::MENUITEMTYPE_RADIO) {
      Some("radio")
    } else if is(cef_menu_item_type_t::MENUITEMTYPE_SUBMENU) {
      Some("submenu")
    } else if is(cef_menu_item_type_t::MENUITEMTYPE_COMMAND) {
      Some("command")
    } else {
      None
    }
  };
  (0..model.count())
    .filter(|&index| model.is_visible_at(index) != 0)
    .filter_map(|index| {
      let kind = kind_of(index)?;
      let items = (kind == "submenu" && depth < DEEPEST)
        .then(|| model.sub_menu_at(index).map(|sub| items(&sub, depth + 1)))
        .flatten();
      Some(ContextMenuItem {
        command: model.command_id_at(index),
        label: label(&CefString::from(&model.label_at(index)).to_string()),
        kind,
        enabled: model.is_enabled_at(index) != 0,
        checked: model.is_checked_at(index) != 0,
        does: does(model.command_id_at(index)),
        items,
      })
    })
    .collect()
}

pub(crate) fn label(said: &str) -> String {
  let mut out = String::with_capacity(said.len());
  let mut chars = said.chars().peekable();
  while let Some(one) = chars.next() {
    if one == '&' {
      if chars.peek() == Some(&'&') {
        out.push('&');
        chars.next();
      }
      continue;
    }
    out.push(one);
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_menu_label_loses_its_access_key_marks_and_keeps_a_doubled_ampersand() {
    assert_eq!(label("&Copy"), "Copy");
    assert_eq!(label("Save &As..."), "Save As...");
    assert_eq!(label("Fish && Chips"), "Fish & Chips");
    assert_eq!(label(""), "");
  }

  #[test]
  fn a_zoom_level_is_a_factor_of_one_point_two_per_step() {
    assert!((zoom_factor(0.0) - 1.0).abs() < 1e-9);
    assert!((zoom_factor(1.0) - 1.2).abs() < 1e-9);
    assert!((zoom_factor(-1.0) - 1.0 / 1.2).abs() < 1e-9);
    assert!((zoom_factor(f64::NAN) - 1.0).abs() < 1e-9);
  }

  fn pressed(code: c_int, shift: bool) -> KeyEvent {
    #[cfg(windows)]
    let flag = cef_event_flags_t::EVENTFLAG_SHIFT_DOWN.0 as u32;
    #[cfg(not(windows))]
    let flag = cef_event_flags_t::EVENTFLAG_SHIFT_DOWN.0;
    KeyEvent {
      type_: KeyEventType::from(cef_key_event_type_t::KEYEVENT_RAWKEYDOWN),
      windows_key_code: code,
      modifiers: if shift { flag } else { 0 },
      ..Default::default()
    }
  }

  #[test]
  fn a_menu_is_opened_by_keys_only_right_after_its_own_page_heard_the_menu_key_or_shift_f10() {
    heard_key(1, &pressed(MENU_KEY, false));
    assert!(opened_by_keys(Some(1)));
    assert!(!opened_by_keys(Some(1)));
    heard_key(1, &pressed(0x10, true));
    heard_key(1, &pressed(F10, true));
    assert!(!opened_by_keys(Some(2)));
    heard_key(1, &pressed(F10, true));
    assert!(opened_by_keys(Some(1)));
    heard_key(1, &pressed(F10, false));
    assert!(!opened_by_keys(Some(1)));
    heard_key(1, &pressed(MENU_KEY, false));
    heard_key(1, &pressed(0x41, false));
    assert!(!opened_by_keys(Some(1)));
    heard_key(1, &pressed(MENU_KEY, false));
    assert!(!opened_by_keys(None));
  }

  #[test]
  fn an_unanswered_menu_is_no_answer() {
    assert!(!answer_context_menu(u64::MAX, None));
  }
}
