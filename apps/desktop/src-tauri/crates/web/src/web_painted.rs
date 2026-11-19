use serde::{Deserialize, Serialize};

const SCRIPT: &str = include_str!("web_painted.js");
pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}
pub const BINDING: &str = "ordenPainted";
pub const PAINTED: &str = "orden://web-painted";
const LONGEST: usize = 8192;
#[derive(Deserialize)]
struct Said {
    url: String,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Painted {
    tab: String,
    url: String,
}
pub fn read(tab: &str, payload: &str) -> Option<Painted> {
    let Said { url } = serde_json::from_str(payload).ok()?;
    (url.len() <= LONGEST).then(|| Painted { tab: tab.to_string(), url })
}
pub fn heard(app: &tauri::AppHandle, window: &str, tab: &str, payload: &str) {
    use tauri::Emitter;

    if let Some(painted) = read(tab, payload) {
        let _ = app.emit_to(window, PAINTED, painted);
    }
}
#[cfg(test)]
mod tests {
    use super::{read, Painted, BINDING, PAINTED, SCRIPT};

    #[test]
    fn a_page_s_first_paint_is_told_as_orden_web_painted_with_its_tab_and_address() {
        assert_eq!(PAINTED, "orden://web-painted");
        let said = read("t1", r#"{"url":"https://a.example/"}"#).expect("a paint");
        assert_eq!(said, Painted { tab: "t1".into(), url: "https://a.example/".into() });
        assert_eq!(
            serde_json::to_value(&said).expect("json"),
            serde_json::json!({ "tab": "t1", "url": "https://a.example/" })
        );
        for wrong in ["", "null", r#"{"url":7}"#, r#"{"href":"x"}"#] {
            assert_eq!(read("t1", wrong), None, "{wrong}");
        }
        assert_eq!(read("t1", &format!(r#"{{"url":"{}"}}"#, "a".repeat(9000))), None);
    }
    #[test]
    fn the_script_tells_the_first_paint_once_from_the_top_document() {
        assert!(SCRIPT.contains(&format!("globalThis.{BINDING}")));
        assert!(SCRIPT.contains("window.top !== window"));
        assert!(SCRIPT.contains("first-contentful-paint"));
        assert!(SCRIPT.contains("first-paint"));
        assert!(SCRIPT.contains("buffered: true"));
        assert!(SCRIPT.contains("if (told) return"));
        assert!(!SCRIPT.contains("addEventListener("));
    }
}
