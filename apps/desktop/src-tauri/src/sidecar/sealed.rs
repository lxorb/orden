use std::fs;
use std::io::Write as _;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};

pub trait Vault: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
}

const MAGIC: &[u8; 4] = b"OSS1";
const LEFT_OUT: [&str; 1] = ["attachments"];

#[derive(Debug, PartialEq, Eq)]
pub enum Opened {
    Fresh,
    Restored,
}

fn key_of(text: &str) -> Option<LessSafeKey> {
    let raw = BASE64.decode(text.trim()).ok()?;
    UnboundKey::new(&AES_256_GCM, &raw)
        .ok()
        .map(LessSafeKey::new)
}

fn key_for_sealing(vault: &dyn Vault) -> Result<LessSafeKey, String> {
    if let Some(kept) = vault.get()? {
        return key_of(&kept).ok_or_else(|| "the kept key is not a key".to_owned());
    }
    let mut raw = [0u8; 32];
    getrandom::fill(&mut raw).map_err(|error| error.to_string())?;
    let text = BASE64.encode(raw);
    vault.set(&text)?;
    key_of(&text).ok_or_else(|| "a new key would not take".to_owned())
}

pub fn private_folder(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn packed(live: &Path) -> Result<Vec<u8>, String> {
    let gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut tar = tar::Builder::new(gz);
    tar.follow_symlinks(false);
    let mut names: Vec<_> = fs::read_dir(live)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    names.sort_by_key(fs::DirEntry::file_name);
    for one in names {
        let name = one.file_name();
        if LEFT_OUT.iter().any(|left| name == *left) {
            continue;
        }
        let kind = one.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() {
            tar.append_dir_all(&name, one.path())
                .map_err(|error| error.to_string())?;
        } else if kind.is_file() {
            tar.append_path_with_name(one.path(), &name)
                .map_err(|error| error.to_string())?;
        }
    }
    tar.into_inner()
        .and_then(flate2::write::GzEncoder::finish)
        .map_err(|error| error.to_string())
}

pub fn seal(live: &Path, file: &Path, vault: &dyn Vault) -> Result<(), String> {
    let key = key_for_sealing(vault)?;
    let mut data = packed(live)?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|error| error.to_string())?;
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(MAGIC),
        &mut data,
    )
    .map_err(|_| "the state would not seal".to_owned())?;
    let part = file.with_extension("part");
    let mut out = fs::File::create(&part).map_err(|error| error.to_string())?;
    out.write_all(MAGIC)
        .and_then(|()| out.write_all(&nonce))
        .and_then(|()| out.write_all(&data))
        .and_then(|()| out.sync_all())
        .map_err(|error| error.to_string())?;
    drop(out);
    fs::rename(&part, file).map_err(|error| error.to_string())
}

fn opened(bytes: &mut [u8], key: &LessSafeKey) -> Option<Vec<u8>> {
    if !bytes.starts_with(MAGIC) {
        return None;
    }
    let rest = &mut bytes[MAGIC.len()..];
    if rest.len() < NONCE_LEN {
        return None;
    }
    let (nonce, data) = rest.split_at_mut(NONCE_LEN);
    let nonce = Nonce::try_assume_unique_for_key(nonce).ok()?;
    key.open_in_place(nonce, Aad::from(MAGIC), data)
        .ok()
        .map(|plain| plain.to_vec())
}

pub fn unseal(file: &Path, live: &Path, vault: &dyn Vault) -> Result<Opened, String> {
    if live.exists() {
        private_folder(live)?;
        return Ok(Opened::Restored);
    }
    let kept = vault.get()?;
    let plain = match (fs::read(file), kept.as_deref().and_then(key_of)) {
        (Ok(mut bytes), Some(key)) => opened(&mut bytes, &key),
        _ => None,
    };
    let part = live.with_extension("part");
    let _ = fs::remove_dir_all(&part);
    private_folder(&part)?;
    let Some(plain) = plain else {
        fs::rename(&part, live).map_err(|error| error.to_string())?;
        return Ok(Opened::Fresh);
    };
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(plain.as_slice()));
    tar.unpack(&part).map_err(|error| error.to_string())?;
    fs::rename(&part, live).map_err(|error| error.to_string())?;
    private_folder(live)?;
    Ok(Opened::Restored)
}

#[cfg(test)]
mod tests {
    use super::{seal, unseal, Opened, Vault};
    use std::fs;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Kept(Mutex<Option<String>>);

    impl Vault for Kept {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }
    }

    struct Locked;

    impl Vault for Locked {
        fn get(&self) -> Result<Option<String>, String> {
            Err("the keyring is locked".to_owned())
        }
        fn set(&self, _value: &str) -> Result<(), String> {
            Err("the keyring is locked".to_owned())
        }
    }

    fn filled(live: &std::path::Path) {
        fs::create_dir_all(live.join("data/acct.d")).unwrap();
        fs::write(live.join("data/accounts.json"), b"{\"accounts\":[]}").unwrap();
        fs::write(live.join("data/acct.d/account.db"), b"identity keys").unwrap();
        fs::create_dir_all(live.join("attachments")).unwrap();
        fs::write(live.join("attachments/big"), b"a picture").unwrap();
    }

    #[test]
    fn the_state_sealed_away_comes_back_without_its_attachments() {
        let folder = tempfile::tempdir().unwrap();
        let live = folder.path().join("live");
        let file = folder.path().join("state.sealed");
        filled(&live);
        let vault = Kept::default();
        seal(&live, &file, &vault).unwrap();
        let sealed = fs::read(&file).unwrap();
        assert!(!sealed
            .windows(b"identity keys".len())
            .any(|one| one == b"identity keys"));
        fs::remove_dir_all(&live).unwrap();
        assert_eq!(unseal(&file, &live, &vault).unwrap(), Opened::Restored);
        assert_eq!(
            fs::read(live.join("data/acct.d/account.db")).unwrap(),
            b"identity keys"
        );
        assert!(!live.join("attachments").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = fs::metadata(&live).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
    }

    #[test]
    fn a_folder_left_by_a_crash_is_newer_than_the_sealed_state_and_is_kept() {
        let folder = tempfile::tempdir().unwrap();
        let live = folder.path().join("live");
        let file = folder.path().join("state.sealed");
        filled(&live);
        let vault = Kept::default();
        seal(&live, &file, &vault).unwrap();
        fs::write(live.join("data/acct.d/account.db"), b"a later ratchet").unwrap();
        assert_eq!(unseal(&file, &live, &vault).unwrap(), Opened::Restored);
        assert_eq!(
            fs::read(live.join("data/acct.d/account.db")).unwrap(),
            b"a later ratchet"
        );
    }

    #[test]
    fn a_state_sealed_with_another_key_or_changed_is_not_opened() {
        let folder = tempfile::tempdir().unwrap();
        let live = folder.path().join("live");
        let file = folder.path().join("state.sealed");
        filled(&live);
        seal(&live, &file, &Kept::default()).unwrap();
        fs::remove_dir_all(&live).unwrap();
        assert_eq!(
            unseal(&file, &live, &Kept::default()).unwrap(),
            Opened::Fresh
        );
        assert!(!live.join("data").exists());
        fs::remove_dir_all(&live).unwrap();

        let vault = Kept::default();
        filled(&live);
        seal(&live, &file, &vault).unwrap();
        fs::remove_dir_all(&live).unwrap();
        let mut bytes = fs::read(&file).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(&file, bytes).unwrap();
        assert_eq!(unseal(&file, &live, &vault).unwrap(), Opened::Fresh);
    }

    #[test]
    fn a_vault_that_cannot_be_read_stops_the_start_and_keeps_what_was_sealed() {
        let folder = tempfile::tempdir().unwrap();
        let live = folder.path().join("live");
        let file = folder.path().join("state.sealed");
        filled(&live);
        seal(&live, &file, &Kept::default()).unwrap();
        fs::remove_dir_all(&live).unwrap();
        let before = fs::read(&file).unwrap();
        assert!(unseal(&file, &live, &Locked).is_err());
        assert!(!live.exists());
        assert_eq!(fs::read(&file).unwrap(), before);
        filled(&live);
        assert!(seal(&live, &file, &Locked).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
    }
}
