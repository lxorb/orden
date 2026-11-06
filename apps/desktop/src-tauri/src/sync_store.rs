pub mod chats;
mod store;
mod tables;
mod wire;

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::paths::cannot;
use store::{device_of, files_of, set_aside, Failed, Opened, Store};
use wire::{frame, unframe, Change, Query};

#[derive(Default)]
pub struct Stores(Mutex<Option<Held>>, chats::ChatStores);

struct Held {
    account: String,
    path: PathBuf,
    store: Store,
    led: bool,
}

impl Held {
    fn opened_for(&mut self, lead: bool) -> Result<Opened, String> {
        if lead && self.led {
            let was_clean = self
                .store
                .mark_clean(false)
                .map_err(|failed| failed.to_string())?;
            return Ok(Opened {
                was_clean,
                ..self.store.opened.clone()
            });
        }
        self.led |= lead;
        Ok(self.store.opened.clone())
    }
}

impl Stores {
    fn lock(&self) -> MutexGuard<'_, Option<Held>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn store_path(app: &AppHandle, account: &str) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(folder
        .join("sync")
        .join(format!("{}.db", account_name(account)?)))
}

fn account_name(account: &str) -> Result<&str, String> {
    let fits = !account.is_empty()
        && account.len() <= 64
        && account
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(account)
    } else {
        Err(format!("{account} is not an account id"))
    }
}

#[tauri::command(async)]
pub fn sync_store_open(
    app: AppHandle,
    account: String,
    lead: Option<bool>,
    device: Option<String>,
) -> Result<Opened, String> {
    let lead = lead.unwrap_or(false);
    let path = store_path(&app, &account)?;
    let stores = app.state::<Stores>();
    let mut held = stores.lock();

    if let Some(open) = held.as_mut() {
        if open.account == account {
            return open.opened_for(lead);
        }
    }
    if let Some(other) = held.take() {
        other.store.close()?;
    }

    let store = Store::open_as(&path, device.as_deref()).map_err(|refused| refused.said())?;
    crate::trace::mark("sync store opened");
    let opened = store.opened.clone();
    *held = Some(Held {
        account,
        path,
        store,
        led: lead,
    });
    Ok(opened)
}

#[tauri::command(async)]
pub fn sync_store_device(app: AppHandle, account: String) -> Result<Option<String>, String> {
    Ok(device_of(&store_path(&app, &account)?))
}

#[tauri::command(async)]
pub fn sync_store_close(app: AppHandle) -> Result<(), String> {
    match app.state::<Stores>().lock().take() {
        Some(open) => open.store.close(),
        None => Ok(()),
    }
}

#[tauri::command(async)]
pub fn sync_store_clean_exit(app: AppHandle, clean: bool) -> Result<(), String> {
    with_store(&app, |store| {
        store.mark_clean(clean)?;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn sync_store_read(app: AppHandle, queries: Vec<Query>) -> Result<Response, String> {
    with_store(&app, |store| {
        let (answers, parts) = store.read(&queries)?;
        Ok(Response::new(frame(&answers, &parts)))
    })
}

#[tauri::command(async)]
pub fn sync_store_write(app: AppHandle, request: Request<'_>) -> Result<Vec<usize>, String> {
    let bytes = sent_bytes(request.body())?;
    let (value, parts) = unframe(&bytes)?;
    let changes: Vec<Change> = serde_json::from_value(value)
        .map_err(|error| format!("the sync store was sent an odd change: {error}"))?;

    with_store(&app, |store| store.write(&changes, &parts))
}

#[tauri::command(async)]
pub fn sync_store_forget(app: AppHandle, account: String) -> Result<(), String> {
    let path = store_path(&app, &account)?;
    {
        let stores = app.state::<Stores>();
        let mut held = stores.lock();
        if held.as_ref().is_some_and(|open| open.account == account) {
            if let Some(open) = held.take() {
                open.store.close()?;
            }
        }
    }

    for one in files_of(&path) {
        match fs::remove_file(&one) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(cannot("delete", &one, &error)),
        }
    }
    Ok(())
}

fn sent_bytes(body: &InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(serde_json::Value::Array(numbers)) => numbers
            .iter()
            .map(|one| one.as_u64().and_then(|number| u8::try_from(number).ok()))
            .collect::<Option<Vec<u8>>>()
            .ok_or_else(|| "the sync store was sent something that is not bytes".to_owned()),
        InvokeBody::Json(_) => Err("the sync store was sent something that is not bytes".into()),
    }
}

fn with_store<T>(
    app: &AppHandle,
    act: impl FnOnce(&mut Store) -> Result<T, Failed>,
) -> Result<T, String> {
    let stores = app.state::<Stores>();
    let mut held = stores.lock();
    let open = held.as_mut().ok_or("the sync store is not open")?;

    match act(&mut open.store) {
        Ok(answer) => Ok(answer),
        Err(failed) if failed.damaged => {
            if let Some(open) = held.take() {
                let _ = open.store.close();
                set_aside(&open.path).map_err(|refused| refused.said())?;
            }
            Err(format!(
                "{}; it has been set aside, open it again",
                failed.said
            ))
        }
        Err(failed) => Err(failed.said),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_window_taking_over_hears_how_the_last_ended() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("sync.db");
        let store = Store::open(&path).expect("a store");
        let mut held = Held {
            account: "a".to_string(),
            path,
            store,
            led: false,
        };
        assert!(held.opened_for(false).expect("a look").was_clean);
        assert!(held.opened_for(true).expect("the first").was_clean);
        assert!(!held.opened_for(true).expect("after a crash").was_clean);
        assert!(!held.opened_for(true).expect("again").was_clean);
        held.store.mark_clean(true).expect("said");
        assert!(held.opened_for(true).expect("after a quit").was_clean);
        assert!(!held.opened_for(true).expect("and it crashed").was_clean);
        held.store.mark_clean(true).expect("said");
        let _ = held.opened_for(false).expect("a look");
        assert!(held.opened_for(true).expect("still").was_clean);
    }

    use super::{account_name, sent_bytes, Held, Store};
    use tauri::ipc::InvokeBody;

    #[test]
    fn only_an_account_id_names_a_store() {
        assert!(account_name("5f0c1d7e-2b8a-4c1e-9d3f-0a1b2c3d4e5f").is_ok());
        for odd in [
            "",
            "../escape",
            "a/b",
            "a\\b",
            "C:",
            "name.db",
            &"x".repeat(65),
        ] {
            assert!(account_name(odd).is_err(), "{odd}");
        }
    }

    #[test]
    fn a_write_is_bytes_whichever_way_the_webview_sent_them() {
        assert_eq!(sent_bytes(&InvokeBody::Raw(vec![1, 2])), Ok(vec![1, 2]));
        assert_eq!(
            sent_bytes(&InvokeBody::Json(serde_json::json!([1, 2, 255]))),
            Ok(vec![1, 2, 255])
        );
        assert!(sent_bytes(&InvokeBody::Json(serde_json::json!([256]))).is_err());
        assert!(sent_bytes(&InvokeBody::Json(serde_json::json!({ "0": 1 }))).is_err());
    }
}
