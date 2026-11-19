use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _, Webview};

const SCRIPT: &str = include_str!("web_select.js");
pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}
pub const BINDING: &str = "ordenSelect";
pub const ASKED: &str = "orden://web-select";
const MOST: usize = 4096;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Choice {
    pub index: usize,
    pub label: String,
    pub disabled: bool,
    pub group: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Said {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub selected: i64,
    pub options: Vec<Choice>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Select {
    pub tab: String,
    pub zoom: f64,
    #[serde(flatten)]
    pub said: Said,
}
#[must_use]
pub fn read(tab: &str, zoom: f64, payload: &str) -> Option<Select> {
    let said: Said = serde_json::from_str(payload).ok()?;
    (said.options.len() <= MOST).then(|| Select { tab: tab.to_owned(), zoom, said })
}
pub fn heard(page: &Webview, app: &AppHandle, window: &str, tab: &str, payload: &str) {
    let (app, window, tab, payload) =
        (app.clone(), window.to_owned(), tab.to_owned(), payload.to_owned());
    let _ = crate::engine::with_platform!(page, move |platform| {
        let zoom = crate::engine::engine().map_or(1.0, |engine| (engine.zoom)(&platform));
        if let Some(select) = read(&tab, zoom, &payload) {
            let _ = app.emit_to(&window, ASKED, select);
        }
    });
}
#[must_use]
pub fn picking(id: u64, index: Option<usize>) -> String {
    let index = index.map_or_else(|| "null".to_owned(), |one| one.to_string());
    format!("typeof globalThis.ordenSelectPick === 'function' && globalThis.ordenSelectPick({id}, {index})")
}
#[tauri::command]
pub async fn web_select_pick(
    app: AppHandle,
    tab: String,
    id: u64,
    index: Option<usize>,
) -> Result<bool, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::web_worlds::value(&view, &picking(id, index)) == Some(serde_json::Value::Bool(true))
    })
    .await
    .map_err(|error| error.to_string())
}
#[cfg(test)]
mod tests {
    use super::{picking, read, ASKED, BINDING, SCRIPT};

    #[test]
    fn a_page_s_select_is_said_as_orden_web_select_with_its_box_zoom_and_choices() {
        assert_eq!(ASKED, "orden://web-select");
        let payload = r#"{"id":3,"x":10,"y":20,"width":120,"height":24,"selected":1,"options":[
            {"index":0,"label":"One","disabled":false,"group":null},
            {"index":1,"label":"Two","disabled":true,"group":"Later"}]}"#;
        let select = read("t1", 1.2, payload).expect("a select");
        assert_eq!(
            serde_json::to_value(&select).expect("json"),
            serde_json::json!({ "tab": "t1", "zoom": 1.2, "id": 3, "x": 10.0, "y": 20.0, "width": 120.0,
                "height": 24.0, "selected": 1, "options": [
                    { "index": 0, "label": "One", "disabled": false, "group": null },
                    { "index": 1, "label": "Two", "disabled": true, "group": "Later" }] })
        );
        assert_eq!(read("t1", 1.0, r#"{"id":3}"#), None);
        assert_eq!(read("t1", 1.0, "not json"), None);
    }
    #[test]
    fn a_pick_sets_the_choice_and_says_input_and_change_and_null_cancels() {
        assert_eq!(
            picking(3, Some(2)),
            "typeof globalThis.ordenSelectPick === 'function' && globalThis.ordenSelectPick(3, 2)"
        );
        assert!(picking(3, None).ends_with("ordenSelectPick(3, null)"));
        assert!(SCRIPT.contains(&format!("globalThis.{BINDING}")));
        assert!(SCRIPT.contains("event.defaultPrevented"));
        assert!(SCRIPT.contains("event.preventDefault()"));
        assert!(SCRIPT.contains("new Event('input'"));
        assert!(SCRIPT.contains("new Event('change'"));
        assert!(SCRIPT.contains("one.multiple"));
        assert!(SCRIPT.contains("group.disabled"));
        assert!(SCRIPT.contains("window.top !== window"));
        assert!(!SCRIPT.contains(", true)"), "listeners stay in the bubbling phase");
    }
}
