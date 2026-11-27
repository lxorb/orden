use std::path::{Path, PathBuf};

use orden_base::Held as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter as _, Manager as _};

use crate::engine::{self, Asked, Engines, Failure, Heard, Kind};
use crate::env::{Dirs, Launch};
use crate::feed;
use crate::host::{self, Status};
use crate::preset::{Orden, Preset};
use crate::proxy::{self, Answer};
use orden_ai::ai_agent::Builtin;

const BINARY_VAR: &str = "ORDEN_OPENCODE_BIN";
const GUARD: &str = "orden-shell.exe";
const ENGINE_EVENT: &str = "opencode-engine";
static DOWNLOADING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|why| why.to_string())?.join("opencode"))
}
fn engines(app: &AppHandle) -> Result<Engines, String> {
    Ok(Engines { folder: root(app)?.join("engine") })
}
fn given() -> Option<PathBuf> {
    std::env::var_os(BINARY_VAR).filter(|one| !one.is_empty()).map(PathBuf::from)
}
fn binary(app: &AppHandle) -> Result<PathBuf, Failure> {
    if let Some(given) = given() {
        return Ok(given);
    }
    engines(app)?.usable(&engine::pin().version).ok_or_else(|| {
        Failure::new(
            Kind::NotDownloaded,
            format!("OpenCode {} is not downloaded", engine::pin().version),
        )
    })
}
fn guard_beside(exe: &Path) -> Option<PathBuf> {
    exe.parent().map(|folder| folder.join(GUARD))
}
fn wrapper() -> Option<PathBuf> {
    if cfg!(windows) {
        guard_beside(&std::env::current_exe().ok()?).filter(|one| one.is_file())
    } else {
        None
    }
}
fn launch(app: &AppHandle, config: Value, preset: Preset) -> Result<Launch, Failure> {
    let engine = Builtin { id: "opencode".into(), name: "OpenCode".into(), reader_tabs: true };
    let orden = Orden {
        program: orden_ai::mcp::program::program()?,
        grant: orden_ai::ai_agent::grant_for(app, &engine)?.id,
        preset,
    };
    Ok(Launch {
        binary: binary(app)?,
        dirs: Dirs { root: root(app)? },
        config,
        auth: None,
        orden: Some(orden),
        wrapper: wrapper(),
    })
}
fn begun() -> Option<Arc<AtomicBool>> {
    let mut downloading = DOWNLOADING.held();
    if downloading.is_some() {
        return None;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *downloading = Some(cancel.clone());
    Some(cancel)
}
fn ended() {
    *DOWNLOADING.held() = None;
}
async fn fetched(
    app: &AppHandle,
    cancel: &AtomicBool,
    tell: &mut impl FnMut(Heard),
) -> Result<PathBuf, Failure> {
    let pin = engine::pin();
    let platform = engine::platform()
        .ok_or_else(|| Failure::new(Kind::Failed, "OpenCode has no build for this computer"))?;
    let sha512 = pin.sha512.get(platform).ok_or_else(|| {
        Failure::new(Kind::Failed, format!("OpenCode {} is not pinned for {platform}", pin.version))
    })?;
    let engines = engines(app)?;
    let asked = Asked {
        engines: &engines,
        registry: engine::REGISTRY,
        version: &pin.version,
        platform,
        sha512,
        bytes: pin.bytes.get(platform).copied(),
    };
    let landed = engine::download(&asked, cancel, tell).await;
    if let Err(failure) = &landed {
        tell(Heard::Failed { kind: failure.kind, detail: failure.detail.clone() });
    }
    landed
}
fn behind(app: &AppHandle) {
    let Some(cancel) = begun() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let landed = fetched(&app, &cancel, &mut |heard| {
            let _ = app.emit(ENGINE_EVENT, heard);
        })
        .await;
        ended();
        if let Ok(binary) = landed {
            host::move_to(binary);
        }
    });
}
fn kept_fresh(app: &AppHandle, launched: &Result<Launch, Failure>) {
    let Ok(engines) = engines(app) else {
        return;
    };
    let wanted = engines.binary_of(&engine::pin().version);
    let behind_the_pin = match launched {
        Ok(launch) => given().is_none() && launch.binary != wanted,
        Err(failure) => failure.kind == Kind::NotDownloaded,
    };
    if behind_the_pin && engines.background() {
        behind(app);
    }
    if let Ok(launch) = launched {
        engines.tidy(&[&wanted, &launch.binary]);
    }
}
#[derive(Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct Engine {
    version: String,
    installed: bool,
    usable: bool,
    bytes: Option<u64>,
    source: &'static str,
    background: bool,
    downloading: bool,
}
#[tauri::command(async)]
pub fn opencode_engine(webview: tauri::Webview, app: AppHandle) -> Result<Engine, Failure> {
    orden_base::labels::from_the_app(&webview)?;
    let pin = engine::pin();
    let engines = engines(&app)?;
    Ok(Engine {
        version: pin.version.clone(),
        installed: given().is_some() || engines.has(&pin.version),
        usable: given().is_some() || engines.usable(&pin.version).is_some(),
        bytes: engine::platform().and_then(|platform| pin.bytes.get(platform).copied()),
        source: engine::SOURCE,
        background: engines.background(),
        downloading: DOWNLOADING.held().is_some(),
    })
}
#[tauri::command]
pub async fn opencode_download(
    webview: tauri::Webview,
    app: AppHandle,
    events: Channel<Heard>,
) -> Result<(), Failure> {
    orden_base::labels::from_the_app(&webview)?;
    let cancel =
        begun().ok_or_else(|| Failure::new(Kind::Busy, "OpenCode is being downloaded already"))?;
    let landed = fetched(&app, &cancel, &mut |heard| {
        let _ = events.send(heard);
    })
    .await;
    ended();
    host::move_to(landed?);
    Ok(())
}
#[tauri::command(async)]
pub fn opencode_download_cancel(webview: tauri::Webview) -> Result<(), Failure> {
    orden_base::labels::from_the_app(&webview)?;
    if let Some(cancel) = DOWNLOADING.held().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command(async)]
pub fn opencode_background(
    webview: tauri::Webview,
    app: AppHandle,
    on: bool,
) -> Result<(), Failure> {
    orden_base::labels::from_the_app(&webview)?;
    engines(&app)?.set_background(on).map_err(|why| Failure::new(Kind::Failed, why.to_string()))
}
#[tauri::command]
pub async fn opencode_start(
    webview: tauri::Webview,
    app: AppHandle,
    config: Value,
    preset: Preset,
) -> Result<Status, Failure> {
    orden_base::labels::from_the_app(&webview)?;
    orden_base::lane::off_the_runtime(move || {
        let launched = launch(&app, config, preset);
        kept_fresh(&app, &launched);
        Ok(host::start(launched?)?)
    })
    .await
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
) -> Result<Status, Failure> {
    orden_base::labels::from_the_app(&webview)?;
    let launched = launch(&app, config, preset);
    kept_fresh(&app, &launched);
    Ok(host::restart(launched?))
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
    fn the_windows_guard_is_looked_for_beside_the_app() {
        assert_eq!(
            guard_beside(Path::new("C:/Program Files/Orden/orden.exe")),
            Some(PathBuf::from("C:/Program Files/Orden").join(GUARD))
        );
        let failure = Failure::new(Kind::NotDownloaded, "OpenCode 1.19.6 is not downloaded");
        assert_eq!(serde_json::to_value(failure).expect("json")["kind"], "not_downloaded");
    }
}
