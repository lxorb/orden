//! Whether a page still has the window its browser draws in.
//!
//! On Linux, `tauri-runtime-cef` answers `with_webview`, `hide`, `show`, `set_bounds` and the
//! like by reading the browser's X11 window, and asserts there is one (`failed to get XID`,
//! `platform/linux/webview.rs` in 3.0.0-alpha.6). A browser going, or not yet there, has
//! none, and the assert takes the whole app down, on a queued message nothing can catch. It
//! was met in the first moments of closing web tabs that were still coming up (#1031's
//! drive, `scripts/closing-drive.py`), on one run in three, and never on this machine.
//!
//! The runtime offers no way to ask first, and its own asking is what panics. So each page's
//! browser is kept here from the moment it is built, while it is certain to be there, and
//! what reaches for a page by name asks it: a page with no window is a page not found, and the
//! log says who wanted it.

/// A browser's window as the runtime reads it, and whether that browser draws into one of its
/// own at all: an offscreen page never has a window, and the runtime does not ask for it.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const fn windowless(handle: u64, offscreen: bool) -> bool {
    handle == 0 && !offscreen
}

#[cfg(feature = "cef")]
mod engine {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    use tauri::Manager as _;

    /// The browser of every page built, by its label.
    static BROWSERS: LazyLock<Mutex<HashMap<String, cef::Browser>>> = LazyLock::new(Mutex::default);

    fn browsers() -> MutexGuard<'static, HashMap<String, cef::Browser>> {
        BROWSERS.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A page has been built: its browser is kept, and those of the pages gone are let go of.
    pub fn built<R: tauri::Runtime>(view: &tauri::Webview<R>) {
        let app = view.app_handle();
        browsers().retain(|label, _| app.get_webview(label).is_some());
        let label = view.label().to_owned();
        let _ = view.with_webview(move |platform| {
            if let Some(page) = platform.downcast_ref::<tauri_runtime_cef::Webview>() {
                browsers().insert(label, page.browser());
            }
        });
    }

    pub fn has_none(label: &str) -> bool {
        let browsers = browsers();
        let Some(host) = browsers.get(label).and_then(cef::Browser::host) else {
            return false;
        };
        super::windowless(
            host.window_handle(),
            host.is_window_rendering_disabled() != 0,
        )
    }
}

#[cfg(feature = "cef")]
pub use engine::built;

/// Nothing to keep where the engine does not assert.
#[cfg(not(feature = "cef"))]
pub fn built<R: tauri::Runtime>(_view: &tauri::Webview<R>) {}

/// Whether the page under this label has lost its window, or has not got one yet. A page
/// nothing is known of is taken to have one, as it did before anybody asked. `who` is said
/// to the log, since who reaches for such a page is what is left to find out.
#[must_use]
#[track_caller]
pub fn has_none(label: &str) -> bool {
    #[cfg(feature = "cef")]
    {
        let none = engine::has_none(label);
        if none {
            let who = std::panic::Location::caller();
            eprintln!(
                "page_window: {label} has no window, asked from {}:{}",
                who.file(),
                who.line()
            );
        }
        none
    }
    #[cfg(not(feature = "cef"))]
    {
        let _ = label;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::windowless;

    #[test]
    fn a_browser_with_no_window_is_one_nothing_may_reach_unless_it_never_had_one() {
        assert!(windowless(0, false));
        assert!(!windowless(42, false));
        assert!(!windowless(0, true));
    }

    /// One left out is the assert back: every way in by name asks first.
    #[test]
    fn what_finds_a_page_asks_whether_it_has_a_window() {
        let tabs = include_str!("web_tabs.rs").replace('\r', "");
        let found = tabs
            .split("pub(crate) fn found(")
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap_or_default();
        assert!(
            found.contains("page_window::has_none"),
            "`found` does not ask"
        );
        for (file, source) in [
            ("page_scheme.rs", include_str!("page_scheme.rs")),
            ("spelling.rs", include_str!("spelling.rs")),
            ("web_follow.rs", include_str!("web_follow.rs")),
        ] {
            assert!(
                source.contains("page_window::has_none"),
                "{file} does not ask"
            );
        }
        let built = include_str!("engine.rs");
        assert!(
            built.contains("page_window::built"),
            "a page built is not kept"
        );
    }
}
