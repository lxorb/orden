use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager as _, Webview, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "orden-quick-add";

const WIDTH: f64 = 600.0;
const HEIGHT: f64 = 150.0;

const PROBE_KEY: &str = "ORDEN_QUICK_ADD_KEY";

static HOST: Mutex<Option<String>> = Mutex::new(None);

static ASKED_AT_LAUNCH: AtomicBool = AtomicBool::new(false);

fn host() -> Option<String> {
    HOST.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

fn key_allowed(asked: Option<String>, probe: Option<String>, away: bool) -> Option<String> {
    let asked = asked.filter(|key| !key.trim().is_empty())?;
    if away {
        probe.filter(|key| !key.trim().is_empty())
    } else {
        Some(asked)
    }
}

#[tauri::command]
pub fn quick_add_key(app: AppHandle, webview: Webview, key: Option<String>) -> Option<String> {
    if !crate::launch::is_document_window(webview.label()) {
        return None;
    }
    let probe = std::env::var(PROBE_KEY).ok();
    let wanted = key_allowed(key, probe, crate::placement::away().is_some());
    *HOST.lock().unwrap_or_else(PoisonError::into_inner) = Some(webview.label().to_owned());
    let held = crate::hotkeys::hold(&app, crate::hotkeys::Which::QuickAdd, wanted);
    if ASKED_AT_LAUNCH.swap(false, Ordering::Relaxed) {
        let building = app.clone();
        let _ = app.run_on_main_thread(move || bring_up(&building, None));
    }
    held
}

pub fn asked_at_launch(argv: &[std::ffi::OsString]) {
    if crate::hotkeys::Which::asked_by(argv).contains(&crate::hotkeys::Which::QuickAdd) {
        ASKED_AT_LAUNCH.store(true, Ordering::Relaxed);
    }
}

pub(crate) fn bring_up(app: &AppHandle, token: Option<String>) {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => match quick_window(app) {
            Ok(window) => {
                #[cfg(feature = "cef")]
                if let Some(id) = crate::host::window_id(&window.as_ref().window()) {
                    let _ = crate::host::system().float(id);
                }
                window
            }
            Err(_) => return,
        },
    };
    if crate::placement::away().is_none() {
        under_pointer(app, &window);
        let _ = window.show();
    }
    let _ = token;
    crate::placement::raised(&window.as_ref().window());
    crate::placement::keyboard_to(window.as_ref());
}

fn quick_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow<crate::Engine>> {
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick-add.html".into()))
        .initialization_script(crate::old_home::script())
        .title("Orden")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .disable_drag_drop_handler();

    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.additional_browser_args(&crate::engine::browser_args(app));

    #[cfg(feature = "cef")]
    let builder = builder
        .min_inner_size(WIDTH, HEIGHT)
        .max_inner_size(WIDTH, HEIGHT);

    #[cfg(feature = "cef")]
    let builder = crate::engine::own_profile(builder);

    crate::placement::built(builder)
}

fn under_pointer(app: &AppHandle, window: &tauri::WebviewWindow<crate::Engine>) {
    let Ok(pointer) = app.cursor_position() else {
        let _ = window.center();
        return;
    };
    let Ok(Some(screen)) = app.monitor_from_point(pointer.x, pointer.y) else {
        let _ = window.center();
        return;
    };
    let area = screen.work_area();
    let scale = screen.scale_factor();
    let width = WIDTH * scale;
    let x = f64::from(area.position.x) + (f64::from(area.size.width) - width) / 2.0;
    let y = f64::from(area.position.y) + f64::from(area.size.height) / 4.0;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

const TALL: f64 = 420.0;

#[tauri::command]
pub fn quick_add_tall(app: AppHandle, webview: Webview, tall: bool) {
    if webview.label() != LABEL {
        return;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let height = if tall { TALL } else { HEIGHT };
        let _ = window.set_size(tauri::LogicalSize::new(WIDTH, height));
    }
}

#[tauri::command]
pub fn quick_add_hide(app: AppHandle, webview: Webview, raise: bool) {
    if webview.label() != LABEL {
        return;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    if raise {
        if let Some(window) = host().and_then(|label| app.get_window(&label)) {
            crate::placement::raised(&window);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_holds_only_the_key_its_drive_named() {
        let asked = Some("Control+Alt+Space".to_owned());
        assert_eq!(key_allowed(asked.clone(), None, false), asked);
        assert_eq!(key_allowed(Some(String::new()), None, false), None);
        assert_eq!(key_allowed(None, None, false), None);
        assert_eq!(key_allowed(asked.clone(), None, true), None);
        let probe = Some("Control+Alt+Shift+F24".to_owned());
        assert_eq!(key_allowed(asked, probe.clone(), true), probe);
        assert_eq!(key_allowed(None, probe, true), None);
    }

    #[test]
    fn the_probe_key_is_the_id_the_probe_presses() {
        use std::str::FromStr as _;

        let key = tauri_plugin_global_shortcut::Shortcut::from_str("Control+Alt+Shift+F24");
        assert_eq!(key.map(|key| key.id()).ok(), Some(0x0209_00b7));
    }
}
