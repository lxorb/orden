use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager as _};

use super::engines::View;
use super::grants::Spaces;
use super::verbs::{window, ReaderTab};

const ASKING: Duration = Duration::from_millis(800);

const LENDING: Duration = Duration::from_secs(15);

pub fn tabs(app: &AppHandle, spaces: &Spaces) -> Vec<ReaderTab> {
    let listed: Vec<ReaderTab> = crate::endpoint::ask(app, window::READER_TABS, json!({}), ASKING)
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_else(|| pages(app));
    listed
        .into_iter()
        .filter(|tab| match (spaces, &tab.space) {
            (Spaces::All(_), _) => true,
            (Spaces::Named(_), None) => false,
            (Spaces::Named(_), Some(space)) => spaces.reach(space),
        })
        .collect()
}

fn pages(app: &AppHandle) -> Vec<ReaderTab> {
    app.webviews()
        .into_iter()
        .filter_map(|(label, view)| {
            let id = label.strip_prefix("web-")?;
            (id != "session").then(|| ReaderTab {
                id: id.to_string(),
                title: String::new(),
                url: view.url().map(|url| url.to_string()).unwrap_or_default(),
                space: None,
                front: false,
                on_screen: false,
            })
        })
        .collect()
}

pub fn page(app: &AppHandle, tab: &str) -> Option<View> {
    let label = crate::web_tabs::label_of(tab);
    if label == "web-session" || !(label.starts_with("web-") || label.starts_with("agent-")) {
        return None;
    }
    let lend = window::Lend {
        tab: tab.to_string(),
    };
    let _ = crate::endpoint::ask(
        app,
        window::LEND,
        serde_json::to_value(lend).unwrap_or_default(),
        LENDING,
    );
    super::engines::view(app, &label)
}
