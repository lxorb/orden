#[cfg(target_os = "macos")]
use tauri::Manager as _;
use tauri::Webview;

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

#[tauri::command]
pub async fn open_shortcuts() -> Result<(), String> {
    crate::lane::off_the_runtime(|| -> Result<(), String> {
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
    })
    .await
}

#[tauri::command(async)]
pub fn shortcuts_added(webview: Webview) -> Result<Vec<serde_json::Value>, String> {
    crate::agents::from_the_app(&webview)?;
    #[cfg(target_os = "macos")]
    {
        crate::siri::added(webview.app_handle())?
            .into_iter()
            .map(|one| serde_json::to_value(one).map_err(|error| error.to_string()))
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command(async)]
pub fn shortcuts_added_taken(webview: Webview, id: String) -> Result<(), String> {
    crate::agents::from_the_app(&webview)?;
    #[cfg(target_os = "macos")]
    {
        crate::siri::taken(webview.app_handle(), &id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(format!("{id} is not a task Shortcuts added"))
    }
}

#[tauri::command(async)]
pub fn shortcuts_left_inbox(webview: Webview) -> Result<Option<String>, String> {
    crate::agents::from_the_app(&webview)?;
    #[cfg(target_os = "macos")]
    {
        Ok(crate::siri::left_inbox(webview.app_handle())
            .map(|path| path.to_string_lossy().into_owned()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}
