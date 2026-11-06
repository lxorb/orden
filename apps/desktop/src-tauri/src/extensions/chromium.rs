use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager as _, Webview, WebviewBuilder, WebviewUrl,
};

use crate::engine::devtools;

use super::library::Kept;
use super::link::Store;

const CONTROL: &str = "web-extensions-control";

const LEAVING: &str = "web-extension-leaving";

const PATIENCE: Duration = Duration::from_secs(20);

static BUILDING: Mutex<()> = Mutex::new(());

static REMOVING: Mutex<()> = Mutex::new(());

pub fn installed(app: &AppHandle) -> Vec<(Kept, PathBuf)> {
    let Some(page) = control(app) else {
        return Vec::new();
    };
    let Ok(profile) = crate::engine::root(app).map(|root| root.join("Default").join("Extensions"))
    else {
        return Vec::new();
    };
    let all = asked(&page, LIST)
        .and_then(|all| all.as_array().cloned())
        .unwrap_or_default();
    entries(&all, &profile)
}

fn entries(all: &[Value], profile: &Path) -> Vec<(Kept, PathBuf)> {
    all.iter()
        .filter_map(|one| {
            let id = one["id"].as_str()?.to_owned();
            let version = one["version"].as_str()?.to_owned();
            let folder = match one["path"].as_str().filter(|path| !path.is_empty()) {
                Some(path) => Some(PathBuf::from(path)).filter(|folder| folder.is_dir()),
                None => unpacked(&profile.join(&id), &version),
            }?;
            let kept = Kept {
                id,
                store: if one["edge"].as_bool() == Some(true) {
                    Store::Edge
                } else {
                    Store::Chrome
                },
                version,
                enabled: one["enabled"].as_bool().unwrap_or(true),
                pinned: true,
                addon: None,
            };
            Some((kept, folder))
        })
        .collect()
}

const LIST: &str = "Promise.all([chrome.management.getAll(), chrome.developerPrivate ? chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }).catch(() => []) : []]).then(([all, info]) => all.filter(one => one.type === 'extension').map(one => ({ id: one.id, version: one.version, enabled: one.enabled, edge: (one.updateUrl || '').includes('edge.microsoft.com'), path: (info.find(said => said.id === one.id) || {}).path || null })))";

fn unpacked(home: &Path, version: &str) -> Option<PathBuf> {
    let prefix = format!("{version}_");
    std::fs::read_dir(home)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .map(|entry| entry.path())
        .max()
}

pub fn enable(app: &AppHandle, id: &str, on: bool) -> Result<(), String> {
    let page = control(app).ok_or("the engine's extensions could not be reached")?;
    asked(
        &page,
        &format!(
            "chrome.management.setEnabled({}, {on}).then(() => true)",
            json!(id)
        ),
    )
    .map(|_| ())
    .ok_or_else(|| "the engine did not change it".to_string())
}

pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    if id.len() != 32 || !id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)) {
        return Err("that is not an extension".to_string());
    }
    let _removing = REMOVING.lock().unwrap_or_else(PoisonError::into_inner);
    let page = control(app).ok_or("the engine's extensions could not be reached")?;
    let held = |expression: &str| asked(&page, &expression.replace("ID", &json!(id).to_string()));
    let was_on = held("chrome.management.get(ID).then((one) => one.enabled)")
        .and_then(|on| on.as_bool())
        .ok_or("the engine does not have it")?;
    if !was_on {
        enable(app, id, true)?;
    }

    if let Some(left) = app.get_webview(LEAVING) {
        devtools::let_go_of(LEAVING);
        let _ = left.close();
    }
    let address = format!("chrome-extension://{id}/manifest.json");
    if let Some(own) = hidden(app, LEAVING, &address) {
        for _ in 0..50 {
            let ready = asked(
                &own,
                "typeof chrome.management?.uninstallSelf === 'function'",
            );
            if ready == Some(Value::Bool(true)) {
                let _ = asked(&own, "(chrome.management.uninstallSelf(), true)");
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        devtools::let_go_of(LEAVING);
        let _ = own.close();
    }

    for _ in 0..50 {
        if held("chrome.management.get(ID).then(() => true, () => false)")
            == Some(Value::Bool(false))
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !was_on {
        let _ = enable(app, id, false);
    }
    Err("the engine did not remove it".to_string())
}

fn control(app: &AppHandle) -> Option<Webview> {
    let _building = BUILDING.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(page) = app.get_webview(CONTROL) {
        return Some(page);
    }
    let page = hidden(app, CONTROL, "chrome://extensions/")?;
    for _ in 0..50 {
        if asked(&page, "typeof chrome.management === 'object'").and_then(|said| said.as_bool())
            == Some(true)
        {
            return Some(page);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

fn hidden(app: &AppHandle, label: &str, address: &str) -> Option<Webview> {
    let window = app.get_window("main")?;
    let address: tauri::Url = address.parse().ok()?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(address))
        .focused(false)
        .disable_drag_drop_handler();
    let builder = crate::engine::web_store(builder, app, None).ok()?;
    let (made, waiting) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let built = crate::engine::add_child(
            &window,
            builder,
            LogicalPosition::new(-10_000.0, -10_000.0),
            LogicalSize::new(400.0, 300.0),
        );
        let _ = made.try_send(built.ok());
    })
    .ok()?;
    waiting.recv_timeout(PATIENCE).ok().flatten()
}

fn asked(page: &Webview, expression: &str) -> Option<Value> {
    let said = devtools::call(
        page,
        None,
        "Runtime.evaluate",
        &json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
        PATIENCE,
    )
    .ok()?;
    if said.get("exceptionDetails").is_some() {
        return None;
    }
    said.get("result")?.get("value").cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(at: &Path) -> PathBuf {
        std::fs::create_dir_all(at).expect("a folder");
        at.to_path_buf()
    }

    #[test]
    fn one_from_a_store_is_read_where_chromium_unpacked_it() {
        let profile = tempfile::tempdir().expect("a profile");
        let id = "eimadpbcbfnmbkopoojfekhnkhdbieeh";
        folder(&profile.path().join(id).join("4.9.0_0"));
        let newest = folder(&profile.path().join(id).join("4.9.0_1"));

        let all =
            [json!({ "id": id, "version": "4.9.0", "enabled": true, "edge": false, "path": null })];
        let found = entries(&all, profile.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, newest);
        assert_eq!(found[0].0.store, Store::Chrome);
    }

    #[test]
    fn one_loaded_unpacked_is_read_where_it_was_loaded_from() {
        let profile = tempfile::tempdir().expect("a profile");
        let loaded = tempfile::tempdir().expect("a folder of its own");
        let id = "ddkjiahejlhfcafbddmgiahcphecmpfh";
        let all = [json!({
            "id": id,
            "version": "2026.1",
            "enabled": false,
            "edge": true,
            "path": loaded.path().to_string_lossy(),
        })];
        let found = entries(&all, profile.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, loaded.path());
        assert!(!found[0].0.enabled);
        assert_eq!(found[0].0.store, Store::Edge);
    }

    #[test]
    fn one_whose_files_are_nowhere_is_left_out() {
        let profile = tempfile::tempdir().expect("a profile");
        let all = [
            json!({ "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "version": "1", "enabled": true, "path": null }),
            json!({ "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "version": "1", "enabled": true, "path": r"C:\nowhere\at\all" }),
        ];
        assert!(entries(&all, profile.path()).is_empty());
    }
}
