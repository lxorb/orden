use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use cef::sys::{cef_context_menu_media_type_t, cef_menu_item_type_t};
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
  pub items: Option<Vec<ContextMenuItem>>,
}

pub type ContextMenuHandler = dyn Fn(ContextMenu) -> bool + Send + Sync + 'static;

static NEXT: AtomicU64 = AtomicU64::new(1);

thread_local! {
  static ASKED: RefCell<HashMap<u64, RunContextMenuCallback>> = RefCell::new(HashMap::new());
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

pub(crate) fn zoom_factor(level: f64) -> f64 {
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

  #[test]
  fn an_unanswered_menu_is_no_answer() {
    assert!(!answer_context_menu(u64::MAX, None));
  }
}
