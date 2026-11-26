use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager as _};

use crate::env::{Dirs, Launch};
use crate::feed;
use crate::host::{self, Status};
use crate::preset::{Orden, Preset};
use crate::proxy::{self, Answer};
use orden_ai::ai_agent::Builtin;

const BINARY_VAR: &str = "ORDEN_OPENCODE_BIN";
const NAME: &str = if cfg!(windows) { "opencode.exe" } else { "opencode" };
fn places(exe: &Path, appdir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut all: Vec<PathBuf> = exe.parent().map(|folder| folder.join(NAME)).into_iter().collect();
    if let Some(appdir) = appdir.filter(|one| one.has_root()) {
        all.push(appdir.join("shared").join("bin").join(NAME));
    }
    all
}
fn binary() -> Result<PathBuf, String> {
    if let Some(given) = std::env::var_os(BINARY_VAR).filter(|one| !one.is_empty()) {
        return Ok(PathBuf::from(given));
    }
    let here = std::env::current_exe().map_err(|why| why.to_string())?;
    places(&here, std::env::var_os("APPDIR").map(PathBuf::from))
        .into_iter()
        .find(|one| one.is_file())
        .ok_or_else(|| "OpenCode is not installed with this build".to_owned())
}
fn launch(app: &AppHandle, config: Value, preset: Preset) -> Result<Launch, String> {
    let root = app.path().app_local_data_dir().map_err(|why| why.to_string())?.join("opencode");
    let engine = Builtin { id: "opencode".into(), name: "OpenCode".into(), reader_tabs: true };
    let orden = Orden {
        program: orden_ai::mcp::program::program()?,
        grant: orden_ai::ai_agent::grant_for(app, &engine)?.id,
        preset,
    };
    Ok(Launch { binary: binary()?, dirs: Dirs { root }, config, auth: None, orden: Some(orden) })
}
#[tauri::command]
pub async fn opencode_start(
    webview: tauri::Webview,
    app: AppHandle,
    config: Value,
    preset: Preset,
) -> Result<Status, String> {
    orden_base::labels::from_the_app(&webview)?;
    orden_base::lane::off_the_runtime(move || host::start(launch(&app, config, preset)?)).await
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
    preset: Preset,
) -> Result<Status, String> {
    orden_base::labels::from_the_app(&webview)?;
    Ok(host::restart(launch(&app, config, preset)?))
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
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_is_looked_for_beside_the_app_and_inside_an_appimage() {
        let exe = PathBuf::from("/usr/share/Orden/orden");
        assert_eq!(places(&exe, None), [PathBuf::from("/usr/share/Orden").join(NAME)]);
        let loader = PathBuf::from("/tmp/.mount_Orden/shared/lib/ld-linux-x86-64.so.2");
        assert_eq!(
            places(&loader, Some(PathBuf::from("/tmp/.mount_Orden"))),
            [
                PathBuf::from("/tmp/.mount_Orden/shared/lib").join(NAME),
                PathBuf::from("/tmp/.mount_Orden/shared/bin").join(NAME),
            ]
        );
        assert_eq!(places(&exe, Some(PathBuf::from("relative"))).len(), 1);
    }
}
