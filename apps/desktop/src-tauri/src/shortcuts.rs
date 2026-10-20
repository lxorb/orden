//! Settings > AI > Access's Shortcuts row, and where a task added from Shortcuts goes.
//! The action itself is the Mac's alone (siri.rs); everywhere else these answer that
//! there is nothing to offer.

use tauri::AppHandle;

/// Whether the Shortcuts row is shown: only where Shortcuts lists nib's actions. Off
/// the window's thread, since the first answer reads the app's signature off the disk.
#[tauri::command(async)]
pub fn shortcuts_offered() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::siri::offered()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Opens the Shortcuts app, where nib's actions are.
#[tauri::command(async)]
pub fn open_shortcuts() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .args(["-b", "com.apple.shortcuts"])
            .spawn()
            .map(drop)
            .map_err(|error| format!("could not open Shortcuts: {error}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("there is no Shortcuts app here".to_owned())
    }
}

/// The page saying which note is the inbox of the space in front; see siri.rs.
#[tauri::command(async)]
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        clippy::unnecessary_wraps,
        reason = "one signature for every platform; only the Mac's Siri file can fail to be written"
    )
)]
pub fn remember_inbox(app: AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::siri::remember(&app, &path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, path);
        Ok(())
    }
}
