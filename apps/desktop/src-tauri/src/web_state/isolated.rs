use tauri::Webview;

const WORLD: &str = "orden-state";

pub(crate) async fn run(view: &Webview, source: &str, call: &str) -> Result<String, String> {
    engine::run(view, source, call).await
}

pub(crate) fn quoted(text: &str) -> Result<String, String> {
    serde_json::to_string(text).map_err(|error| error.to_string())
}

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
