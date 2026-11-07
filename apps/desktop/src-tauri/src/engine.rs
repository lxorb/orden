use std::path::PathBuf;

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Runtime};

use crate::paths::{config_dir, made};

#[cfg(not(feature = "cef"))]
const ROOT: &str = "web";

#[cfg(feature = "cef")]
const ROOT: &str = "chromium";

#[cfg(feature = "cef")]
const STORE_PROFILE: &str = "store-";

#[cfg_attr(
    not(feature = "cef"),
    allow(
        dead_code,
        reason = "only Orden's own Chromium has profiles to name; the name is kept beside the layout it belongs to"
    )
)]
const APP_PROFILE: &str = "app";

#[cfg(all(not(feature = "cef"), target_os = "macos"))]
const STORE_ID: [u8; 16] = *b"nib-web-tabs\0\0\0\0";

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) const BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping,",
    "TouchpadOverscrollHistoryNavigation",
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

#[cfg_attr(not(any(test, feature = "cef")), allow(dead_code))]
pub(crate) const ENGINE_SWIPE: (&str, &str, &str) = (
    "TouchpadOverscrollHistoryNavigation",
    "overscroll-history-navigation",
    "0",
);

#[cfg(feature = "cef")]
pub(crate) fn cef_runtime() -> tauri_runtime_cef::Cef {
    use tauri_runtime_cef::{Cef, DevToolsPolicy, RemoteDebugging, SandboxPolicy};

    let sandbox = match from_run("ORDEN_CEF_SANDBOX").unwrap_or_default().as_str() {
        "required" => SandboxPolicy::Required,
        "disabled" | "off" => SandboxPolicy::Disabled,
        _ => SandboxPolicy::Auto,
    };
    let debugging = from_run("ORDEN_CEF_DEBUG_PORT")
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
        .map_or(RemoteDebugging::Disabled, |port| RemoteDebugging::Port {
            port,
            allowed_origins: Vec::new(),
        });

    let (swipe_feature, swipe_switch, swipe_off) = ENGINE_SWIPE;
    let mut asked = switches(&from_run("ORDEN_CEF_ARGS").unwrap_or_default());
    let firefox = cef_root()
        .and_then(|root| Some(root.parent()?.join("extensions")))
        .map(|root| crate::extensions::library::firefox_folders(&root))
        .unwrap_or_default();
    let loading = loaded(&mut asked, &firefox);
    let mut engine = Cef::default()
        .sandbox(sandbox)
        .deep_link_schemes(["orden", "nib"])
        .on_unhosted_tab(crate::extensions::tabs::opened)
        .disable_features([swipe_feature])
        .command_line_args([(swipe_switch, Some(swipe_off))])
        .command_line_args([(
            crate::page_scale::SWITCH.0,
            Some(crate::page_scale::SWITCH.1),
        )])
        .command_line_args(asked)
        .devtools(DevToolsPolicy::Allowed)
        .remote_debugging(debugging);
    #[cfg(target_os = "linux")]
    {
        engine = engine.enable_features([OVERLAY_BARS]);
    }
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
const LOAD_EXTENSION_OFF: &str = "DisableLoadExtensionCommandLineSwitch";

#[cfg(any(feature = "cef", test))]
fn loaded(asked: &mut Vec<(String, Option<String>)>, folders: &[PathBuf]) -> bool {
    const SWITCH: &str = "load-extension";
    let ours: Vec<String> = folders
        .iter()
        .map(|folder| folder.to_string_lossy().into_owned())
        .collect();
    if let Some((_, value)) = asked
        .iter_mut()
        .find(|(key, _)| key.trim_start_matches('-') == SWITCH)
    {
        let mut all: Vec<String> = value.iter().cloned().collect();
        all.extend(ours);
        *value = Some(all.join(","));
        return true;
    }
    if ours.is_empty() {
        return false;
    }
    asked.push((SWITCH.to_owned(), Some(ours.join(","))));
    true
}

#[cfg(feature = "cef")]
fn from_run(name: &str) -> Option<String> {
    read_by(cfg!(debug_assertions), name)
}

#[cfg(any(feature = "cef", test))]
fn read_by(drive: bool, name: &str) -> Option<String> {
    drive.then(|| std::env::var(name).ok()).flatten()
}

#[cfg(all(feature = "cef", target_os = "linux"))]
const OVERLAY_BARS: &str = "OverlayScrollbar";

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

#[cfg(any(feature = "cef", test))]
fn switches(written: &str) -> Vec<(String, Option<String>)> {
    written
        .split(',')
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(|one| match one.split_once('=') {
            Some((key, value)) => (key.to_owned(), Some(value.to_owned())),
            None => (format!("--{}", one.trim_start_matches('-')), None),
        })
        .collect()
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
thread_local! {
    static BUILDING: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static AFTER: std::cell::RefCell<Vec<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(desktop)]
pub(crate) fn one_at_a_time<T>(build: impl FnOnce() -> tauri::Result<T>) -> tauri::Result<T> {
    if BUILDING.get() > 0 {
        return Err(tauri::Error::FailedToReceiveMessage);
    }
    BUILDING.set(1);
    let made = build();
    BUILDING.set(0);
    loop {
        let waiting = AFTER.with_borrow_mut(std::mem::take);
        if waiting.is_empty() {
            break;
        }
        for one in waiting {
            one();
        }
    }
    made
}

#[cfg(desktop)]
pub(crate) fn once_built(then: impl FnOnce() + 'static) {
    if BUILDING.get() > 0 {
        AFTER.with_borrow_mut(|after| after.push(Box::new(then)));
    } else {
        then();
    }
}

#[cfg(desktop)]
thread_local! {
    static HANDED: std::cell::RefCell<Vec<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(desktop)]
macro_rules! with_platform {
    ($page:expr, $then:expr) => {
        $crate::engine::handed_out(|f| $page.with_webview(f), $then)
    };
}
#[cfg(desktop)]
pub(crate) use with_platform;

#[cfg(desktop)]
pub(crate) fn handed_out<P: 'static>(
    with_webview: impl FnOnce(Box<dyn FnOnce(P) + Send>) -> tauri::Result<()>,
    then: impl FnOnce(P) + Send + 'static,
) -> tauri::Result<()> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let caller = std::thread::current().id();
    let waiting = Arc::new(AtomicBool::new(true));
    let inside = Arc::clone(&waiting);
    let before = HANDED.with_borrow(Vec::len);
    let asked = with_webview(Box::new(move |platform| {
        if std::thread::current().id() == caller && inside.load(Ordering::Acquire) {
            HANDED.with_borrow_mut(|handed| handed.push(Box::new(move || then(platform))));
        } else {
            then(platform);
        }
    }));
    waiting.store(false, Ordering::Release);
    let handed =
        HANDED.with_borrow_mut(|handed| (handed.len() > before).then(|| handed.pop()).flatten());
    if let Some(handed) = handed {
        handed();
    }
    asked
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

pub(crate) fn internal(url: &str) -> bool {
    url.starts_with("data:") && url.contains("data-tauri-cef-internal")
}

#[cfg(feature = "cef")]
pub(crate) mod devtools;
#[cfg(feature = "cef")]
pub(crate) mod renderer;

#[cfg(test)]
mod tests {
    use super::{handed_out, internal, APP_PROFILE, ROOT};
    use std::sync::{Arc, Mutex};

    #[test]
    fn a_page_handed_inline_is_used_once_the_runtime_lets_go() {
        let lock = Arc::new(Mutex::new(()));
        let held = Arc::clone(&lock);
        let ran = Arc::new(Mutex::new(None));
        let saw = Arc::clone(&ran);
        let asked = handed_out(
            |f: Box<dyn FnOnce(u8) + Send>| {
                let _runtime = held.lock().expect("the runtime's lock");
                f(7);
                Ok(())
            },
            move |platform| {
                let free = lock.try_lock().is_ok();
                *saw.lock().expect("saw") = Some((platform, free));
            },
        );
        assert!(asked.is_ok());
        assert_eq!(*ran.lock().expect("ran"), Some((7, true)));
    }

    #[test]
    fn a_page_handed_later_is_used_where_it_is_handed() {
        let (said, heard) = std::sync::mpsc::channel();
        let elsewhere = said.clone();
        handed_out(
            |f: Box<dyn FnOnce(u8) + Send>| {
                std::thread::spawn(move || f(1));
                Ok(())
            },
            move |platform| {
                let _ = elsewhere.send((platform, std::thread::current().id()));
            },
        )
        .expect("asked");
        let (platform, on) = heard.recv().expect("handed");
        assert_eq!(platform, 1);
        assert_ne!(on, std::thread::current().id());

        let kept = Arc::new(Mutex::new(None::<Box<dyn FnOnce(u8) + Send>>));
        let keeping = Arc::clone(&kept);
        handed_out(
            move |f: Box<dyn FnOnce(u8) + Send>| {
                *keeping.lock().expect("kept") = Some(f);
                Ok(())
            },
            move |platform| {
                let _ = said.send((platform, std::thread::current().id()));
            },
        )
        .expect("asked");
        assert!(heard.try_recv().is_err(), "nothing ran yet");
        let later = kept.lock().expect("kept").take().expect("posted");
        later(2);
        assert_eq!(
            heard.try_recv().expect("handed"),
            (2, std::thread::current().id())
        );
    }

    #[cfg(desktop)]
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
    fn the_engine_s_own_first_page_is_nobody_s_address() {
        assert!(internal(concat!(
            "data:text/html;charset=utf-8,%3C!doctype%20html%3E",
            "%3Chtml%20data-tauri-cef-internal%3D%22initial-load%22%3E"
        )));
        assert!(!internal("about:blank"));
        assert!(!internal("https://example.com/?q=data-tauri-cef-internal"));
        assert!(!internal("data:text/html,<p>a page somebody made</p>"));
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

    #[test]
    fn the_command_line_reads_pairs_and_bare_keys() {
        assert_eq!(
            super::switches("enable-logging=stderr, no-sandbox ,,v=1"),
            vec![
                ("enable-logging".to_owned(), Some("stderr".to_owned())),
                ("--no-sandbox".to_owned(), None),
                ("v".to_owned(), Some("1".to_owned())),
            ]
        );
        assert_eq!(
            super::switches("--noerrdialogs"),
            vec![("--noerrdialogs".to_owned(), None)]
        );
        assert!(super::switches("").is_empty());
    }

    #[test]
    fn the_firefox_add_ons_join_what_a_run_loads() {
        use std::path::PathBuf;
        let ours = [
            PathBuf::from("/c/extensions/a/1"),
            PathBuf::from("/c/extensions/b/2"),
        ];
        let mut asked = super::switches("load-extension=/run/x,v=1");
        assert!(super::loaded(&mut asked, &ours));
        assert_eq!(
            asked[0],
            (
                "load-extension".to_owned(),
                Some("/run/x,/c/extensions/a/1,/c/extensions/b/2".to_owned())
            )
        );
        let mut none = super::switches("v=1");
        assert!(!super::loaded(&mut none, &[]));
        assert_eq!(none.len(), 1);
        assert!(super::loaded(&mut none, &ours[..1]));
        assert_eq!(
            none[1],
            (
                "load-extension".to_owned(),
                Some("/c/extensions/a/1".to_owned())
            )
        );
    }

    #[cfg(feature = "cef")]
    #[test]
    fn a_feature_list_a_run_asks_for_joins_the_engine_s_own() {
        let engine = tauri_runtime_cef::Cef::default().command_line_args(super::switches(
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
    fn a_build_that_ships_reads_nothing_from_its_environment() {
        assert_eq!(super::read_by(false, "PATH"), None);
        assert!(super::read_by(true, "PATH").is_some());
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

    #[test]
    fn the_engine_s_swipe_is_named_the_way_chromium_reads_it() {
        let (feature, switch, value) = super::ENGINE_SWIPE;
        assert_eq!(feature, "TouchpadOverscrollHistoryNavigation");
        assert_eq!(switch, "overscroll-history-navigation");
        assert_eq!(value, "0", "the history navigation that is none");
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
        let (swipe, switch, value) = super::ENGINE_SWIPE;
        assert!(
            off.contains(&swipe),
            "the engine's touchpad swipe is not off"
        );
        let wanted = format!("--{switch}={value}");
        assert!(
            super::BROWSER_ARGS
                .split_whitespace()
                .any(|one| one == wanted),
            "the engine's swipe is not switched off"
        );
    }

    #[test]
    fn a_profile_is_a_direct_child_of_the_user_data_directory() {
        assert!(!APP_PROFILE.contains('/'), "a profile is one folder name");
        assert!(!APP_PROFILE.contains('\\'));
        assert!(!ROOT.is_empty());
        assert_ne!(APP_PROFILE, ROOT, "the interface is not the whole of it");
    }

    #[cfg(feature = "cef")]
    #[test]
    fn a_store_s_profile_is_never_the_interface_s() {
        let named = format!("{}{}", super::STORE_PROFILE, "space_1");
        assert_ne!(named, APP_PROFILE);
        assert!(!named.contains('/') && !named.contains('\\'));
    }
}
