#![cfg(not(any(target_os = "android", target_os = "ios")))]
use std::fs;
use std::path::{Path, PathBuf};

use orden_extensions::extensions::library::{folder_of, loaded_folders, unpack, write, Kept};
use orden_extensions::extensions::link::Store;
use orden_extensions::extensions::{shown, Done, Gaps};
use serde_json::{json, Value};

const PASS: &str = "ghmbeldphafepmbegfdlkpapadhbakde";
fn kept(id: &str, store: Store, enabled: bool) -> Kept {
    Kept {
        id: id.to_owned(),
        store,
        version: "1.2.3".to_owned(),
        enabled,
        pinned: true,
        addon: None,
    }
}
fn unpacked(root: &Path, one: &Kept) -> PathBuf {
    let folder = folder_of(root, &one.id, &one.version);
    fs::create_dir_all(&folder).expect("a folder");
    fs::write(folder.join("manifest.json"), r#"{"name": "Pass", "version": "1.2.3"}"#)
        .expect("a manifest");
    folder
}
fn said(done: Done) -> Value {
    serde_json::to_value(done).expect("an answer")
}
#[test]
fn a_profile_with_no_library_loads_no_extension() {
    let root = tempfile::tempdir().expect("a folder");
    assert!(loaded_folders(root.path()).is_empty());
}
#[test]
fn every_answer_to_an_install_has_the_shape_the_desktop_reads() {
    assert_eq!(
        said(Done::Asks { name: "Pass".to_owned(), asks: Gaps::default() }),
        json!({ "name": "Pass", "asks": { "said": [], "apis": [] } })
    );
    let root = tempfile::tempdir().expect("a folder");
    let one = kept(PASS, Store::Chrome, true);
    let folder = unpacked(root.path(), &one);
    let installed = said(Done::Installed(Box::new(shown(one, &folder))));
    assert_eq!(installed["id"], PASS);
    assert_eq!(installed["version"], "1.2.3");
    assert_eq!(installed["store"], "chrome");
    assert_eq!(installed["name"], "Pass");
    assert!(installed["pending"].is_boolean());
    assert!(installed["enabled"].is_boolean());
    assert!(installed["pinned"].is_boolean());
    assert!(installed.get("asks").is_none());
}
#[test]
fn chromium_loads_every_enabled_folder_orden_keeps_and_only_those() {
    let root = tempfile::tempdir().expect("a folder");
    let root = root.path();
    let firefox = kept(&"b".repeat(32), Store::Firefox, true);
    let store = kept(PASS, Store::Edge, true);
    let off = kept(&"c".repeat(32), Store::Chrome, false);
    let pin = kept(&"d".repeat(32), Store::Chrome, true);
    let (from_firefox, from_store) = (unpacked(root, &firefox), unpacked(root, &store));
    unpacked(root, &off);
    write(root, &[firefox, store, off, pin]).expect("written");
    assert_eq!(loaded_folders(root), vec![from_firefox, from_store]);
}
#[test]
fn a_store_file_that_is_not_a_signed_crx3_is_refused_with_why() {
    let root = tempfile::tempdir().expect("a folder");
    for (bytes, why) in [
        (&b""[..], "no CRX header"),
        (&b"PK\x03\x04 a plain zip"[..], "no CRX header"),
        (&b"Cr24\x02\0\0\0\0\0\0\0"[..], "not CRX3"),
        (&b"Cr24\x03\0\0\0\xff\xff\0\0"[..], "the header is cut short"),
        (&b"Cr24\x03\0\0\0\x02\0\0\0\x0a\xff"[..], "its header is broken"),
        (&b"Cr24\x03\0\0\0\0\0\0\0"[..], "no signed id"),
    ] {
        let refused = unpack(root.path(), Store::Chrome, PASS, bytes).expect_err(why);
        assert!(refused.starts_with("that extension's file is not one: "), "{refused}");
        assert!(refused.contains(why), "{refused}");
    }
    assert!(!root.path().join(PASS).exists());
}
