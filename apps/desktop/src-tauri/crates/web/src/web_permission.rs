use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};

pub const ASKED: &str = "orden://web-permission";
pub const GONE: &str = "orden://web-permission-gone";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Said {
    pub id: u64,
    pub origin: String,
    pub asks: Vec<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Asked {
    pub tab: String,
    #[serde(flatten)]
    pub said: Said,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Gone {
    pub tab: String,
    pub id: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Heard {
    Asked(Said),
    Gone(u64),
}
#[derive(Debug, PartialEq)]
pub enum Told {
    Asked(Asked),
    Gone(Gone),
}
#[must_use]
pub fn read(tab: &str, said: serde_json::Value) -> Option<Told> {
    let tab = tab.to_owned();
    Some(match serde_json::from_value(said).ok()? {
        Heard::Asked(said) => Told::Asked(Asked { tab, said }),
        Heard::Gone(id) => Told::Gone(Gone { tab, id }),
    })
}
pub fn asking(
    page: crate::engine::Page,
    app: &AppHandle,
    tab: &str,
    window: &str,
) -> crate::engine::Page {
    let (app, tab, window) = (app.clone(), tab.to_owned(), window.to_owned());
    crate::engine::permissions(
        page,
        Box::new(move |said| match read(&tab, said) {
            Some(Told::Asked(_)) if !crate::web_page_ui::takes(&window, "permission") => false,
            Some(Told::Asked(asked)) => app.emit_to(&window, ASKED, asked).is_ok(),
            Some(Told::Gone(gone)) => app.emit_to(&window, GONE, gone).is_ok(),
            None => false,
        }),
    )
}
#[tauri::command]
pub fn web_permission_answer(
    app: AppHandle,
    tab: String,
    id: u64,
    allow: bool,
) -> Result<(), String> {
    let _ = tab;
    let answer = crate::engine::engine()?.permission_answer;
    tauri::Manager::run_on_main_thread(&app, move || {
        answer(id, allow);
    })
    .map_err(|error| format!("that permission could not be answered: {error}"))
}
#[cfg(test)]
mod tests {
    use super::{read, Told, ASKED, GONE};

    #[test]
    fn a_page_s_permission_ask_is_said_as_orden_web_permission_and_its_going_as_orden_web_permission_gone(
    ) {
        assert_eq!(ASKED, "orden://web-permission");
        assert_eq!(GONE, "orden://web-permission-gone");
        let said = serde_json::json!({ "id": 5, "origin": "https://a.example", "asks": ["camera", "microphone"] });
        let Some(Told::Asked(asked)) = read("t1", serde_json::json!({ "asked": said.clone() }))
        else {
            panic!("an ask");
        };
        let mut wanted = said;
        wanted["tab"] = serde_json::json!("t1");
        assert_eq!(serde_json::to_value(&asked).expect("json"), wanted);
        let Some(Told::Gone(gone)) = read("t1", serde_json::json!({ "gone": 5 })) else {
            panic!("an ask gone");
        };
        assert_eq!(
            serde_json::to_value(&gone).expect("json"),
            serde_json::json!({ "tab": "t1", "id": 5 })
        );
        assert_eq!(read("t1", serde_json::json!({ "asked": { "id": 1 } })), None);
    }
}
