//! `WebView2`: the `DevTools` Protocol's `Network.getCertificate`, which answers the
//! chain the frame of the page's origin was committed with, site first, as base64 DER.
//!
//! `WebView2` itself says nothing of a certificate that had nothing wrong with it: its
//! one certificate event, `ServerCertificateErrorDetected`, is raised for an error, and
//! with no handler for it - nib has none - the page is refused and the engine's error
//! page shown in its place. So a page that was committed over `https:` with a chain to
//! answer is one the engine found nothing wrong with, and that is what `secure` says.

use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};
use tauri::Webview;

use super::Served;

/// How long the engine is waited for.
const PATIENCE: Duration = Duration::from_secs(5);

/// The chain the page's frame was committed with, or `None` where the engine has none
/// for the page's origin.
pub async fn read(view: Webview, address: &str) -> Option<Served> {
    let origin = tauri::Url::parse(address).ok()?.origin();
    if !origin.is_tuple() {
        return None;
    }
    let asked = json!({ "origin": origin.ascii_serialization() });
    let answered = tauri::async_runtime::spawn_blocking(move || {
        let view = crate::agents::engines::View::Webview(view);
        crate::agents::cdp::call_in(&view, None, "Network.getCertificate", &asked, PATIENCE)
    })
    .await
    .ok()?
    .ok()?;
    let chain = chain(&answered);
    (!chain.is_empty()).then_some(Served {
        secure: true,
        chain,
    })
}

/// The certificates an answer names, in its order; one that is not base64 ends it.
fn chain(answered: &Value) -> Vec<Vec<u8>> {
    answered
        .get("tableNames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map_while(|one| {
            let written = one.as_str()?;
            base64::engine::general_purpose::STANDARD
                .decode(written)
                .ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::chain;

    #[test]
    fn the_protocol_s_answer_is_the_chain_in_its_order() {
        let answered = json!({ "tableNames": ["AQI=", "AwQ=", "!!", "BQY="] });
        assert_eq!(chain(&answered), [vec![1, 2], vec![3, 4]]);
        assert!(chain(&json!({})).is_empty());
    }
}
