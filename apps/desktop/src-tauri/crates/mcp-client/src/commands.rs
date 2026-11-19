use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use orden_base::lane::off_the_runtime;
use tauri::{AppHandle, Emitter as _};

use crate::hub::{Host, Hub};
use crate::import;
use crate::kept;
use crate::types::{Found, Permission, Pick, Secrets, Server, ServerView, State};

pub const EVENT: &str = "orden://mcp";
static HUB: OnceLock<Arc<Hub>> = OnceLock::new();
struct Kept(AppHandle);
impl Host for Kept {
    fn file(&self) -> Result<PathBuf, String> {
        Ok(orden_base::paths::data_dir(&self.0)?.join(kept::FILE))
    }
    fn secret(&self, name: &str) -> Result<Option<String>, String> {
        orden_secrets::secrets::secret_read(self.0.clone(), name.to_owned())
    }
    fn keep(&self, name: &str, secret: Option<&str>) -> Result<(), String> {
        match secret {
            Some(secret) => orden_secrets::secrets::secret_write(
                self.0.clone(),
                name.to_owned(),
                secret.to_owned(),
            ),
            None => orden_secrets::secrets::secret_forget(self.0.clone(), name.to_owned()),
        }
    }
    fn said(&self, id: &str, state: State) {
        let _ = self.0.emit(EVENT, serde_json::json!({ "id": id, "state": state }));
    }
}
pub fn hub(app: &AppHandle) -> Arc<Hub> {
    Arc::clone(HUB.get_or_init(|| {
        let hub = Hub::new(Kept(app.clone()));
        hub.wake_all();
        hub
    }))
}
pub fn running() -> Option<&'static Arc<Hub>> {
    HUB.get()
}
fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}
#[tauri::command]
pub async fn mcp_servers(app: AppHandle) -> Result<Vec<ServerView>, String> {
    off_the_runtime(move || hub(&app).views()).await
}
#[tauri::command]
pub async fn mcp_server_save(
    app: AppHandle,
    server: Server,
    secrets: Option<Secrets>,
) -> Result<ServerView, String> {
    off_the_runtime(move || hub(&app).save(server, secrets)).await
}
#[tauri::command]
pub async fn mcp_server_remove(app: AppHandle, id: String) -> Result<(), String> {
    off_the_runtime(move || hub(&app).remove(&id)).await
}
#[tauri::command]
pub async fn mcp_server_switch(app: AppHandle, id: String, on: bool) -> Result<ServerView, String> {
    off_the_runtime(move || hub(&app).switch(&id, on)).await
}
#[tauri::command]
pub async fn mcp_tool_permission(
    app: AppHandle,
    id: String,
    tool: String,
    permission: Permission,
) -> Result<ServerView, String> {
    off_the_runtime(move || hub(&app).permission(&id, &tool, permission)).await
}
#[tauri::command]
pub async fn mcp_server_restart(app: AppHandle, id: String) -> Result<ServerView, String> {
    off_the_runtime(move || hub(&app).restart(&id)).await
}
#[tauri::command]
pub async fn mcp_import_scan(app: AppHandle) -> Result<Vec<Found>, String> {
    off_the_runtime(move || Ok(hub(&app).scan(&import::here(), &env_var))).await
}
#[tauri::command]
pub async fn mcp_import(app: AppHandle, picks: Vec<Pick>) -> Result<Vec<ServerView>, String> {
    off_the_runtime(move || hub(&app).import(&import::here(), &env_var, &picks)).await
}
