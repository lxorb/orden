#![cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod client;
pub mod commands;
pub mod exposed;
mod family;
mod http;
pub mod hub;
pub mod import;
pub mod kept;
mod rpc;
mod stdio;
mod types;

pub use client::{Client, Heard, PROTOCOL};
pub use hub::{Host, Hub};
pub use types::{
    Found, FoundServer, Offered, Permission, Pick, Secrets, Server, ServerView, State, ToolInfo,
    Transport,
};

use tauri::AppHandle;

pub fn offered(app: &AppHandle) -> Vec<Offered> {
    commands::hub(app).offered()
}
pub fn find(app: &AppHandle, exposed: &str) -> Option<Offered> {
    commands::hub(app).find(exposed)
}
pub fn call(
    app: &AppHandle,
    server: &str,
    tool: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    commands::hub(app).call(server, tool, args)
}
pub fn stop_all() {
    if let Some(hub) = commands::running() {
        hub.stop_all();
    }
}
