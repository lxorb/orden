//! An agent's page on `WKWebView` (#1092): the same [`Engine`] every browser verb goes
//! through, on a Mac.
//!
//! Not built yet: every verb is in `WEBKIT_CANNOT`, so `browser.rs` answers
//! `unsupported_on_this_engine` with the reason before any act here is reached, and each
//! act answers the same if it ever is. The steps of #1092 build it, and take its rows
//! out of that table one by one.

use std::time::Duration;

use serde_json::{Map, Value};
use tauri::AppHandle;

use super::{refused, Engine, Gate, Page, Tree};
use crate::agents::keys::Key;
use crate::agents::policy::Facts;
use crate::agents::quiet::{Owner, Said};
use crate::agents::snapshot::Wanted;
use crate::agents::verbs::{
    Answer, ConsoleLines, Cookie, FieldValue, Match, Picture, ReadAs, Requests, Until,
};
use crate::pdf::PdfPage;

/// An element, resolved from a ref.
#[derive(Clone, Debug)]
pub struct Element {
    /// The node.
    pub backend: u64,
}

/// Builds an agent's page: not yet.
pub fn build(
    _app: &AppHandle,
    _owner: &Owner,
    _store: Option<&str>,
    _size: (u32, u32),
    _address: Option<&str>,
) -> Result<(), String> {
    Err(super::cannot("browser_open")
        .unwrap_or("an agent's page cannot be built here")
        .to_string())
}

/// Answers the dialog a page is holding: no page holds one yet.
pub fn answer_dialog(_app: &AppHandle, _label: &str, _said: Said) -> Result<(), String> {
    Err("the page is holding no dialog".into())
}

/// Forgets what is kept about a page that closed: nothing is kept yet.
pub fn forget(_label: &str) {}

/// Notes a tab a page opened: no page opens one yet.
pub fn opened(_label: &str, _tab: &str) {}

impl Engine for Page<'_> {
    fn wake(&self) {}

    fn url(&self) -> String {
        self.view.url()
    }

    fn title(&self) -> String {
        String::new()
    }

    fn element(&self, _reference: &str) -> Result<Element, Answer> {
        Err(refused("browser_snapshot"))
    }

    fn element_at(&self, _point: (f64, f64)) -> Result<Element, Answer> {
        Err(refused("browser_click"))
    }

    fn facts(&self, _element: &Element) -> Result<Facts, Answer> {
        Err(refused("browser_click"))
    }

    fn active_facts(&self) -> Result<Option<Facts>, Answer> {
        Err(refused("browser_press"))
    }

    fn facts_of_press(&self, _element: &Element) -> Result<Facts, Answer> {
        Err(refused("browser_click"))
    }

    fn at_first_point(&self, _element: &Element) -> Result<Element, Answer> {
        Err(refused("browser_click"))
    }

    fn aimed(&self, _element: &Element) -> Result<Element, Answer> {
        Err(refused("browser_click"))
    }

    fn may_act_in(&self, _facts: &Facts) -> Result<(), Answer> {
        Err(refused("browser_click"))
    }

    fn limits_sites(&self) -> bool {
        true
    }

    fn tick_changes(&self, _element: &Element, _wanted: bool) -> Result<bool, Answer> {
        Err(refused("browser_fill_form"))
    }

    fn navigate(&self, _url: &str) -> Result<(), Answer> {
        Err(refused("browser_navigate"))
    }

    fn step(&self, _by: i64) -> Result<(), Answer> {
        Err(refused("browser_navigate"))
    }

    fn wait(&self, _until: &Until, _most: Duration) -> Result<u64, Answer> {
        Err(refused("browser_wait"))
    }

    fn settle(&self, _navigations_before: u64) {}

    fn navigations(&self) -> u64 {
        0
    }

    fn opened(&self) -> Vec<String> {
        Vec::new()
    }

    fn hosts(&self) -> Vec<String> {
        Vec::new()
    }

    fn parts(&self) -> Result<Tree, Answer> {
        Err(refused("browser_snapshot"))
    }

    fn find(&self, _wanted: &Wanted<'_>) -> Result<Vec<Match>, Answer> {
        Err(refused("browser_find"))
    }

    fn read(&self, _app: &AppHandle, _shape: ReadAs) -> Result<(String, String, String), Answer> {
        Err(refused("browser_read"))
    }

    fn clip(&self) -> Result<(String, String, String), Answer> {
        Err(refused("capture_to_note"))
    }

    fn pdf(&self, _paper: &PdfPage) -> Result<String, Answer> {
        Err(refused("capture_to_note"))
    }

    fn click(
        &self,
        _element: &Element,
        _button: &str,
        _count: u8,
        _modifiers: u8,
        _gate: Gate<'_>,
    ) -> Result<(), Answer> {
        Err(refused("browser_click"))
    }

    fn click_at(
        &self,
        _point: (f64, f64),
        _judged: &Element,
        _button: &str,
        _count: u8,
        _modifiers: u8,
        _gate: Gate<'_>,
    ) -> Result<(), Answer> {
        Err(refused("browser_click"))
    }

    fn hover(&self, _element: &Element) -> Result<(), Answer> {
        Err(refused("browser_hover"))
    }

    fn type_text(&self, _element: &Element, _text: &str, _replace: bool) -> Result<(), Answer> {
        Err(refused("browser_type"))
    }

    fn press(&self, _key: &Key) -> Result<(), Answer> {
        Err(refused("browser_press"))
    }

    fn press_in_page(&self, _key: &Key) -> Result<(), Answer> {
        Err(refused("browser_press"))
    }

    fn scroll(&self, _element: Option<&Element>, _dx: f64, _dy: f64) -> Result<(), Answer> {
        Err(refused("browser_scroll"))
    }

    fn select(&self, _element: &Element, _values: &[String]) -> Result<Vec<String>, Answer> {
        Err(refused("browser_select"))
    }

    fn fill(&self, _element: &Element, _value: &FieldValue, _gate: Gate<'_>) -> Result<(), Answer> {
        Err(refused("browser_fill_form"))
    }

    fn drag(
        &self,
        _from: (&Element, &Element),
        _to: (&Element, &Element),
        _gates: (Gate<'_>, Gate<'_>),
    ) -> Result<(), Answer> {
        Err(refused("browser_drag"))
    }

    fn upload(&self, _element: &Element, _files: &[String], _gate: Gate<'_>) -> Result<(), Answer> {
        Err(refused("browser_upload"))
    }

    fn screenshot(
        &self,
        _element: Option<&Element>,
        _full: bool,
        _scale: Option<f64>,
    ) -> Result<Picture, Answer> {
        Err(refused("browser_screenshot"))
    }

    fn console(&self, _since: Option<u64>, _level: Option<&str>) -> Result<ConsoleLines, Answer> {
        Err(refused("browser_console"))
    }

    fn network(
        &self,
        _since: Option<u64>,
        _matching: Option<&str>,
        _bodies: bool,
    ) -> Result<Requests, Answer> {
        Err(refused("browser_network"))
    }

    fn evaluate(&self, _expression: &str, _page_world: bool) -> Result<Value, Answer> {
        Err(refused("browser_evaluate"))
    }

    fn cookies(&self) -> Result<Vec<Cookie>, Answer> {
        Err(refused("browser_storage"))
    }

    fn set_cookie(&self, _cookie: &Cookie) -> Result<(), Answer> {
        Err(refused("browser_storage"))
    }

    fn clear(&self) -> Result<(), Answer> {
        Err(refused("browser_storage"))
    }

    fn local(&self) -> Result<Map<String, Value>, Answer> {
        Err(refused("browser_storage"))
    }
}
