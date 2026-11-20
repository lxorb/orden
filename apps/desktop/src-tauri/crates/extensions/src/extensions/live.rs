use std::path::Path;

use serde_json::{json, Value};

use super::library::Kept;

pub fn load(
    cdp: &mut impl FnMut(&str, Value) -> Result<Value, String>,
    id: &str,
    folder: &Path,
) -> Result<(), String> {
    let said = cdp("Extensions.loadUnpacked", json!({ "path": folder.to_string_lossy() }))
        .map_err(|why| format!("Chromium did not load it: {why}"))?;
    match said["id"].as_str() {
        Some(loaded) if loaded == id => Ok(()),
        Some(other) => {
            let _ = cdp("Extensions.uninstall", json!({ "id": other }));
            Err(format!("Chromium loaded it as another extension, {other}"))
        }
        None => Err("Chromium did not say which extension it loaded".to_string()),
    }
}
pub fn unload(
    cdp: &mut impl FnMut(&str, Value) -> Result<Value, String>,
    id: &str,
) -> Result<(), String> {
    cdp("Extensions.uninstall", json!({ "id": id }))
        .map(|_| ())
        .map_err(|why| format!("Chromium did not remove it: {why}"))
}
pub fn landed(
    cdp: &mut impl FnMut(&str, Value) -> Result<Value, String>,
    one: &Kept,
    folder: &Path,
) -> Option<String> {
    if one.enabled {
        load(cdp, &one.id, folder).err()
    } else {
        None
    }
}
#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{json, Value};

    use super::{landed, load, unload};
    use crate::extensions::library::Kept;
    use crate::extensions::link::Store;

    const PASS: &str = "ghmbeldphafepmbegfdlkpapadhbakde";
    fn kept(enabled: bool) -> Kept {
        Kept {
            id: PASS.to_owned(),
            store: Store::Chrome,
            version: "1.2.3".to_owned(),
            enabled,
            pinned: true,
            addon: None,
        }
    }
    fn chromium(answer: Result<Value, String>) -> impl FnMut(&str, Value) -> Result<Value, String> {
        move |_: &str, _: Value| answer.clone()
    }
    #[test]
    fn a_folder_chromium_loads_under_its_own_id_is_running_at_once() {
        let mut asked = Vec::new();
        let mut cdp = |method: &str, params: Value| {
            asked.push((method.to_owned(), params));
            Ok(json!({ "id": PASS }))
        };
        let folder = Path::new("/kept/ghmbeldphafepmbegfdlkpapadhbakde/1.2.3");
        let newer = Path::new("/kept/ghmbeldphafepmbegfdlkpapadhbakde/1.3.0");
        assert_eq!(load(&mut cdp, PASS, folder), Ok(()));
        assert_eq!(landed(&mut cdp, &kept(true), newer), None);
        let loaded = |path: &Path| {
            ("Extensions.loadUnpacked".to_owned(), json!({ "path": path.to_string_lossy() }))
        };
        assert_eq!(asked, vec![loaded(folder), loaded(newer)]);
    }
    #[test]
    fn what_chromium_says_when_it_will_not_load_one_is_kept_word_for_word() {
        let mut cdp =
            chromium(Err("Extensions.loadUnpacked: Manifest file is missing or unreadable".into()));
        let why = landed(&mut cdp, &kept(true), Path::new("/kept")).expect("a problem");
        assert_eq!(
            why,
            "Chromium did not load it: Extensions.loadUnpacked: Manifest file is missing or unreadable"
        );
        let mut cdp = chromium(Ok(json!({})));
        assert_eq!(
            load(&mut cdp, PASS, Path::new("/kept")),
            Err("Chromium did not say which extension it loaded".to_owned())
        );
    }
    #[test]
    fn a_folder_loaded_as_another_extension_is_taken_back_out() {
        let mut asked = Vec::new();
        let other = "a".repeat(32);
        let mut cdp = |method: &str, params: Value| {
            asked.push((method.to_owned(), params));
            Ok(json!({ "id": other }))
        };
        let why = load(&mut cdp, PASS, Path::new("/kept")).expect_err("refused");
        assert!(why.contains(&other), "{why}");
        assert_eq!(asked[1], ("Extensions.uninstall".to_owned(), json!({ "id": other })));
    }
    #[test]
    fn a_turned_off_one_is_not_loaded_and_a_removed_one_is_taken_out() {
        let mut asked = Vec::new();
        let mut cdp = |method: &str, params: Value| {
            asked.push((method.to_owned(), params));
            Err("no".to_owned())
        };
        assert_eq!(landed(&mut cdp, &kept(false), Path::new("/kept")), None);
        assert_eq!(unload(&mut cdp, PASS), Err("Chromium did not remove it: no".to_owned()));
        assert_eq!(asked, vec![("Extensions.uninstall".to_owned(), json!({ "id": PASS }))]);
        let mut fine = |_: &str, _: Value| Ok(json!({}));
        assert_eq!(unload(&mut fine, PASS), Ok(()));
    }
}
