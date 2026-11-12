use std::path::PathBuf;

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Runtime};

use crate::paths::{config_dir, made};

#[cfg(not(feature = "cef"))]
const ROOT: &str = "web";

#[cfg(feature = "cef")]
const ROOT: &str = orden_web_engine::ROOT;

#[cfg(feature = "cef")]
const STORE_PROFILE: &str = orden_web_engine::STORE_PROFILE;

#[cfg(feature = "cef")]
const APP_PROFILE: &str = orden_web_engine::APP_PROFILE;

#[cfg(all(not(feature = "cef"), target_os = "macos"))]
const STORE_ID: [u8; 16] = *b"nib-web-tabs\0\0\0\0";

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) const BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping,",
    "TouchpadOverscrollHistoryNavigation",
    " --enable-features=msOverlayScrollbarWinStyle,msOverlayScrollbarWinStyleAnimation",
    " --overscroll-history-navigation=0",
);

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) fn browser_args(_app: &AppHandle) -> String {
    if crate::gpu::this_run() {
        BROWSER_ARGS.to_owned()
    } else {
        format!("{BROWSER_ARGS} {}", crate::gpu::OFF.join(" "))
    }
}

#[cfg(feature = "cef")]
pub(crate) fn cef_runtime() -> tauri_runtime_cef::Cef {
    use orden_web_engine::{debug_port, switches, with_extensions, LOAD_EXTENSION_OFF};
    use tauri_runtime_cef::{Cef, DevToolsPolicy, RemoteDebugging, SandboxPolicy};

    let sandbox = match orden_web_engine::SandboxPolicy::parse(
        &from_run("ORDEN_CEF_SANDBOX").unwrap_or_default(),
    ) {
        orden_web_engine::SandboxPolicy::Required => SandboxPolicy::Required,
        orden_web_engine::SandboxPolicy::Disabled => SandboxPolicy::Disabled,
        orden_web_engine::SandboxPolicy::Auto => SandboxPolicy::Auto,
    };
    let debugging = debug_port(from_run("ORDEN_CEF_DEBUG_PORT").as_deref()).map_or(
        RemoteDebugging::Disabled,
        |port| RemoteDebugging::Port {
            port,
            allowed_origins: Vec::new(),
        },
    );

    let mut asked = switches(&from_run("ORDEN_CEF_ARGS").unwrap_or_default());
    let firefox = cef_root()
        .and_then(|root| Some(root.parent()?.join("extensions")))
        .map(|root| crate::extensions::library::firefox_folders(&root))
        .unwrap_or_default();
    let loading = with_extensions(&mut asked, &firefox);
    let settings = orden_web_engine::EngineSettings::default()
        .with_switches([(
            crate::page_scale::SWITCH.0.to_owned(),
            Some(crate::page_scale::SWITCH.1.to_owned()),
        )])
        .with_switches(asked);
    let mut engine = Cef::default()
        .sandbox(sandbox)
        .deep_link_schemes(settings.deep_link_schemes.clone())
        .on_unhosted_tab(crate::extensions::tabs::opened)
        .disable_features(settings.disabled_features.clone())
        .enable_features(settings.enabled_features.clone())
        .command_line_args(settings.switches.clone())
        .devtools(DevToolsPolicy::Allowed)
        .remote_debugging(debugging);
    if loading {
        engine = engine.disable_features([LOAD_EXTENSION_OFF]);
    }
    if let Some(root) = cef_root() {
        if root
            .parent()
            .is_some_and(crate::agents::engines::cef::windowless_wanted)
        {
            engine = engine.with_settings(|settings| settings.windowless_rendering_enabled = 1);
        }
        if root
            .parent()
            .is_some_and(|config| !crate::gpu::accelerated(config))
        {
            engine = engine.command_line_args(crate::gpu::OFF.map(|switch| (switch, None::<&str>)));
        }
        engine = engine.root_cache_path(root);
    }
    engine
}

#[cfg(feature = "cef")]
fn from_run(name: &str) -> Option<String> {
    orden_web_engine::from_run(cfg!(debug_assertions), name)
}

#[cfg(feature = "cef")]
fn cef_root() -> Option<PathBuf> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
    let identifier = option_env!("TAURI_CONFIG")
        .and_then(|said| serde_json::from_str::<serde_json::Value>(said).ok())
        .and_then(|said| said.get("identifier")?.as_str().map(str::to_owned))
        .or_else(|| config.get("identifier")?.as_str().map(str::to_owned))?;
    Some(dirs::config_dir()?.join(identifier).join(ROOT))
}

#[cfg(desktop)]
#[cfg_attr(
    all(not(feature = "cef"), target_os = "macos"),
    allow(
        dead_code,
        reason = "a Mac's own engine is handed a store identifier rather than a folder; the folder is what the other two desktops and Orden's own Chromium use"
    )
)]
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(ROOT);
    made(&dir)?;
    Ok(dir)
}

#[cfg(feature = "cef")]
pub(crate) fn app_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root(app)?.join(APP_PROFILE);
    made(&dir)?;
    Ok(dir)
}

#[cfg(all(desktop, not(feature = "cef")))]
#[cfg_attr(
    target_os = "macos",
    allow(
        clippy::unnecessary_wraps,
        reason = "the seam is one signature for every engine and platform; only the Windows and Linux path reaches the disk and can fail, and the caller returns Result either way"
    )
)]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<WebviewBuilder<R>, String> {
    #[cfg(windows)]
    let builder = builder
        .additional_browser_args(&browser_args(app))
        .browser_extensions_enabled(crate::extensions::in_store(store));

    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.data_directory(match store {
        None => root(app)?,
        Some(name) => {
            let dir = config_dir(app)?.join(crate::web_stores::STORES).join(name);
            made(&dir)?;
            dir
        }
    });

    #[cfg(target_os = "macos")]
    let builder = {
        let _ = app;
        builder.data_store_identifier(store.map_or(STORE_ID, crate::web_stores::identifier))
    };

    Ok(builder)
}

#[cfg(feature = "cef")]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<WebviewBuilder<R>, String> {
    Ok(builder.data_directory(profile(app, store)?))
}

#[cfg(feature = "cef")]
pub(crate) fn profile(app: &AppHandle, store: Option<&str>) -> Result<PathBuf, String> {
    let root = root(app)?;
    Ok(match store {
        None => root,
        Some(name) => {
            let dir = root.join(format!("{STORE_PROFILE}{name}"));
            made(&dir)?;
            dir
        }
    })
}

#[cfg(desktop)]
pub(crate) fn add_child<R: Runtime>(
    window: &tauri::Window<R>,
    builder: WebviewBuilder<R>,
    position: impl Into<tauri::Position>,
    size: impl Into<tauri::Size>,
) -> tauri::Result<tauri::Webview<R>> {
    #[cfg(not(feature = "cef"))]
    let built = one_at_a_time(|| window.add_child(builder, position, size));
    #[cfg(feature = "cef")]
    let built = one_at_a_time(|| window.add_child(builder.position(position).size(size)));
    #[cfg(all(windows, not(feature = "cef")))]
    if let Ok(view) = &built {
        crate::web_visual::host_page(view);
    }
    built
}

#[cfg(desktop)]
pub(crate) fn one_at_a_time<T>(build: impl FnOnce() -> tauri::Result<T>) -> tauri::Result<T> {
    orden_web_engine::one_at_a_time(|| tauri::Error::FailedToReceiveMessage, build)
}

#[cfg(desktop)]
pub(crate) use orden_web_engine::{handed_out, once_built};

#[cfg(desktop)]
macro_rules! with_platform {
    ($page:expr, $then:expr) => {
        $crate::engine::handed_out(|f| $page.with_webview(f), $then)
    };
}
#[cfg(desktop)]
pub(crate) use with_platform;

pub(crate) fn take_ui_window(
    context: &mut tauri::Context,
) -> Option<tauri::utils::config::WindowConfig> {
    let windows = &mut context.config_mut().app.windows;
    if windows.is_empty() {
        return None;
    }
    Some(windows.remove(0))
}

pub(crate) fn ui_window<'a, M: tauri::Manager<crate::Engine>>(
    manager: &'a M,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindowBuilder<'a, crate::Engine, M>, Box<dyn std::error::Error>> {
    let building =
        tauri::WebviewWindowBuilder::from_config(manager, config)?.devtools(cfg!(debug_assertions));
    #[cfg(all(windows, not(feature = "cef")))]
    if let Ok(settings) = config_dir(manager.app_handle()) {
        crate::gpu::accelerated(&settings);
    }
    #[cfg(all(windows, not(feature = "cef")))]
    let building = building
        .additional_browser_args(&browser_args(manager.app_handle()))
        .initialization_script(crate::page_scheme::SCRIPT);
    #[cfg(feature = "cef")]
    let building = {
        let _ = OWN_PROFILE.set(app_profile(manager.app_handle())?);
        crate::page_scale::read_chosen(manager.app_handle());
        crate::kept::read_kept(manager.app_handle());
        own_window(building)
    };
    Ok(building.initialization_script(crate::old_home::script()))
}

#[cfg(feature = "cef")]
pub(crate) fn own_window<M: tauri::Manager<crate::Engine>>(
    building: tauri::WebviewWindowBuilder<'_, crate::Engine, M>,
) -> tauri::WebviewWindowBuilder<'_, crate::Engine, M> {
    use tauri_runtime_cef::{RuntimeStyle, WebviewWindowBuilderCefExt as _};
    let building = building
        .browser_runtime_style(RuntimeStyle::Alloy)
        .initialization_script(crate::kept::kept_script())
        .initialization_script(crate::window_drag::SCRIPT)
        .initialization_script(crate::page_drag::SCRIPT)
        .initialization_script(crate::gpu::SCRIPT)
        .initialization_script(crate::page_scale::SCRIPT)
        .initialization_script(crate::keyboard::PRESS_SCRIPT)
        .initialization_script(crate::page_scheme::SCRIPT);
    match OWN_PROFILE.get() {
        Some(profile) => building.data_directory(profile.clone()),
        None => building,
    }
}

#[cfg(feature = "cef")]
pub(crate) fn own_profile<M: tauri::Manager<crate::Engine>>(
    building: tauri::WebviewWindowBuilder<'_, crate::Engine, M>,
) -> tauri::WebviewWindowBuilder<'_, crate::Engine, M> {
    use tauri_runtime_cef::{RuntimeStyle, WebviewWindowBuilderCefExt as _};
    let building = building.browser_runtime_style(RuntimeStyle::Alloy);
    match OWN_PROFILE.get() {
        Some(profile) => building.data_directory(profile.clone()),
        None => building,
    }
}

#[cfg(feature = "cef")]
static OWN_PROFILE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub(crate) use orden_web_engine::internal;

#[cfg(feature = "cef")]
pub(crate) mod devtools;
#[cfg(feature = "cef")]
pub(crate) mod renderer;

#[cfg(test)]
mod tests {
    #[cfg(all(windows, not(feature = "cef")))]
    use orden_web_engine::ENGINE_SWIPE;

    #[test]
    fn a_page_asked_for_while_another_is_built_waits_for_it_and_never_builds_inside_it() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let order = Rc::new(RefCell::new(Vec::new()));
        let seen = Rc::clone(&order);
        let built = super::one_at_a_time(|| {
            seen.borrow_mut().push("outer begins");
            let inner = Rc::clone(&seen);
            super::once_built(move || {
                let nested = super::one_at_a_time(|| {
                    inner.borrow_mut().push("waited");
                    Ok(())
                });
                assert!(nested.is_ok());
            });
            assert!(super::one_at_a_time(|| Ok(())).is_err());
            seen.borrow_mut().push("outer ends");
            Ok(7)
        });
        assert_eq!(built.ok(), Some(7));
        assert_eq!(*order.borrow(), ["outer begins", "outer ends", "waited"]);

        let now = Rc::new(RefCell::new(false));
        let ran = Rc::clone(&now);
        super::once_built(move || *ran.borrow_mut() = true);
        assert!(*now.borrow());
    }

    #[test]
    fn the_runtime_holds_no_lock_of_its_own_while_a_webview_is_used_built_or_let_go() {
        let runtime =
            std::fs::read_to_string(crate::app_dir().join("windows/tauri-runtime-wry/src/lib.rs"))
                .expect("the runtime's source");
        assert!(
            !runtime.contains("self.window_id.lock().unwrap(),"),
            "a webview's window id is locked for the whole of a call made with it"
        );
        assert!(
            !runtime.contains("self.context_store.lock()"),
            "a webview let go of while another is built waits on the store the build holds"
        );
    }

    #[test]
    fn the_windows_engine_gives_up_every_wait_for_webview2_in_time() {
        let folder = crate::app_dir().join("windows/wry/src/webview2");
        let mut unbounded = Vec::new();
        for entry in std::fs::read_dir(&folder)
            .expect("the engine's source")
            .flatten()
        {
            let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
            for wait in ["wait_with_pump(", "::wait_for_async_operation("] {
                let calls = text
                    .match_indices(wait)
                    .filter(|&(at, _)| {
                        let line = text[..at].rsplit('\n').next().unwrap_or_default();
                        !line.trim_start().starts_with("//")
                    })
                    .count();
                if calls > 0 {
                    unbounded.push(format!("{} {wait} x{calls}", entry.path().display()));
                }
            }
        }
        assert!(
            unbounded.is_empty(),
            "a wait for WebView2 that holds the window until it answers: {unbounded:?}"
        );
    }

    #[test]
    fn a_new_window_is_handed_only_to_a_page_still_open() {
        let sources = [
            "windows/wry/src/webview2/mod.rs",
            "src/agents/quiet.rs",
            "src/web_tabs.rs",
            "src/extensions/popup.rs",
        ];
        let mut unchecked = Vec::new();
        for source in sources {
            let text = std::fs::read_to_string(crate::app_dir().join(source)).unwrap_or_default();
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
    fn nothing_pumps_inside_with_webview() {
        let root = crate::app_dir().join("src");
        let mut sources = vec![root];
        let mut inside = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
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
        }
        assert!(inside.is_empty(), "a pump inside with_webview: {inside:?}");
    }

    #[test]
    fn every_window_of_an_app_page_is_in_the_interface_s_profile() {
        let root = crate::app_dir().join("src");
        let mut sources = vec![root.clone()];
        let mut past = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
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
        }
        assert!(
            past.is_empty(),
            "an app page outside the interface's profile: {past:?}"
        );
    }

    #[test]
    fn the_engine_is_the_manifest_s() {
        let read =
            |path: &str| std::fs::read_to_string(crate::app_dir().join(path)).expect("a manifest");
        let linux = read("linux/Cargo.toml");
        assert!(linux.contains("\ndefault = [\"cef\"]\ncef = []\n"));
        let built = read("Cargo.toml");
        assert_eq!(built == linux, cfg!(feature = "cef"));
        if !cfg!(feature = "cef") {
            assert!(built.contains("\ncef = []"), "the feature is not declared");
            assert!(
                !built.contains("\ndefault = ["),
                "the app's manifest has a default feature list, so something is on that nobody asked for"
            );
        }
    }

    #[cfg(feature = "cef")]
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

    #[cfg(all(windows, not(feature = "cef")))]
    #[test]
    fn the_engine_never_hides_the_pointer_and_keeps_wry_s_switches() {
        let features: Vec<&str> = super::BROWSER_ARGS
            .split_whitespace()
            .filter_map(|one| one.strip_prefix("--disable-features="))
            .collect();

        assert_eq!(
            features.len(),
            1,
            "one --disable-features, or all but the last are lost"
        );
        let off: Vec<&str> = features[0].split(',').collect();
        for feature in [
            "HideCursorWhileTyping",
            "msWebOOUI",
            "msPdfOOUI",
            "msSmartScreenProtection",
        ] {
            assert!(off.contains(&feature), "{feature} is not switched off");
        }
        let (swipe, switch, value) = ENGINE_SWIPE;
        assert!(
            off.contains(&swipe),
            "the engine's touchpad swipe is not off"
        );
        let on: Vec<&str> = super::BROWSER_ARGS
            .split_whitespace()
            .filter_map(|one| one.strip_prefix("--enable-features="))
            .flat_map(|one| one.split(','))
            .collect();
        assert!(
            on.contains(&"msOverlayScrollbarWinStyle"),
            "a page's scrollbars are not laid over it, so its bar runs through the pane's rounded corner"
        );
        let wanted = format!("--{switch}={value}");
        assert!(
            super::BROWSER_ARGS
                .split_whitespace()
                .any(|one| one == wanted),
            "the engine's swipe is not switched off"
        );
    }
}
