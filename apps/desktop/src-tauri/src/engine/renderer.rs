#![allow(clippy::transmute_ptr_to_ptr)]

use cef::*;

const MESSAGE: &str = "tauri:ipc";

const POST_MESSAGE: &str = "postMessage";

const API_VERSION_SWITCH: &str = "tauri-cef-api-version";

pub(crate) fn own_origin(address: &str) -> bool {
    tauri::Url::parse(address).is_ok_and(|url| {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none()
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

pub(crate) fn run() {
    let args = cef::args::Args::new();
    let version = told_version(std::env::args_os()).unwrap_or(sys::CEF_API_VERSION_LAST);
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

    #[test]
    fn only_the_app_s_own_origin_is_given_the_channel() {
        assert!(own_origin("http://tauri.localhost/"));
        assert!(own_origin("http://tauri.localhost/quick-add.html"));
        assert!(own_origin("http://tauri.localhost/quick-add.html?x=1#y"));
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

    #[test]
    fn the_dev_server_is_no_address_of_the_app_s() {
        assert!(!tauri::is_dev());
        assert!(!own_origin("http://localhost:1420/"));
        assert!(!own_origin("tauri://localhost/"));
    }

    #[test]
    fn a_child_declares_the_version_it_was_told_the_last_time() {
        let args = |list: &[&str]| {
            list.iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            super::told_version(args(&["orden", "--type=renderer"])),
            None
        );
        assert_eq!(
            super::told_version(args(&[
                "orden",
                "--tauri-cef-api-version=1",
                "--tauri-cef-api-version=2",
                "--tauri-cef-api-version=x",
            ])),
            Some(2)
        );
    }
}
