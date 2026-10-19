//! Which engine every webview in this build runs on, and which profile each of
//! them is in.
//!
//! Two builds come out of this source and they differ in one thing. macOS, Windows and
//! the phones run every webview on the system's engine - `WebView2` on Windows,
//! `WKWebView` on a Mac - which is what Tauri 2 gives without being asked. Linux runs on
//! CEF (Chromium): the same library compiled against Tauri 3 and `tauri-runtime-cef` from
//! `linux/Cargo.toml`, with the `cef` feature on, the app's interface and every web tab
//! views in one browser process, as on Windows with `WebView2`. Everything Chromium is
//! behind the feature, so the other platforms' dependency graph and lock file name no
//! CEF at all. See `cef_runtime` for how the engine is started, and packaging/linux.md
//! for what a Linux package carries.
//!
//! **The two profiles.** Chromium serves many profiles from one browser process, and an
//! extension is installed into a profile - so two profiles is what keeps an extension a
//! reader installed for the web out of nib's own interface. It is not a precaution: with
//! one profile the spike's test extension read the app's own document, in a screenshot,
//! on the first try (docs/browser.md section 9). The browsing profile is the engine's
//! *primary* one, which is where an extension installed by the command line or by
//! Chromium's policies lands, and nib's interface is the named one beside it. A space
//! that keeps its web data apart has a profile of its own too.
//!
//! ```text
//! <config>/chromium/                Chromium's user data directory, one lock on it
//! <config>/chromium/Default         the browsing profile. Cookies, logins, extensions
//! <config>/chromium/app             nib's own interface. No extensions, nothing granted
//! <config>/chromium/store-<name>    a space's or a site's own store; see web_stores.rs
//! ```
//!
//! The system's engine keeps the folder it has always used - `<config>/web`, as one
//! `WebView2` user data folder or one `WKWebView` data store - so nobody's cookies moved
//! because a second engine exists, and the two engines never read each other's files. A
//! store of its own is a folder under `<config>/web-stores`; see `web_stores.rs`.

use std::path::PathBuf;

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Runtime};

use crate::paths::{config_dir, made};

/// The folder inside the app's own settings folder that the web lives in: the
/// `WebView2` user data folder the system's engine has always used.
#[cfg(not(feature = "cef"))]
const ROOT: &str = "web";

/// And nib's own Chromium's user data directory, a folder of its own beside it: two
/// engines on one machine, each with its own profiles. A profile is a direct child of
/// it, which is the only shape CEF accepts. `cef_root` names the same place before Tauri has started.
#[cfg(feature = "cef")]
const ROOT: &str = "chromium";

/// What a store of its own is called as a Chromium profile, in front of its name.
#[cfg(feature = "cef")]
const STORE_PROFILE: &str = "store-";

/// The profile nib's own interface is in, as a folder name.
///
/// Only the `cef` feature has profiles; the name is here rather than beside its one
/// caller so that the layout in this file's comment is the layout in this file.
#[cfg_attr(
    not(feature = "cef"),
    allow(
        dead_code,
        reason = "only nib's own Chromium has profiles to name; the name is kept beside the layout it belongs to"
    )
)]
const APP_PROFILE: &str = "app";

/// The same sixteen bytes every time, so `WKWebView` hands back the store it handed
/// out last time. macOS 14 and later; older macOS has no such API and falls back to
/// the default store, which is the one case where a web tab and the app share a
/// profile on disk. Said out loud in docs/web-tabs.md rather than hidden here.
#[cfg(all(not(feature = "cef"), target_os = "macos"))]
const STORE_ID: [u8; 16] = *b"nib-web-tabs\0\0\0\0";

/// The switches every `WebView2` browser process of this app starts with: the app's own
/// page and every web tab's, in every store.
///
/// Three are wry's own defaults, written out again because passing any switches
/// replaces them: Edge's mini menu over a selection, in a page and in a PDF, and
/// `SmartScreen`. One is nib's: **`HideCursorWhileTyping` is off**. Emil, 2026-09-28:
/// *"manchmal habe ich einfach keinen mouse cursor waehrend ich im browser bin. dann
/// muss ich ihn aus dem browserfenster raus und dann wieder rein bewegen."*
///
/// The engine hides the pointer while somebody types, for Windows' *Hide pointer while
/// typing*, with `ShowCursor(FALSE)` on its own thread, and shows it again on the next
/// mouse event that same browser process receives. That is sound in a browser, which
/// is one process under one window. Here it is two or more: the app's page and the web
/// pages keep separate profiles, so separate browser processes, and every thread with a
/// window in nib's window shares one input queue and so one pointer count. Type an
/// address with the pointer resting on the page, and the app's process hides the pointer
/// over the whole window; moving it about the page reaches only the page's process,
/// which never hid it, so it stays gone until it crosses into the app's own page. The
/// same holds the other way round, and between two stores. Measured with
/// `scripts/web-cursor-probe.py`.
///
/// The engine offers no way to show a pointer another process hid, so the hiding goes:
/// the pointer stays where it was while somebody types, as it always had in nib until the
/// runtime started hiding it. One `--disable-features`, because Chromium reads only the
/// last of a repeated switch. Every webview on one user data folder must be started with
/// the same switches, which is why there is one list and not one per caller.
///
/// And **the engine's own swipe between pages is off**, both halves of it. Emil,
/// 2026-10-08 (#209): *"edge supports it for some sites while nib supports it as well
/// ... sometimes both triggers"*. nib draws the swipe itself (`web_swipe.rs`) and walks the
/// tab's own trail; the engine's walks its own history, which a tab revived after a
/// relaunch does not have, so it went on some pages and not others, and on those it went
/// as well as nib's. `IsSwipeNavigationEnabled`, which wry leaves off, is documented for a
/// finger on a screen, and did not reach two on a touchpad: that is Chromium's
/// `TouchpadOverscrollHistoryNavigation`, and `--overscroll-history-navigation=0` turns
/// the whole of it off, touchpad and screen alike, whichever of the two a runtime reads.
/// See [`ENGINE_SWIPE`].
#[cfg(all(windows, not(feature = "cef")))]
pub(crate) const BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping,",
    "TouchpadOverscrollHistoryNavigation",
    " --overscroll-history-navigation=0",
);

/// Chromium's own swipe between pages, which both of Windows' engines would run beside
/// nib's: the feature that is its touchpad half, and the switch, with its value, that is
/// the whole of it. Written into [`BROWSER_ARGS`] for `WebView2` and handed to nib's own
/// Chromium as it starts (`cef_runtime`); a test holds
/// the first to these names.
#[cfg_attr(not(any(test, feature = "cef")), allow(dead_code))]
pub(crate) const ENGINE_SWIPE: (&str, &str, &str) = (
    "TouchpadOverscrollHistoryNavigation",
    "overscroll-history-navigation",
    "0",
);

/// The engine Linux runs on, configured before anything of it starts: CEF, with
/// Chromium's user data directory in the app's own settings folder (see this file's
/// comment), `nib://` links heard by the browser process when a second launch carries
/// one, and the engine's own swipe off so only nib's runs ([`ENGINE_SWIPE`]).
///
/// What a run can ask for through its environment, for the drives and for somebody
/// chasing a crash, none of it read by a launch that sets nothing:
///
/// - `NIB_CEF_ARGS`: switches for Chromium, `key=value` or a bare key, split on commas,
///   such as `enable-logging=stderr,v=1`.
/// - `NIB_CEF_DEBUG_PORT`: the `DevTools` protocol on that local port, for a drive.
/// - `NIB_CEF_SANDBOX`: `disabled` for a container that cannot give Chromium a sandbox,
///   `required` to refuse to start without one. Kept wherever it can be otherwise.
#[cfg(feature = "cef")]
pub(crate) fn cef_runtime() -> tauri_runtime_cef::Cef {
    use tauri_runtime_cef::{Cef, DevToolsPolicy, RemoteDebugging, SandboxPolicy};

    let sandbox = match std::env::var("NIB_CEF_SANDBOX")
        .unwrap_or_default()
        .as_str()
    {
        "required" => SandboxPolicy::Required,
        "disabled" | "off" => SandboxPolicy::Disabled,
        _ => SandboxPolicy::Auto,
    };
    let debugging = std::env::var("NIB_CEF_DEBUG_PORT")
        .ok()
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
        .map_or(RemoteDebugging::Disabled, |port| RemoteDebugging::Port {
            port,
            allowed_origins: Vec::new(),
        });

    let (swipe_feature, swipe_switch, swipe_off) = ENGINE_SWIPE;
    let mut engine = Cef::default()
        .sandbox(sandbox)
        .deep_link_schemes(["nib"])
        .disable_features([swipe_feature])
        .command_line_args([(swipe_switch, Some(swipe_off))])
        .command_line_args(switches(&std::env::var("NIB_CEF_ARGS").unwrap_or_default()))
        // A web tab's developer tools in the build that ships, as in a browser; nib's own
        // window turns its own off outside a development build (`ui_window`).
        .devtools(DevToolsPolicy::Allowed)
        .remote_debugging(debugging);
    if let Some(root) = cef_root() {
        // An agent's own tab is a browser with no window, which CEF can make only when
        // the whole process started able to; see agents/engines/cef.rs.
        if root
            .parent()
            .is_some_and(crate::agents::engines::cef::windowless_wanted)
        {
            engine = engine.with_settings(|settings| settings.windowless_rendering_enabled = 1);
        }
        engine = engine.root_cache_path(root);
    }
    engine
}

/// Chromium's user data directory before Tauri has started, so before `config_dir` can
/// be asked: the same `<config>/<identifier>/chromium` that [`root`] answers once it has.
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

/// Chromium switches as `NIB_CEF_ARGS` writes them: `key=value` or a bare key, split on
/// commas. A bare key keeps or gains its two dashes, which is how CEF tells a switch from
/// an argument.
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

/// The folder the web's own storage lives in, made if it is not there yet.
#[cfg(desktop)]
#[cfg_attr(
    all(not(feature = "cef"), target_os = "macos"),
    allow(
        dead_code,
        reason = "a Mac's own engine is handed a store identifier rather than a folder; the folder is what the other two desktops and nib's own Chromium use"
    )
)]
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(ROOT);
    made(&dir)?;
    Ok(dir)
}

/// Where nib's own interface keeps what a webview keeps.
///
/// A profile of its own, so an extension installed for the web cannot reach the
/// app's own document: an extension is installed into a profile, and this is not
/// that profile.
#[cfg(feature = "cef")]
pub(crate) fn app_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root(app)?.join(APP_PROFILE);
    made(&dir)?;
    Ok(dir)
}

/// Where a web tab's site data goes, on the engine this build runs on.
///
/// **This is the seam.** One call for every engine, so `web_tabs.rs` says where a
/// page's storage goes once rather than once per platform per engine, and so the
/// answer for nib's own Chromium is in the module that knows about engines.
///
/// `store` is the store the tab was asked to be in, already checked by
/// `web_stores::named`: `None` for the one every space shares, a name for a space or a
/// site that keeps its own. See `web_stores.rs`.
///
/// - The system's engine: for the shared store, the folder the app has always used,
///   as a user data folder on Windows and Linux and as a data store identifier on a
///   Mac, unchanged to the byte from what shipped. For a store of its own, a folder of
///   its own under `web-stores`, or sixteen bytes of its own on a Mac.
/// - nib's own Chromium: nothing, deliberately, and for every store. A web tab is in
///   the engine's primary profile, which is where an extension installed by the
///   command line or by policy lands, and nib's own interface is the named profile
///   beside it; see this file's comment. A space that asks for a store of its own
///   shares that one there, until the runtime can be asked for a profile per tab.
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
    // Extensions run in every store a reader's tab can be in and in none of an agent's.
    // An environment option, and every page on one data folder must be built with the
    // same options, which is why it is decided here, by store, and nowhere else. See
    // extensions.rs.
    #[cfg(windows)]
    let builder = builder
        .additional_browser_args(BROWSER_ARGS)
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

/// Where a web tab's site data goes on nib's own Chromium: the engine's primary
/// profile for the store every space shares - asked for as the user data directory
/// itself, which is how the runtime is told "the primary one" rather than a profile named
/// after it - and a profile of its own beside it for a store of its own. See above.
#[cfg(feature = "cef")]
pub(crate) fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<WebviewBuilder<R>, String> {
    Ok(builder.data_directory(profile(app, store)?))
}

/// The folder a store's profile is on nib's own Chromium: the user data directory itself
/// for the store every space shares, which is how the engine is told "the primary
/// profile", and a profile of its own beside it for a store of its own. An agent's page
/// is put in a store's profile by this folder too (agents/engines/cef.rs).
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

/// Puts a webview built by `builder` into `window`, at `position` and `size`: a web
/// tab's page, and every other page that lives inside the app's window.
///
/// The one call both Tauris spell differently - Tauri 2 takes the place beside the
/// builder, Tauri 3 on it - so every caller says it once, here.
#[cfg(desktop)]
pub(crate) fn add_child<R: Runtime>(
    window: &tauri::Window<R>,
    builder: WebviewBuilder<R>,
    position: impl Into<tauri::Position>,
    size: impl Into<tauri::Size>,
) -> tauri::Result<tauri::Webview<R>> {
    #[cfg(not(feature = "cef"))]
    {
        window.add_child(builder, position, size)
    }
    #[cfg(feature = "cef")]
    {
        window.add_child(builder.position(position).size(size))
    }
}

/// The window the config describes, taken out of it so it is built by our own code
/// instead. The config keeps saying what the window looks like; only who builds it
/// changes.
///
/// One reason per engine, and the same mechanism for both. Orden's own Chromium needs
/// the interface in a profile of its own, and a profile is asked for when a webview is
/// built. The system's webview needs the window on screen before the webview inside it
/// exists, and a window the runtime builds cannot be: it is built around its webview,
/// so nothing is visible until the webview runtime has started - between a third and
/// half of a launch on Windows. Either way a window in `tauri.conf.json` is built
/// before any of our own code runs, and this is what takes that over.
pub(crate) fn take_ui_window(
    context: &mut tauri::Context,
) -> Option<tauri::utils::config::WindowConfig> {
    let windows = &mut context.config_mut().app.windows;
    if windows.is_empty() {
        return None;
    }
    Some(windows.remove(0))
}

/// The builder of nib's own window, on the engine this build runs on: everything the
/// window needs from the engine, and nothing about where it goes or when it shows,
/// which is the same on both and is `ready`'s in lib.rs.
///
/// - The system's engine: developer tools in a development build only, as nib's own
///   window always had, and the switches every page of this app starts with; see
///   [`BROWSER_ARGS`].
/// - nib's own Chromium: the interface in a profile of its own, so an extension
///   installed for the web cannot reach the app's own document; see this file's comment.
pub(crate) fn ui_window<'a, M: tauri::Manager<crate::Engine>>(
    manager: &'a M,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindowBuilder<'a, crate::Engine, M>, Box<dyn std::error::Error>> {
    let building =
        tauri::WebviewWindowBuilder::from_config(manager, config)?.devtools(cfg!(debug_assertions));
    #[cfg(all(windows, not(feature = "cef")))]
    let building = building.additional_browser_args(BROWSER_ARGS);
    // On CEF, Alloy style: a page and nothing of Chrome's around it, as `WebView2` and
    // `WKWebView` are. A Chrome style browser keeps Chrome's whole accelerator table,
    // which takes Ctrl+Tab, Ctrl+W, Ctrl+T and Ctrl+N before the page is offered them -
    // the interface's own chords - and the runtime then swallows them, since the window
    // has no tab strip for Chrome to act on. A web tab is Chrome style, for the browser's
    // own pages and extensions; see web_tabs.rs.
    #[cfg(feature = "cef")]
    let building = own_window(building, manager.app_handle());
    Ok(building)
}

/// What every window of the app's own is on CEF, the first and every one after it: its
/// page in the interface's own profile, Alloy style (see `ui_window`), and the window
/// moved and resized by the page's own presses, which never reach GTK (`window_drag.rs`).
///
/// A profile folder that cannot be made leaves the page in the engine's own, said in the
/// log, rather than the window not opening at all.
#[cfg(feature = "cef")]
pub(crate) fn own_window<'a, M: tauri::Manager<crate::Engine>>(
    building: tauri::WebviewWindowBuilder<'a, crate::Engine, M>,
    app: &AppHandle,
) -> tauri::WebviewWindowBuilder<'a, crate::Engine, M> {
    use tauri_runtime_cef::{RuntimeStyle, WebviewWindowBuilderCefExt as _};
    let building = building
        .browser_runtime_style(RuntimeStyle::Alloy)
        .initialization_script(crate::window_drag::SCRIPT);
    match app_profile(app) {
        Ok(profile) => building.data_directory(profile),
        Err(error) => {
            crate::logs::say(app, "error", &format!("the window's profile: {error}"));
            building
        }
    }
}

/// Whether a page is one the engine loads for itself rather than one a tab was sent to.
///
/// `tauri-runtime-cef` builds every browser on an inert document of its own - a `data:`
/// page marked `data-tauri-cef-internal`, titled "Tauri CEF Initial Load" - and only then
/// sends it where it was asked to go. It hides that page's address from the address
/// event and from nobody else: its load and its title arrive like any page's, and a web
/// tab took them for its own - one came back from a relaunch named after that page, at
/// that page. The system's engine has no such page, so nothing is one there.
pub(crate) fn internal(url: &str) -> bool {
    url.starts_with("data:") && url.contains("data-tauri-cef-internal")
}

#[cfg(feature = "cef")]
pub(crate) mod devtools;

#[cfg(test)]
mod tests {
    use super::{internal, APP_PROFILE, ROOT};

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

    /// The engine is chosen by the manifest a build is made from and by nothing else:
    /// the app's own has no default features, so macOS, Windows and the phones are on
    /// the system's engine, and Linux's has `cef` on by default, so every Linux build -
    /// a plain `cargo build`, the Tauri CLI's and every runner's - is on CEF.
    #[test]
    fn the_engine_is_the_manifest_s() {
        let read =
            |path: &str| std::fs::read_to_string(crate::app_dir().join(path)).expect("a manifest");
        let linux = read("linux/Cargo.toml");
        assert!(linux.contains("\ndefault = [\"cef\"]\ncef = []\n"));
        // The manifest built from is Linux's on Linux and the app's everywhere else.
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

    /// `NIB_CEF_ARGS` reads pairs and bare keys, and a bare key keeps two dashes.
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

    /// The engine's own swipe is named the way Chromium reads it, and handed over the way
    /// both runtimes take a switch with a value: without its dashes.
    #[test]
    fn the_engine_s_swipe_is_named_the_way_chromium_reads_it() {
        let (feature, switch, value) = super::ENGINE_SWIPE;
        assert_eq!(feature, "TouchpadOverscrollHistoryNavigation");
        assert_eq!(switch, "overscroll-history-navigation");
        assert_eq!(value, "0", "the history navigation that is none");
    }

    /// The pointer is never hidden by one browser process where another one has it,
    /// wry's own three switches survive being replaced - all in the one
    /// `--disable-features`, because Chromium reads only the last of a repeated switch -
    /// and the engine's own swipe is off.
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

    /// A profile is a direct child of the user data directory, which is the only
    /// shape CEF accepts: it refuses anything deeper, and anything outside it is
    /// turned into a hashed folder name nobody chose.
    #[test]
    fn a_profile_is_a_direct_child_of_the_user_data_directory() {
        assert!(!APP_PROFILE.contains('/'), "a profile is one folder name");
        assert!(!APP_PROFILE.contains('\\'));
        assert!(!ROOT.is_empty());
        assert_ne!(APP_PROFILE, ROOT, "the interface is not the whole of it");
    }

    /// A store of its own is a profile beside nib's interface and never the interface:
    /// a store is named `space_` or `site_` something, and the interface is `app`.
    #[cfg(feature = "cef")]
    #[test]
    fn a_store_s_profile_is_never_the_interface_s() {
        let named = format!("{}{}", super::STORE_PROFILE, "space_1");
        assert_ne!(named, APP_PROFILE);
        assert!(!named.contains('/') && !named.contains('\\'));
    }
}
