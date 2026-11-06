use tauri::AppHandle;

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

#[tauri::command(async)]
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        clippy::unnecessary_wraps,
        reason = "a command's answer, the same on every platform"
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
