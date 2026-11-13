use tauri::Webview;

const WORLD: &str = "orden-state";

pub(crate) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
    engine::run(view, source, call).await
}

pub(crate) fn quoted(text: &str) -> Result<String, String> {
    serde_json::to_string(text).map_err(|error| error.to_string())
}

#[cfg(any(windows, feature = "cef"))]
mod engine {
    use serde_json::json;
    use tauri::Webview;

    use super::super::cdp;
    use super::WORLD;

    pub(super) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
        let tree = cdp::call(view, "Page.getFrameTree", &json!({})).await?;
        let frame = tree["frameTree"]["frame"]["id"]
            .as_str()
            .ok_or("the page has no frame to run in")?;

        let world = cdp::call(
            view,
            "Page.createIsolatedWorld",
            &json!({ "frameId": frame, "worldName": WORLD, "grantUniveralAccess": false }),
        )
        .await?;
        let context = world["executionContextId"]
            .as_i64()
            .ok_or("the page made no world to run in")?;

        let answered = cdp::call(
            view,
            "Runtime.evaluate",
            &json!({
                "expression": format!("{source}\n;{call}"),
                "contextId": context,
                "awaitPromise": true,
                "returnByValue": true,
            }),
        )
        .await?;

        if let Some(thrown) = answered.get("exceptionDetails") {
            let said = thrown["exception"]["description"]
                .as_str()
                .or_else(|| thrown["text"].as_str())
                .unwrap_or("the script failed");
            return Err(said.to_owned());
        }
        answered["result"]["value"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "the script answered nothing".to_owned())
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod engine {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentWorld, WKWebView};
    use tauri::Webview;

    use super::super::answer::{answer, Reply};
    use super::WORLD;

    #[allow(
        unsafe_code,
        reason = "WKWebView's content worlds are reached through its Objective-C interface, from the pointer wry hands out"
    )]
    pub(super) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
        let body = format!("{source}\nreturn await {call}");
        answer("a script", |reply: Reply<String>| {
            view.with_webview(move |platform| {
                let Some(mtm) = MainThreadMarker::new() else {
                    reply.say(Err("not on the window's thread".to_owned()));
                    return;
                };
                let Some(web) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) })
                else {
                    reply.say(Err("the page has gone".to_owned()));
                    return;
                };
                let world =
                    unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) };
                let answered = reply.clone();
                let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                    let said = unsafe {
                        if let Some(error) = error.as_ref() {
                            Err(error.localizedDescription().to_string())
                        } else {
                            value
                                .as_ref()
                                .and_then(|value| value.downcast_ref::<NSString>())
                                .map(ToString::to_string)
                                .ok_or_else(|| "the script answered nothing".to_owned())
                        }
                    };
                    answered.say(said);
                });
                unsafe {
                    web.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                        &NSString::from_str(&body),
                        None,
                        None,
                        &world,
                        Some(&done),
                    );
                }
            })
            .map_err(|error| error.to_string())
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::quoted;

    #[test]
    fn a_quoted_string_stays_a_string() {
        assert_eq!(
            quoted(r#"{"a":"b'c"}"#).as_deref(),
            Ok(r#""{\"a\":\"b'c\"}""#)
        );
    }
}
