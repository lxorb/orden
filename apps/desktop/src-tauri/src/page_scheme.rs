//! A web tab's page drawn in the app's scheme, light or dark, rather than the system's.
//!
//! A reader on a dark desktop who chose Orden light got every site dark, and the other
//! way round (#427): a page's `prefers-color-scheme` was the system's, whatever the
//! app around it wore. So the app's page says its scheme as it starts and each time it
//! changes (`SCRIPT`, which reads the `data-theme` the app wears on its root), and every
//! web tab's page is given it, and each new one as it is made: on CEF through its
//! profile's colour scheme (`SetChromeColorScheme`), which is what a page's
//! `prefers-color-scheme` answers there; on Windows through its `WebView2` profile's
//! preferred colour scheme. Elsewhere the page follows the system, as it always did.
//!
//! On CEF a page that paints no ground of its own stands on its browser view's, not on
//! the web's white: Chrome style keeps the page itself clear there, and a browser
//! view's ground goes back to the theme's own each time its theme changes, which in a
//! dark scheme is Chrome's dark grey. A page written only for light was then dark text
//! on dark, with its white parts a frame round it (#763). So each time a page is given
//! the scheme its browser view is given white again, as every browser stands a page on.

use std::sync::Mutex;

use tauri::{Manager as _, Webview};

/// What the app's own page runs to say its scheme; see the top of this file.
#[cfg_attr(not(any(feature = "cef", windows)), allow(dead_code))]
pub const SCRIPT: &str = include_str!("page_scheme.js");

/// The app's scheme, light or dark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    Light,
    Dark,
}

/// The scheme last said, which every page made from now on is given; none before the
/// app's page has said one, and the page then follows the system.
static SAID: Mutex<Option<Scheme>> = Mutex::new(None);

fn said() -> Option<Scheme> {
    *SAID
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The app's page says its scheme: kept, and every web tab's page given it.
#[tauri::command]
pub fn page_scheme_seen(webview: Webview<crate::Engine>, scheme: Scheme) {
    let before = SAID
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .replace(scheme);
    if before == Some(scheme) {
        return;
    }
    for page in webview.app_handle().webviews().into_values() {
        // A window's own page is the app's, which wears its scheme itself.
        if page.label() != page.window().label() {
            wear(&page);
        }
    }
}

/// Gives a web tab's page the app's scheme, where the app has said one.
pub fn wear(page: &Webview<crate::Engine>) {
    let Some(scheme) = said() else {
        return;
    };
    let _ = page.with_webview(move |platform| engine::wear(&platform, scheme));
}

#[cfg(feature = "cef")]
mod engine {
    use cef::{ImplBrowser as _, ImplBrowserHost as _, ImplRequestContext as _, ImplView as _};

    use super::Scheme;

    /// The page's profile told the scheme: every page in that profile is drawn in it.
    pub fn wear(platform: &tauri::webview::PlatformWebview, scheme: Scheme) {
        let Some(view) = platform.downcast_ref::<tauri_runtime_cef::Webview>() else {
            return;
        };
        let mut browser = view.browser();
        let Some(context) = browser.host().and_then(|host| host.request_context()) else {
            return;
        };
        let variant = match scheme {
            Scheme::Light => cef::sys::cef_color_variant_t::CEF_COLOR_VARIANT_LIGHT,
            Scheme::Dark => cef::sys::cef_color_variant_t::CEF_COLOR_VARIANT_DARK,
        };
        context.set_chrome_color_scheme(cef::ColorVariant::from(variant), 0);
        // After the scheme, whose theme change has just put the view's ground back to
        // the theme's; see the top of this file. CEF answers the change twice: at once,
        // and again in a task it posts to its UI thread for the views' own
        // `ThemeChanged`, which puts the ground back a second time. So the ground is
        // given now and again in a task posted after CEF's, which runs after it.
        ground(&mut browser);
        crate::agents::engines::cef::on_ui(move || ground(&mut browser));
    }

    /// The page's browser view given white. A browser with no view of its own, as under
    /// Alloy style, has none to give.
    fn ground(browser: &mut cef::Browser) {
        if let Some(view) = cef::browser_view_get_for_browser(Some(browser)) {
            view.set_background_color(WHITE);
        }
    }

    /// The web's own ground, as ARGB.
    const WHITE: u32 = 0xFFFF_FFFF;
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_13, COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
        COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
    };
    use windows_core::Interface as _;

    use super::Scheme;

    /// The page's `WebView2` profile told the scheme.
    #[allow(
        unsafe_code,
        reason = "the page's profile is reached through WebView2's COM interfaces"
    )]
    pub fn wear(platform: &tauri::webview::PlatformWebview, scheme: Scheme) {
        // Safe: the controller is this page's, and everything reached from it is used
        // here, on the page's own thread.
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            let Ok(profile) = core
                .cast::<ICoreWebView2_13>()
                .and_then(|one| one.Profile())
            else {
                return;
            };
            let _ = profile.SetPreferredColorScheme(match scheme {
                Scheme::Light => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
                Scheme::Dark => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
            });
        }
    }
}

#[cfg(not(any(feature = "cef", windows)))]
mod engine {
    use super::Scheme;

    /// Nothing to tell: the page follows the system.
    pub fn wear(_platform: &tauri::webview::PlatformWebview, _scheme: Scheme) {}
}

#[cfg(test)]
mod tests {
    use super::{Scheme, SCRIPT};

    #[test]
    fn the_script_says_the_scheme_the_app_wears() {
        assert!(SCRIPT.contains("'page_scheme_seen'"));
        assert!(SCRIPT.contains("data-theme"));
    }

    #[test]
    fn a_scheme_is_read_as_the_page_says_it() {
        assert_eq!(
            serde_json::from_str::<Scheme>("\"dark\"").ok(),
            Some(Scheme::Dark)
        );
        assert_eq!(
            serde_json::from_str::<Scheme>("\"light\"").ok(),
            Some(Scheme::Light)
        );
        assert!(serde_json::from_str::<Scheme>("\"system\"").is_err());
    }
}
