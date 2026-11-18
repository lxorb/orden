use orden_base::Held as _;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Url};

static APP: OnceLock<AppHandle> = OnceLock::new();

const LISTINGS: usize = 20;
const AGAIN: std::time::Duration = std::time::Duration::from_secs(1);

static EARLY: Mutex<Vec<Url>> = Mutex::new(Vec::new());

static OPEN: OnceLock<fn(&AppHandle, Vec<String>)> = OnceLock::new();

pub fn opened(url: Url) {
    let mut early = EARLY.held();
    match APP.get() {
        Some(app) => handed(app.clone(), url),
        None => early.push(url),
    }
}

pub fn start(app: &AppHandle, open: fn(&AppHandle, Vec<String>)) {
    let mut early = EARLY.held();
    let _ = OPEN.set(open);
    let _ = APP.set(app.clone());
    for url in early.drain(..) {
        handed(app.clone(), url);
    }
}

fn handed(app: AppHandle, url: Url) {
    std::thread::spawn(move || {
        let unknown =
            |url: &Url| url.scheme() == "chrome-extension" && !orden_web::extension_ids::ours(url);
        for _ in 0..LISTINGS {
            if !unknown(&url) {
                break;
            }
            let _ = super::listed(&app);
            if unknown(&url) {
                std::thread::sleep(AGAIN);
            }
        }
        if orden_web::web_tabs::tab_may_open(&url) {
            orden_base::logs::say(
                &app,
                "info",
                "extensions: a tab one opened, as a tab of Orden's",
            );
            if let Some(open) = OPEN.get() {
                open(&app, vec![url.to_string()]);
            }
        } else {
            orden_base::logs::say(
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
