mod bin;
pub mod changes;
pub mod jobs;
pub mod listing;
pub mod reach;
pub mod watch;

pub fn shown(app: &tauri::AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    listing::asked(app, path, reach::Use::Look)
}
