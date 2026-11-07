use serde::Serialize;
use tauri::AppHandle;

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const SAID: &str = "nib://web-page";

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "said", rename_all = "lowercase")]
pub enum Said {
    Sound {
        playing: bool,
        muted: bool,
    },
    Fill {
        on: bool,
    },
    Zoom {
        factor: f64,
    },
    Arrived {
        url: String,
        failure: Option<Failure>,
        bare: bool,
        reason: Option<String>,
    },
    Crashed,
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Failure {
    Unreachable,
    Certificate,
    Other,
}

#[cfg_attr(
    not(all(target_os = "macos", not(feature = "cef"))),
    allow(dead_code, reason = "only WKWebView's failures are read here")
)]
pub fn failure_of_error(domain: &str, code: isize) -> Option<Failure> {
    match (domain, code) {
        ("NSURLErrorDomain", -999) | ("WebKitErrorDomain", 102 | 204) => None,
        ("NSURLErrorDomain", -1206..=-1200) => Some(Failure::Certificate),
        ("NSURLErrorDomain", -1001 | -1004 | -1005 | -1011 | -1017) => Some(Failure::Unreachable),
        _ => Some(Failure::Other),
    }
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
#[derive(Clone, Serialize)]
struct Heard {
    tab: String,
    #[serde(flatten)]
    said: Said,
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn leaves(vk: u32, down: bool) -> bool {
    down && matches!(vk, 0x1B | 0x7A)
}

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

#[cfg_attr(any(windows, feature = "cef"), allow(dead_code))]
const QUIET: &str =
    "document.querySelectorAll('audio, video').forEach(function (one) { one.muted = __MUTED__ })";

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

#[tauri::command]
pub fn web_mute(app: AppHandle, tab: String, muted: bool) -> Result<(), String> {
    mute(&crate::web_tabs::found(&app, &tab)?, muted)
}

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
        ICoreWebView2NavigationCompletedEventArgs2, ICoreWebView2ProcessFailedEventHandler,
        ICoreWebView2_8, COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED, COREWEBVIEW2_WEB_ERROR_STATUS,
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
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

    #[allow(unsafe_code, reason = "the event's own COM objects, on this thread")]
    fn arrived(
        core: Option<&ICoreWebView2>,
        args: Option<&ICoreWebView2NavigationCompletedEventArgs>,
    ) -> Option<Said> {
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

    fn failing(
        (app, tab): (AppHandle, String),
        told: impl Fn(Said) + 'static,
    ) -> ICoreWebView2ProcessFailedEventHandler {
        ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let (kind, what) = crate::stall::failure_of(&args);
            crate::logs::say(&app, "error", &format!("web: tab {tab}'s page {what}"));
            if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
            {
                told(Said::Crashed);
            }
            Ok(())
        }))
    }

    #[allow(
        unsafe_code,
        reason = "what a page is doing is told through WebView2's own events, reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        let logged = (app.clone(), tab.clone());
        let tell = move |said: Said| {
            let heard = Heard {
                tab: tab.clone(),
                said,
            };
            let _ = app.emit_to(window.as_str(), SAID, heard);
        };

        unsafe {
            let controller = webview.controller();
            let Ok(core) = controller.CoreWebView2() else {
                return;
            };

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

            let mut token = 0i64;
            let _ = core.add_ProcessFailed(&failing(logged, tell.clone()), &raw mut token);

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

            let told = tell.clone();
            let ended = NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                if let Some(said) = arrived(sender.as_ref(), args.as_ref()) {
                    told(said);
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_NavigationCompleted(&ended, &raw mut token);

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

    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    fn sound(core: &ICoreWebView2) -> Option<Said> {
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

    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    pub fn holds_screen(controller: &ICoreWebView2Controller) -> bool {
        unsafe { controller.CoreWebView2() }.is_ok_and(|core| filling(&core))
    }

    #[allow(unsafe_code, reason = "the engine is asked through its COM interfaces")]
    fn filling(core: &ICoreWebView2) -> bool {
        let mut on = BOOL::default();
        unsafe { core.ContainsFullScreenElement(&raw mut on).is_ok() && on.as_bool() }
    }

    #[allow(
        unsafe_code,
        reason = "the engine is reached through its COM interfaces"
    )]
    pub fn mute(view: &Webview, muted: bool) -> Result<(), String> {
        let fallback = view.clone();
        view.with_webview(move |platform| {
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

#[cfg_attr(any(windows, feature = "cef"), allow(dead_code))]
fn quieted(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    view.eval(QUIET.replace("__MUTED__", if muted { "true" } else { "false" }))
        .map_err(|error| format!("that page could not be reached: {error}"))
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
#[path = "web_page/webkit.rs"]
mod webkit;
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub use webkit::listen;

#[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(feature = "cef")]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(all(not(windows), not(feature = "cef")))]
pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    quieted(view, muted)
}

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

    #[test]
    fn a_webkit_failure_is_read_as_what_it_means() {
        assert_eq!(failure_of_error("NSURLErrorDomain", -999), None);
        assert_eq!(failure_of_error("WebKitErrorDomain", 102), None);
        assert_eq!(failure_of_error("WebKitErrorDomain", 204), None);
        for code in [-1200, -1201, -1202, -1203, -1204, -1205, -1206] {
            assert_eq!(
                failure_of_error("NSURLErrorDomain", code),
                Some(Failure::Certificate)
            );
        }
        for code in [-1001, -1004, -1005, -1011, -1017] {
            assert_eq!(
                failure_of_error("NSURLErrorDomain", code),
                Some(Failure::Unreachable)
            );
        }
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
