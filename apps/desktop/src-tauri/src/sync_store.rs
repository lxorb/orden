//! The device's half of sync v2: one SQLite file per account, holding what the account
//! has confirmed of every document, what this device has not sent yet, what Orden last
//! wrote to each file, the tree ops waiting to go up and the notes held for a question.
//! docs/sync-v2.md section 9.2 is the schema; this module is the storage and nothing of
//! the sync itself, which is the engine's in `src/lib/sync2`.
//!
//! The store lives in the app's local data folder (`sync/<account>.db`), never in a
//! roaming one: the device id in it names this machine, and a copy of it arriving on a
//! second computer would be two devices answering to one name.
//!
//! Nothing here runs at launch. The store is opened when the engine first asks, which
//! is after the first paint, and every command is `async`, so opening, reading and
//! writing all happen on a thread of the runtime rather than on the one the window
//! paints from. A pass is a handful of calls rather than one per note: a read carries
//! a list of questions and answers them from one snapshot, and a write carries a list
//! of changes and applies them in one transaction. Bytes cross the bridge as bytes, in
//! sync v2's own envelope; see `sync_store/wire.rs`.
//!
//! One store is open at a time, because one account is signed in at a time. The
//! browser build keeps the same tables in `IndexedDB`; see `src/lib/web/sync-store.ts`.

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

/// The store that is open, if one is, and whose it is; and the chats' store beside it
/// (chats.rs), which keeps its own.
#[derive(Default)]
pub struct Stores(Mutex<Option<Held>>, chats::ChatStores);

struct Held {
    account: String,
    path: PathBuf,
    store: Store,
    /// Whether the window running the engine has asked for this store yet.
    led: bool,
}

impl Held {
    /// What one who asks for the store already open hears; see `sync_store_open`.
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
        // A panic while a store was held leaves a store that is still a store: SQLite
        // rolled back whatever transaction the panic interrupted.
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Where an account's store is kept.
fn store_path(app: &AppHandle, account: &str) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(folder
        .join("sync")
        .join(format!("{}.db", account_name(account)?)))
}

/// An account id as the name of a file: the account's own ids are UUIDs, so anything
/// else is refused rather than made safe, and no id can name a file outside the folder.
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

/// Opens the account's store, or answers the one already open for it: the device id,
/// whether the last session ended cleanly, the schema, and whether a damaged file had to
/// be replaced. A different account's store is closed first.
///
/// `lead` is the window running the device's one engine asking. The store outlives any
/// window, so the first such window hears how the last launch ended, and each one after it
/// is taking over: it hears how the one before it ended, which a crashed window never said
/// was clean, and the session is marked not ended again. Anyone else asking changes
/// nothing. `device` is the id a store made now takes (`Store::open_as`).
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
    // On the launch trace, so it can be seen to come after the first paint; see trace.rs.
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

/// The device id the account's store keeps, read beside it and never through it: no
/// store is opened, closed or marked, so it is safe whichever window's engine holds the
/// store, and it changes nothing about how the last session ended. None before the
/// account has a store on this device.
#[tauri::command(async)]
pub fn sync_store_device(app: AppHandle, account: String) -> Result<Option<String>, String> {
    Ok(device_of(&store_path(&app, &account)?))
}

/// Closes the store. Says nothing about whether the session ended cleanly; that is
/// `sync_store_clean_exit`.
#[tauri::command(async)]
pub fn sync_store_close(app: AppHandle) -> Result<(), String> {
    match app.state::<Stores>().lock().take() {
        Some(open) => open.store.close(),
        None => Ok(()),
    }
}

/// Says whether this session is ending cleanly: true once the engine has written down
/// everything it held, as the app quits; false again at the next open.
#[tauri::command(async)]
pub fn sync_store_clean_exit(app: AppHandle, clean: bool) -> Result<(), String> {
    with_store(&app, |store| {
        store.mark_clean(clean)?;
        Ok(())
    })
}

/// Answers a list of questions from one snapshot of the store, as one envelope: the
/// answers, one per question, with every blob in them a part. At most `MOST_PARTS`
/// blobs in one answer; ask for more in batches.
#[tauri::command(async)]
pub fn sync_store_read(app: AppHandle, queries: Vec<Query>) -> Result<Response, String> {
    with_store(&app, |store| {
        let (answers, parts) = store.read(&queries)?;
        Ok(Response::new(frame(&answers, &parts)))
    })
}

/// Applies a list of changes in one transaction, sent as one envelope, and answers how
/// many rows each touched. Nothing of a batch is written unless all of it is.
#[tauri::command(async)]
pub fn sync_store_write(app: AppHandle, request: Request<'_>) -> Result<Vec<usize>, String> {
    let bytes = sent_bytes(request.body())?;
    let (value, parts) = unframe(&bytes)?;
    let changes: Vec<Change> = serde_json::from_value(value)
        .map_err(|error| format!("the sync store was sent an odd change: {error}"))?;

    with_store(&app, |store| store.write(&changes, &parts))
}

/// Closes the account's store if it is open and deletes it, with its log, its index and
/// any damaged copy: signing out leaves nothing of the account's sync on the device.
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

/// The bytes a write was sent as: the raw body on a desktop and an iPhone, and a list
/// of numbers on Android, whose webview cannot hand a request body over any other way.
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

/// Runs `act` on the open store. A store found damaged while it is used is set aside
/// and closed, and the sentence says to open it again, which makes a new one: the engine
/// then rebuilds it the way it does after `recovered`.
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
    /// The store outlives a window. A window taking the engine over hears how the one before
    /// it ended, and the hub asking for the device id changes nothing.
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
        // A new store has no history for a rotation to protect: the launch's word.
        assert!(held.opened_for(false).expect("a look").was_clean);
        assert!(held.opened_for(true).expect("the first").was_clean);
        // That window crashed, saying nothing: the next must rotate, as must the one after.
        assert!(!held.opened_for(true).expect("after a crash").was_clean);
        assert!(!held.opened_for(true).expect("again").was_clean);
        // A real end says so, and the one who takes over is the session not ended again.
        held.store.mark_clean(true).expect("said");
        assert!(held.opened_for(true).expect("after a quit").was_clean);
        assert!(!held.opened_for(true).expect("and it crashed").was_clean);
        // A look in between changes nothing.
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
