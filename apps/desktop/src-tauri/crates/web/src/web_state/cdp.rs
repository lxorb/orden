use serde_json::Value;
use tauri::Webview;

use super::PATIENCE;

pub async fn call(view: &Webview, method: &str, params: &Value) -> Result<Value, String> {
    let (view, method, params) = (view.clone(), method.to_owned(), params.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::engine::devtools::call(&view, None, &method, &params, PATIENCE)
    })
    .await
    .map_err(|error| error.to_string())?
}
