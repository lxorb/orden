//! What a renderer of Orden's own Chromium gives a page, in place of what
//! `tauri-runtime-cef` gives one.
//!
//! The runtime's render handler writes `window.ipc` into every V8 context of every frame:
//! a web tab's page, its frames, an extension's own pages and an extension's world. It
//! writes it read only and not configurable, and a classic script may not declare `let
//! ipc`, `const ipc` or `class ipc` at the top level while the global object carries such
//! a property: the whole script is a `SyntaxError` before its first line. Nothing in the
//! page can undo it, and neither can the sweep in `web_worlds.rs`, since `delete` answers
//! false. Google Sheets declares one, and shows "Loading issue"; see docs/web-tabs.md,
//! "What a page is given: nothing", where `WebView2`'s is the same story.
//!
//! The channel is only ever the app's: `ipc-protocol.js` calls it when its page's custom
//! protocol fails, a web tab's page has no key to call it with, and nothing Orden puts in a
//! web tab's world uses it, those speaking through `DevTools` bindings instead
//! (`web_opens.rs`, `web_swipe.rs`). So it goes where it is used and nowhere else.
//!
//! **Why this is not a patch of the runtime.** Every process CEF starts beside the app is
//! this executable with `--type=`, and `cef_helper` in lib.rs reaches it before anything
//! of Tauri starts, so the handler is the app's to choose: the runtime's own helper is a
//! dozen lines over `cef::execute_process`, repeated in `run` here. Its handler for the
//! browser process's own renderer is reached only with `--single-process`, which Orden
//! never runs. The browser's side, `on_process_message_received`, stays the runtime's:
//! it hears the message written here, so `MESSAGE` is its `IPC_MESSAGE_NAME` and the two
//! arguments are in its order. Look again when the `tauri-runtime-cef` pin moves;
//! scripts/globals-drive.py sends a command down this channel, so a drift fails there.

// The `cef` crate's `wrap_*` macros write these transmutes; nothing here does.
#![allow(clippy::transmute_ptr_to_ptr)]

use cef::*;

/// The message the runtime's browser side hears: `IPC_MESSAGE_NAME` in its `cef_impl/ipc.rs`.
const MESSAGE: &str = "tauri:ipc";

/// The one function on the channel.
const POST_MESSAGE: &str = "postMessage";

/// The switch the browser process tells a child which CEF API version to declare with:
/// `API_VERSION_SWITCH` in the runtime's `runtime.rs`, which keeps both to itself.
const API_VERSION_SWITCH: &str = "tauri-cef-api-version";

/// Where a build with no `custom-protocol` serves the app from: `devUrl` in tauri.conf.json.
const DEV_ORIGIN: &str = "http://localhost:1420";

/// Whether a frame's address is the app's own. By scheme, host and port, and only those:
/// `*.localhost` is the loopback in Chromium, so another port of the same name is whatever
/// is listening there. `tauri://localhost` is what the runtime serves where it is not
/// asked for http.
pub(crate) fn own_origin(address: &str) -> bool {
    let Ok(url) = tauri::Url::parse(address) else {
        return false;
    };
    let is = |scheme: &str, host: &str| {
        url.scheme() == scheme && url.host_str() == Some(host) && url.port().is_none()
    };
    if is("http", "tauri.localhost") || is("tauri", "localhost") {
        return true;
    }
    tauri::is_dev()
        && tauri::Url::parse(DEV_ORIGIN).is_ok_and(|dev| {
            url.scheme() == dev.scheme()
                && url.host_str() == dev.host_str()
                && url.port() == dev.port()
        })
}

wrap_v8_handler! {
    struct PostMessage;

    impl V8Handler {
        fn execute(
            &self,
            name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            retval: Option<&mut Option<V8Value>>,
            exception: Option<&mut CefString>,
        ) -> std::os::raw::c_int {
            let Some(name) = name else {
                return 0;
            };
            if name.to_string() != POST_MESSAGE {
                return 0;
            }
            let Some(message) = arguments
                .filter(|arguments| arguments.len() == 1)
                .and_then(|arguments| arguments[0].as_ref())
                .filter(|argument| argument.is_string() != 0)
            else {
                if let Some(exception) = exception {
                    *exception = CefString::from("window.ipc.postMessage expects a string argument");
                }
                return 1;
            };
            let Some(frame) = v8_context_get_current_context().and_then(|context| context.frame()) else {
                return 1;
            };
            let body = CefString::from(&message.string_value()).to_string();
            let url = CefString::from(&frame.url()).to_string();
            let mut sending = process_message_create(Some(&CefString::from(MESSAGE)));
            if let Some(args) = sending.as_ref().and_then(ProcessMessage::argument_list) {
                args.set_string(0, Some(&CefString::from(url.as_str())));
                args.set_string(1, Some(&CefString::from(body.as_str())));
                frame.send_process_message(ProcessId::BROWSER, sending.as_mut());
            }
            if let Some(retval) = retval {
                *retval = v8_value_create_undefined();
            }
            1
        }
    }
}

/// `window.ipc` in a context, as the runtime writes it.
fn install(context: &mut V8Context) {
    let Some(window) = context.global() else {
        return;
    };
    let attributes = sys::cef_v8_propertyattribute_t(
        [
            sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_READONLY,
            sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_DONTENUM,
            sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_DONTDELETE,
        ]
        .into_iter()
        .fold(0, |all, one| all | one.0),
    )
    .into();
    let Some(mut ipc) = v8_value_create_object(None, None) else {
        return;
    };
    let mut handler = PostMessage::new();
    let name = CefString::from(POST_MESSAGE);
    let Some(mut post) = v8_value_create_function(Some(&name), Some(&mut handler)) else {
        return;
    };
    ipc.set_value_bykey(Some(&name), Some(&mut post), attributes);
    window.set_value_bykey(Some(&CefString::from("ipc")), Some(&mut ipc), attributes);
}

wrap_render_process_handler! {
    struct OwnOriginOnly;

    impl RenderProcessHandler {
        fn on_context_created(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            let (Some(frame), Some(context)) = (frame, context) else {
                return;
            };
            if own_origin(&CefString::from(&frame.url()).to_string()) {
                install(context);
            }
        }
    }
}

wrap_app! {
    struct Helper;

    impl App {
        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(OwnOriginOnly::new())
        }
    }
}

/// The version a child was told to declare, the last one said: no CEF call may come first.
fn told_version(args: impl IntoIterator<Item = std::ffi::OsString>) -> Option<i32> {
    let prefix = format!("--{API_VERSION_SWITCH}=");
    args.into_iter()
        .filter_map(|arg| {
            arg.to_str()
                .and_then(|arg| arg.strip_prefix(&prefix))
                .and_then(|value| value.parse().ok())
        })
        .last()
}

/// This process as what CEF started it to be, a renderer or any other: the runtime's
/// `run_cef_helper_process` on Linux, which is the one platform on this engine, with the
/// handler above. A zygote is included: the renderers it forks keep the handler it was given.
pub(crate) fn run() {
    let args = cef::args::Args::new();
    let version = told_version(std::env::args_os()).unwrap_or(sys::CEF_API_VERSION_LAST);
    // NULL where the loaded library does not support the version, and the next CEF call
    // would crash.
    assert!(
        !cef::api_hash(version, 0).is_null(),
        "the loaded CEF library does not support CEF API version {version}"
    );
    let mut app = Helper::new();
    let _ = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
}

#[cfg(test)]
mod tests {
    use super::own_origin;

    /// The app's own page, in the shapes it is served in, and nothing that only looks like it.
    #[test]
    fn only_the_app_s_own_origin_is_given_the_channel() {
        assert!(own_origin("http://tauri.localhost/"));
        assert!(own_origin("http://tauri.localhost/quick-add.html"));
        assert!(own_origin("http://tauri.localhost/presenter.html?x=1#y"));
        assert!(own_origin("tauri://localhost/"));
        for other in [
            "https://docs.google.com/spreadsheets/d/x/edit",
            "http://tauri.localhost.evil.example/",
            "http://evil.example/?u=http://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "https://tauri.localhost/",
            "http://user@evil.example/",
            "http://ipc.localhost/",
            "http://asset.localhost/",
            "tauri://evil.example/",
            "about:blank",
            "about:srcdoc",
            "data:text/html,<p>x",
            "chrome://extensions/",
            "chrome-extension://abcdefghijklmnop/popup.html",
            "file:///tmp/a.html",
            "",
            "not a url",
        ] {
            assert!(!own_origin(other), "{other}");
        }
    }

    /// A build served by the dev server is the one place the dev server is the app.
    #[test]
    fn the_dev_server_is_the_app_only_in_a_build_that_uses_it() {
        assert_eq!(own_origin("http://localhost:1420/"), tauri::is_dev());
        assert!(!own_origin("http://localhost:1421/"));
        assert!(!own_origin("http://127.0.0.1:1420/"));
    }

    #[test]
    fn a_child_declares_the_version_it_was_told_the_last_time() {
        let args = |list: &[&str]| {
            list.iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert_eq!(super::told_version(args(&["nib", "--type=renderer"])), None);
        assert_eq!(
            super::told_version(args(&[
                "nib",
                "--tauri-cef-api-version=1",
                "--tauri-cef-api-version=2",
                "--tauri-cef-api-version=x",
            ])),
            Some(2)
        );
    }

    /// The address above is the one the config serves the app from.
    #[test]
    fn the_dev_server_named_is_the_config_s() {
        let config =
            std::fs::read_to_string(crate::app_dir().join("tauri.conf.json")).expect("the config");
        assert!(config.contains(&format!("\"devUrl\": \"{}\"", super::DEV_ORIGIN)));
    }
}
