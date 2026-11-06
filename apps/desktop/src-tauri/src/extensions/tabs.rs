//! A tab an extension opens by itself on Orden's own Chromium (#1161): `chrome.tabs.create`
//! from its background, its popup or its pages - the page about its own install, a popup's
//! button for its dashboard, a Firefox add-on's sidebar. Chrome's own UI makes a browser for
//! it, which the runtime keeps off the screen, hands over and closes (`on_unhosted_tab` in
//! linux/tauri-runtime-cef); it opens as a tab of Orden's instead, the way a link handed
//! over from elsewhere does: in the window in front, in its pane being worked in.

use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::{AppHandle, Url};

/// The app, once it is built. An extension's background can open a tab while CEF starts.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// How often, and how far apart, the engine is asked for its list before a tab of an
/// extension it does not list is given up on.
const LISTINGS: usize = 20;
const AGAIN: std::time::Duration = std::time::Duration::from_secs(1);

/// The tabs asked for before the app was built.
static EARLY: Mutex<Vec<Url>> = Mutex::new(Vec::new());

/// The runtime's hook, on the browser process's thread.
pub fn opened(url: Url) {
    let mut early = EARLY.lock().unwrap_or_else(PoisonError::into_inner);
    match APP.get() {
        Some(app) => handed(app.clone(), url),
        None => early.push(url),
    }
}

/// The app is built: what was asked for already is opened, and everything after it.
pub fn start(app: &AppHandle) {
    let mut early = EARLY.lock().unwrap_or_else(PoisonError::into_inner);
    let _ = APP.set(app.clone());
    for url in early.drain(..) {
        handed(app.clone(), url);
    }
}

/// Off the browser's thread, where the engine is asked for its list.
fn handed(app: AppHandle, url: Url) {
    std::thread::spawn(move || {
        // An extension that arrived since the list was last read: no tab may be on its
        // pages until the list knows it, and as Orden starts the engine may not answer
        // for its list yet.
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
