use tauri::{AppHandle, Manager};

pub const MAIN: &str = "main";

pub fn document_windows(app: &AppHandle) -> Vec<tauri::Window> {
    app.windows()
        .into_values()
        .filter(|window| is_document_window(window.label()))
        .collect()
}

pub fn host(app: &AppHandle) -> Option<tauri::Window> {
    app.get_window(MAIN)
        .or_else(|| document_windows(app).into_iter().next())
}

pub fn is_document_window(label: &str) -> bool {
    label == MAIN
        || label
            .strip_prefix("orden-")
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

pub fn own_window(webview: &tauri::Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("not a window of this app".into())
    }
}

pub fn from_the_app(webview: &tauri::Webview) -> Result<(), String> {
    if is_document_window(webview.label()) {
        Ok(())
    } else {
        Err("only Orden's own window may ask that".into())
    }
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
