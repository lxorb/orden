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
fn borrowed(
    app: &AppHandle,
    name: &str,
    address: &str,
    store: Option<&str>,
) -> Option<Borrowed<Webview>> {
    let label = format!("{name}-{}", NUMBERED.fetch_add(1, Ordering::SeqCst));
    hidden(app, &label, address, store).map(|page| Borrowed::new(label, page, shut))
}
fn profiles() -> Vec<Option<String>> {
    std::iter::once(None).chain(orden_web::engine::stores_open().into_iter().map(Some)).collect()
}
const UNREACHED: &str = "the engine's extensions could not be reached";
fn everywhere(
    stores: &[Option<String>],
    mut each: impl FnMut(Option<&str>) -> Option<Result<bool, String>>,
) -> Result<bool, String> {
    let mut held = false;
    for store in stores {
        match (store, each(store.as_deref())) {
            (_, Some(Err(why))) => return Err(why),
            (_, Some(Ok(had))) => held |= had,
            (None, None) => return Err(UNREACHED.to_owned()),
            (Some(_), None) => {}
        }
    }
    Ok(held)
}
fn holds(page: &Webview, id: &str) -> bool {
    let asking = format!("chrome.management.get({}).then(() => true, () => false)", json!(id));
    asked(page, &asking) == Some(Value::Bool(true))
}
pub fn installed(app: &AppHandle) -> Vec<(Kept, PathBuf)> {
    let Some(all) = controlled(app, None, |page| asked(page, LIST)) else {
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
    let held = everywhere(&profiles(), |store| {
        controlled(app, store, |page| {
            Some(if holds(page, id) { set(page, id, on).map(|()| true) } else { Ok(false) })
        })
    })?;
    if held {
        Ok(())
    } else {
        Err("the engine does not have it".to_string())
    }
}
fn set(page: &Webview, id: &str, on: bool) -> Result<(), String> {
    asked(page, &format!("chrome.management.setEnabled({}, {on}).then(() => true)", json!(id)))
        .map(|_| ())
        .ok_or_else(|| "the engine did not change it".to_string())
}
pub fn woken(app: &AppHandle, store: Option<&str>, ids: &[String]) {
    if !ids.is_empty() {
        let _ = controlled(app, store, |page| asked(page, &waking(ids)));
    }
}
pub fn woken_everywhere(app: &AppHandle, ids: &[String]) {
    for store in profiles() {
        woken(app, store.as_deref(), ids);
    }
}
fn waking(ids: &[String]) -> String {
    format!(
        "Promise.all({}.map((id) => chrome.management.get(id).then((one) => one.enabled || chrome.management.setEnabled(id, true).then(() => true, () => false), () => false)))",
        json!(ids)
    )
}
pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    if id.len() != 32 || !id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)) {
        return Err("that is not an extension".to_string());
    }
    let _removing = REMOVING.held();
    everywhere(&profiles(), |store| {
        controlled(app, store, |page| {
            Some(if holds(page, id) {
                removed(app, store, page, id).map(|()| true)
            } else {
                Ok(false)
            })
        })
    })
    .map(|_| ())
}
fn removed(app: &AppHandle, store: Option<&str>, page: &Webview, id: &str) -> Result<(), String> {
    let held = |expression: &str| asked(page, &expression.replace("ID", &json!(id).to_string()));
    let was_on = held("chrome.management.get(ID).then((one) => one.enabled)")
        .and_then(|on| on.as_bool())
        .ok_or("the engine does not have it")?;
    if !was_on {
        set(page, id, true)?;
    }
    if let Some(own) =
        borrowed(app, LEAVING, &format!("chrome-extension://{id}/manifest.json"), store)
    {
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
const READY: &str = "typeof chrome.management === 'object' || location.href";
const SETTLED: Duration = Duration::from_secs(10);
const LOOK_EVERY: Duration = Duration::from_millis(100);
#[derive(Debug, PartialEq, Eq)]
enum Ready {
    Yes,
    Blocked,
    Not,
}
fn ready(said: Option<&Value>, waited: Duration) -> Ready {
    match said {
        Some(Value::Bool(true)) => Ready::Yes,
        Some(Value::String(at)) if at.starts_with("chrome-error:") => Ready::Blocked,
        Some(Value::String(at)) if waited >= SETTLED && !at.starts_with("chrome://extensions") => {
            Ready::Blocked
        }
        _ => Ready::Not,
    }
}
const ALLOY_ONLY: bool = cfg!(target_os = "macos");
fn worth_trying(alloy_only: bool, unreachable: bool) -> bool {
    !alloy_only && !unreachable
}
fn controlled<T>(
    app: &AppHandle,
    store: Option<&str>,
    with: impl FnOnce(&Webview) -> Option<T>,
) -> Option<T> {
    if !worth_trying(ALLOY_ONLY, UNREACHABLE.load(Ordering::SeqCst)) {
        return None;
    }
    let _using = USING.held();
    let page = borrowed(app, CONTROL, "chrome://extensions/", store)?;
    let (mut waited, mut answered) = (Duration::ZERO, false);
    while waited < PATIENCE {
        let said = asked(&page.page, READY);
        answered |= said.is_some();
        match ready(said.as_ref(), waited) {
            Ready::Yes => return with(&page.page),
            Ready::Blocked => break,
            Ready::Not => {}
        }
        std::thread::sleep(LOOK_EVERY);
        waited += LOOK_EVERY;
    }
    if answered {
        UNREACHABLE.store(true, Ordering::SeqCst);
    }
    None
}
pub fn blocked() -> bool {
    !worth_trying(ALLOY_ONLY, UNREACHABLE.load(Ordering::SeqCst))
}
pub fn has(app: &AppHandle, id: &str) -> Option<bool> {
    everywhere(&profiles(), |store| controlled(app, store, |page| Some(Ok(holds(page, id))))).ok()
}
fn hidden(app: &AppHandle, label: &str, address: &str, store: Option<&str>) -> Option<Webview> {
    let window = app.get_window("main")?;
    let address: tauri::Url = address.parse().ok()?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(address))
        .focused(false)
        .disable_drag_drop_handler();
    let builder = orden_web::engine::web_store(builder, app, store).ok()?;
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
    fn a_change_reaches_every_web_data_that_holds_the_extension_and_fails_only_where_it_must() {
        let stores = [None, Some("note_a".to_owned()), Some("note_b".to_owned())];
        let mut seen = Vec::new();
        let held = everywhere(&stores, |store| {
            seen.push(store.map(str::to_owned));
            Some(Ok(store == Some("note_b")))
        });
        assert_eq!(held, Ok(true));
        assert_eq!(seen, stores.to_vec());
        assert_eq!(everywhere(&stores, |_| Some(Ok(false))), Ok(false));
        assert_eq!(everywhere(&stores, |store| store.map(|_| Ok(true))), Err(UNREACHED.to_owned()));
        assert_eq!(everywhere(&stores, |store| store.is_none().then_some(Ok(true))), Ok(true));
        let mut after = 0;
        let failed = everywhere(&stores, |store| {
            after += 1;
            Some(if store == Some("note_a") { Err("refused".to_owned()) } else { Ok(true) })
        });
        assert_eq!((failed, after), (Err("refused".to_owned()), 2));
    }
    #[test]
    fn one_kept_on_is_turned_back_on_wherever_chromium_still_holds_it_off() {
        let asked = waking(&["a".repeat(32), "b\"');".to_owned()]);
        assert!(
            asked.starts_with(&format!("Promise.all([\"{}\",\"b\\\"');\"].map(", "a".repeat(32))),
            "{asked}"
        );
        assert!(asked.contains("one.enabled || chrome.management.setEnabled(id, true)"));
        assert!(!asked.contains("setEnabled(id, false)"));
    }
    #[test]
    fn every_change_asks_each_web_data_through_a_page_opened_in_it() {
        let source = include_str!("chromium.rs").replace('\r', "");
        let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
        for name in ["pub fn enable(", "pub fn remove(", "pub fn has("] {
            let body = code
                .split(name)
                .nth(1)
                .unwrap_or_default()
                .split("\n}\n")
                .next()
                .unwrap_or_default();
            assert!(body.contains("everywhere(&profiles()"), "{name}");
            assert!(body.contains("controlled(app, store,"), "{name}");
        }
        assert!(code.contains("web_store(builder, app, store)"));
    }
    #[test]
    fn the_extensions_page_is_given_up_only_when_chromium_blocks_it_not_while_it_loads() {
        let at = |href: &str| Value::String(href.to_owned());
        let early = Duration::from_millis(300);
        assert_eq!(ready(Some(&Value::Bool(true)), early), Ready::Yes);
        assert_eq!(ready(Some(&at("chrome-error://chromewebdata/")), early), Ready::Blocked);
        assert_eq!(ready(Some(&at("about:blank")), early), Ready::Not);
        assert_eq!(ready(Some(&at("about:blank")), SETTLED), Ready::Blocked);
        assert_eq!(ready(Some(&at("chrome://extensions/")), SETTLED * 3), Ready::Not);
        assert_eq!(ready(Some(&Value::Bool(false)), SETTLED * 3), Ready::Not);
        assert_eq!(ready(None, SETTLED * 3), Ready::Not);
    }
    #[test]
    fn where_every_tab_is_alloy_the_extensions_page_is_never_tried_so_a_listing_does_not_wait() {
        assert!(worth_trying(false, false));
        assert!(!worth_trying(true, false));
        assert!(!worth_trying(false, true));
        assert_eq!(ALLOY_ONLY, cfg!(target_os = "macos"));
        let source = include_str!("chromium.rs").replace('\r', "");
        let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
        let body = code.split("fn controlled<T>").nth(1).unwrap_or_default();
        let inside = body.split_once("{\n").map(|(_, rest)| rest).unwrap_or_default();
        let first = inside.lines().next().unwrap_or_default();
        assert!(first.contains("worth_trying(ALLOY_ONLY"), "{first}");
    }
    #[test]
    fn every_page_orden_opens_for_itself_is_borrowed_and_so_closed() {
        let source = include_str!("chromium.rs").replace('\r', "");
        let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
        assert_eq!(code.matches("hidden(app, ").count(), 1, "a page opened outside borrowed()");
        assert!(code.contains(
            "hidden(app, &label, address, store).map(|page| Borrowed::new(label, page, shut))"
        ));
        assert!(!code.contains("get_webview("), "a page kept around to be found again");
    }
}
