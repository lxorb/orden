use tauri::Window;

#[tauri::command]
pub fn show_document(
    window: Window,
    title: String,
    edited: bool,
    path: Option<String>,
) -> Result<(), String> {
    window
        .set_title(&title)
        .map_err(|error| format!("the window could not be retitled: {error}"))?;

    #[cfg(target_os = "macos")]
    mark_document(&window, edited, path.unwrap_or_default())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (edited, path);

    Ok(())
}

#[cfg(target_os = "macos")]
fn mark_document(window: &Window, edited: bool, path: String) -> Result<(), String> {
    use tauri::Manager as _;
    let on = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(handle) = on.ns_window() {
                set_document_state(handle, edited, &path);
            }
        })
        .map_err(|error| format!("the window could not be marked: {error}"))
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "Tauri hands the NSWindow over as a bare pointer, and reading one as the object is the only way to it"
)]
fn set_document_state(handle: *mut std::ffi::c_void, edited: bool, path: &str) {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::NSString;

    if handle.is_null() {
        return;
    }

    let ns_window: &NSWindow = unsafe { &*handle.cast::<NSWindow>() };
    ns_window.setDocumentEdited(edited);
    ns_window.setRepresentedFilename(&NSString::from_str(path));
}
