use tauri::{AppHandle, Manager};

pub const MAIN: &str = "main";

pub fn document_windows(app: &AppHandle) -> Vec<tauri::Window> {
    app.windows()
        .into_values()
        .filter(|window| is_document_window(window.label()))
        .collect()
}

pub fn is_document_window(label: &str) -> bool {
    label == MAIN
        || label
            .strip_prefix("orden-")
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::is_document_window;

    #[test]
    fn a_document_window_is_main_or_a_numbered_one() {
        assert!(is_document_window("main"));
        assert!(is_document_window("orden-2"));
        assert!(is_document_window("orden-12"));
        assert!(!is_document_window("orden-quick-add"));
        assert!(!is_document_window("orden-"));
        assert!(!is_document_window("orden-2a"));
        assert!(!is_document_window("web-1"));
    }
}
