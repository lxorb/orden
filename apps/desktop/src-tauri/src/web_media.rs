#![cfg_attr(not(feature = "cef"), allow(dead_code))]

const SCRIPT: &str = include_str!("web_media.js");

pub const UNPLAYABLE: &str = "orden-media-unplayable";

const HEARD: &str = "orden://web-unplayable";

pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}

pub fn heard(app: &tauri::AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let _ = app.emit_to(window, HEARD, serde_json::json!({ "tab": tab }));
}

#[cfg(test)]
mod tests {
    use super::{script, SCRIPT, UNPLAYABLE};

    #[test]
    fn the_script_asks_under_the_name_the_crate_reads() {
        assert!(SCRIPT.contains(UNPLAYABLE));
    }

    #[test]
    fn the_script_is_one_function_called_on_the_spot() {
        assert!(script().starts_with("(function () {"));
        assert!(script().ends_with("})()"));
    }
}
