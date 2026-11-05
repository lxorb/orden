//! What the engine says about a page beside where it is: whether it is playing sound
//! and whether that sound is muted, whether something in it has asked for the whole
//! screen, and how large it is drawn.
//!
//! Three things a browser shows or does without being asked, and each was missing:
//!
//! - **Sound.** Chrome puts a speaker on the tab a sound is coming from, and its tab
//!   menu mutes the site. `WebView2` says both (`IsDocumentPlayingAudio`, `IsMuted`)
//!   and takes the second; see `web_mute`.
//! - **The whole screen.** A video's own full screen button asks the engine for the
//!   whole screen, and the engine can only give it the whole of the webview, which was
//!   the pane. `WebView2` says when a page holds a full screen element, and the window
//!   answers by going full screen with the page over all of it. Escape and F11 give the
//!   screen back, as in Chrome; they are the engine's to hear, so they are heard here,
//!   and F11 is Orden's own full screen only while no video holds the screen (`web_keys.rs`).
//! - **Zoom.** Ctrl and the wheel, Ctrl and a sign, or a pinch zoom the page inside the
//!   engine (switched on for a web tab's page in `web_tabs.rs`), and the menu's
//!   percentage never knew. The engine says when it changes, so the window can show it
//!   and keep it for the site. And the engine keeps such a zoom for the one page it was
//!   made on: at the next page, the same site's or not, it goes back to the last zoom the
//!   app set and says so - which the window took for the site going back to that size,
//!   and forgot what the reader chose. So a zoom made in the page is set again as the
//!   app's own the moment it is heard, which is what the engine keeps across pages until
//!   the window sets the next site's. Its Ctrl+0 goes back to that same zoom the app set,
//!   which is no zoom at all; so Ctrl+0 is the page's first and then Orden's, the way the
//!   find keys are (see `web_opens.rs`), and `actual_size` answers it.
//!
//! And **how a page arrived**: where a navigation of its own frame ended and, when it did
//! not arrive, why - the word the bar's https-first waits for (web-tab/upgrade.ts). Emil,
//! 2026-10-13 (#235): a host typed with no scheme was tried over https alone.
//!
//! And **a page whose process died** (#791), which every engine says its own way:
//! `WebView2` as `ProcessFailed` on the page, here; `WKWebView` and Orden's own Chromium to
//! the one hook the app's builder has for it (`run_on` in lib.rs), which lands in `ended`.
//!
//! All of it is said to the window as one event, `nib://web-page`, carrying the tab.
//! But for that last, `WebView2`'s alone: elsewhere nothing is said, a video fills its pane
//! as it did, and a mute is the page's own media elements told to be quiet.

use serde::Serialize;
use tauri::AppHandle;

/// The event the window hears on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const SAID: &str = "nib://web-page";

/// What the engine said about one page.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "said", rename_all = "lowercase")]
pub enum Said {
    /// Whether the page is playing sound, and whether it is muted.
    Sound { playing: bool, muted: bool },
    /// Whether something in the page holds the whole screen.
    Fill { on: bool },
    /// How large the page is drawn: 1 is a hundred per cent.
    Zoom { factor: f64 },
    /// Where a navigation of the page's own frame ended, and why it did not arrive when
    /// it did not. The bar's https-first settles on it; see `failure_of`.
    Arrived {
        url: String,
        failure: Option<Failure>,
        /// The engine drew nothing for the failure: no error page of its own, the tab left
        /// on whatever it held, which for a new tab is nothing at all - a black pane in a
        /// dark theme (#1093). The window then says it instead; see `failed` in
        /// `web-tab/pages.svelte.ts`. `WKWebView`'s; `WebView2` draws a page of its own.
        bare: bool,
        /// Why, in the engine's words and the reader's language, where it says.
        reason: Option<String>,
    },
    /// The page's process has died: a white box from here on, until somebody builds it
    /// again. The pane offers that; see `ended` in pages.svelte.ts.
    Crashed,
}

/// Why a page did not arrive, in the three kinds that decide anything: nothing answered
/// on the connection, so plain http is worth trying for an address the bar gave
/// `https:` (web-tab/upgrade.ts); the certificate was wrong, which is shown and never
/// stepped round; or anything else.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Failure {
    Unreachable,
    Certificate,
    Other,
}

/// Why a `WKWebView` navigation did not arrive, out of its error's domain and code, or
/// `None` for one that is no failure to show: a navigation another one replaced
/// (`NSURLErrorCancelled`), one that became a download or that the tab's own rule turned
/// away (`WebKitErrorFrameLoadInterruptedByPolicyChange`), and a document a plug-in took.
/// The same three kinds `WebView2`'s statuses are read into above: the connection
/// failing is unreachable, so the bar's https-first falls back; a certificate is the
/// certificate; a name that does not resolve, or no network at all, is anything else.
#[cfg_attr(
    not(all(target_os = "macos", not(feature = "cef"))),
    allow(dead_code, reason = "only WKWebView's failures are read here")
)]
pub fn failure_of_error(domain: &str, code: isize) -> Option<Failure> {
    match (domain, code) {
        ("NSURLErrorDomain", -999) | ("WebKitErrorDomain", 102 | 204) => None,
        // Every certificate error NSURLError has, and a TLS handshake that failed.
        ("NSURLErrorDomain", -1206..=-1200) => Some(Failure::Certificate),
        // Timed out, could not connect, the connection lost, or answered with nothing.
        ("NSURLErrorDomain", -1001 | -1004 | -1005 | -1011 | -1017) => Some(Failure::Unreachable),
        _ => Some(Failure::Other),
    }
}

/// One of those, with the tab it is about.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Serialize)]
struct Heard {
    tab: String,
    #[serde(flatten)]
    said: Said,
}

/// Whether a key gives the screen back from a page holding it: Escape or F11, pressed
/// rather than let go of, and nothing held with it.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn leaves(vk: u32, down: bool) -> bool {
    down && matches!(vk, 0x1B | 0x7A)
}

/// A webview's process has died: said to its window, if it is a tab's page. The app's own
/// page goes through the same hook, and has nothing to say it to.
#[cfg_attr(not(any(feature = "cef", target_os = "macos")), allow(dead_code))]
pub fn ended(view: &tauri::Webview) {
    use tauri::{Emitter, Manager};

    let Some(tab) = crate::web_tabs::tab_of(view.label()) else {
        return;
    };
    let window = view.window().label().to_string();
    let heard = Heard {
        tab,
        said: Said::Crashed,
    };
    let _ = view.app_handle().emit_to(window.as_str(), SAID, heard);
}

/// What a page is told when its sound is turned off or on, on an engine that cannot
/// mute a page itself: every media element in it, as it is now.
#[cfg_attr(any(windows, feature = "cef"), allow(dead_code))]
const QUIET: &str =
    "document.querySelectorAll('audio, video').forEach(function (one) { one.muted = __MUTED__ })";

/// Draws a tab's page at a hundred per cent, for Ctrl+0 pressed inside it that nothing
/// in the page took, and tells the window, which forgets the site's size: a zoom the app
/// sets is one the engine says nothing about. See the top of this file.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn actual_size(app: &AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    if view.set_zoom(crate::page_scale::web(1.0)).is_ok() {
        let heard = Heard {
            tab: tab.to_string(),
            said: Said::Zoom { factor: 1.0 },
        };
        let _ = app.emit_to(window, SAID, heard);
    }
}

/// Mutes a tab's page, or lets it be heard again.
#[tauri::command]
pub fn web_mute(app: AppHandle, tab: String, muted: bool) -> Result<(), String> {
    mute(&crate::web_tabs::found(&app, &tab)?, muted)
}

/// Gives the screen back from a page holding it, for a tab going out of sight while it
/// does. The page's own call, so the page hears about it the way it would from Escape.
#[tauri::command]
pub fn web_unfill(app: AppHandle, tab: String) -> Result<(), String> {
    crate::web_tabs::found(&app, &tab)?
        .eval("if (document.fullscreenElement) document.exitFullscreen()")
        .map_err(|error| format!("that page could not be reached: {error}"))
}

#[cfg(all(windows, not(feature = "cef")))]
pub use heard::{holds_screen, listen, mute};

#[cfg(all(windows, not(feature = "cef")))]
mod heard {
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter, Webview};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Controller, ICoreWebView2NavigationCompletedEventArgs,
        ICoreWebView2NavigationCompletedEventArgs2, ICoreWebView2_8, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_WEB_ERROR_STATUS, COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET, COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE,
        COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE, COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
        COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
    };
    use webview2_com::{
        AcceleratorKeyPressedEventHandler, ContainsFullScreenElementChangedEventHandler,
        ExecuteScriptCompletedHandler, IsDocumentPlayingAudioChangedEventHandler,
        IsMutedChangedEventHandler, NavigationCompletedEventHandler, ProcessFailedEventHandler,
        ZoomFactorChangedEventHandler,
    };
    use windows_core::{Interface, BOOL, PWSTR};

    use super::{leaves, Failure, Heard, Said, SAID};

    /// Why a navigation did not arrive, out of the engine's own status for it and the
    /// HTTP status the server answered with, 0 where nothing answered.
    ///
    /// Unreachable is the connection itself failing: refused, reset, cut off, timed out,
    /// no route to the server, or something on the other end that answered without
    /// speaking TLS - which is what a server serving plain http on the port does, and
    /// what Chrome falls back from too. Measured on `WebView2` 154: a refused connection
    /// and a server that does not speak TLS are both `UNKNOWN`, and so are a 404 and a
    /// 500 - which are a server answering - so a server that answered is never
    /// unreachable, whatever the status. A name that does not resolve is not among them:
    /// it resolves no better over http. Each certificate status is the certificate.
    pub(super) fn failure_of(status: COREWEBVIEW2_WEB_ERROR_STATUS, answered: i32) -> Failure {
        match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT
            | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID
            | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS => {
                Failure::Certificate
            }
            _ if answered > 0 => Failure::Other,
            COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN
            | COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT
            | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
            | COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED
            | COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE
            | COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT
            | COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE => {
                Failure::Unreachable
            }
            _ => Failure::Other,
        }
    }

    /// Where a navigation ended and why it did not arrive, out of the engine's event.
    #[allow(unsafe_code, reason = "the event's own COM objects, on this thread")]
    fn arrived(
        core: Option<&ICoreWebView2>,
        args: Option<&ICoreWebView2NavigationCompletedEventArgs>,
    ) -> Option<Said> {
        // Safe: the engine's own objects, handed to its event on the window's thread.
        unsafe {
            let mut url = PWSTR::null();
            core?.Source(&raw mut url).ok()?;
            let url = webview2_com::take_pwstr(url);
            let args = args?;
            let mut success = BOOL::default();
            args.IsSuccess(&raw mut success).ok()?;
            let failure = if success.as_bool() {
                None
            } else {
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                args.WebErrorStatus(&raw mut status).ok()?;
                // What the server said, where the runtime can say: 0 for nothing at all.
                let mut answered = 0i32;
                if let Ok(two) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>() {
                    let _ = two.HttpStatusCode(&raw mut answered);
                }
                Some(failure_of(status, answered))
            };
            Some(Said::Arrived {
                url,
                failure,
                bare: false,
                reason: None,
            })
        }
    }

    /// Starts listening on one page. Called on the window's thread, once, as the page is
    /// built; `window` is the label of the window it is in.
    #[allow(
        unsafe_code,
        reason = "what a page is doing is told through WebView2's own events, reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        let tell = move |said: Said| {
            let heard = Heard {
                tab: tab.clone(),
                said,
            };
            let _ = app.emit_to(window.as_str(), SAID, heard);
        };

        // Safe: the controller is this window's, every object below is used only on
        // this thread, and WebView2 holds each handler for as long as it can fire.
        unsafe {
            let controller = webview.controller();
            let Ok(core) = controller.CoreWebView2() else {
                return;
            };

            // The sound, whichever of the two changed: the tab draws both at once.
            if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
                let told = tell.clone();
                let heard = move |sender: Option<ICoreWebView2>| {
                    if let Some(said) = sender.and_then(|one| sound(&one)) {
                        told(said);
                    }
                    Ok(())
                };
                let playing = IsDocumentPlayingAudioChangedEventHandler::create(Box::new({
                    let heard = heard.clone();
                    move |sender, _| heard(sender)
                }));
                let muted =
                    IsMutedChangedEventHandler::create(Box::new(move |sender, _| heard(sender)));
                let mut token = 0i64;
                let _ = eight.add_IsDocumentPlayingAudioChanged(&playing, &raw mut token);
                let _ = eight.add_IsMutedChanged(&muted, &raw mut token);
            }

            // Its process, gone. The main frame's only, which is the page: a frame of another
            // site crashing leaves the page around it, and the window has nothing to offer
            // for it. Nor for the engine's own process, whose every page goes at once and
            // which a Reload here could not bring back.
            let told = tell.clone();
            let failed = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                args.ProcessFailedKind(&raw mut kind)?;
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                    told(Said::Crashed);
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_ProcessFailed(&failed, &raw mut token);

            let told = tell.clone();
            let filled =
                ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        told(Said::Fill { on: filling(&core) });
                    }
                    Ok(())
                }));
            let mut token = 0i64;
            let _ = core.add_ContainsFullScreenElementChanged(&filled, &raw mut token);

            // Escape and F11 while the page holds the screen. The page is asked to let
            // go, which is what makes the event above say so; nothing else about either
            // key changes.
            let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |sender, args| {
                let (Some(sender), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                let mut vk = 0u32;
                args.KeyEventKind(&raw mut kind)?;
                args.VirtualKey(&raw mut vk)?;
                let down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;

                if !leaves(vk, down) {
                    return Ok(());
                }
                // The page's engine from the controller the key arrived at, rather than
                // one held here: a handler holding its own webview would keep it alive.
                let core = sender.CoreWebView2()?;
                if filling(&core) {
                    args.SetHandled(true)?;
                    let done = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
                    core.ExecuteScript(windows_core::w!("document.exitFullscreen()"), &done)?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = controller.add_AcceleratorKeyPressed(&keys, &raw mut token);

            // How each navigation of the page's own frame ended; see `arrived`.
            let told = tell.clone();
            let ended = NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                if let Some(said) = arrived(sender.as_ref(), args.as_ref()) {
                    told(said);
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_NavigationCompleted(&ended, &raw mut token);

            // Only a zoom made in the page is heard: one the app sets says nothing, so
            // setting this one again cannot come back round. See the top of this file.
            let zoomed = ZoomFactorChangedEventHandler::create(Box::new(move |sender, _| {
                let mut factor = 1.0f64;
                if let Some(controller) = sender {
                    if controller.ZoomFactor(&raw mut factor).is_ok() {
                        let _ = controller.SetZoomFactor(factor);
                        tell(Said::Zoom { factor });
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = controller.add_ZoomFactorChanged(&zoomed, &raw mut token);
        }
    }

    /// What the page's sound is now, or nothing from an engine too old to say.
    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    fn sound(core: &ICoreWebView2) -> Option<Said> {
        // Safe: the engine is this page's, on this thread.
        unsafe {
            let eight = core.cast::<ICoreWebView2_8>().ok()?;
            let mut playing = BOOL::default();
            let mut muted = BOOL::default();
            eight.IsDocumentPlayingAudio(&raw mut playing).ok()?;
            eight.IsMuted(&raw mut muted).ok()?;
            Some(Said::Sound {
                playing: playing.as_bool(),
                muted: muted.as_bool(),
            })
        }
    }

    /// Whether something in the page a key arrived at holds the whole screen, so the
    /// key is this file's to hear; see `web_keys.rs`.
    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    pub fn holds_screen(controller: &ICoreWebView2Controller) -> bool {
        // Safe: the controller is the page's own, asked on its own thread.
        unsafe { controller.CoreWebView2() }.is_ok_and(|core| filling(&core))
    }

    /// Whether something in the page holds the whole screen.
    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    fn filling(core: &ICoreWebView2) -> bool {
        let mut on = BOOL::default();
        // Safe: the engine is this page's, on this thread.
        unsafe { core.ContainsFullScreenElement(&raw mut on).is_ok() && on.as_bool() }
    }

    /// The engine's own mute, on the window's thread, where its objects live. An engine
    /// too old to mute is told the way every other engine is.
    #[allow(
        unsafe_code,
        reason = "the engine is reached through its COM interfaces"
    )]
    pub fn mute(view: &Webview, muted: bool) -> Result<(), String> {
        let fallback = view.clone();
        view.with_webview(move |platform| {
            // Safe: the controller is this webview's own, asked on its own thread.
            let done = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_8>())
                    .and_then(|eight| eight.SetIsMuted(muted))
            };
            if done.is_err() {
                let _ = super::quieted(&fallback, muted);
            }
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }
}

/// Tells a page's media elements to be quiet, or not.
#[cfg_attr(any(windows, feature = "cef"), allow(dead_code))]
fn quieted(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    view.eval(QUIET.replace("__MUTED__", if muted { "true" } else { "false" }))
        .map_err(|error| format!("that page could not be reached: {error}"))
}

/// `WKWebView`: how a page arrived, and its frames judged as frames; see web_page/webkit.rs.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
#[path = "web_page/webkit.rs"]
mod webkit;
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub use webkit::listen;

/// Every other engine says nothing about a page; see the top of this file.
#[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

/// Nor does Orden's own Chromium, here.
#[cfg(feature = "cef")]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

/// Every other engine mutes what the page is playing now.
#[cfg(all(not(windows), not(feature = "cef")))]
pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    quieted(view, muted)
}

/// Orden's own Chromium mutes the page the way Chrome's tab strip does: the browser's own
/// sound off, whatever the page plays next, and nothing said to the page.
#[cfg(feature = "cef")]
pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    use tauri_runtime_cef::WebviewCefExt as _;
    view.with_cef_webview(move |page| {
        if let Some(host) = page.browser().host() {
            host.set_audio_muted(i32::from(muted));
        }
    })
    .map_err(|error| format!("that page could not be reached: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{failure_of_error, leaves, Failure, Heard, Said, QUIET};

    #[test]
    fn escape_and_f11_give_the_screen_back() {
        assert!(leaves(0x1B, true));
        assert!(leaves(0x7A, true));
        // Let go of, or any other key, is the page's.
        assert!(!leaves(0x1B, false));
        assert!(!leaves(0x0D, true));
    }

    #[test]
    fn the_window_hears_which_tab_and_what() {
        let heard = Heard {
            tab: "a".into(),
            said: Said::Sound {
                playing: true,
                muted: false,
            },
        };
        let json = serde_json::to_value(&heard).expect("json");
        assert_eq!(
            json,
            serde_json::json!({ "tab": "a", "said": "sound", "playing": true, "muted": false })
        );

        let fill = serde_json::to_value(Heard {
            tab: "b".into(),
            said: Said::Fill { on: true },
        })
        .expect("json");
        assert_eq!(fill["said"], "fill");

        let zoom = serde_json::to_value(Heard {
            tab: "c".into(),
            said: Said::Zoom { factor: 1.25 },
        })
        .expect("json");
        assert_eq!(zoom["factor"], 1.25);

        let crashed = serde_json::to_value(Heard {
            tab: "d".into(),
            said: Said::Crashed,
        })
        .expect("json");
        assert_eq!(
            crashed,
            serde_json::json!({ "tab": "d", "said": "crashed" })
        );
    }

    /// #1093: a Mac's failed navigation, read into the kinds the window decides on, and the
    /// ones that are no failure at all left unsaid.
    #[test]
    fn a_webkit_failure_is_read_as_what_it_means() {
        // Replaced by the next navigation, turned into a download, taken by a plug-in.
        assert_eq!(failure_of_error("NSURLErrorDomain", -999), None);
        assert_eq!(failure_of_error("WebKitErrorDomain", 102), None);
        assert_eq!(failure_of_error("WebKitErrorDomain", 204), None);
        // A certificate, however it is wrong, and a handshake that failed.
        for code in [-1200, -1201, -1202, -1203, -1204, -1205, -1206] {
            assert_eq!(
                failure_of_error("NSURLErrorDomain", code),
                Some(Failure::Certificate)
            );
        }
        // The connection itself: what the bar's https-first falls back from.
        for code in [-1001, -1004, -1005, -1011, -1017] {
            assert_eq!(
                failure_of_error("NSURLErrorDomain", code),
                Some(Failure::Unreachable)
            );
        }
        // A name that does not resolve, no network, anything else.
        assert_eq!(
            failure_of_error("NSURLErrorDomain", -1003),
            Some(Failure::Other)
        );
        assert_eq!(
            failure_of_error("NSURLErrorDomain", -1009),
            Some(Failure::Other)
        );
        assert_eq!(
            failure_of_error("WebKitErrorDomain", 101),
            Some(Failure::Other)
        );
    }

    /// The window reads an arrival's four fields, the bare one and the reason included.
    #[test]
    fn an_arrival_says_whether_anything_was_drawn_and_why() {
        let json = serde_json::to_value(Heard {
            tab: "e".into(),
            said: Said::Arrived {
                url: "https://no-such-host.invalid/".into(),
                failure: Some(Failure::Other),
                bare: true,
                reason: Some("A server with the specified hostname could not be found.".into()),
            },
        })
        .expect("json");
        assert_eq!(
            json,
            serde_json::json!({
                "tab": "e",
                "said": "arrived",
                "url": "https://no-such-host.invalid/",
                "failure": "other",
                "bare": true,
                "reason": "A server with the specified hostname could not be found.",
            })
        );
    }

    #[test]
    fn a_page_is_quieted_through_its_own_media() {
        assert!(QUIET.contains("audio, video"));
        assert!(QUIET.contains("__MUTED__"));
    }
}

#[cfg(all(test, windows, not(feature = "cef")))]
mod arrivals {
    use super::heard::failure_of;
    use super::Failure;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
        COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED, COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
        COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
    };

    #[test]
    fn nothing_answering_on_the_connection_is_unreachable() {
        // A refused connection and a server that does not speak TLS, as measured.
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN, 0),
            Failure::Unreachable
        );
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT, 0),
            Failure::Unreachable
        );
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT, 0),
            Failure::Unreachable
        );
    }

    #[test]
    fn a_server_that_answered_is_never_unreachable() {
        // A 404 and a 500 over https are `UNKNOWN` too: the server answered.
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN, 404),
            Failure::Other
        );
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN, 500),
            Failure::Other
        );
    }

    #[test]
    fn a_wrong_certificate_is_the_certificate() {
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED, 0),
            Failure::Certificate
        );
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID, 0),
            Failure::Certificate
        );
    }

    #[test]
    fn a_name_that_does_not_resolve_or_a_stop_is_something_else() {
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED, 0),
            Failure::Other
        );
        assert_eq!(
            failure_of(COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED, 0),
            Failure::Other
        );
    }

    #[test]
    fn it_is_said_to_the_window_in_the_words_upgrade_ts_reads() {
        let said = serde_json::to_value(super::Said::Arrived {
            url: "https://a.example/".into(),
            failure: Some(Failure::Unreachable),
            bare: false,
            reason: None,
        })
        .expect("json");
        assert_eq!(said["said"], "arrived");
        assert_eq!(said["failure"], "unreachable");
        let fine = serde_json::to_value(super::Said::Arrived {
            url: "https://a.example/".into(),
            failure: None,
            bare: false,
            reason: None,
        })
        .expect("json");
        assert!(fine["failure"].is_null());
    }
}
