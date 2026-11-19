use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _};

pub const ASKED: &str = "orden://web-dialog";
pub const GONE: &str = "orden://web-dialog-gone";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Said {
    pub id: u64,
    pub kind: String,
    pub message: String,
    pub default: Option<String>,
    pub origin: Option<String>,
    pub reload: bool,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Dialog {
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
    Asked(Dialog),
    Gone(Gone),
}
#[must_use]
pub fn read(tab: &str, said: serde_json::Value) -> Option<Told> {
    let tab = tab.to_owned();
    Some(match serde_json::from_value(said).ok()? {
        Heard::Asked(said) => Told::Asked(Dialog { tab, said }),
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
    crate::engine::dialogs(
        page,
        Box::new(move |said| match read(&tab, said) {
            Some(Told::Asked(dialog)) => app.emit_to(&window, ASKED, dialog).is_ok(),
            Some(Told::Gone(gone)) => app.emit_to(&window, GONE, gone).is_ok(),
            None => false,
        }),
    )
}
#[tauri::command]
pub fn web_dialog_answer(
    app: AppHandle,
    tab: String,
    id: u64,
    ok: bool,
    text: Option<String>,
) -> Result<(), String> {
    let _ = tab;
    let answer = crate::engine::engine()?.dialog_answer;
    tauri::Manager::run_on_main_thread(&app, move || {
        answer(id, ok, text);
    })
    .map_err(|error| format!("that dialog could not be answered: {error}"))
}
#[cfg(test)]
mod tests {
    use super::{read, Told, ASKED, GONE};

    #[test]
    fn a_page_s_dialog_is_said_as_orden_web_dialog_and_its_going_as_orden_web_dialog_gone() {
        assert_eq!(ASKED, "orden://web-dialog");
        assert_eq!(GONE, "orden://web-dialog-gone");
        let said = serde_json::json!({ "id": 4, "kind": "prompt", "message": "Name?", "default": "",
            "origin": "https://a.example", "reload": false });
        let Some(Told::Asked(dialog)) = read("t1", serde_json::json!({ "asked": said.clone() }))
        else {
            panic!("a dialog");
        };
        let mut wanted = said;
        wanted["tab"] = serde_json::json!("t1");
        assert_eq!(serde_json::to_value(&dialog).expect("json"), wanted);
        let Some(Told::Gone(gone)) = read("t1", serde_json::json!({ "gone": 4 })) else {
            panic!("a dialog gone");
        };
        assert_eq!(
            serde_json::to_value(&gone).expect("json"),
            serde_json::json!({ "tab": "t1", "id": 4 })
        );
        assert_eq!(read("t1", serde_json::json!({ "asked": { "id": 1 } })), None);
    }
}
