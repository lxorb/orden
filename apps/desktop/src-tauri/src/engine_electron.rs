use std::time::Duration;

use serde_json::Value;

const SHELL_BRINGS: [&str; 1] = ["check_update"];
pub(crate) fn runtime() -> tauri_runtime_electron::Electron {
    let pipe = std::env::args()
        .find_map(|arg| arg.strip_prefix("--orden-electron-pipe=").map(str::to_owned))
        .or_else(|| std::env::var(tauri_runtime_electron::wire::PIPE_ENV).ok())
        .filter(|pipe| !pipe.is_empty());
    let Some(pipe) = pipe else {
        eprintln!(
            "Orden's core is started by its Electron shell: neither --orden-electron-pipe= nor {} names the shell's pipe",
            tauri_runtime_electron::wire::PIPE_ENV
        );
        std::process::exit(2);
    };
    tauri_runtime_electron::Electron::default().pipe(pipe)
}
pub(crate) fn kept(
    invoke: tauri::ipc::Invoke<orden_base::Engine>,
) -> Option<tauri::ipc::Invoke<orden_base::Engine>> {
    if SHELL_BRINGS.contains(&invoke.message.command()) {
        invoke.resolver.reject("the Electron shell brings its own updates");
        return None;
    }
    Some(invoke)
}
pub(crate) fn try_browser_pipe() {}
pub(crate) fn take_ui_window(
    context: &mut tauri::Context,
) -> Option<tauri::utils::config::WindowConfig> {
    let windows = &mut context.config_mut().app.windows;
    if windows.is_empty() {
        return None;
    }
    Some(windows.remove(0))
}
pub(crate) fn ui_window<'a, M: tauri::Manager<orden_base::Engine>>(
    manager: &'a M,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindowBuilder<'a, orden_base::Engine, M>, Box<dyn std::error::Error>> {
    let building =
        tauri::WebviewWindowBuilder::from_config(manager, config)?.devtools(cfg!(debug_assertions));
    #[cfg(not(any(target_os = "macos", windows)))]
    let building = building.disable_drag_drop_handler();
    orden_web::page_scale::read_chosen(manager.app_handle());
    orden_carry::kept::read_kept(manager.app_handle());
    Ok(own_window(building)
        .initialization_script(orden_carry::old_home::script())
        .initialization_script(orden_carry::old_engine::script()))
}
pub(crate) fn own_window<M: tauri::Manager<orden_base::Engine>>(
    building: tauri::WebviewWindowBuilder<'_, orden_base::Engine, M>,
) -> tauri::WebviewWindowBuilder<'_, orden_base::Engine, M> {
    building
        .initialization_script(orden_carry::kept::kept_script())
        .initialization_script(crate::window_drag::SCRIPT)
        .initialization_script(orden_web::page_drag::SCRIPT)
        .initialization_script(orden_system::gpu::SCRIPT)
        .initialization_script(orden_web::page_scale::SCRIPT)
        .initialization_script(orden_web::keyboard::PRESS_SCRIPT)
        .initialization_script(orden_web::page_scheme::SCRIPT)
}
pub(crate) fn own_profile<M: tauri::Manager<orden_base::Engine>>(
    building: tauri::WebviewWindowBuilder<'_, orden_base::Engine, M>,
) -> tauri::WebviewWindowBuilder<'_, orden_base::Engine, M> {
    building
}
pub(crate) fn zooms(
    page: orden_web::engine::Page,
    _zooms: orden_web::engine::Zooms,
) -> orden_web::engine::Page {
    page
}
pub(crate) fn hear_keys() {}
pub(crate) fn menus(
    page: orden_web::engine::Page,
    _menus: orden_web::engine::Menus,
) -> orden_web::engine::Page {
    page
}
pub(crate) fn menu_pick(_id: u64, _command: Option<i32>) -> bool {
    false
}
pub(crate) fn dialogs(
    page: orden_web::engine::Page,
    _dialogs: orden_web::engine::Dialogs,
) -> orden_web::engine::Page {
    page
}
pub(crate) fn dialog_answer(_id: u64, _ok: bool, _text: Option<String>) -> bool {
    false
}
pub(crate) fn permissions(
    page: orden_web::engine::Page,
    _permissions: orden_web::engine::Permissions,
) -> orden_web::engine::Page {
    page
}
pub(crate) fn fails(
    page: orden_web::engine::Page,
    _fails: orden_web::engine::Fails,
) -> orden_web::engine::Page {
    page
}
pub(crate) fn permission_answer(_id: u64, _allow: bool) -> bool {
    false
}
pub(crate) fn zoom(_webview: &tauri::webview::PlatformWebview) -> f64 {
    1.0
}
pub(crate) fn page_id(
    _webview: &tauri::webview::PlatformWebview,
) -> Option<orden_web_engine::NativeWindow> {
    None
}
pub(crate) fn extensions_cdp(
    _method: &str,
    _params: &Value,
    _patience: Duration,
) -> Result<Value, String> {
    Err("the Electron shell has no extensions pipe".into())
}
pub(crate) mod devtools {
    use std::time::Duration;

    use serde_json::Value;
    use tauri::Webview;

    pub fn call(
        _view: &Webview,
        _session: Option<&str>,
        _method: &str,
        _params: &Value,
        _patience: Duration,
    ) -> Result<Value, String> {
        Err("the Electron shell carries no DevTools calls yet".into())
    }
    pub fn tell(_view: &Webview, _session: Option<&str>, _said: Vec<(&'static str, Value)>) {}
    pub fn hear(
        _view: &Webview,
        _heard: impl Fn(&str, Option<&str>, &Value) + Send + Sync + 'static,
    ) -> Result<(), String> {
        Err("the Electron shell carries no DevTools calls yet".into())
    }
    pub fn let_go_of(_label: &str) {}
}
pub(crate) mod mute {
    pub(crate) fn mute(_view: &tauri::Webview, _muted: bool) -> Result<(), String> {
        Err("the Electron shell mutes its own pages".into())
    }
}
pub(crate) mod scheme {
    pub(crate) fn wear(
        _platform: &tauri::webview::PlatformWebview,
        _scheme: orden_web::page_scheme::Scheme,
    ) {
    }
}
pub(crate) mod certificate {
    pub(crate) fn served(
        _platform: &tauri::webview::PlatformWebview,
    ) -> Option<orden_web::web_certificate::Served> {
        None
    }
}
pub(crate) mod history {
    pub(crate) fn history(
        _platform: &tauri::webview::PlatformWebview,
    ) -> Option<orden_web::engine::Entries> {
        None
    }
}
pub(crate) mod renderer {
    pub(crate) fn run() {}
}
pub(crate) mod windowless {
    use std::sync::Arc;

    use orden_agent_web::quiet::{Owner, Said};
    use tauri::AppHandle;

    pub(crate) fn shared(_label: &str) -> Option<Arc<dyn orden_agent_web::engines::Windowless>> {
        None
    }
    pub fn build(
        _app: &AppHandle,
        _owner: &Owner,
        _store: Option<&str>,
        _size: (u32, u32),
        _going: Option<&str>,
    ) -> Result<(), String> {
        Err("the Electron shell makes no agent pages yet".into())
    }
    pub fn answer_dialog(_app: &AppHandle, _label: &str, _said: Said) -> Result<(), String> {
        Err("the Electron shell makes no agent pages yet".into())
    }
}
