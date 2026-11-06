//! A Firefox add-on, made into an extension Chromium runs (#1155).
//!
//! What addons.mozilla.org hands out is a Manifest V2 add-on nearly every time, or a
//! Firefox Manifest V3 one, and Chromium runs neither: it has dropped Manifest V2, and a
//! Firefox background is a page where Chromium's is a service worker. So the add-on's
//! files are kept as they are and around them:
//!
//! - the manifest is written again as Chromium's Manifest V3 (`translate`): Firefox's own
//!   keys gone, `browser_action` and `page_action` as `action`, `menus` as `contextMenus`,
//!   host patterns out of `permissions`, the shortcuts and patterns Chromium would refuse
//!   to load left out, an SVG picture (which Chromium cannot draw) left out;
//! - the background page runs as an offscreen document, with its document, and calls the
//!   API through a service worker of Orden's (firefox/host.js, firefox/bridge.js);
//! - every context - the background, every page, every content script - has `browser`
//!   with promises, the `WebExtension` polyfill's (firefox/browser-polyfill.js, MPL-2.0),
//!   and before it the Firefox-only API Orden emulates (firefox/firefox.js);
//! - and the add-on's id is the same on every computer and every version: a key made from
//!   its AMO id is written into the manifest, as a CRX's own key is (manifest.rs).
//!
//! What it uses that the layer cannot run is read off the manifest and its scripts
//! (`gaps`), for the reader to see before it is installed.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest as _, Sha256};

/// The folder inside the add-on the layer's own files are written into.
const FOLDER: &str = "orden";

/// The layer's scripts, as each context loads them.
const FIREFOX_JS: &str = include_str!("firefox/firefox.js");
const POLYFILL_JS: &str = include_str!("firefox/browser-polyfill.js");
const BRIDGE_JS: &str = include_str!("firefox/bridge.js");
const HOST_JS: &str = include_str!("firefox/host.js");

/// What every page loads first, and what the background page loads before that.
const PAGE_SCRIPTS: &str = r#"<script src="/orden/firefox.js"></script><script src="/orden/browser-polyfill.js"></script>"#;
const BACKGROUND_SCRIPTS: &str = r#"<script src="/orden/bridge.js"></script><script src="/orden/firefox.js"></script><script src="/orden/browser-polyfill.js"></script>"#;

/// The background page Orden writes for an add-on that names only its scripts.
const BACKGROUND_PAGE: &str = "orden/background.html";

/// The Firefox an add-on is told it runs in, `runtime.getBrowserInfo`: an ESR, which is
/// what an add-on is most surely written for.
const FIREFOX_VERSION: &str = "140.0";

/// The most bytes of script read for `gaps`.
const MOST_READ: u64 = 64 * 1024 * 1024;

/// How Chromium is handed the key: an Ed25519 `SubjectPublicKeyInfo`'s first twelve bytes,
/// before the thirty-two of the key. Chromium checks nothing of an unpacked extension's key
/// but its hash, which is the id.
const ED25519_SPKI: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

/// What of an add-on Orden cannot run, said before it is installed.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gaps {
    /// What the window says in a sentence of its own: `blocking`, `containers`, `sidebar`,
    /// `hiddenTabs`.
    pub said: Vec<String>,
    /// The other Firefox-only parts of the API it calls, by name.
    pub apis: Vec<String>,
}

impl Gaps {
    /// Whether all of it runs.
    pub fn is_empty(&self) -> bool {
        self.said.is_empty() && self.apis.is_empty()
    }

    fn say(&mut self, what: &str) {
        if !self.said.iter().any(|one| one == what) {
            self.said.push(what.to_owned());
        }
    }

    fn api(&mut self, what: &str) {
        if !self.apis.iter().any(|one| one == what) {
            self.apis.push(what.to_owned());
        }
    }
}

/// The id an add-on has in Orden, and the key that gives it that id, out of its AMO id.
pub fn id_and_key(guid: &str) -> (String, String) {
    let seed = Sha256::digest(format!("orden firefox add-on\0{guid}"));
    let mut key = ED25519_SPKI.to_vec();
    key.extend_from_slice(&seed);
    let id = super::link::id_of(&Sha256::digest(&key)[..16]);
    (id, base64::engine::general_purpose::STANDARD.encode(&key))
}

/// Where an add-on's background runs from.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Background {
    /// A page of its own, at this path.
    Page(String),
    /// Scripts Orden writes a page round, as a module or not.
    Scripts(Vec<String>, bool),
    /// A service worker already, at this path, as a module or not.
    Worker(String, bool),
}

/// A Firefox manifest, as Chromium's.
#[derive(Debug)]
pub struct Translated {
    pub manifest: Value,
    /// What the layer's scripts are told about the add-on; see firefox.js.
    pub layer: Value,
    pub gaps: Gaps,
    background: Option<Background>,
}

/// `firefox`, as a Manifest V3 extension with `key` as its key.
pub fn translate(firefox: &Value, key: &str) -> Translated {
    let empty = Map::new();
    let source = firefox.as_object().unwrap_or(&empty);
    let mut out = Map::new();
    let mut gaps = Gaps::default();
    let mut layer = Map::new();
    layer.insert("firefox".into(), json!(FIREFOX_VERSION));

    for (field, value) in source {
        if !TAKEN.contains(&field.as_str()) && !DROPPED.contains(&field.as_str()) {
            out.insert(field.clone(), value.clone());
        }
    }
    out.insert("manifest_version".into(), json!(3));
    out.insert("key".into(), json!(key));

    let version = source.get("version").and_then(Value::as_str).unwrap_or("0");
    let chromium = chromium_version(version);
    if chromium != version && !source.contains_key("version_name") {
        out.insert("version_name".into(), json!(version));
    }
    out.insert("version".into(), json!(chromium));

    if let Some(icons) = source.get("icons").and_then(drawable) {
        if let Some(icon) = largest(&icons) {
            layer.insert("icon".into(), json!(icon));
        }
        out.insert("icons".into(), icons);
    }
    pages_of(source, &mut out, &mut layer, &mut gaps);

    let background = background_of(source.get("background"));
    permissions_of(source, background.as_ref(), &mut out, &mut gaps);
    match &background {
        Some(Background::Page(page)) => {
            layer.insert("background".into(), json!(page));
            out.insert(
                "background".into(),
                json!({ "service_worker": "orden/host.js" }),
            );
        }
        Some(Background::Scripts(scripts, _)) => {
            layer.insert("background".into(), json!(BACKGROUND_PAGE));
            layer.insert("scripts".into(), json!(scripts));
            out.insert(
                "background".into(),
                json!({ "service_worker": "orden/host.js" }),
            );
        }
        Some(Background::Worker(_, module)) => {
            let mut worker = Map::new();
            worker.insert("service_worker".into(), json!("orden/worker.js"));
            if *module {
                worker.insert("type".into(), json!("module"));
            }
            out.insert("background".into(), Value::Object(worker));
        }
        None => {}
    }

    if let Some(scripts) = source.get("content_scripts").and_then(Value::as_array) {
        let scripts: Vec<Value> = scripts.iter().filter_map(content_script).collect();
        if !scripts.is_empty() {
            out.insert("content_scripts".into(), Value::Array(scripts));
        }
    }
    if let Some(resources) = source
        .get("web_accessible_resources")
        .and_then(Value::as_array)
    {
        let resources = accessible(resources);
        if !resources.is_empty() {
            out.insert("web_accessible_resources".into(), Value::Array(resources));
        }
    }
    if let Some(policy) = source.get("content_security_policy") {
        let said = match policy {
            Value::String(one) => one.as_str(),
            other => other
                .get("extension_pages")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        };
        // Chromium's own for a Manifest V3 extension, which forbids what a Firefox add-on
        // could allow itself; only WebAssembly is kept, which it allows when asked.
        if said.contains("'wasm-unsafe-eval'") {
            out.insert(
                "content_security_policy".into(),
                json!({ "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }),
            );
        }
    }
    if let Some(commands) = source.get("commands").and_then(Value::as_object) {
        out.insert("commands".into(), Value::Object(shortcuts(commands)));
    }

    Translated {
        manifest: Value::Object(out),
        layer: Value::Object(layer),
        gaps,
        background,
    }
}

/// The button, the options page and the sidebar.
fn pages_of(
    source: &Map<String, Value>,
    out: &mut Map<String, Value>,
    layer: &mut Map<String, Value>,
    gaps: &mut Gaps,
) {
    // Firefox MV3's `action`, else the browser action, else the page action.
    let browser_action = source
        .get("action")
        .or_else(|| source.get("browser_action"));
    let page_action = source.get("page_action");
    if let Some(action) = browser_action.or(page_action) {
        out.insert("action".into(), button(action));
        if browser_action.is_none() {
            layer.insert("pageAction".into(), json!("action"));
        } else if page_action.is_some() {
            gaps.api("pageAction");
        }
    }

    if let Some(options) = source.get("options_ui").and_then(Value::as_object) {
        let mut kept = Map::new();
        if let Some(page) = options.get("page").and_then(Value::as_str) {
            kept.insert("page".into(), json!(relative(page)));
        }
        if let Some(open) = options.get("open_in_tab") {
            kept.insert("open_in_tab".into(), open.clone());
        }
        out.insert("options_ui".into(), Value::Object(kept));
    }

    if let Some(sidebar) = source.get("sidebar_action").and_then(Value::as_object) {
        if let Some(panel) = sidebar.get("default_panel").and_then(Value::as_str) {
            layer.insert("sidebar".into(), json!(relative(panel)));
        }
        if let Some(title) = sidebar.get("default_title").and_then(Value::as_str) {
            layer.insert("sidebarTitle".into(), json!(title));
        }
        gaps.say("sidebar");
    }
}

/// What it may do: names for the engine, patterns for the hosts, and what the layer needs.
fn permissions_of(
    source: &Map<String, Value>,
    background: Option<&Background>,
    out: &mut Map<String, Value>,
    gaps: &mut Gaps,
) {
    let (mut permissions, mut hosts) = split(source.get("permissions"), gaps);
    let (optional, mut optional_hosts) = split(source.get("optional_permissions"), gaps);
    hosts.extend(patterns(source.get("host_permissions")));
    optional_hosts.extend(patterns(source.get("optional_host_permissions")));
    let mut layered = vec!["scripting", "storage"];
    if matches!(
        background,
        Some(Background::Page(_) | Background::Scripts(..))
    ) {
        layered.push("offscreen");
    }
    for one in layered {
        if !permissions.iter().any(|held| held == one) {
            permissions.push(one.to_owned());
        }
    }
    let optional: Vec<String> = optional
        .into_iter()
        .filter(|one| !permissions.contains(one) && !NEVER_OPTIONAL.contains(&one.as_str()))
        .collect();
    out.insert("permissions".into(), json!(permissions));
    if !hosts.is_empty() {
        out.insert("host_permissions".into(), json!(unique(hosts)));
    }
    if !optional.is_empty() {
        out.insert("optional_permissions".into(), json!(optional));
    }
    if !optional_hosts.is_empty() {
        out.insert(
            "optional_host_permissions".into(),
            json!(unique(optional_hosts)),
        );
    }
}

/// The keys `translate` writes itself.
const TAKEN: [&str; 18] = [
    "manifest_version",
    "key",
    "version",
    "icons",
    "action",
    "browser_action",
    "page_action",
    "options_ui",
    "sidebar_action",
    "permissions",
    "optional_permissions",
    "host_permissions",
    "optional_host_permissions",
    "background",
    "content_scripts",
    "web_accessible_resources",
    "content_security_policy",
    "commands",
];

/// Firefox's own keys, and the few Chromium would refuse to load in the shape Firefox
/// writes them.
const DROPPED: [&str; 12] = [
    "browser_specific_settings",
    "applications",
    "developer",
    "author",
    "protocol_handlers",
    "user_scripts",
    "theme",
    "theme_experiment",
    "dictionaries",
    "l10n_resources",
    "hidden",
    "chrome_settings_overrides",
];

/// What only Firefox has permissions for, and what a Firefox one is called in Chromium.
const ONLY_FIREFOX: [&str; 19] = [
    "contextualIdentities",
    "menus.overrideContext",
    "theme",
    "find",
    "dns",
    "pkcs11",
    "tabHide",
    "webRequestBlocking",
    "webRequestFilterResponse",
    "webRequestFilterResponse.serviceWorkerScript",
    "browserSettings",
    "captivePortal",
    "geckoProfiler",
    "telemetry",
    "normandyAddonStudy",
    "networkStatus",
    "urlbar",
    "mozillaAddons",
    "trialML",
];

/// What Chromium will not have asked for later, which Firefox will.
const NEVER_OPTIONAL: [&str; 9] = [
    "debugger",
    "declarativeNetRequest",
    "devtools",
    "geolocation",
    "mdns",
    "proxy",
    "tts",
    "ttsEngine",
    "wallpaper",
];

/// A permissions list, split into the engine's names and the hosts' patterns; what it
/// says of a gap is written down.
fn split(list: Option<&Value>, gaps: &mut Gaps) -> (Vec<String>, Vec<String>) {
    let mut names = Vec::new();
    let mut hosts = Vec::new();
    for one in list
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        match one {
            "webRequestBlocking" => gaps.say("blocking"),
            "contextualIdentities" => gaps.say("containers"),
            "tabHide" => gaps.say("hiddenTabs"),
            "dns" | "pkcs11" | "menus.overrideContext" | "browserSettings" | "captivePortal" => {
                gaps.api(one);
            }
            _ => {}
        }
        if one == "<all_urls>" || one.contains("://") {
            if pattern(one) {
                hosts.push(one.to_owned());
            }
            continue;
        }
        if ONLY_FIREFOX.contains(&one) {
            continue;
        }
        let name = if one == "menus" { "contextMenus" } else { one };
        if !names.iter().any(|held| held == name) {
            names.push(name.to_owned());
        }
    }
    (names, hosts)
}

/// The patterns of a list Chromium would take.
fn patterns(list: Option<&Value>) -> Vec<String> {
    list.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|one| pattern(one))
        .map(str::to_owned)
        .collect()
}

fn unique(mut list: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    list.retain(|one| seen.insert(one.clone()));
    list
}

/// Whether Chromium reads a match pattern as one: `<all_urls>`, or a scheme it knows, a
/// host that is `*`, `*.` a name or a name, and a path. Firefox takes more, such as
/// `moz-extension://`, which Chromium would refuse the whole add-on for.
fn pattern(said: &str) -> bool {
    if said == "<all_urls>" {
        return true;
    }
    let Some((scheme, rest)) = said.split_once("://") else {
        return false;
    };
    if !["*", "http", "https", "ws", "wss", "ftp", "file", "urn"].contains(&scheme) {
        return false;
    }
    let Some(slash) = rest.find('/') else {
        return false;
    };
    let host = &rest[..slash];
    if scheme == "file" {
        return host.is_empty();
    }
    let name = host.strip_prefix("*.").unwrap_or(host);
    !host.is_empty() && (host == "*" || !name.contains('*'))
}

/// The background a manifest names.
fn background_of(background: Option<&Value>) -> Option<Background> {
    let background = background?.as_object()?;
    let module = background.get("type").and_then(Value::as_str) == Some("module");
    if let Some(page) = background.get("page").and_then(Value::as_str) {
        return Some(Background::Page(relative(page)));
    }
    let scripts: Vec<String> = background
        .get("scripts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(relative)
        .collect();
    if !scripts.is_empty() {
        return Some(Background::Scripts(scripts, module));
    }
    background
        .get("service_worker")
        .and_then(Value::as_str)
        .map(|worker| Background::Worker(relative(worker), module))
}

/// A path inside the add-on as Chromium's manifest writes it: no `/` or `./` in front.
fn relative(path: &str) -> String {
    let mut path = path.trim();
    loop {
        if let Some(rest) = path.strip_prefix("./") {
            path = rest;
        } else if let Some(rest) = path.strip_prefix('/') {
            path = rest;
        } else {
            return path.to_owned();
        }
    }
}

/// Whether a picture is one Chromium draws: not an SVG.
fn draws(path: &str) -> bool {
    let file = path.split('#').next().unwrap_or_default();
    !file.is_empty()
        && !Path::new(file)
            .extension()
            .is_some_and(|one| one.eq_ignore_ascii_case("svg"))
}

/// A picture or a map of pictures, without what Chromium cannot draw; `None` when that
/// leaves nothing.
fn drawable(icons: &Value) -> Option<Value> {
    match icons {
        Value::String(path) => draws(path).then(|| json!(relative(path))),
        Value::Object(sizes) => {
            let kept: Map<String, Value> = sizes
                .iter()
                .filter(|(size, _)| size.parse::<u32>().is_ok())
                .filter_map(|(size, path)| {
                    let path = path.as_str()?;
                    draws(path).then(|| (size.clone(), json!(relative(path))))
                })
                .collect();
            (!kept.is_empty()).then_some(Value::Object(kept))
        }
        _ => None,
    }
}

/// The largest picture of a map, or the one picture.
fn largest(icons: &Value) -> Option<String> {
    match icons {
        Value::String(path) => Some(path.clone()),
        Value::Object(sizes) => sizes
            .iter()
            .filter_map(|(size, path)| Some((size.parse::<u32>().ok()?, path.as_str()?)))
            .max_by_key(|(size, _)| *size)
            .map(|(_, path)| path.to_owned()),
        _ => None,
    }
}

/// A browser or page action, as Chromium's `action`.
fn button(action: &Value) -> Value {
    let mut out = Map::new();
    if let Some(popup) = action.get("default_popup").and_then(Value::as_str) {
        out.insert("default_popup".into(), json!(relative(popup)));
    }
    if let Some(title) = action.get("default_title") {
        out.insert("default_title".into(), title.clone());
    }
    if let Some(icon) = action.get("default_icon").and_then(drawable) {
        out.insert("default_icon".into(), icon);
    }
    Value::Object(out)
}

/// A content script, run with the layer's scripts first; `None` for one that matches
/// nothing Chromium can match.
fn content_script(script: &Value) -> Option<Value> {
    let mut out = script.as_object()?.clone();
    out.remove("cookieStoreId");
    let matches = patterns(script.get("matches"));
    if matches.is_empty() {
        return None;
    }
    out.insert("matches".into(), json!(matches));
    if script.get("exclude_matches").is_some() {
        out.insert(
            "exclude_matches".into(),
            json!(patterns(script.get("exclude_matches"))),
        );
    }
    let files = |field: &str| -> Vec<String> {
        script
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(relative)
            .collect()
    };
    let mut js = files("js");
    if !js.is_empty() && script.get("world").and_then(Value::as_str) != Some("MAIN") {
        js.splice(
            0..0,
            [
                format!("{FOLDER}/firefox.js"),
                format!("{FOLDER}/browser-polyfill.js"),
            ],
        );
    }
    if !js.is_empty() {
        out.insert("js".into(), json!(js));
    }
    let css = files("css");
    if !css.is_empty() {
        out.insert("css".into(), json!(css));
    }
    Some(Value::Object(out))
}

/// Manifest V2's list of what a page may load, as V3's: every page, by pattern.
fn accessible(resources: &[Value]) -> Vec<Value> {
    let plain: Vec<String> = resources
        .iter()
        .filter_map(Value::as_str)
        .map(relative)
        .collect();
    let mut out: Vec<Value> = resources
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|one| {
            let mut one = one.clone();
            let listed: Vec<String> = one
                .get("resources")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(relative)
                .collect();
            let matches = patterns(one.get("matches"));
            if listed.is_empty() || (matches.is_empty() && one.get("extension_ids").is_none()) {
                return None;
            }
            one.insert("resources".into(), json!(listed));
            if one.get("matches").is_some() {
                one.insert("matches".into(), json!(matches));
            }
            Some(Value::Object(one))
        })
        .collect();
    if !plain.is_empty() {
        out.insert(0, json!({ "resources": plain, "matches": ["<all_urls>"] }));
    }
    out
}

/// What Chromium takes of `commands`: the button's own under its V3 name, a description
/// for each, and only the shortcuts it would load - at most four.
fn shortcuts(commands: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    let mut bound = 0;
    let mut ordered: Vec<(&String, &Value)> = commands.iter().collect();
    // The button's own first, so it keeps its shortcut when there are more than four.
    ordered.sort_by_key(|(name, _)| !name.starts_with("_execute_"));
    for (name, command) in ordered {
        let name = match name.as_str() {
            "_execute_browser_action" | "_execute_page_action" | "_execute_action" => {
                "_execute_action"
            }
            other if other.starts_with('_') => continue,
            other => other,
        };
        if out.contains_key(name) {
            continue;
        }
        let mut kept = Map::new();
        let description = command
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or(name);
        if name != "_execute_action" {
            kept.insert("description".into(), json!(description));
        }
        if let Some(keys) = command.get("suggested_key").and_then(Value::as_object) {
            let keys: Map<String, Value> = keys
                .iter()
                .filter(|(platform, key)| {
                    key.as_str()
                        .is_some_and(|key| shortcut(key, platform.as_str() == "mac"))
                        && ["default", "windows", "mac", "linux", "chromeos"]
                            .contains(&platform.as_str())
                })
                .map(|(platform, key)| (platform.clone(), key.clone()))
                .collect();
            if !keys.is_empty() && bound < 4 {
                bound += 1;
                kept.insert("suggested_key".into(), Value::Object(keys));
            }
        }
        out.insert(name.to_owned(), Value::Object(kept));
    }
    out
}

/// Whether Chromium takes a shortcut: Ctrl or Alt (or a Mac's Command or Control), maybe
/// Shift, never Ctrl with Alt, and one key it knows; a media key alone.
fn shortcut(said: &str, mac: bool) -> bool {
    const MEDIA: [&str; 4] = [
        "MediaNextTrack",
        "MediaPlayPause",
        "MediaPrevTrack",
        "MediaStop",
    ];
    const KEYS: [&str; 13] = [
        "Comma", "Period", "Home", "End", "PageUp", "PageDown", "Space", "Insert", "Delete", "Up",
        "Down", "Left", "Right",
    ];
    let parts: Vec<&str> = said.split('+').map(str::trim).collect();
    let Some((key, modifiers)) = parts.split_last() else {
        return false;
    };
    if MEDIA.contains(key) {
        return modifiers.is_empty();
    }
    let known_key = (key.len() == 1 && key.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        || KEYS.contains(key);
    if !known_key {
        return false;
    }
    let mut seen = std::collections::HashSet::new();
    let fine = modifiers.iter().all(|one| {
        seen.insert(*one)
            && match *one {
                "Ctrl" | "Alt" | "Shift" => true,
                "Command" | "MacCtrl" => mac,
                _ => false,
            }
    });
    let main = ["Ctrl", "Alt", "Command", "MacCtrl"]
        .iter()
        .any(|one| seen.contains(one));
    fine && main && !(seen.contains("Ctrl") && seen.contains("Alt"))
}

/// A Firefox version as Chromium's: up to four numbers. Firefox allows letters after a
/// number (`1.0b2`, `3.0pre`); such a version keeps its first three numbers and a fourth
/// of its own, so no two versions share a folder.
pub fn chromium_version(version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    let number = |part: &str| -> Option<u32> {
        (!part.is_empty() && part.len() <= 5 && part.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| part.parse::<u32>().ok())
            .flatten()
            .filter(|one| *one <= 65_535)
    };
    if parts.len() <= 4 && parts.iter().all(|part| number(part).is_some()) {
        return parts
            .iter()
            .filter_map(|part| number(part))
            .map(|one| one.to_string())
            .collect::<Vec<_>>()
            .join(".");
    }
    let leading = |part: &str| -> u32 {
        let digits: String = part
            .chars()
            .take_while(char::is_ascii_digit)
            .take(5)
            .collect();
        digits.parse::<u32>().unwrap_or(0).min(65_535)
    };
    let mut numbers: Vec<u32> = parts.iter().take(3).map(|part| leading(part)).collect();
    numbers.resize(3, 0);
    let hash = Sha256::digest(version.as_bytes());
    let own = 1 + u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]) % 65_000;
    numbers.push(own);
    numbers
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".")
}

/// Makes the add-on unpacked in `folder`, whose AMO id is `guid`, one Chromium runs:
/// its manifest written again, the layer's files beside it and in every page. Answers
/// what of it will not run, which is also written down for its row.
pub fn apply(folder: &Path, guid: &str) -> Result<Gaps, String> {
    let path = folder.join("manifest.json");
    let text = fs::read_to_string(&path).map_err(|_| "that add-on has no manifest".to_string())?;
    let firefox: Value = serde_json::from_str(&uncommented(&text))
        .map_err(|_| "that add-on's manifest cannot be read".to_string())?;
    let (_, key) = id_and_key(guid);
    let mut translated = translate(&firefox, &key);
    named_plainly(&mut translated.manifest);
    // What `runtime.getManifest` answers: the add-on's own, which it reads for its
    // Firefox names (`browser_action`) and its own version.
    let mut own = firefox.clone();
    named_plainly(&mut own);
    if let Some(layer) = translated.layer.as_object_mut() {
        layer.insert("manifest".into(), own);
    }
    locales(folder)?;
    if let Some(Background::Page(page)) = &translated.background {
        let scripts = page_scripts(folder, page);
        if let Some(layer) = translated.layer.as_object_mut() {
            layer.insert("scripts".into(), json!(scripts));
        }
    }

    let layer_dir = folder.join(FOLDER);
    fs::create_dir_all(&layer_dir).map_err(|error| error.to_string())?;
    let told = format!("globalThis.__ordenLayer = {};\n", translated.layer);
    let write = |name: &str, text: &str| {
        fs::write(layer_dir.join(name), text).map_err(|error| error.to_string())
    };
    write("firefox.js", &format!("{told}{FIREFOX_JS}"))?;
    write("browser-polyfill.js", POLYFILL_JS)?;
    write("bridge.js", BRIDGE_JS)?;
    write("host.js", HOST_JS)?;

    let mut background_page = None;
    match &translated.background {
        Some(Background::Page(page)) => background_page = Some(folder.join(page)),
        Some(Background::Scripts(scripts, module)) => {
            let kind = if *module { r#" type="module""# } else { "" };
            let tags = scripts.iter().fold(String::new(), |mut tags, one| {
                let _ = write!(tags, r#"<script{kind} src="/{one}"></script>"#);
                tags
            });
            write(
                "background.html",
                &format!(
                    "<!doctype html><html><head><meta charset=\"utf-8\">{BACKGROUND_SCRIPTS}</head><body>{tags}</body></html>\n"
                ),
            )?;
        }
        Some(Background::Worker(worker, module)) => {
            let text = if *module {
                format!("import '/orden/firefox.js'\nimport '/orden/browser-polyfill.js'\nimport '/{worker}'\n")
            } else {
                format!("importScripts('/orden/firefox.js', '/orden/browser-polyfill.js', '/{worker}')\n")
            };
            write("worker.js", &text)?;
        }
        None => {}
    }

    for page in pages(folder) {
        let Ok(html) = fs::read_to_string(&page) else {
            continue;
        };
        let first = if background_page.as_deref() == Some(page.as_path()) {
            BACKGROUND_SCRIPTS
        } else {
            PAGE_SCRIPTS
        };
        fs::write(&page, headed(&html, first)).map_err(|error| error.to_string())?;
    }

    let mut gaps = translated.gaps;
    read_for_gaps(folder, &mut gaps);
    let written =
        serde_json::to_string_pretty(&translated.manifest).map_err(|error| error.to_string())?;
    fs::write(&path, written).map_err(|error| error.to_string())?;
    write(
        "gaps.json",
        &serde_json::to_string(&gaps).map_err(|error| error.to_string())?,
    )?;
    Ok(gaps)
}

/// A manifest as Firefox reads one: a line that starts with `//` is a comment.
fn uncommented(text: &str) -> String {
    text.trim_start_matches('\u{feff}')
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A message's name as Chromium takes one: letters, digits, `_` and `@`. Firefox takes a
/// `-` too, and Chromium refuses to load an add-on whose words have one. The layer looks
/// a name up the same way (firefox.js).
pub fn message_name(name: &str) -> String {
    name.chars()
        .map(|one| {
            if one.is_ascii_alphanumeric() || one == '_' || one == '@' {
                one
            } else {
                '_'
            }
        })
        .collect()
}

/// Every `__MSG_name__` in the manifest, with its name as Chromium takes one.
fn named_plainly(value: &mut Value) {
    match value {
        Value::String(text) if text.contains("__MSG_") => {
            let mut out = String::new();
            let mut rest = text.as_str();
            while let Some(at) = rest.find("__MSG_") {
                out.push_str(&rest[..at + 6]);
                rest = &rest[at + 6..];
                if let Some(end) = rest.find("__") {
                    out.push_str(&message_name(&rest[..end]));
                    rest = &rest[end..];
                }
            }
            out.push_str(rest);
            *text = out;
        }
        Value::Array(all) => all.iter_mut().for_each(named_plainly),
        Value::Object(all) => all.values_mut().for_each(named_plainly),
        _ => {}
    }
}

/// The add-on's words, each language's held to what Chromium loads, which is less than
/// Firefox does: every name as Chromium takes one, a message's and a placeholder's with
/// the places it is used; a place no placeholder is defined for left empty, as Firefox
/// leaves it; and a message with no words, or a language that cannot be read at all, left
/// out - Chromium refuses the whole add-on for any of them.
fn locales(folder: &Path) -> Result<(), String> {
    let Ok(languages) = fs::read_dir(folder.join("_locales")) else {
        return Ok(());
    };
    for language in languages.flatten() {
        let path = language.path().join("messages.json");
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(Value::Object(messages)) = serde_json::from_str::<Value>(&uncommented(&text)) else {
            let _ = fs::remove_dir_all(language.path());
            continue;
        };
        let mut out = Map::new();
        for (name, entry) in messages {
            let Some(message) = entry.get("message").and_then(Value::as_str) else {
                continue;
            };
            let mut message = message.to_owned();
            let mut entry = entry.clone();
            let mut defined = Vec::new();
            if let Some(held) = entry
                .get("placeholders")
                .and_then(Value::as_object)
                .cloned()
            {
                let mut renamed = Map::new();
                for (place, content) in held {
                    let plain = message_name(&place);
                    if plain != place {
                        message = replace_ignoring_case(
                            &message,
                            &format!("${place}$"),
                            &format!("${plain}$"),
                        );
                    }
                    defined.push(plain.to_ascii_lowercase());
                    renamed.insert(plain, content);
                }
                entry["placeholders"] = Value::Object(renamed);
            }
            entry["message"] = json!(undefined_left_out(&message, &defined));
            out.entry(message_name(&name)).or_insert(entry);
        }
        let written = serde_json::to_string(&out).map_err(|error| error.to_string())?;
        fs::write(&path, written).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// A message without the `$name$` places no placeholder of `defined` is for.
fn undefined_left_out(message: &str, defined: &[String]) -> String {
    let mut out = String::new();
    let mut rest = message;
    while let Some(at) = rest.find('$') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        let name_end = after
            .find(|one: char| !(one.is_ascii_alphanumeric() || one == '_' || one == '@'))
            .unwrap_or(after.len());
        let name = &after[..name_end];
        let place = !name.is_empty()
            && !name.bytes().all(|byte| byte.is_ascii_digit())
            && after[name_end..].starts_with('$');
        if place && !defined.contains(&name.to_ascii_lowercase()) {
            rest = &after[name_end + 1..];
        } else {
            out.push('$');
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// `text` with every `from`, in any case, as `to`.
fn replace_ignoring_case(text: &str, from: &str, to: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let from = from.to_ascii_lowercase();
    let mut out = String::new();
    let mut at = 0;
    while let Some(found) = lower[at..].find(&from) {
        out.push_str(&text[at..at + found]);
        out.push_str(to);
        at += found + from.len();
    }
    out.push_str(&text[at..]);
    out
}

/// What an installed add-on's folder says will not run of it; nothing for any other
/// extension.
pub fn gaps_in(folder: &Path) -> Option<Gaps> {
    #[derive(serde::Deserialize)]
    struct Said {
        said: Vec<String>,
        apis: Vec<String>,
    }
    let text = fs::read_to_string(folder.join(FOLDER).join("gaps.json")).ok()?;
    let said: Said = serde_json::from_str(&text).ok()?;
    Some(Gaps {
        said: said.said,
        apis: said.apis,
    })
}

/// `html` with `first` as the first thing its head runs.
fn headed(html: &str, first: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let after = |tag: &str| -> Option<usize> {
        let mut from = 0;
        while let Some(at) = lower[from..].find(tag) {
            let at = from + at;
            let next = lower.as_bytes().get(at + tag.len()).copied();
            if matches!(next, Some(b'>' | b' ' | b'\t' | b'\n' | b'\r' | b'/')) {
                return lower[at..].find('>').map(|end| at + end + 1);
            }
            from = at + tag.len();
        }
        None
    };
    let at = after("<head")
        .or_else(|| after("<html"))
        .or_else(|| after("<!doctype"))
        .unwrap_or(0);
    format!("{}{first}{}", &html[..at], &html[at..])
}

/// The scripts a background page loads, in order, as paths inside the add-on: what its
/// service worker runs where the engine has no offscreen documents.
fn page_scripts(folder: &Path, page: &str) -> Vec<String> {
    let Ok(html) = fs::read_to_string(folder.join(page)) else {
        return Vec::new();
    };
    let base: Vec<&str> = page.split('/').collect();
    let base = &base[..base.len().saturating_sub(1)];
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find("<script") {
        let at = from + at;
        let Some(end) = lower[at..].find('>').map(|end| at + end) else {
            break;
        };
        let tag = &html[at..end];
        from = end;
        let Some(src) = attribute(tag, "src") else {
            continue;
        };
        if src.contains(':') {
            continue;
        }
        let mut parts: Vec<&str> = if src.starts_with('/') {
            Vec::new()
        } else {
            base.to_vec()
        };
        for part in src.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                one => parts.push(one),
            }
        }
        out.push(parts.join("/"));
    }
    out
}

/// An attribute's value in a tag, quoted or not.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(name) {
        let at = from + at;
        from = at + name.len();
        let before = lower.as_bytes().get(at.wrapping_sub(1)).copied();
        if !matches!(before, Some(b' ' | b'\t' | b'\n' | b'\r')) {
            continue;
        }
        let rest = tag[at + name.len()..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let value = match rest.chars().next()? {
            quote @ ('"' | '\'') => rest[1..].split(quote).next()?.to_owned(),
            _ => rest
                .split(|one: char| one.is_whitespace() || one == '>')
                .next()?
                .to_owned(),
        };
        return Some(value);
    }
    None
}

/// Every page in the add-on but the layer's own.
fn pages(folder: &Path) -> Vec<PathBuf> {
    files(folder)
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|one| one.to_str())
                .is_some_and(|one| {
                    one.eq_ignore_ascii_case("html") || one.eq_ignore_ascii_case("htm")
                })
        })
        .collect()
}

/// Every file in the add-on, outside the layer's folder.
fn files(folder: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut waiting = vec![folder.to_path_buf()];
    while let Some(dir) = waiting.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                if dir != folder || entry.file_name() != FOLDER {
                    waiting.push(path);
                }
            } else if kind.is_file() {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// What the add-on's scripts call that the layer cannot run, by a word each is called by.
const CALLS: [(&str, Gap); 14] = [
    (
        "filterResponseData",
        Gap::Api("webRequest.filterResponseData"),
    ),
    ("contextualIdentities", Gap::Said("containers")),
    ("cookieStoreId", Gap::Said("containers")),
    ("sidebarAction", Gap::Said("sidebar")),
    ("tabs.hide", Gap::Said("hiddenTabs")),
    ("dns.resolve", Gap::Api("dns")),
    ("pkcs11", Gap::Api("pkcs11")),
    ("proxy.onRequest", Gap::Api("proxy.onRequest")),
    ("theme.update", Gap::Api("theme.update")),
    ("overrideContext", Gap::Api("menus.overrideContext")),
    ("browserSettings", Gap::Api("browserSettings")),
    ("captivePortal", Gap::Api("captivePortal")),
    ("toggleReaderMode", Gap::Api("tabs.toggleReaderMode")),
    ("geckoProfiler", Gap::Api("geckoProfiler")),
];

#[derive(Clone, Copy)]
enum Gap {
    Said(&'static str),
    Api(&'static str),
}

/// What the scripts in `folder` call of `CALLS`.
fn read_for_gaps(folder: &Path, gaps: &mut Gaps) {
    let mut read = 0u64;
    for path in files(folder) {
        let script = path
            .extension()
            .and_then(|one| one.to_str())
            .is_some_and(|one| matches!(one, "js" | "mjs" | "html" | "htm"));
        if !script {
            continue;
        }
        let size = fs::metadata(&path).map_or(0, |one| one.len());
        if read + size > MOST_READ {
            break;
        }
        read += size;
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let text = String::from_utf8_lossy(&bytes);
        for (word, gap) in CALLS {
            if text.contains(word) {
                match gap {
                    Gap::Said(said) => gaps.say(said),
                    Gap::Api(api) => gaps.api(api),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{chromium_version, headed, id_and_key, pattern, shortcut, translate};

    /// An add-on as AMO hands out most of them: Manifest V2, a background page, a browser
    /// action with an SVG picture, Firefox's own keys and permissions.
    #[test]
    fn a_manifest_v2_add_on_becomes_a_manifest_v3_extension() {
        let firefox = json!({
            "manifest_version": 2,
            "name": "__MSG_name__",
            "version": "8.4.0",
            "default_locale": "en",
            "browser_specific_settings": { "gecko": { "id": "@testpilot-containers" } },
            "icons": { "48": "img/icon.svg", "96": "img/icon-96.png" },
            "background": { "page": "/js/background/index.html" },
            "browser_action": {
                "browser_style": true,
                "default_icon": "img/icon.svg",
                "default_popup": "/popup.html",
                "default_area": "navbar",
                "theme_icons": [],
            },
            "page_action": { "default_popup": "pageActionPopup.html" },
            "options_ui": { "page": "options.html", "browser_style": true },
            "permissions": ["<all_urls>", "menus", "contextualIdentities", "storage", "webRequestBlocking", "webRequest", "moz-extension://*/*"],
            "optional_permissions": ["bookmarks", "*://*/*"],
            "web_accessible_resources": ["/img/icon.svg"],
            "content_scripts": [{ "matches": ["<all_urls>"], "js": ["/js/content.js"], "run_at": "document_start" }],
            "content_security_policy": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
            "commands": {
                "_execute_browser_action": { "suggested_key": { "default": "Ctrl+Period" } },
                "_execute_sidebar_action": { "suggested_key": { "default": "Alt+Shift+Y" } },
                "reload": { "suggested_key": { "default": "F1" } },
            },
        });
        let made = translate(&firefox, "KEY");
        let manifest = &made.manifest;
        assert_eq!(manifest["manifest_version"], 3);
        assert_eq!(manifest["key"], "KEY");
        assert_eq!(manifest["version"], "8.4.0");
        assert!(manifest.get("browser_specific_settings").is_none());
        assert!(manifest.get("browser_action").is_none());
        assert!(manifest.get("page_action").is_none());
        assert_eq!(manifest["icons"], json!({ "96": "img/icon-96.png" }));
        assert_eq!(manifest["action"], json!({ "default_popup": "popup.html" }));
        assert_eq!(manifest["options_ui"], json!({ "page": "options.html" }));
        assert_eq!(
            manifest["background"],
            json!({ "service_worker": "orden/host.js" })
        );
        assert_eq!(
            manifest["permissions"],
            json!([
                "contextMenus",
                "storage",
                "webRequest",
                "scripting",
                "offscreen"
            ])
        );
        assert_eq!(manifest["host_permissions"], json!(["<all_urls>"]));
        assert_eq!(manifest["optional_permissions"], json!(["bookmarks"]));
        assert_eq!(manifest["optional_host_permissions"], json!(["*://*/*"]));
        assert_eq!(
            manifest["web_accessible_resources"],
            json!([{ "resources": ["img/icon.svg"], "matches": ["<all_urls>"] }])
        );
        assert_eq!(
            manifest["content_scripts"][0]["js"],
            json!([
                "orden/firefox.js",
                "orden/browser-polyfill.js",
                "js/content.js"
            ])
        );
        assert_eq!(
            manifest["content_security_policy"]["extension_pages"],
            "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
        );
        assert_eq!(
            manifest["commands"],
            json!({
                "_execute_action": { "suggested_key": { "default": "Ctrl+Period" } },
                "reload": { "description": "reload" },
            })
        );
        assert_eq!(made.layer["background"], "js/background/index.html");
        assert_eq!(made.gaps.said, ["containers", "blocking"]);
        assert_eq!(made.gaps.apis, ["pageAction"]);
    }

    /// Firefox's Manifest V3 keeps a page's scripts as its background, which Orden writes a
    /// page round, and a page action alone is the button that shows and hides.
    #[test]
    fn a_firefox_manifest_v3_background_is_a_page_orden_writes() {
        let firefox = json!({
            "manifest_version": 3,
            "name": "SponsorBlock",
            "version": "6.1.7",
            "background": { "scripts": ["./js/background.js"], "type": "module" },
            "page_action": { "default_icon": { "16": "a.png", "32": "a.svg" } },
            "host_permissions": ["https://sponsor.ajay.app/*"],
            "web_accessible_resources": [{ "resources": ["/a.png"], "matches": ["*://*.youtube.com/*"] }],
            "sidebar_action": { "default_panel": "/sidebar.html" },
        });
        let made = translate(&firefox, "KEY");
        assert_eq!(
            made.manifest["action"],
            json!({ "default_icon": { "16": "a.png" } })
        );
        assert_eq!(made.layer["pageAction"], "action");
        assert_eq!(made.layer["background"], "orden/background.html");
        assert_eq!(made.layer["scripts"], json!(["js/background.js"]));
        assert_eq!(made.layer["sidebar"], "sidebar.html");
        assert_eq!(
            made.manifest["host_permissions"],
            json!(["https://sponsor.ajay.app/*"])
        );
        assert_eq!(
            made.manifest["web_accessible_resources"],
            json!([{ "resources": ["a.png"], "matches": ["*://*.youtube.com/*"] }])
        );
        assert_eq!(made.gaps.said, ["sidebar"]);
    }

    #[test]
    fn a_version_with_letters_keeps_its_numbers_and_one_of_its_own() {
        assert_eq!(chromium_version("2026.10.2"), "2026.10.2");
        assert_eq!(chromium_version("1.02"), "1.2");
        let beta = chromium_version("1.0b2");
        assert!(beta.starts_with("1.0.0."), "{beta}");
        assert_ne!(beta, chromium_version("1.0b3"));
        assert_eq!(chromium_version("1.2.3.4.5").split('.').count(), 4);
        assert_eq!(chromium_version("99999").split('.').count(), 4);
        for version in ["1.0b2", "3.0pre", "", "x", "1.2.3.4.5", "99999"] {
            assert!(
                super::super::library::plain_version(&chromium_version(version)),
                "{version}"
            );
        }
    }

    #[test]
    fn only_a_shortcut_chromium_takes_is_kept() {
        for (key, fine) in [
            ("Ctrl+Shift+Y", true),
            ("Alt+Shift+D", true),
            ("Ctrl+Period", true),
            ("MediaPlayPause", true),
            ("F1", false),
            ("Ctrl+F1", false),
            ("Ctrl+Alt+K", false),
            ("Shift+K", false),
            ("Command+K", false),
            ("Ctrl+Ctrl+K", false),
            ("Ctrl+MediaStop", false),
        ] {
            assert_eq!(shortcut(key, false), fine, "{key}");
        }
        assert!(shortcut("Command+Shift+K", true));
    }

    #[test]
    fn only_a_pattern_chromium_reads_is_kept() {
        for (said, fine) in [
            ("<all_urls>", true),
            ("*://*/*", true),
            ("https://*.youtube.com/*", true),
            ("file:///*", true),
            ("moz-extension://*/*", false),
            ("https://a*b.com/*", false),
            ("https://example.com", false),
            ("about:blank", false),
        ] {
            assert_eq!(pattern(said), fine, "{said}");
        }
    }

    #[test]
    fn the_layer_runs_before_anything_a_page_has() {
        let first = "<script src=\"/orden/firefox.js\"></script>";
        assert_eq!(
            headed(
                "<!DOCTYPE html><html><HEAD><script src=a.js></script></head></html>",
                first
            ),
            format!("<!DOCTYPE html><html><HEAD>{first}<script src=a.js></script></head></html>")
        );
        assert_eq!(
            headed("<header></header><html lang=en><body>", first),
            format!("<header></header><html lang=en>{first}<body>")
        );
        assert_eq!(headed("<p>hi</p>", first), format!("{first}<p>hi</p>"));
    }

    /// Firefox takes a `-` in a message's name; Chromium refuses to load an add-on with
    /// one, so every name, and every use of it in the manifest, is written without.
    #[test]
    fn its_words_are_named_as_chromium_takes_them() {
        let folder = tempfile::tempdir().expect("a folder");
        let at = folder.path();
        std::fs::create_dir_all(at.join("_locales/et")).expect("a language");
        std::fs::write(at.join("_locales/README.md"), "not a language").expect("a file");
        std::fs::write(
            at.join("_locales/et/messages.json"),
            json!({
                "onboarding-1-header": { "message": "Tere $First-Name$", "placeholders": { "first-name": { "content": "$1" } } },
                "plain": { "message": "x $keyId$ costs $1 and $$5" },
                "empty": { "description": "no words" }
            })
            .to_string(),
        )
        .expect("words");
        std::fs::write(
            at.join("manifest.json"),
            "// a comment Firefox allows\n{\"name\": \"__MSG_onboarding-1-header__\", \"version\": \"1\", \"default_locale\": \"et\"}",
        )
        .expect("a manifest");
        super::apply(at, "x@example.com").expect("applied");
        let words: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(at.join("_locales/et/messages.json")).expect("there"),
        )
        .expect("words");
        assert_eq!(
            words["onboarding_1_header"],
            json!({ "message": "Tere $first_name$", "placeholders": { "first_name": { "content": "$1" } } })
        );
        assert_eq!(words["plain"]["message"], "x  costs $1 and $$5");
        assert!(words.get("empty").is_none());
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(at.join("manifest.json")).expect("there"),
        )
        .expect("a manifest");
        assert_eq!(manifest["name"], "__MSG_onboarding_1_header__");
    }

    #[test]
    fn an_add_on_has_one_id_wherever_it_is_installed() {
        let (id, key) = id_and_key("@testpilot-containers");
        assert_eq!(id_and_key("@testpilot-containers"), (id.clone(), key));
        assert!(super::super::link::is_id(&id));
        assert_ne!(id, id_and_key("uBlock0@raymondhill.net").0);
    }

    #[test]
    fn a_folder_is_made_one_chromium_runs() {
        let folder = tempfile::tempdir().expect("a folder");
        let at = folder.path();
        std::fs::create_dir_all(at.join("bg")).expect("a folder");
        std::fs::write(
            at.join("manifest.json"),
            json!({
                "manifest_version": 2, "name": "x", "version": "1.0",
                "background": { "page": "bg/index.html" },
                "browser_action": { "default_popup": "popup.html" },
                "permissions": ["tabHide"]
            })
            .to_string(),
        )
        .expect("a manifest");
        std::fs::write(
            at.join("bg/index.html"),
            "<html><head><script src=\"../lib.js\"></script><script src='main.js'></script></head></html>",
        )
        .expect("a page");
        std::fs::write(
            at.join("popup.html"),
            "<html><head></head><body>hi</body></html>",
        )
        .expect("a popup");
        std::fs::write(at.join("lib.js"), "browser.dns.resolve('x')").expect("a script");

        let gaps = super::apply(at, "x@example.com").expect("applied");
        assert_eq!(gaps.said, ["hiddenTabs"]);
        assert_eq!(gaps.apis, ["dns"]);
        assert_eq!(super::gaps_in(at), Some(gaps));

        let popup = std::fs::read_to_string(at.join("popup.html")).expect("there");
        assert!(
            popup.starts_with(&format!("<html><head>{}", super::PAGE_SCRIPTS)),
            "{popup}"
        );
        let background = std::fs::read_to_string(at.join("bg/index.html")).expect("there");
        assert!(
            background.contains(super::BACKGROUND_SCRIPTS),
            "{background}"
        );
        let layer = std::fs::read_to_string(at.join("orden/firefox.js")).expect("there");
        assert!(layer.starts_with("globalThis.__ordenLayer = "), "{layer}");
        assert!(
            layer.contains(r#""scripts":["lib.js","bg/main.js"]"#),
            "{layer}"
        );
        assert!(at.join("orden/host.js").is_file());
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(at.join("manifest.json")).expect("there"),
        )
        .expect("a manifest");
        assert_eq!(manifest["manifest_version"], 3);
        assert_eq!(manifest["key"], id_and_key("x@example.com").1);
    }
}
