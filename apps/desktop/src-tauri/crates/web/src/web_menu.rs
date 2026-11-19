use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};

pub const ASKED: &str = "orden://web-menu";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Item {
    pub command: i32,
    pub label: String,
    pub kind: String,
    pub enabled: bool,
    pub checked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<Item>>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Said {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
    pub link: Option<String>,
    pub image: Option<String>,
    pub media: String,
    pub selection: String,
    pub editable: bool,
    pub misspelled: Option<String>,
    pub suggestions: Vec<String>,
    pub items: Vec<Item>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Menu {
    pub tab: String,
    #[serde(flatten)]
    pub said: Said,
}
#[must_use]
pub fn read(tab: &str, said: serde_json::Value) -> Option<Menu> {
    let said: Said = serde_json::from_value(said).ok()?;
    Some(Menu { tab: tab.to_owned(), said })
}
pub fn asking(
    page: crate::engine::Page,
    app: &AppHandle,
    tab: &str,
    window: &str,
) -> crate::engine::Page {
    let (app, tab, window) = (app.clone(), tab.to_owned(), window.to_owned());
    crate::engine::menus(
        page,
        Box::new(move |said| {
            let Some(menu) = read(&tab, said) else {
                return false;
            };
            app.emit_to(&window, ASKED, menu).is_ok()
        }),
    )
}
#[tauri::command]
pub fn web_menu_pick(
    app: AppHandle,
    tab: String,
    id: u64,
    command: Option<i32>,
) -> Result<(), String> {
    let _ = tab;
    let engine = crate::engine::engine()?;
    let pick = engine.menu_pick;
    tauri::Manager::run_on_main_thread(&app, move || {
        pick(id, command);
    })
    .map_err(|error| format!("that menu could not be answered: {error}"))
}
#[cfg(test)]
mod tests {
    use super::{read, ASKED};

    #[test]
    fn a_page_s_menu_is_said_as_orden_web_menu_with_its_tab_point_zoom_and_items() {
        assert_eq!(ASKED, "orden://web-menu");
        let said = serde_json::json!({
            "id": 7, "x": 10.5, "y": 20.0, "zoom": 1.2,
            "link": "https://a.example/", "image": null, "media": "none",
            "selection": "words", "editable": false, "misspelled": null, "suggestions": [],
            "items": [
                { "command": 113, "label": "Copy", "kind": "command", "enabled": true, "checked": false },
                { "command": 0, "label": "", "kind": "separator", "enabled": true, "checked": false },
                { "command": 200, "label": "More", "kind": "submenu", "enabled": true, "checked": false,
                  "items": [{ "command": 201, "label": "One", "kind": "radio", "enabled": true, "checked": true }] }
            ]
        });
        let menu = read("t1", said.clone()).expect("a menu");
        let told = serde_json::to_value(&menu).expect("json");
        let mut wanted = said;
        wanted["tab"] = serde_json::json!("t1");
        assert_eq!(told, wanted);
        let keys: Vec<&str> =
            told.as_object().expect("an object").keys().map(String::as_str).collect();
        for key in [
            "tab",
            "id",
            "x",
            "y",
            "zoom",
            "link",
            "image",
            "media",
            "selection",
            "editable",
            "misspelled",
            "suggestions",
            "items",
        ] {
            assert!(keys.contains(&key), "{key}");
        }
        assert_eq!(read("t1", serde_json::json!({ "id": 1 })), None);
    }
}
