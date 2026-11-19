use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use orden_base::Held as _;
use tauri::Webview;

pub const KINDS: [&str; 4] = ["menu", "dialog", "permission", "select"];
static TAKEN: LazyLock<Mutex<HashMap<String, HashSet<&'static str>>>> =
    LazyLock::new(Mutex::default);
fn known(kind: &str) -> Option<&'static str> {
    KINDS.into_iter().find(|one| *one == kind)
}
pub fn take(window: &str, kinds: &[String]) -> Result<(), String> {
    let mut taken = HashSet::new();
    for kind in kinds {
        taken.insert(known(kind).ok_or_else(|| format!("{kind} is not a page's own UI"))?);
    }
    TAKEN.held().insert(window.to_owned(), taken);
    Ok(())
}
#[must_use]
pub fn takes(window: &str, kind: &str) -> bool {
    TAKEN.held().get(window).is_some_and(|all| all.contains(kind))
}
#[tauri::command]
pub fn web_page_ui(webview: Webview, kinds: Vec<String>) -> Result<(), String> {
    take(webview.window().label(), &kinds)
}
#[cfg(test)]
mod tests {
    use super::{take, takes, KINDS};

    #[test]
    fn a_page_s_own_ui_is_the_app_s_only_where_the_app_said_it_takes_it() {
        assert_eq!(KINDS, ["menu", "dialog", "permission", "select"]);
        assert!(!takes("ui-test-1", "menu"));
        take("ui-test-1", &["menu".into(), "select".into()]).expect("known kinds");
        assert!(takes("ui-test-1", "menu"));
        assert!(takes("ui-test-1", "select"));
        assert!(!takes("ui-test-1", "dialog"));
        assert!(!takes("ui-test-2", "menu"));
        assert!(take("ui-test-1", &["popup".into()]).is_err());
        assert!(takes("ui-test-1", "menu"));
        take("ui-test-1", &[]).expect("nothing");
        assert!(!takes("ui-test-1", "menu"));
    }
}
