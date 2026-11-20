use orden_base::Held as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager as _, Webview, WebviewBuilder, WebviewUrl,
};

use orden_web::engine::devtools;

use super::library::Kept;
use super::link::Store;

const CONTROL: &str = "web-extensions-control";
const LEAVING: &str = "web-extension-leaving";
const PATIENCE: Duration = Duration::from_secs(20);
static USING: Mutex<()> = Mutex::new(());
static REMOVING: Mutex<()> = Mutex::new(());
static UNREACHABLE: AtomicBool = AtomicBool::new(false);
static NUMBERED: AtomicU64 = AtomicU64::new(0);
static OPEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
pub fn own_pages_open() -> Vec<String> {
    OPEN.held().clone()
}
struct Borrowed<T> {
    label: String,
    page: T,
    shut: fn(&T),
}
impl<T> Borrowed<T> {
    fn new(label: String, page: T, shut: fn(&T)) -> Self {
        OPEN.held().push(label.clone());
        Self { label, page, shut }
    }
}
impl<T> Drop for Borrowed<T> {
    fn drop(&mut self) {
        (self.shut)(&self.page);
        OPEN.held().retain(|one| *one != self.label);
    }
}
fn shut(page: &Webview) {
    devtools::let_go_of(page.label());
    let _ = page.close();
}
fn borrowed(app: &AppHandle, name: &str, address: &str) -> Option<Borrowed<Webview>> {
    let label = format!("{name}-{}", NUMBERED.fetch_add(1, Ordering::SeqCst));
    hidden(app, &label, address).map(|page| Borrowed::new(label, page, shut))
}
pub fn installed(app: &AppHandle) -> Vec<(Kept, PathBuf)> {
    let Some(all) = controlled(app, |page| asked(page, LIST)) else {
        static SAID: std::sync::Once = std::sync::Once::new();
        SAID.call_once(|| {
            orden_base::logs::say(
                app,
                "warn",
                "extensions: Chromium's extensions page cannot be opened here, so only Orden's own extensions are listed and they are turned on and off through the browser pipe",
            );
        });
        return Vec::new();
    };
    let Ok(profile) =
        orden_web::engine::root(app).map(|root| root.join("Default").join("Extensions"))
    else {
        return Vec::new();
    };
    entries(all.as_array().map(Vec::as_slice).unwrap_or_default(), &profile)
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
    controlled(app, |page| Some(set(page, id, on)))
        .unwrap_or_else(|| Err("the engine's extensions could not be reached".to_string()))
}
fn set(page: &Webview, id: &str, on: bool) -> Result<(), String> {
    asked(page, &format!("chrome.management.setEnabled({}, {on}).then(() => true)", json!(id)))
        .map(|_| ())
        .ok_or_else(|| "the engine did not change it".to_string())
}
pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    if id.len() != 32 || !id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)) {
        return Err("that is not an extension".to_string());
    }
    let _removing = REMOVING.held();
    controlled(app, |page| Some(removed(app, page, id)))
        .unwrap_or_else(|| Err("the engine's extensions could not be reached".to_string()))
}
fn removed(app: &AppHandle, page: &Webview, id: &str) -> Result<(), String> {
    let held = |expression: &str| asked(page, &expression.replace("ID", &json!(id).to_string()));
    let was_on = held("chrome.management.get(ID).then((one) => one.enabled)")
        .and_then(|on| on.as_bool())
        .ok_or("the engine does not have it")?;
    if !was_on {
        set(page, id, true)?;
    }
    if let Some(own) = borrowed(app, LEAVING, &format!("chrome-extension://{id}/manifest.json")) {
        for _ in 0..50 {
            let ready = asked(&own.page, "typeof chrome.management?.uninstallSelf === 'function'");
            if ready == Some(Value::Bool(true)) {
                let _ = asked(&own.page, "(chrome.management.uninstallSelf(), true)");
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
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
        let _ = set(page, id, false);
    }
    Err("the engine did not remove it".to_string())
}
fn controlled<T>(app: &AppHandle, with: impl FnOnce(&Webview) -> Option<T>) -> Option<T> {
    if UNREACHABLE.load(Ordering::SeqCst) {
        return None;
    }
    let _using = USING.held();
    let page = borrowed(app, CONTROL, "chrome://extensions/")?;
    let mut answered = false;
    for _ in 0..50 {
        match asked(&page.page, "typeof chrome.management === 'object'") {
            Some(Value::Bool(true)) => return with(&page.page),
            Some(_) => answered = true,
            None => {}
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if answered {
        UNREACHABLE.store(true, Ordering::SeqCst);
    }
    None
}
fn hidden(app: &AppHandle, label: &str, address: &str) -> Option<Webview> {
    let window = app.get_window("main")?;
    let address: tauri::Url = address.parse().ok()?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(address))
        .focused(false)
        .disable_drag_drop_handler();
    let builder = orden_web::engine::web_store(builder, app, None).ok()?;
    let (made, waiting) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let built = orden_web::engine::add_child(
            &window,
            builder,
            LogicalPosition::new(-10_000.0, -10_000.0),
            LogicalSize::new(400.0, 300.0),
        );
        if let Ok(view) = &built {
            let _ = view.hide();
        }
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
    use std::cell::RefCell;

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
    #[test]
    fn a_page_orden_opens_for_itself_is_closed_once_used_however_the_use_ends() {
        struct Page(String);
        thread_local! {
            static CLOSED: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
        }
        fn closed(page: &Page) {
            CLOSED.with(|all| all.borrow_mut().push(page.0.clone()));
        }
        let used = |which: &str, fails: bool| -> Option<()> {
            let label = format!("web-extensions-control-{which}");
            let page = Borrowed::new(label, Page(which.to_owned()), closed);
            assert!(own_pages_open().contains(&page.label));
            if fails {
                return None;
            }
            Some(())
        };
        assert_eq!(used("t1", false), Some(()));
        assert_eq!(used("t2", true), None);
        assert!(std::panic::catch_unwind(|| {
            let _page =
                Borrowed::new("web-extension-leaving-t3".to_owned(), Page("t3".to_owned()), closed);
            panic!("a use that breaks")
        })
        .is_err());
        assert!(own_pages_open().iter().all(|one| !one.contains("-t")));
        assert_eq!(CLOSED.with(|all| all.borrow().clone()), ["t1", "t2", "t3"]);
    }
    #[test]
    fn every_page_orden_opens_for_itself_is_borrowed_and_so_closed() {
        let source = include_str!("chromium.rs").replace('\r', "");
        let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
        assert_eq!(code.matches("hidden(app, ").count(), 1, "a page opened outside borrowed()");
        assert!(code
            .contains("hidden(app, &label, address).map(|page| Borrowed::new(label, page, shut))"));
        assert!(!code.contains("get_webview("), "a page kept around to be found again");
    }
}
