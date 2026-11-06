use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Url};

mod amo;
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

const CHANGED: &str = "nib://extensions";

static WRITING: Mutex<()> = Mutex::new(());

static KNOWN: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(RwLock::default);

static PROBLEMS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

static PENDING: LazyLock<RwLock<HashSet<String>>> = LazyLock::new(RwLock::default);

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only what nib hands WebView2 can fail to load")
)]
fn went_wrong(id: &str, why: &str) {
    let mut problems = PROBLEMS.lock().unwrap_or_else(PoisonError::into_inner);
    problems.retain(|(one, _)| one != id);
    problems.push((id.to_owned(), why.to_owned()));
}

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

pub const SUPPORTED: bool = cfg!(any(feature = "cef", windows));

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::config_dir(app)?.join("extensions");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

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

pub fn ours(url: &Url) -> bool {
    url.scheme() == "chrome-extension"
        && url.host_str().is_some_and(|id| {
            KNOWN
                .read()
                .unwrap_or_else(PoisonError::into_inner)
                .contains(id)
        })
}

#[cfg(test)]
pub fn known(id: &str) {
    KNOWN
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned());
}

pub fn kept(app: &AppHandle) -> Vec<Kept> {
    root(app)
        .map(|root| library::read(&root))
        .unwrap_or_default()
}

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    #[serde(flatten)]
    kept: Kept,
    #[serde(flatten)]
    about: About,
    picture: Option<String>,
    problem: Option<String>,
    gaps: Option<Gaps>,
    pending: bool,
}

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

const LARGEST: u64 = 512 * 1024;

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

fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED, ());
    #[cfg(all(windows, not(feature = "cef")))]
    webview2::apply(app);
}

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

#[derive(Serialize)]
pub struct Theme {
    name: String,
    source: String,
    css: bool,
    pages: String,
}

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

#[tauri::command]
pub async fn extensions_set(
    app: AppHandle,
    id: String,
    enabled: Option<bool>,
    pinned: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
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

#[tauri::command]
pub async fn extensions_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
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

#[tauri::command]
pub async fn extensions_page(app: AppHandle, id: String, options: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || page_of(&app, &id, options))
        .await
        .map_err(|error| error.to_string())?
}

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

#[tauri::command]
pub fn extensions_named(link: String) -> Option<(Store, String)> {
    if !SUPPORTED {
        return None;
    }
    link::named(&link)
        .filter(|_| link.contains("://"))
        .filter(|(store, _)| *store == Store::Firefox || !cfg!(feature = "cef"))
}

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
