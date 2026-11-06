use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::{AppHandle, Url};

static APP: OnceLock<AppHandle> = OnceLock::new();

const LISTINGS: usize = 20;
const AGAIN: std::time::Duration = std::time::Duration::from_secs(1);

static EARLY: Mutex<Vec<Url>> = Mutex::new(Vec::new());

pub fn opened(url: Url) {
    let mut early = EARLY.lock().unwrap_or_else(PoisonError::into_inner);
    match APP.get() {
        Some(app) => handed(app.clone(), url),
        None => early.push(url),
    }
}

pub fn start(app: &AppHandle) {
    let mut early = EARLY.lock().unwrap_or_else(PoisonError::into_inner);
    let _ = APP.set(app.clone());
    for url in early.drain(..) {
        handed(app.clone(), url);
    }
}

fn handed(app: AppHandle, url: Url) {
    std::thread::spawn(move || {
        let unknown = |url: &Url| url.scheme() == "chrome-extension" && !super::ours(url);
        for _ in 0..LISTINGS {
            if !unknown(&url) {
                break;
            }
            let _ = super::listed(&app);
            if unknown(&url) {
                std::thread::sleep(AGAIN);
            }
        }
        if crate::web_tabs::tab_may_open(&url) {
            crate::logs::say(
                &app,
                "info",
                "extensions: a tab one opened, as a tab of Orden's",
            );
            crate::launch::hand_over(&app, crate::launch::Handed::Pages, vec![url.to_string()]);
        } else {
            crate::logs::say(
                &app,
                "info",
                &format!(
                    "extensions: a tab at a {}: address was not opened",
                    url.scheme()
                ),
            );
        }
    });
}
