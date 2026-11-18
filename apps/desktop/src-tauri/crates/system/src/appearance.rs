use tauri::{AppHandle, Manager};

pub fn own_frame<R: tauri::Runtime, M: Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'_, R, M>,
) -> tauri::WebviewWindowBuilder<'_, R, M> {
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    builder
}

#[tauri::command]
pub fn set_frame(app: AppHandle, system: bool) -> Result<(), String> {
    for window in orden_base::labels::document_windows(&app) {
        #[cfg(target_os = "macos")]
        let changed = window.set_title_bar_style(if system {
            tauri::TitleBarStyle::Visible
        } else {
            tauri::TitleBarStyle::Overlay
        });

        #[cfg(not(target_os = "macos"))]
        let changed = window.set_decorations(system);

        changed.map_err(|error| format!("the frame could not be changed: {error}"))?;

        #[cfg(not(target_os = "macos"))]
        orden_placement::top_edge::mind(&window);

        #[cfg(target_os = "macos")]
        {
            crate::lights::refresh(&window);

            if let Some(page) = app.get_webview(window.label()) {
                orden_placement::placement::keyboard_to(&page);
            }
        }
    }

    Ok(())
}
