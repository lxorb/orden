use std::path::PathBuf;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager as _};

use crate::env::{Dirs, Launch};
use crate::feed;
use crate::host::{self, Status};
use crate::proxy::{self, Answer};

const BINARY_VAR: &str = "ORDEN_OPENCODE_BIN";
fn binary() -> Result<PathBuf, String> {
    if let Some(given) = std::env::var_os(BINARY_VAR).filter(|one| !one.is_empty()) {
        return Ok(PathBuf::from(given));
    }
    let here = std::env::current_exe().map_err(|why| why.to_string())?;
    let folder = here.parent().ok_or("the app has no folder")?;
    let found = folder.join(if cfg!(windows) { "opencode.exe" } else { "opencode" });
    if found.is_file() {
        Ok(found)
    } else {
        Err("OpenCode is not installed with this build".to_owned())
    }
}
fn launch(app: &AppHandle, config: Value) -> Result<Launch, String> {
    let root = app.path().app_local_data_dir().map_err(|why| why.to_string())?.join("opencode");
    Ok(Launch { binary: binary()?, dirs: Dirs { root }, config, auth: None })
}
#[tauri::command]
pub async fn opencode_start(
    webview: tauri::Webview,
    app: AppHandle,
    config: Value,
) -> Result<Status, String> {
    orden_base::labels::from_the_app(&webview)?;
    orden_base::lane::off_the_runtime(move || host::start(launch(&app, config)?)).await
}
#[tauri::command(async)]
pub fn opencode_status(webview: tauri::Webview) -> Result<Status, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(host::status())
}
#[tauri::command(async)]
pub fn opencode_restart(
    webview: tauri::Webview,
    app: AppHandle,
    config: Value,
) -> Result<Status, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(host::restart(launch(&app, config)?))
}
#[tauri::command(async)]
pub fn opencode_stop(webview: tauri::Webview) -> Result<Status, String> {
    orden_base::labels::from_the_app(&webview)?;
    host::stop_all();
    Ok(host::status())
}
#[tauri::command]
pub async fn opencode_call(
    webview: tauri::Webview,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Answer, String> {
    orden_base::labels::from_the_app(&webview)?;
    orden_base::lane::off_the_runtime(move || proxy::call(&method, &path, body.as_ref())).await
}
#[tauri::command(async)]
pub fn opencode_events_start(
    webview: tauri::Webview,
    events: Channel<Value>,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    feed::start(webview.label().to_owned(), move |event| events.send(event).is_ok());
    Ok(())
}
#[tauri::command(async)]
pub fn opencode_events_stop(webview: tauri::Webview) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    feed::stop(webview.label());
    Ok(())
}
