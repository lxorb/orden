//! The keys an AI provider is reached with, and Orden's other secrets.
//!
//! A provider key is the one secret Orden holds that is worth money to whoever takes
//! it, and it is the reader's own. No log ever prints one, and the account never sees
//! one: it reaches the reader's other devices only sealed end to end, in the AI vault
//! the window seals (src/lib/ai/vault), which the account holds as ciphertext.
//!
//! **Where.** On Windows the Credential Manager and on Linux the Secret Service
//! (gnome-keyring or `KWallet`), through the `keyring` crate; the iPhone's keychain,
//! which asks nothing. On a Mac a file of Orden's own, readable by its owner alone
//! (0600) in the app's data folder - the way Claude Code and Codex keep a login on Linux
//! (#1090). Never the Mac's keychain: every read of an item there asks for the login
//! password whenever the app's signature and the item's access list disagree, and asked
//! again the moment it was answered. Nothing is read from the keychain either, so a key
//! kept there by an older Orden is left where it is and typed again, once; the AI pane
//! says why.
//!
//! The rest of the app reaches every one of these through [`get`], [`set`] and
//! [`delete`] (`chatgpt.rs` too), so there is one place that says where a secret goes.
//!
//! Android keeps them in `EncryptedSharedPreferences`, which is its own answer and is
//! reached through the activity rather than through Rust; see `Secrets` in
//! MainActivity.kt and `keys.ts` in the app. A browser has no keychain at all and says
//! so; see web/commands.ts.
//!
//! Three commands and nothing else: a key can be written, read back by the app
//! that wrote it, and taken away. Reading it back is what lets a provider be used
//! at all, since the request is made in the webview.

use std::collections::BTreeMap;

use tauri::AppHandle;

/// The store this platform keeps secrets in.
#[cfg(not(target_os = "macos"))]
mod store {
    use keyring::{Entry, Error};
    use tauri::AppHandle;

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new(super::SERVICE, account).map_err(|error| error.to_string())
    }

    pub fn get(_app: &AppHandle, account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn set(_app: &AppHandle, account: &str, secret: &str) -> Result<(), String> {
        entry(account)?
            .set_password(secret)
            .map_err(|error| error.to_string())
    }

    pub fn delete(_app: &AppHandle, account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// The store a Mac keeps secrets in: one file of the app's own, owner-only (#1090).
#[cfg(target_os = "macos")]
mod store {
    use std::sync::Mutex;

    use tauri::{AppHandle, Manager as _};

    /// One read, change and write of the file at a time.
    static HELD: Mutex<()> = Mutex::new(());

    fn file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        let folder = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("could not find the app's data folder: {error}"))?;
        Ok(folder.join(super::FILE))
    }

    pub fn get(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
        let _held = HELD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Ok(super::read_file(&file(app)?)?.remove(account))
    }

    pub fn set(app: &AppHandle, account: &str, secret: &str) -> Result<(), String> {
        let _held = HELD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let path = file(app)?;
        let mut kept = super::read_file(&path)?;
        kept.insert(account.to_owned(), secret.to_owned());
        super::write_file(&path, &kept)
    }

    pub fn delete(app: &AppHandle, account: &str) -> Result<(), String> {
        let _held = HELD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let path = file(app)?;
        let mut kept = super::read_file(&path)?;
        if kept.remove(account).is_some() {
            super::write_file(&path, &kept)?;
        }
        Ok(())
    }
}

/// The file a Mac keeps its secrets in, in the app's data folder.
#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
const FILE: &str = "secrets.json";

/// The secrets a file holds, by account; none where there is no file yet. A file that
/// does not read is an error rather than nothing, so a write never empties it.
#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn read_file(path: &std::path::Path) -> Result<BTreeMap<String, String>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("the secrets file would not read: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(format!("could not read the secrets file: {error}")),
    }
}

/// Writes them whole, readable by the owner alone.
#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn write_file(path: &std::path::Path, kept: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        crate::paths::made(folder)?;
    }
    let text = serde_json::to_vec(kept).map_err(|error| error.to_string())?;
    crate::paths::write_privately(path, &text)
}

/// A secret of the app's own under `account`, wherever this platform keeps them.
pub(crate) fn get(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
    store::get(app, account)
}

/// Keeps one, replacing whatever was there.
pub(crate) fn set(app: &AppHandle, account: &str, secret: &str) -> Result<(), String> {
    store::set(app, account, secret)
}

/// Takes one away; one that was never there is not a failure.
pub(crate) fn delete(app: &AppHandle, account: &str) -> Result<(), String> {
    store::delete(app, account)
}

/// The identifier the app ships under: its secrets are filed under their plain names.
const SHIPPED: &str = "ch.emilvinu.nib";

/// What the keychain files these under. One service for the app, with the
/// provider's own id as the account, so a reader looking at their keychain sees
/// one entry per provider rather than an unexplained blob. The keys web logins used
/// while they travelled between computers (#393) were filed under it too, and are left
/// where they are.
///
/// Still `nibeditor`, the product's name when the first key was filed, and never to be
/// renamed: every key a reader stored is under it, and a new name would find none.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) const SERVICE: &str = "nibeditor";

/// Refuses a name that is not one of ours.
///
/// The name reaches here from the webview, and a keychain is a store the whole
/// machine shares: without this, a page could ask for the entry another
/// application keeps under a name it guessed. Every name the app uses is a
/// provider id, which it makes itself out of these characters; see `providers.ts`.
fn named(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || one == '-' || one == '_');

    if ok {
        Ok(name.to_owned())
    } else {
        Err("that is not a key nib keeps".to_owned())
    }
}

/// The keychain account a name is filed under: the name itself for the app that ships,
/// and the name with `@<identifier>` after it for any other build, a probe or a
/// development build under an identifier of its own. The keychain is the user's and
/// outlives every build, so a probe must never read, write or forget the keys of the
/// app somebody installed.
fn filed(name: &str, identifier: &str) -> Result<String, String> {
    let name = named(name)?;
    Ok(if identifier == SHIPPED {
        name
    } else {
        format!("{name}@{identifier}")
    })
}

/// The key kept under `name`, or nothing where none is. An unreadable store is an
/// error and not an absence: a reader whose keyring is locked should be told that rather
/// than told their key has gone.
#[tauri::command(async)]
pub fn secret_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    get(&app, &filed(&name, &app.config().identifier)?)
}

/// Writes one, replacing whatever was there.
#[tauri::command(async)]
pub fn secret_write(app: AppHandle, name: String, secret: String) -> Result<(), String> {
    set(&app, &filed(&name, &app.config().identifier)?, &secret)
}

/// Takes one away. A key that was never there is not a failure: taking away what
/// is already gone is what the caller asked for.
#[tauri::command(async)]
pub fn secret_forget(app: AppHandle, name: String) -> Result<(), String> {
    delete(&app, &filed(&name, &app.config().identifier)?)
}

#[cfg(test)]
mod tests {
    use super::{filed, named, read_file, write_file};

    #[test]
    fn a_secrets_file_is_the_owners_alone_and_reads_back() {
        let folder = std::env::temp_dir().join(format!("nib-secrets-{}", std::process::id()));
        let path = folder.join(super::FILE);
        assert!(read_file(&path).unwrap().is_empty());
        let mut kept = std::collections::BTreeMap::new();
        kept.insert("openai".to_owned(), "sk-one".to_owned());
        write_file(&path, &kept).unwrap();
        assert_eq!(read_file(&path).unwrap(), kept);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        std::fs::write(&path, b"not json").unwrap();
        assert!(read_file(&path).is_err());
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_build_other_than_the_shipped_one_files_its_secrets_apart() {
        assert_eq!(filed("openai", "ch.emilvinu.nib").as_deref(), Ok("openai"));
        assert_eq!(
            filed("openai", "ch.emilvinu.nib.probe.x").as_deref(),
            Ok("openai@ch.emilvinu.nib.probe.x")
        );
        assert!(filed("a b", "ch.emilvinu.nib").is_err());
    }

    #[test]
    fn accepts_a_provider_id() {
        assert_eq!(named("openai").as_deref(), Ok("openai"));
        assert_eq!(named("compatible-1").as_deref(), Ok("compatible-1"));
        assert_eq!(named("a_b").as_deref(), Ok("a_b"));
    }

    #[test]
    fn refuses_anything_else() {
        for name in ["", "with space", "sl/ash", "Chrome Safe Storage", "ö"] {
            assert!(named(name).is_err(), "{name}");
        }
    }

    #[test]
    fn refuses_a_name_longer_than_any_of_ours() {
        assert!(named(&"a".repeat(65)).is_err());
    }
}
