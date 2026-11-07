use std::collections::BTreeMap;

use tauri::AppHandle;

#[cfg(not(target_os = "macos"))]
mod store {
    use keyring::{Entry, Error};
    use tauri::AppHandle;

    use super::file;

    fn entry(service: &str, account: &str) -> Result<Entry, Error> {
        Entry::new(service, account)
    }

    fn read(service: &str, account: &str) -> Result<Option<String>, Error> {
        match entry(service, account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn forget(service: &str, account: &str) -> Result<(), Error> {
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn kept(account: &str) -> Result<Option<String>, Error> {
        if let Some(secret) = read(super::SERVICE, account)? {
            return Ok(Some(secret));
        }
        let Some(secret) = read(super::FORMER_SERVICE, account)? else {
            return Ok(None);
        };
        if entry(super::SERVICE, account)?
            .set_password(&secret)
            .is_ok()
        {
            let _ = forget(super::FORMER_SERVICE, account);
        }
        Ok(Some(secret))
    }

    fn away(error: &Error) -> bool {
        matches!(error, Error::PlatformFailure(_) | Error::NoStorageAccess(_))
    }

    pub(super) fn either(
        kept: Result<Option<String>, Error>,
        filed: impl FnOnce() -> Result<Option<String>, String>,
    ) -> Result<Option<String>, String> {
        match kept {
            Ok(Some(secret)) => Ok(Some(secret)),
            Ok(None) => filed(),
            Err(error) if away(&error) => filed(),
            Err(error) => Err(error.to_string()),
        }
    }

    pub(super) fn wrote(
        kept: Result<(), Error>,
        then: impl FnOnce() -> Result<(), String>,
        instead: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        match kept {
            Ok(()) => then(),
            Err(error) if away(&error) => instead(),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn get(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
        let kept = kept(account);
        let reachable = matches!(kept, Ok(None));
        let found = either(kept, || file::get(app, account))?;
        if let (true, Some(secret)) = (reachable, &found) {
            if entry(super::SERVICE, account)
                .and_then(|one| one.set_password(secret))
                .is_ok()
            {
                let _ = file::delete(app, account);
            }
        }
        Ok(found)
    }

    pub fn in_file(app: &AppHandle) -> bool {
        let probed = entry(super::SERVICE, PROBE).and_then(|one| one.get_password());
        matches!(&probed, Err(error) if away(error)) || file::holds_any(app)
    }

    const PROBE: &str = "orden-keyring-probe";

    pub fn set(app: &AppHandle, account: &str, secret: &str) -> Result<(), String> {
        let written = entry(super::SERVICE, account).and_then(|one| one.set_password(secret));
        if written.is_ok() {
            let _ = forget(super::FORMER_SERVICE, account);
        }
        wrote(
            written,
            || file::delete(app, account),
            || file::set(app, account, secret),
        )
    }

    pub fn delete(app: &AppHandle, account: &str) -> Result<(), String> {
        wrote(
            forget(super::SERVICE, account).and_then(|()| forget(super::FORMER_SERVICE, account)),
            || file::delete(app, account),
            || file::delete(app, account),
        )
    }
}

#[cfg(target_os = "macos")]
mod store {
    pub use super::file::{delete, get, set};

    pub fn in_file(_app: &tauri::AppHandle) -> bool {
        false
    }
}

mod file {
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

    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub fn holds_any(app: &AppHandle) -> bool {
        let _held = HELD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        file(app)
            .and_then(|path| super::read_file(&path))
            .is_ok_and(|kept| !kept.is_empty())
    }
}

const FILE: &str = "secrets.json";

fn read_file(path: &std::path::Path) -> Result<BTreeMap<String, String>, String> {
    #[cfg(unix)]
    if let Some(folder) = path.parent() {
        private(folder, 0o700);
        private(path, 0o600);
    }
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("the secrets file would not read: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(format!("could not read the secrets file: {error}")),
    }
}

fn write_file(path: &std::path::Path, kept: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        crate::paths::made(folder)?;
        #[cfg(unix)]
        private(folder, 0o700);
    }
    let text = serde_json::to_vec(kept).map_err(|error| error.to_string())?;
    crate::paths::write_privately(path, &text)
}

#[cfg(unix)]
fn private(path: &std::path::Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt as _;
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return;
    };
    if meta.file_type().is_symlink() || meta.permissions().mode() & 0o777 == mode {
        return;
    }
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
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
pub(crate) const SERVICE: &str = "orden";

#[cfg_attr(target_os = "macos", allow(dead_code))]
const FORMER_SERVICE: &str = "nibeditor";

fn named(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || one == '-' || one == '_');

    if ok {
        Ok(name.to_owned())
    } else {
        Err("that is not a key Orden keeps".to_owned())
    }
}

pub(crate) fn filed(name: &str, identifier: &str) -> Result<String, String> {
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
pub fn secrets_in_file(app: AppHandle) -> bool {
    store::in_file(&app)
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
            let mode =
                |at: &std::path::Path| std::fs::metadata(at).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(&folder), 0o700);
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(read_file(&path).unwrap(), kept);
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(&folder), 0o700);
            let left: Vec<_> = std::fs::read_dir(&folder).unwrap().collect();
            assert_eq!(left.len(), 1);
        }
        std::fs::write(&path, b"not json").unwrap();
        assert!(read_file(&path).is_err());
        let _ = std::fs::remove_dir_all(folder);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn a_keyring_that_is_not_there_keeps_keys_in_the_file() {
        use super::store::{either, wrote};
        use keyring::Error;
        let gone = || Error::PlatformFailure("no secret service".into());
        let filed = || Ok(Some("sk".to_owned()));
        assert_eq!(either(Err(gone()), filed), Ok(Some("sk".to_owned())));
        assert_eq!(either(Ok(None), filed), Ok(Some("sk".to_owned())));
        assert_eq!(
            either(Ok(Some("kept".to_owned())), || Err("unread".to_owned())),
            Ok(Some("kept".to_owned()))
        );
        assert!(either(Err(Error::TooLong("name".into(), 1)), filed).is_err());
        assert_eq!(
            wrote(Err(gone()), || Err("kept".to_owned()), || Ok(())),
            Ok(())
        );
        assert_eq!(wrote(Ok(()), || Ok(()), || Err("filed".to_owned())), Ok(()));
        assert!(wrote(Err(Error::TooLong("name".into(), 1)), || Ok(()), || Ok(())).is_err());
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
