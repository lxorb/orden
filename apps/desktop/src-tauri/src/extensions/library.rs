use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::firefox::{self, Gaps};
use super::link::Store;
use super::unzip;
#[cfg(not(feature = "cef"))]
use super::{crx, manifest};

const LIST: &str = "library.json";

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
const APPLIED: &str = "applied.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kept {
    pub id: String,
    pub store: Store,
    pub version: String,
    pub enabled: bool,
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addon: Option<String>,
}

pub fn folder_of(root: &Path, id: &str, version: &str) -> PathBuf {
    root.join(id).join(version)
}

pub fn read(root: &Path) -> Vec<Kept> {
    fs::read_to_string(root.join(LIST))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Kept>>(&text).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|kept| super::link::is_id(&kept.id) && plain_version(&kept.version))
        .collect()
}

pub fn write(root: &Path, list: &[Kept]) -> Result<(), String> {
    written(
        &root.join(LIST),
        &serde_json::to_string_pretty(list).map_err(|e| e.to_string())?,
    )
}

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
pub type Applied = BTreeMap<String, BTreeMap<String, String>>;

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
pub fn applied(root: &Path) -> Applied {
    fs::read_to_string(root.join(APPLIED))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(
        dead_code,
        reason = "WebView2 cannot say which version it holds, so only it needs this written down"
    )
)]
pub fn write_applied(root: &Path, applied: &Applied) -> Result<(), String> {
    written(
        &root.join(APPLIED),
        &serde_json::to_string_pretty(applied).map_err(|e| e.to_string())?,
    )
}

fn written(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let beside = path.with_extension("json.new");
    fs::write(&beside, text).map_err(|error| error.to_string())?;
    fs::rename(&beside, path).map_err(|error| error.to_string())
}

pub fn plain_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version.split('.').count() <= 4
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(not(feature = "cef"))]
pub fn unpack(root: &Path, store: Store, id: &str, bytes: &[u8]) -> Result<String, String> {
    let checked = crx::checked(bytes, id, Some(store))?;
    unpack_checked(root, &checked)
}

#[cfg(not(feature = "cef"))]
pub fn unpack_checked(root: &Path, checked: &crx::Checked<'_>) -> Result<String, String> {
    unpack_with(root, &checked.id, checked.zip, |folder| {
        manifest::keyed(folder, &checked.key)
    })
}

pub fn unpack_firefox(
    root: &Path,
    id: &str,
    zip: &[u8],
    guid: &str,
) -> Result<(String, Gaps), String> {
    let mut gaps = Gaps::default();
    let version = unpack_with(root, id, zip, |folder| {
        gaps = firefox::apply(folder, guid)?;
        Ok(())
    })?;
    Ok((version, gaps))
}

fn unpack_with(
    root: &Path,
    id: &str,
    zip: &[u8],
    finish: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<String, String> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let home = root.join(id);
    fs::create_dir_all(&home).map_err(|error| error.to_string())?;
    let making = home.join(format!(
        ".unpacking-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&making);

    let made = (|| {
        unzip::unzip(zip, &making)?;
        finish(&making)?;
        let about = super::manifest::read(&making)?;
        if !plain_version(&about.version) {
            return Err("that extension's version is not one".to_string());
        }
        Ok(about.version)
    })();

    let version = match made {
        Ok(version) => version,
        Err(why) => {
            let _ = fs::remove_dir_all(&making);
            return Err(why);
        }
    };
    let target = home.join(&version);
    if target.join("manifest.json").is_file() {
        let _ = fs::remove_dir_all(&making);
    } else {
        let _ = fs::remove_dir_all(&target);
        fs::rename(&making, &target).map_err(|error| error.to_string())?;
    }
    Ok(version)
}

pub fn prune(root: &Path, id: &str, keep: &str) {
    let Ok(entries) = fs::read_dir(root.join(id)) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy() != keep {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

pub fn forget(root: &Path, id: &str) {
    if super::link::is_id(id) {
        let _ = fs::remove_dir_all(root.join(id));
    }
}

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine that runs extensions leaves folders behind"
    )
)]
pub fn tidy(root: &Path) {
    let list = read(root);
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !entry.path().is_dir() {
            continue;
        }
        match list.iter().find(|one| one.id == name) {
            Some(one) => prune(root, &one.id, &one.version),
            None => forget(root, &name),
        }
    }
}

#[cfg(feature = "cef")]
pub fn firefox_folders(root: &Path) -> Vec<PathBuf> {
    read(root)
        .into_iter()
        .filter(|one| one.store == Store::Firefox && one.enabled)
        .map(|one| folder_of(root, &one.id, &one.version))
        .filter(|folder| {
            folder.join("manifest.json").is_file() && !folder.to_string_lossy().contains(',')
        })
        .collect()
}

#[cfg(all(test, not(feature = "cef")))]
mod tests {
    use super::super::crx::tests::crx;
    use super::super::unzip::tests::zip;
    use super::{folder_of, plain_version, prune, read, unpack_checked, write, Kept, Store};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("orden-library-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn an_extension_unpacks_into_its_version_with_its_key_in_the_manifest() {
        let root = scratch("unpack");
        let archive = zip(&[
            (
                "manifest.json",
                br#"{"name":"Test","version":"1.2.3","manifest_version":3}"#,
            ),
            ("popup.html", b"<p>hi</p>"),
        ]);
        let (bytes, id) = crx(&archive);
        let checked = super::crx::checked(&bytes, &id, None).expect("checked");

        let version = unpack_checked(&root, &checked).expect("unpacked");
        assert_eq!(version, "1.2.3");
        let folder = folder_of(&root, &id, &version);
        let manifest = std::fs::read_to_string(folder.join("manifest.json")).expect("there");
        assert!(manifest.contains("\"key\""), "{manifest}");
        assert!(folder.join("popup.html").is_file());

        assert_eq!(unpack_checked(&root, &checked).expect("again"), "1.2.3");
        prune(&root, &id, "1.2.3");
        assert!(folder.is_dir());
        let leftovers = std::fs::read_dir(root.join(&id)).expect("there").count();
        assert_eq!(leftovers, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_version_that_is_not_a_folder_name_is_refused() {
        let root = scratch("bad-version");
        let archive = zip(&[("manifest.json", br#"{"name":"x","version":"../1"}"#)]);
        let (bytes, id) = crx(&archive);
        let checked = super::crx::checked(&bytes, &id, None).expect("checked");
        assert!(unpack_checked(&root, &checked).is_err());
        assert!(!root.join(&id).join("..").join("1").exists());
        for (version, fine) in [
            ("1", true),
            ("2025.1.30.4", true),
            ("1.2.3.4.5", false),
            ("1..2", false),
            ("1a", false),
            ("", false),
        ] {
            assert_eq!(plain_version(version), fine, "{version}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_list_survives_being_written_and_drops_what_is_not_an_extension() {
        let root = scratch("list");
        let one = Kept {
            id: "ddkjiahejlhfcafbddmgiahcphecmpfh".into(),
            store: Store::Chrome,
            version: "1.0".into(),
            enabled: true,
            pinned: true,
            addon: None,
        };
        let mut bad = one.clone();
        bad.id = "../../x".into();
        write(&root, &[one.clone(), bad]).expect("written");
        assert_eq!(read(&root), vec![one]);
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod amo_tests {
    use sha2::{Digest as _, Sha256};

    use super::super::amo::{checked, Listing};
    use super::super::firefox::{chromium_version, id_and_key};
    use super::super::unzip::tests::zip;
    use super::{folder_of, read, tidy, unpack_firefox, write, Kept, Store};

    fn xpi(version: &str) -> (Vec<u8>, Listing) {
        let manifest = format!(
            r#"{{"manifest_version": 2, "name": "Fixture", "version": "{version}",
                "browser_specific_settings": {{ "gecko": {{ "id": "fixture@example.com" }} }},
                "browser_action": {{ "default_popup": "popup.html" }},
                "background": {{ "scripts": ["bg.js"] }}}}"#
        );
        let bytes = zip(&[
            ("manifest.json", manifest.as_bytes()),
            ("popup.html", b"<html><head></head><body>hi</body></html>"),
            (
                "bg.js",
                b"browser.runtime.onInstalled.addListener(() => {})",
            ),
            ("META-INF/cose.sig", b"signed"),
        ]);
        let hash = Sha256::digest(&bytes)
            .iter()
            .fold(String::new(), |mut out, byte| {
                use std::fmt::Write as _;
                let _ = write!(out, "{byte:02x}");
                out
            });
        let listing = Listing {
            guid: "fixture@example.com".into(),
            slug: "fixture".into(),
            version: version.into(),
            url: "https://addons.mozilla.org/firefox/downloads/file/1/fixture.xpi".into(),
            hash,
            size: bytes.len() as u64,
        };
        (bytes, listing)
    }

    #[test]
    fn an_amo_add_on_installs_from_its_file_and_updates() {
        let root = tempfile::tempdir().expect("a folder");
        let root = root.path();
        let (bytes, listing) = xpi("1.0b1");
        checked(&bytes, &listing).expect("as AMO lists it");
        let mut other = listing.clone();
        other.hash = "0".repeat(64);
        assert!(checked(&bytes, &other).is_err());

        let (id, key) = id_and_key(&listing.guid);
        let (version, gaps) = unpack_firefox(root, &id, &bytes, &listing.guid).expect("unpacked");
        assert_eq!(version, chromium_version("1.0b1"));
        assert!(gaps.is_empty(), "{gaps:?}");
        let folder = folder_of(root, &id, &version);
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(folder.join("manifest.json")).expect("there"),
        )
        .expect("a manifest");
        assert_eq!(manifest["manifest_version"], 3);
        assert_eq!(manifest["key"], key);
        assert_eq!(manifest["version_name"], "1.0b1");
        assert_eq!(manifest["action"]["default_popup"], "popup.html");
        assert_eq!(manifest["background"]["service_worker"], "orden/host.js");
        assert!(folder.join("orden/background.html").is_file());
        let popup = std::fs::read_to_string(folder.join("popup.html")).expect("there");
        assert!(popup.contains("/orden/browser-polyfill.js"), "{popup}");

        let kept = Kept {
            id: id.clone(),
            store: Store::Firefox,
            version: version.clone(),
            enabled: true,
            pinned: true,
            addon: Some(listing.slug.clone()),
        };
        write(root, std::slice::from_ref(&kept)).expect("written");
        assert_eq!(read(root), vec![kept.clone()]);

        let (bytes, listing) = xpi("1.0");
        let (newer, _) = unpack_firefox(root, &id, &bytes, &listing.guid).expect("unpacked");
        assert_eq!(newer, "1.0");
        write(
            root,
            &[Kept {
                version: newer.clone(),
                ..kept
            }],
        )
        .expect("written");
        tidy(root);
        assert!(folder_of(root, &id, &newer).is_dir());
        assert!(!folder.exists());
    }
}
