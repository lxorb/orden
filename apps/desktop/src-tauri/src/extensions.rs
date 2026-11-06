//! Chrome and Edge extensions in web tabs, on both engines, and Firefox add-ons.
//!
//! Emil, 2026-10-03: extensions on `WebView2` and on nib's own Chromium, installed from a
//! Chrome Web Store or Edge Add-ons link or from the store's own page in a tab, kept in
//! the app's own folder, updated through the stores' own update service, with a button in
//! the web bar, the popup in a bubble, the options page as a tab and a list in Settings.
//!
//! **Firefox add-ons** (#1155) come from addons.mozilla.org on both engines, and Orden
//! installs them itself: the file AMO's API names (amo.rs), made into an extension
//! Chromium runs (firefox.rs), unpacked into `<config>/extensions` like any other, and
//! updated from AMO. On `WebView2` it is handed to the stores as the rest are; Orden's own
//! Chromium, which installs no folder while it runs, loads it as it starts, so one that is
//! installed or updated there starts with the next launch.
//!
//! **Who installs depends on the engine, and nothing else does.** `WebView2` installs
//! nothing from a store - its API takes an unpacked folder - so on it Orden installs: the
//! file fetched from the store's update service (fetch.rs), checked the way Chromium
//! checks it (crx.rs), unpacked into `<config>/extensions` (library.rs), handed to every
//! store's profile (webview2.rs), and updated the same way. Orden's own Chromium installs
//! from the store for itself and refuses a host the one door to install a folder, so there
//! the store's own button installs and the list is the engine's (chromium.rs). Everything
//! the reader sees is the same on both: the button and its icons in the web bar
//! (lib/web-tab/ExtensionButtons.svelte), the popup in a bubble (popup.rs), the options
//! page as a tab, the rows in Settings.
//!
//! **Where they run.** Every store a reader's tab can be in: the shared one, a space's, a
//! site's. Never Orden's own interface, which is a separate data folder on `WebView2` and a
//! separate profile on Chromium (engine.rs). And never an agent's own store, which is
//! built with extensions off at the engine; see `in_store`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Url};

mod amo;
// What Orden installs itself, which on Orden's own Chromium the store does; see chromium.rs.
#[cfg(not(feature = "cef"))]
mod crx;
mod fetch;
mod firefox;
#[cfg(any(windows, test))]
mod given;
pub mod library;
pub mod link;
mod manifest;
pub mod popup;
mod unzip;
#[cfg(any(windows, test))]
pub mod welcome;

#[cfg(feature = "cef")]
mod chromium;
#[cfg(feature = "cef")]
pub mod tabs;
#[cfg(all(windows, not(feature = "cef")))]
pub mod webview2;

use firefox::Gaps;
use library::Kept;
use link::Store;
use manifest::About;

/// What the window hears when the list changed: nothing, the window asks again.
const CHANGED: &str = "nib://extensions";

/// One change to the list at a time, so two installs never write over each other.
static WRITING: Mutex<()> = Mutex::new(());

/// The ids installed, for the one question asked of every address a tab goes to: is
/// `chrome-extension://<id>/` one of ours? Filled each time the list is read.
static KNOWN: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(RwLock::default);

/// Why an extension did not load this run, by id, for its row to say.
static PROBLEMS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// The Firefox add-ons Orden's own Chromium has not loaded at the list's version, because
/// they were installed, updated or turned on since it started; the next launch loads them.
static PENDING: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(RwLock::default);

/// Writes down why an extension did not load.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only what nib hands WebView2 can fail to load")
)]
fn went_wrong(id: &str, why: &str) {
    let mut problems = PROBLEMS.lock().unwrap_or_else(PoisonError::into_inner);
    problems.retain(|(one, _)| one != id);
    problems.push((id.to_owned(), why.to_owned()));
}

/// An extension that loaded has nothing wrong with it any more.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only what nib hands WebView2 can fail to load")
)]
fn went_right(id: &str) {
    PROBLEMS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|(one, _)| one != id);
}

/// Whether this build's engine runs extensions at all: `WebView2` and Orden's Chromium.
/// A Mac's and Linux's own engines have no extension API.
pub const SUPPORTED: bool = cfg!(any(feature = "cef", windows));

/// The folder extensions live in, made if it is not there.
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::config_dir(app)?.join("extensions");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// Whether a store's pages run extensions: every store but an agent's own.
#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "an environment option of WebView2's; nib's own Chromium keeps agents' stores apart by profile"
    )
)]
pub fn in_store(store: Option<&str>) -> bool {
    SUPPORTED && !store.is_some_and(|name| name.starts_with("agent_"))
}

/// Whether `url` is a page of an installed extension: `chrome-extension://<id>/...`.
pub fn ours(url: &Url) -> bool {
    url.scheme() == "chrome-extension"
        && url.host_str().is_some_and(|id| {
            KNOWN
                .read()
                .unwrap_or_else(PoisonError::into_inner)
                .contains(id)
        })
}

/// An extension `ours` knows of before the list is read.
#[cfg(test)]
pub fn known(id: &str) {
    KNOWN
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned());
}

/// The list as written down: on `WebView2`, what Orden installed; on Orden's own Chromium,
/// the pins the reader set, the list itself being the engine's (`listed`).
pub fn kept(app: &AppHandle) -> Vec<Kept> {
    root(app)
        .map(|root| library::read(&root))
        .unwrap_or_default()
}

/// What is installed, each with the folder it is unpacked in, and the ids remembered for
/// `ours`. From a thread that is not the window's: on Chromium the engine is asked.
fn listed(app: &AppHandle) -> Vec<(Kept, PathBuf)> {
    #[cfg(feature = "cef")]
    let list: Vec<(Kept, PathBuf)> = {
        static TIDIED: std::sync::Once = std::sync::Once::new();
        if let Ok(root) = root(app) {
            TIDIED.call_once(|| library::tidy(&root));
        }
        let pins = kept(app);
        let mut list: Vec<(Kept, PathBuf)> = chromium::installed(app)
            .into_iter()
            .map(|(mut one, folder)| {
                one.pinned = pins
                    .iter()
                    .find(|pin| pin.id == one.id)
                    .is_none_or(|pin| pin.pinned);
                (one, folder)
            })
            .collect();
        // A Firefox add-on is the list's, on or off as the list says: the engine has it only
        // from the launch that loaded it, at the version it loaded.
        if let Ok(root) = root(app) {
            let mut pending = PENDING.write().unwrap_or_else(PoisonError::into_inner);
            pending.clear();
            for one in pins.iter().filter(|one| one.store == Store::Firefox) {
                let folder = library::folder_of(&root, &one.id, &one.version);
                let loaded = list.iter().position(|(there, _)| there.id == one.id);
                let current = loaded.is_some_and(|at| list[at].0.version == one.version);
                if one.enabled && !current {
                    pending.insert(one.id.clone());
                }
                match loaded {
                    Some(at) => list[at] = (one.clone(), folder),
                    None => list.push((one.clone(), folder)),
                }
            }
        }
        list
    };
    #[cfg(not(feature = "cef"))]
    let list: Vec<(Kept, PathBuf)> = match root(app) {
        Ok(root) => library::read(&root)
            .into_iter()
            .map(|one| {
                let folder = library::folder_of(&root, &one.id, &one.version);
                (one, folder)
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    *KNOWN.write().unwrap_or_else(PoisonError::into_inner) =
        list.iter().map(|(one, _)| one.id.clone()).collect();
    list
}

/// One extension as the window draws it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    #[serde(flatten)]
    kept: Kept,
    #[serde(flatten)]
    about: About,
    /// Its picture as a `data:` address, so the window needs no way into the folder.
    picture: Option<String>,
    /// Why it did not load this run, if it did not.
    problem: Option<String>,
    /// What of a Firefox add-on does not run in Orden; see firefox.rs.
    gaps: Option<Gaps>,
    /// Whether it starts only with the next launch; see `PENDING`.
    pending: bool,
}

/// An extension's row: the list's entry and what its manifest says.
fn shown(kept: Kept, folder: &Path) -> Shown {
    let about = manifest::read(folder).unwrap_or_default();
    let picture = about.icon.as_deref().and_then(|icon| picture(folder, icon));
    let problem = PROBLEMS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .find(|(id, _)| *id == kept.id)
        .map(|(_, why)| why.clone());
    let pending = PENDING
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(&kept.id);
    Shown {
        kept,
        about,
        picture,
        problem,
        gaps: firefox::gaps_in(folder),
        pending,
    }
}

/// The largest picture a row carries, so a manifest naming a large file is not read whole.
const LARGEST: u64 = 512 * 1024;

/// A picture in an extension's folder as a `data:` address, if it is a small one.
fn picture(folder: &Path, path: &str) -> Option<String> {
    use base64::Engine as _;

    let kind = match path.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return None,
    };
    let file = folder.join(path);
    if !std::fs::metadata(&file).is_ok_and(|one| one.is_file() && one.len() <= LARGEST) {
        return None;
    }
    let bytes = std::fs::read(&file).ok()?;
    u64::try_from(bytes.len())
        .is_ok_and(|size| size <= LARGEST)
        .then(|| {
            format!(
                "data:{kind};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        })
}

/// Tells the window the list changed, and every `WebView2` store what it now holds.
fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED, ());
    #[cfg(all(windows, not(feature = "cef")))]
    webview2::apply(app);
}

/// What is installed.
#[tauri::command]
pub async fn extensions_list(app: AppHandle) -> Result<Vec<Shown>, String> {
    if !SUPPORTED {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        listed(&app)
            .into_iter()
            .map(|(one, folder)| shown(one, &folder))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

/// What an install came to: the extension, installed - or, on Orden's own Chromium, the
/// store's own page, where the store's own button installs it. A Firefox add-on that will
/// not run whole is not installed until the reader has read what will not and asked again;
/// a Firefox theme is not installed at all but handed to the window, to become one of
/// Orden's (lib/themes/browser.ts).
#[derive(Serialize)]
#[serde(untagged)]
pub enum Done {
    Installed(Box<Shown>),
    #[cfg_attr(
        not(feature = "cef"),
        allow(
            dead_code,
            reason = "only nib's own Chromium sends the reader to the store"
        )
    )]
    Store {
        store: String,
    },
    Asks {
        name: String,
        asks: Gaps,
    },
    Theme {
        theme: Theme,
    },
}

/// A Firefox theme, as the window reads a browser's theme (`browser_themes.rs`).
#[derive(Serialize)]
pub struct Theme {
    name: String,
    /// Its manifest's `theme`, as JSON.
    source: String,
    css: bool,
    pages: String,
}

/// Installs the extension a store link or an id names, or updates it if it is there. A
/// Firefox add-on that will not run whole is installed only once `anyway` says so.
#[tauri::command]
pub async fn extensions_install(
    app: AppHandle,
    link: String,
    anyway: Option<bool>,
) -> Result<Done, String> {
    if !SUPPORTED {
        return Err("this engine runs no extensions".into());
    }
    let (store, id) = link::named(&link).ok_or("that is not a link to an extension")?;
    if store == Store::Firefox {
        return from_amo(app, &id, anyway == Some(true)).await;
    }
    #[cfg(feature = "cef")]
    {
        let _ = app;
        Ok(Done::Store {
            store: link::page_of(store, &id),
        })
    }
    #[cfg(not(feature = "cef"))]
    {
        let bytes = fetch::crx(store, &id).await?;
        installed(app, store, id, bytes)
            .await
            .map(|one| Done::Installed(Box::new(one)))
    }
}

/// Installs the Firefox add-on `slug` names from addons.mozilla.org, or hands its theme
/// to the window.
async fn from_amo(app: AppHandle, slug: &str, anyway: bool) -> Result<Done, String> {
    let listing = amo::listing(slug).await?;
    let bytes = amo::file(&listing).await?;
    if listing.kind == amo::Kind::Theme {
        return tauri::async_runtime::spawn_blocking(move || theme_in(&bytes))
            .await
            .map_err(|error| error.to_string())?
            .map(|theme| Done::Theme { theme });
    }
    let (id, _) = firefox::id_and_key(&listing.guid);
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        let (version, gaps) = library::unpack_firefox(&root, &id, &bytes, &listing.guid)?;
        let folder = library::folder_of(&root, &id, &version);
        if !anyway && !gaps.is_empty() && !kept(&app).iter().any(|one| one.id == id) {
            let name = manifest::read(&folder)
                .map(|about| about.name)
                .unwrap_or_default();
            library::prune(&root, &id, "");
            return Ok(Done::Asks { name, asks: gaps });
        }
        listed_as(
            &app,
            &root,
            Store::Firefox,
            &id,
            version,
            Some(listing.slug),
        )
        .map(|one| Done::Installed(Box::new(one)))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A theme's name and colours, out of its file.
fn theme_in(bytes: &[u8]) -> Result<Theme, String> {
    let folder = tempfile::tempdir().map_err(|error| error.to_string())?;
    let unpacked = folder.path().join("theme");
    unzip::unzip(bytes, &unpacked)?;
    let text = std::fs::read_to_string(unpacked.join("manifest.json"))
        .map_err(|_| "that theme has no manifest".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "that theme's manifest cannot be read".to_string())?;
    let colours = manifest
        .get("theme")
        .filter(|one| one.is_object())
        .ok_or("that theme has no colours")?;
    Ok(Theme {
        name: manifest::read(&unpacked)
            .map(|about| about.name)
            .unwrap_or_default(),
        source: colours.to_string(),
        css: false,
        pages: String::new(),
    })
}

/// Puts an unpacked version on the list, or moves the list's entry to it, and hands it to
/// the engines.
fn listed_as(
    app: &AppHandle,
    root: &Path,
    store: Store,
    id: &str,
    version: String,
    addon: Option<String>,
) -> Result<Shown, String> {
    let one = {
        let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
        let mut list = kept(app);
        let one = if let Some(there) = list.iter_mut().find(|one| one.id == id) {
            there.version.clone_from(&version);
            there.store = store;
            if addon.is_some() {
                there.addon.clone_from(&addon);
            }
            there.clone()
        } else {
            let fresh = Kept {
                id: id.to_owned(),
                store,
                version,
                enabled: true,
                pinned: true,
                addon,
            };
            list.push(fresh.clone());
            fresh
        };
        library::write(root, &list)?;
        one
    };
    let folder = library::folder_of(root, &one.id, &one.version);
    let _ = listed(app);
    changed(app);
    Ok(shown(one, &folder))
}

/// Unpacks a fetched file, puts it on the list and hands it to the engines.
#[cfg(not(feature = "cef"))]
async fn installed(
    app: AppHandle,
    store: Store,
    id: String,
    bytes: Vec<u8>,
) -> Result<Shown, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        let version = library::unpack(&root, store, &id, &bytes)?;
        listed_as(&app, &root, store, &id, version, None)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Turns an extension on or off, or pins or unpins its button.
#[tauri::command]
pub async fn extensions_set(
    app: AppHandle,
    id: String,
    enabled: Option<bool>,
    pinned: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        // Orden's own Chromium keeps whether one is on itself, and loses nothing it stored.
        // A Firefox add-on is the list's, and the engine has it only if this run loaded it.
        #[cfg(feature = "cef")]
        if let Some(on) = enabled {
            let firefox = kept(&app)
                .iter()
                .any(|one| one.id == id && one.store == Store::Firefox);
            let done = chromium::enable(&app, &id, on);
            if !firefox {
                done?;
            }
        }
        {
            let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
            let mut list = kept(&app);
            if !list.iter().any(|one| one.id == id) {
                let (one, _) = listed(&app)
                    .into_iter()
                    .find(|(one, _)| one.id == id)
                    .ok_or("that extension is not installed")?;
                list.push(one);
            }
            if let Some(one) = list.iter_mut().find(|one| one.id == id) {
                if let Some(on) = enabled {
                    one.enabled = on;
                }
                if let Some(on) = pinned {
                    one.pinned = on;
                }
            }
            library::write(&root, &list)?;
        }
        changed(&app);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Removes an extension: from every store, and on `WebView2` its folder with it on the next
/// tidy.
#[tauri::command]
pub async fn extensions_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        // A Firefox add-on this run did not load is the list's alone.
        #[cfg(feature = "cef")]
        {
            let firefox = kept(&app)
                .iter()
                .any(|one| one.id == id && one.store == Store::Firefox);
            let done = chromium::remove(&app, &id);
            if !firefox {
                done?;
            }
        }
        {
            let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
            let mut list = kept(&app);
            list.retain(|one| one.id != id);
            library::write(&root, &list)?;
        }
        let _ = listed(&app);
        changed(&app);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Looks for a newer version of every extension, and installs what it finds. Answers how
/// many moved. The window asks every few hours, never at the launch. Orden's own Chromium
/// updates what its store installed itself; a Firefox add-on is updated from AMO on both.
#[tauri::command]
pub async fn extensions_update(app: AppHandle) -> Result<usize, String> {
    if !SUPPORTED {
        return Ok(0);
    }
    let mut moved = 0;
    for one in kept(&app)
        .into_iter()
        .filter(|one| one.store == Store::Firefox)
    {
        if amo_update(&app, &one).await.unwrap_or(false) {
            moved += 1;
        }
    }
    #[cfg(feature = "cef")]
    {
        Ok(moved)
    }
    #[cfg(not(feature = "cef"))]
    {
        for one in kept(&app)
            .into_iter()
            .filter(|one| one.store != Store::Firefox)
        {
            let Ok(Some((_, file))) = fetch::newer(one.store, &one.id, &one.version).await else {
                continue;
            };
            let Ok(bytes) = fetch::download(&file).await else {
                continue;
            };
            if installed(app.clone(), one.store, one.id.clone(), bytes)
                .await
                .is_ok()
            {
                moved += 1;
            }
        }
        Ok(moved)
    }
}

/// Installs the version AMO has of a Firefox add-on if it is not the one here, answering
/// whether it did. What will not run of it was read before its first install.
async fn amo_update(app: &AppHandle, one: &Kept) -> Result<bool, String> {
    let slug = one
        .addon
        .clone()
        .ok_or("that add-on has no address on AMO")?;
    let listing = amo::listing(&slug).await?;
    if firefox::chromium_version(&listing.version) == one.version
        || firefox::id_and_key(&listing.guid).0 != one.id
    {
        return Ok(false);
    }
    let root = root(app)?;
    let bytes = amo::file(&listing).await?;
    let (app, id) = (app.clone(), one.id.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let (version, _) = library::unpack_firefox(&root, &id, &bytes, &listing.guid)?;
        listed_as(&app, &root, Store::Firefox, &id, version, None).map(|_| true)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The address of an extension's popup or options page, for the window to open.
#[tauri::command]
pub async fn extensions_page(app: AppHandle, id: String, options: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || page_of(&app, &id, options))
        .await
        .map_err(|error| error.to_string())?
}

/// The address of an extension's popup, or of its options page.
fn page_of(app: &AppHandle, id: &str, options: bool) -> Result<String, String> {
    let (_, folder) = listed(app)
        .into_iter()
        .find(|(one, _)| one.id == id)
        .ok_or("that extension is not installed")?;
    let about = manifest::read(&folder)?;
    let page = if options { about.options } else { about.popup };
    page.map(|page| format!("chrome-extension://{id}/{page}"))
        .ok_or_else(|| "that extension has no such page".to_string())
}

/// The store's own page a tab is on, if it is an extension's: `(store, id)`, so the bar
/// can offer Add there - for a Firefox add-on, its slug. A Chromium store's page never on
/// Orden's own Chromium, where the store's own button installs.
#[tauri::command]
pub fn extensions_named(link: String) -> Option<(Store, String)> {
    if !SUPPORTED {
        return None;
    }
    link::named(&link)
        .filter(|_| link.contains("://"))
        .filter(|(store, _)| *store == Store::Firefox || !cfg!(feature = "cef"))
}

/// Folders nothing on the list names any more, and versions an update left behind. Once
/// a run, after the first store has been handed its extensions, so no engine still has a
/// folder it is being taken away from.
#[cfg(all(windows, not(feature = "cef")))]
pub fn tidy(app: &AppHandle) {
    if let Ok(root) = root(app) {
        library::tidy(&root);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use serde_json::{json, Value};

    use super::{shown, Kept, Store, LARGEST};

    fn kept() -> Kept {
        Kept {
            id: "abcdefghijklmnopabcdefghijklmnop".to_owned(),
            store: Store::Chrome,
            version: "1.0".to_owned(),
            enabled: true,
            pinned: true,
            addon: None,
        }
    }

    fn row(folder: &Path, manifest: &str) -> Value {
        fs::write(folder.join("manifest.json"), manifest).expect("a manifest");
        serde_json::to_value(shown(kept(), folder)).expect("a row")
    }

    /// Whatever an extension's manifest says, or fails to say, its row is the list's id
    /// and version and is drawn (#1084): no field is assumed, of any type or size.
    #[test]
    fn any_manifest_at_all_makes_a_row() {
        let folder = tempfile::tempdir().expect("a folder");
        let locale = folder.path().join("_locales/zh_CN");
        fs::create_dir_all(&locale).expect("a locale");
        fs::write(
            locale.join("messages.json"),
            r#"{"extName": {"message": 5}}"#,
        )
        .expect("words");
        let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
        let large = json!({
            "name": "x".repeat(4 << 20),
            "permissions": vec!["storage"; 10_000]
        })
        .to_string();
        let manifests = [
            String::new(),
            "not a manifest".to_owned(),
            "[]".to_owned(),
            "null".to_owned(),
            "42".to_owned(),
            r#""text""#.to_owned(),
            "{}".to_owned(),
            "\u{feff}{\"name\": 5, \"version\": 2}".to_owned(),
            json!({
                "name": ["x"], "version": { "a": 1 }, "icons": "icon.png", "action": "yes",
                "options_ui": [], "options_page": 3, "permissions": "storage",
                "host_permissions": [1, null, {}], "content_scripts": { "matches": "x" },
                "default_locale": 7
            })
            .to_string(),
            json!({
                "icons": { "16": 5, "abc": "a.png", "4294967296": "b.png", "-1": "c.png" },
                "action": { "default_icon": 7, "default_popup": {} }
            })
            .to_string(),
            json!({
                "name": "__MSG_extName__", "short_name": "__MSG___", "default_locale": "zh_CN",
                "icons": { "128": "图标/ícone 🧩.png" },
                "action": { "default_popup": "ポップ.html#ä" }
            })
            .to_string(),
            json!({ "name": "名前 🧩\u{0}", "default_locale": "../../x" }).to_string(),
            format!(r#"{{"name": "deep", "icons": {deep}}}"#),
            large,
        ];
        for manifest in &manifests {
            let said = row(folder.path(), manifest);
            let start = manifest.chars().take(80).collect::<String>();
            assert_eq!(said["id"], kept().id, "{start}");
            assert_eq!(said["version"], "1.0", "{start}");
            assert!(said["name"].is_string(), "{start}");
            assert!(said["permissions"].is_array(), "{start}");
        }

        fs::remove_file(folder.path().join("manifest.json")).expect("gone");
        let said = serde_json::to_value(shown(kept(), folder.path())).expect("a row");
        assert_eq!(said["version"], "1.0");
        assert_eq!(said["picture"], Value::Null);
    }

    /// A Firefox theme is its name and its colours, handed to the window (#1155).
    #[test]
    fn a_firefox_theme_is_its_name_and_its_colours() {
        let file = super::unzip::tests::zip(&[
            (
                "manifest.json",
                br#"{"manifest_version": 2, "name": "Balanced", "version": "2.1", "theme": {"colors": {"frame": "hsl(220, 72%, 28%)"}}}"#,
            ),
            ("META-INF/cose.sig", b"signed"),
        ]);
        let theme = super::theme_in(&file).expect("a theme");
        assert_eq!(theme.name, "Balanced");
        assert_eq!(theme.source, r#"{"colors":{"frame":"hsl(220, 72%, 28%)"}}"#);
        let none = super::unzip::tests::zip(&[("manifest.json", br#"{"name": "x"}"#)]);
        assert!(super::theme_in(&none).is_err());
    }

    /// A picture is carried only when it is a small file: never a folder, a file that is
    /// not there, or a large one, which is not read at all.
    #[test]
    fn only_a_small_picture_is_carried() {
        let folder = tempfile::tempdir().expect("a folder");
        fs::write(folder.path().join("small.png"), b"\x89PNG").expect("a picture");
        fs::create_dir(folder.path().join("folder.png")).expect("a folder");
        fs::File::create(folder.path().join("large.png"))
            .and_then(|file| file.set_len(LARGEST + 1))
            .expect("a large picture");

        let picture = |path: &str| {
            row(
                folder.path(),
                &json!({ "icons": { "16": path } }).to_string(),
            )["picture"]
                .clone()
        };
        assert!(picture("small.png")
            .as_str()
            .is_some_and(|said| said.starts_with("data:image/png;base64,")));
        for path in ["folder.png", "large.png", "nowhere.png", "small.txt"] {
            assert_eq!(picture(path), Value::Null, "{path}");
        }
    }
}
