use serde_json::Value;
use tauri::Webview;

use super::answer::PATIENCE;

pub(crate) async fn call(view: &Webview, method: &str, params: &Value) -> Result<Value, String> {
    let (view, method, params) = (view.clone(), method.to_owned(), params.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let view = crate::agents::engines::View::Webview(view);
        crate::agents::cdp::call_in(&view, None, &method, &params, PATIENCE)
    })
    .await
    .map_err(|error| error.to_string())?
}
