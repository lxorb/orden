use std::path::PathBuf;

pub(crate) fn cef_runtime() -> tauri_runtime_cef::Cef {
    use orden_web_engine::{debug_port, switches, with_extensions, LOAD_EXTENSION_OFF};
    use tauri_runtime_cef::{Cef, DevToolsPolicy, RemoteDebugging, SandboxPolicy, SecretStorage};

    let sandbox = match orden_web_engine::SandboxPolicy::parse(
        &from_run("ORDEN_CEF_SANDBOX").unwrap_or_default(),
    ) {
        orden_web_engine::SandboxPolicy::Required => SandboxPolicy::Required,
        orden_web_engine::SandboxPolicy::Disabled => SandboxPolicy::Disabled,
        orden_web_engine::SandboxPolicy::Auto => SandboxPolicy::Auto,
    };
    let debugging = debug_port(from_run("ORDEN_CEF_DEBUG_PORT").as_deref()).map_or(
        RemoteDebugging::Disabled,
        |port| RemoteDebugging::Port { port, allowed_origins: Vec::new() },
    );
    let mut asked = switches(&from_run("ORDEN_CEF_ARGS").unwrap_or_default());
    let loaded = cef_root()
        .and_then(|root| Some(root.parent()?.join("extensions")))
        .map(|root| orden_extensions::extensions::library::loaded_folders(&root))
        .unwrap_or_default();
    let loading = with_extensions(&mut asked, &loaded);
    let settings = orden_web_engine::EngineSettings::default()
        .with_switches(orden_web::page_scale::switches())
        .with_switches(asked);
    let mut engine = Cef::default()
        .sandbox(sandbox)
        .deep_link_schemes(settings.deep_link_schemes.clone())
        .on_unhosted_tab(orden_extensions::extensions::tabs::opened)
        .disable_features(settings.disabled_features.clone())
        .enable_features(settings.enabled_features.clone())
        .command_line_args(settings.switches.clone())
        .devtools(DevToolsPolicy::Allowed)
        .remote_debugging(debugging)
        .browser_pipe(true);
    if cfg!(target_os = "macos") {
        engine = engine.secret_storage(SecretStorage::Mock);
    }
    if loading {
        engine = engine.disable_features([LOAD_EXTENSION_OFF]);
    }
    if let Some(root) = cef_root() {
        if root.parent().is_some_and(|config| {
            windowless_on(crate::engine::windowless::windowless_wanted(config), config)
        }) {
            engine = engine.with_settings(|settings| settings.windowless_rendering_enabled = 1);
        }
        if root.parent().is_some_and(|config| !orden_system::gpu::accelerated(config)) {
            engine = engine
                .command_line_args(orden_system::gpu::OFF.map(|switch| (switch, None::<&str>)));
        }
        engine = engine.root_cache_path(root);
    }
    engine
}
pub(crate) fn try_browser_pipe() {
    let Some(path) = from_run("ORDEN_BROWSER_PIPE_PROBE") else {
        return;
    };
    std::thread::spawn(move || {
        let said = tauri_runtime_cef::extensions_cdp(
            "Extensions.loadUnpacked",
            &serde_json::json!({ "path": path }),
            std::time::Duration::from_secs(60),
        );
        match said {
            Ok(answer) => eprintln!("browser pipe: ok {answer}"),
            Err(error) => eprintln!("browser pipe: error {error}"),
        }
    });
}
fn windowless_on(agents: bool, config: &std::path::Path) -> bool {
    agents || orden_web::inside::wanted(config)
}
fn from_run(name: &str) -> Option<String> {
    orden_web_engine::from_run(cfg!(debug_assertions), name)
}
fn cef_root() -> Option<PathBuf> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
    let identifier = option_env!("TAURI_CONFIG")
        .and_then(|said| serde_json::from_str::<serde_json::Value>(said).ok())
        .and_then(|said| said.get("identifier")?.as_str().map(str::to_owned))
        .or_else(|| config.get("identifier")?.as_str().map(str::to_owned))?;
    Some(dirs::config_dir()?.join(identifier).join(orden_web_engine::ROOT))
}
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
    let building = {
        let _ = OWN_PROFILE.set(orden_web::engine::app_profile(manager.app_handle())?);
        orden_web::page_scale::read_chosen(manager.app_handle());
        orden_carry::kept::read_kept(manager.app_handle());
        own_window(building)
    };
    Ok(building
        .initialization_script(orden_carry::old_home::script())
        .initialization_script(orden_carry::old_engine::script()))
}
pub(crate) fn own_window<M: tauri::Manager<orden_base::Engine>>(
    building: tauri::WebviewWindowBuilder<'_, orden_base::Engine, M>,
) -> tauri::WebviewWindowBuilder<'_, orden_base::Engine, M> {
    use tauri_runtime_cef::{RuntimeStyle, WebviewWindowBuilderCefExt as _};
    let building = building
        .browser_runtime_style(RuntimeStyle::Alloy)
        .initialization_script(orden_carry::kept::kept_script())
        .initialization_script(crate::window_drag::SCRIPT)
        .initialization_script(orden_web::page_drag::SCRIPT)
        .initialization_script(orden_system::gpu::SCRIPT)
        .initialization_script(orden_web::page_scale::SCRIPT)
        .initialization_script(orden_web::keyboard::PRESS_SCRIPT)
        .initialization_script(orden_web::page_scheme::SCRIPT);
    match OWN_PROFILE.get() {
        Some(profile) => building.data_directory(profile.clone()),
        None => building,
    }
}
pub(crate) fn own_profile<M: tauri::Manager<orden_base::Engine>>(
    building: tauri::WebviewWindowBuilder<'_, orden_base::Engine, M>,
) -> tauri::WebviewWindowBuilder<'_, orden_base::Engine, M> {
    use tauri_runtime_cef::{RuntimeStyle, WebviewWindowBuilderCefExt as _};
    let building = building.browser_runtime_style(RuntimeStyle::Alloy);
    match OWN_PROFILE.get() {
        Some(profile) => building.data_directory(profile.clone()),
        None => building,
    }
}
static OWN_PROFILE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
pub(crate) fn zooms(
    page: orden_web::engine::Page,
    zooms: orden_web::engine::Zooms,
) -> orden_web::engine::Page {
    use orden_web::web_page::Step;
    use tauri_runtime_cef::{WebviewBuilderCefExt as _, ZoomCommand};
    page.on_zoom_command(move |command| {
        zooms(match command {
            ZoomCommand::In => Step::In,
            ZoomCommand::Out => Step::Out,
            ZoomCommand::Reset => Step::Reset,
        });
    })
}
pub(crate) fn hear_keys() {
    tauri_runtime_cef::hear_keys(pressed, orden_web::keyboard::left);
}
fn pressed(label: &str, event: &cef::KeyEvent) -> bool {
    use cef::sys::{cef_event_flags_t as Flag, cef_key_event_type_t as Kind};
    let kind = |one: Kind| event.type_ == cef::KeyEventType::from(one);
    let held = |flag: Flag| i64::from(event.modifiers) & i64::from(flag.0) != 0;
    let Ok(vk) = u32::try_from(event.windows_key_code) else {
        return false;
    };
    let down = kind(Kind::KEYEVENT_RAWKEYDOWN) || kind(Kind::KEYEVENT_KEYDOWN);
    down && orden_web::keyboard::pressed(
        label,
        orden_web::web_keys::Press {
            vk,
            held: orden_web::web_keys::Held {
                ctrl: held(Flag::EVENTFLAG_CONTROL_DOWN),
                shift: held(Flag::EVENTFLAG_SHIFT_DOWN),
                alt: held(Flag::EVENTFLAG_ALT_DOWN),
            },
            meta: held(Flag::EVENTFLAG_COMMAND_DOWN),
            altgr: held(Flag::EVENTFLAG_ALTGR_DOWN),
            repeat: held(Flag::EVENTFLAG_IS_REPEAT),
        },
    )
}
pub(crate) fn menus(
    page: orden_web::engine::Page,
    menus: orden_web::engine::Menus,
) -> orden_web::engine::Page {
    use tauri_runtime_cef::WebviewBuilderCefExt as _;
    page.on_context_menu(move |asked| serde_json::to_value(asked).is_ok_and(&*menus))
}
pub(crate) fn menu_pick(id: u64, command: Option<i32>) -> bool {
    tauri_runtime_cef::answer_context_menu(id, command)
}
pub(crate) fn dialogs(
    page: orden_web::engine::Page,
    dialogs: orden_web::engine::Dialogs,
) -> orden_web::engine::Page {
    use tauri_runtime_cef::WebviewBuilderCefExt as _;
    page.on_js_dialog(move |said| serde_json::to_value(said).is_ok_and(&*dialogs))
}
pub(crate) fn dialog_answer(id: u64, ok: bool, text: Option<String>) -> bool {
    tauri_runtime_cef::answer_js_dialog(id, ok, text.as_deref())
}
pub(crate) fn permissions(
    page: orden_web::engine::Page,
    permissions: orden_web::engine::Permissions,
) -> orden_web::engine::Page {
    use tauri_runtime_cef::WebviewBuilderCefExt as _;
    page.on_permission_ask(move |said| serde_json::to_value(said).is_ok_and(&*permissions))
}
pub(crate) fn permission_answer(id: u64, allow: bool) -> bool {
    tauri_runtime_cef::answer_permission(id, allow)
}
pub(crate) fn zoom(webview: &tauri::webview::PlatformWebview) -> f64 {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};
    webview
        .downcast_ref::<tauri_runtime_cef::Webview>()
        .and_then(|view| view.browser().host())
        .map_or(1.0, |host| tauri_runtime_cef::zoom_factor(host.zoom_level()))
}
#[allow(
    clippy::cast_possible_truncation,
    clippy::useless_conversion,
    reason = "the engine's window handle is an X11 id, a view pointer or an HWND by platform; one number holds any of them"
)]
pub(crate) fn page_id(
    webview: &tauri::webview::PlatformWebview,
) -> Option<orden_web_engine::NativeWindow> {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};

    let handle = webview
        .downcast_ref::<tauri_runtime_cef::Webview>()
        .and_then(|view| view.browser().host())
        .map(|host| host.window_handle())?;
    #[cfg(windows)]
    let raw = handle.0 as usize as u64;
    #[cfg(not(windows))]
    let raw = handle as usize as u64;
    (raw != 0).then_some(orden_web_engine::NativeWindow(raw))
}
pub(crate) mod certificate;
pub(crate) mod devtools;
pub(crate) mod mute;
pub(crate) mod renderer;
pub(crate) mod scheme;
pub(crate) mod windowless;

#[cfg(test)]
mod tests {
    #[test]
    fn pages_drawn_inside_orden_turn_windowless_rendering_on() {
        let config = tempfile::tempdir().expect("a config folder");
        std::fs::write(config.path().join(orden_web::inside::FILE), "1\n").expect("the choice");
        assert!(super::windowless_on(false, config.path()));
    }
    #[test]
    fn a_new_window_is_handed_only_to_a_page_still_open() {
        let sources = [
            "crates/agent-web/src/quiet.rs",
            "crates/web/src/web_tabs.rs",
            "crates/extensions/src/extensions/popup.rs",
        ];
        let mut unchecked = Vec::new();
        for source in sources {
            let text = std::fs::read_to_string(crate::app_dir().join(source)).expect("a source");
            for (at, _) in text.match_indices(".SetNewWindow(") {
                let before = &text[at.saturating_sub(240)..at];
                if !before.contains("still_open(") {
                    unchecked.push(source);
                }
            }
        }
        assert!(
            unchecked.is_empty(),
            "a new window handed to a page that may have closed: {unchecked:?}"
        );
    }
    #[test]
    fn every_profile_the_engine_opens_stays_open_for_the_app_s_life() {
        let runtime =
            crate::app_dir().join("linux/tauri-runtime-cef/src/cef_impl/request_context.rs");
        let mut open = Vec::new();
        let mut checked = 0;
        for path in crate::sources().into_iter().map(|(_, path)| path).chain([runtime]) {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let text = text.split("#[cfg(test)]").next().unwrap_or_default();
            let made = text.matches("= request_context_create_context(").count()
                + text.matches("if request_context_create_context(").count();
            checked += made;
            if made > 0 && !text.contains("keep_open(") {
                open.push(path.display().to_string());
            }
        }
        assert!(checked >= 2, "no profile is opened where it was looked for");
        assert!(open.is_empty(), "a profile that closes with its last page: {open:?}");
    }
    #[test]
    fn nothing_pumps_inside_with_webview() {
        let mut inside = Vec::new();
        for (_, path) in crate::sources() {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let text = text.split("#[cfg(test)]").next().unwrap_or_default();
            for (at, _) in text.match_indices(".with_webview(") {
                let call = &text[at + ".with_webview(".len()..];
                let mut depth = 1usize;
                let end = call
                    .char_indices()
                    .find(|&(_, one)| {
                        match one {
                            '(' => depth += 1,
                            ')' => depth -= 1,
                            _ => {}
                        }
                        depth == 0
                    })
                    .map_or(call.len(), |(end, _)| end);
                let call = &call[..end];
                if call.contains("web_worlds::cleared(") || call.contains("web_worlds::sent(") {
                    inside.push(path.display().to_string());
                }
            }
        }
        assert!(inside.is_empty(), "a pump inside with_webview: {inside:?}");
    }
    #[test]
    fn every_page_made_for_the_app_s_own_use_is_hidden_as_it_is_made() {
        let shown = ["web_tabs.rs", "popup.rs"];
        let mut seen = Vec::new();
        let mut checked = 0;
        for (_, path) in crate::sources() {
            let named = path.file_name().and_then(|name| name.to_str());
            if named.is_some_and(|name| shown.contains(&name)) {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let text = text.split("#[cfg(test)]").next().unwrap_or_default();
            for (at, _) in text.match_indices("engine::add_child(") {
                checked += 1;
                let after = &text[at..text.len().min(at + 400)];
                if !after.contains(".hide()") {
                    seen.push(path.display().to_string());
                }
            }
        }
        assert!(checked >= 3, "the scan found the pages it is about ({checked})");
        assert!(seen.is_empty(), "a page of the app's own left in sight: {seen:?}");
    }
    #[test]
    fn every_window_of_an_app_page_is_in_the_interface_s_profile() {
        let mut past = Vec::new();
        for (_, path) in crate::sources() {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let text = text.split("#[cfg(test)]").next().unwrap_or_default();
            let of_the_app =
                text.contains("WebviewUrl::App(") || text.contains("WebviewUrl::default()");
            let in_it =
                text.contains("engine::own_window(") || text.contains("engine::own_profile(");
            if of_the_app && !in_it {
                past.push(path.display().to_string());
            }
        }
        assert!(past.is_empty(), "an app page outside the interface's profile: {past:?}");
    }
    #[test]
    fn the_engine_is_the_manifest_s() {
        let read =
            |path: &str| std::fs::read_to_string(crate::app_dir().join(path)).expect("a manifest");
        let linux = read("linux/Cargo.toml");
        assert!(linux.contains("\ndefault = [\"cef\"]\ncef = []\n"));
        let built = read("Cargo.toml");
        assert!(built == linux, "the desktop builds from linux/Cargo.toml");
    }
    #[test]
    fn a_feature_list_a_run_asks_for_joins_the_engine_s_own() {
        let engine =
            tauri_runtime_cef::Cef::default().command_line_args(orden_web_engine::switches(
                "disable-features=DisableLoadExtensionCommandLineSwitch,enable-features=Probe,v=1",
            ));
        let said = format!("{engine:?}");
        let switches = said.split("disabled_features").next().unwrap_or_default();
        assert!(!switches.contains("features"), "{said}");
        assert!(switches.contains(r#"("v", Some("1"))"#), "{said}");
        assert!(
            said.contains(r#"disabled_features: ["DisableLoadExtensionCommandLineSwitch"]"#),
            "{said}"
        );
        assert!(said.contains(r#"enabled_features: ["Probe"]"#), "{said}");
    }
    #[test]
    fn the_drives_build_for_debug_and_the_release_does_not() {
        let workflow = |name: &str| {
            std::fs::read_to_string(
                crate::app_dir().join(format!("../../../.github/workflows/{name}.yml")),
            )
            .expect("a workflow")
        };
        assert!(workflow("wayland").contains("scripts/linux-cef.sh tauri build --debug"));
        let release = workflow("release");
        let linux = release
            .lines()
            .find(|line| line.contains("scripts/linux-cef.sh tauri build"))
            .expect("the release's Linux build");
        assert!(!linux.contains("--debug"), "{linux}");
    }
}
