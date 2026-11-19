use serde::{Deserialize, Serialize};

const SCRIPT: &str = include_str!("web_pointer.js");
pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}
pub const BINDING: &str = "ordenPointed";
const POINTED: &str = "orden://web-pointer";
#[derive(Deserialize)]
struct Said {
    x: f64,
    y: f64,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Pointed {
    tab: String,
    x: f64,
    y: f64,
}
pub fn read(tab: &str, payload: &str) -> Option<Pointed> {
    let Said { x, y } = serde_json::from_str(payload).ok()?;
    let inside = |one: f64| (0.0..=1.0).contains(&one);
    (inside(x) && inside(y)).then(|| Pointed {
        tab: tab.to_string(),
        x,
        y,
    })
}
pub fn heard(app: &tauri::AppHandle, window: &str, tab: &str, payload: &str) {
    use tauri::Emitter;

    if let Some(pointed) = read(tab, payload) {
        let _ = app.emit_to(window, POINTED, pointed);
    }
}
#[cfg(test)]
mod tests {
    use super::{read, Pointed, BINDING, SCRIPT};

    #[test]
    fn a_pointer_on_the_page_is_told_as_a_share_of_its_width_and_height() {
        assert_eq!(
            read("t1", r#"{"x":0.001,"y":0.5}"#),
            Some(Pointed {
                tab: "t1".into(),
                x: 0.001,
                y: 0.5
            })
        );
        for said in [
            "",
            "null",
            r#"{"x":"0","y":0}"#,
            r#"{"x":0}"#,
            r#"{"x":-0.1,"y":0}"#,
            r#"{"x":0,"y":1.5}"#,
            r#"{"x":1e300,"y":0}"#,
        ] {
            assert_eq!(read("t1", said), None, "{said}");
        }
    }
    #[test]
    fn the_script_only_listens_in_the_top_document_and_says_through_the_binding() {
        assert!(SCRIPT.contains(&format!("globalThis.{BINDING}")));
        assert!(SCRIPT.contains("window.top !== window"));
        assert_eq!(SCRIPT.matches("addEventListener(").count(), 1);
        assert!(SCRIPT.contains("passive: true"));
        assert!(!SCRIPT.contains("preventDefault"));
        assert!(!SCRIPT.contains("stopPropagation"));
    }
}
