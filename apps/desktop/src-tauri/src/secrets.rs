use std::collections::BTreeMap;

use tauri::AppHandle;

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

#[cfg(target_os = "macos")]
mod store {
    use std::sync::Mutex;

    use tauri::{AppHandle, Manager as _};

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

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
const FILE: &str = "secrets.json";

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn read_file(path: &std::path::Path) -> Result<BTreeMap<String, String>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("the secrets file would not read: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(format!("could not read the secrets file: {error}")),
    }
}

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn write_file(path: &std::path::Path, kept: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        crate::paths::made(folder)?;
    }
    let text = serde_json::to_vec(kept).map_err(|error| error.to_string())?;
    crate::paths::write_privately(path, &text)
}

pub(crate) fn get(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
    store::get(app, account)
}

pub(crate) fn set(app: &AppHandle, account: &str, secret: &str) -> Result<(), String> {
    store::set(app, account, secret)
}

pub(crate) fn delete(app: &AppHandle, account: &str) -> Result<(), String> {
    store::delete(app, account)
}

const SHIPPED: &str = "so.orden.Orden";

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) const SERVICE: &str = "nibeditor";

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

fn filed(name: &str, identifier: &str) -> Result<String, String> {
    let name = named(name)?;
    Ok(if identifier == SHIPPED {
        name
    } else {
        format!("{name}@{identifier}")
    })
}

#[tauri::command(async)]
pub fn secret_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    get(&app, &filed(&name, &app.config().identifier)?)
}

#[tauri::command(async)]
pub fn secret_write(app: AppHandle, name: String, secret: String) -> Result<(), String> {
    set(&app, &filed(&name, &app.config().identifier)?, &secret)
}

#[tauri::command(async)]
pub fn secret_forget(app: AppHandle, name: String) -> Result<(), String> {
    delete(&app, &filed(&name, &app.config().identifier)?)
}

#[cfg(test)]
mod tests {
    use super::{filed, named, read_file, write_file};

    #[test]
    fn a_secrets_file_is_the_owners_alone_and_reads_back() {
        let folder = std::env::temp_dir().join(format!("orden-secrets-{}", std::process::id()));
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
        assert_eq!(filed("openai", "so.orden.Orden").as_deref(), Ok("openai"));
        assert_eq!(
            filed("openai", "so.orden.Orden.probe.x").as_deref(),
            Ok("openai@so.orden.Orden.probe.x")
        );
        assert!(filed("a b", "so.orden.Orden").is_err());
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
