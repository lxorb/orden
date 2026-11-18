use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

mod databases;

const CARRIED: &str = "old-engine-carried";

const DATABASES_CARRIED: &str = "old-engine-databases-carried";

const CHROMIUM_DATABASES: &str = "EBWebView/Default/IndexedDB";

const WAITING_SCRIPT: &str = "window.ordenOldDatabases = true;";

static WAITING: Mutex<Option<String>> = Mutex::new(None);

const CHROMIUM_ORIGIN: &[u8] = b"_http://tauri.localhost\0";

const CHROMIUM_STORAGE: &str = "EBWebView/Default/Local Storage/leveldb";

const WEBKIT_LEGACY: &str = "tauri_localhost_0.localstorage";

const WEBKIT_STORE: &str = "localstorage.sqlite3";

const TABLE_MAGIC: u64 = 0xdb47_7524_8b80_fb57;

const LOG_BLOCK: usize = 32768;

type Values = BTreeMap<String, String>;

pub fn carry_storage(identifier: &str) {
    let Some(config) = dirs::config_dir().map(|dir| dir.join(identifier)) else {
        return;
    };
    let homes: Vec<Home> = [identifier, crate::old_home::OLD]
        .into_iter()
        .map(|name| Home {
            chromium: dirs::data_local_dir().map(|dir| dir.join(name).join(CHROMIUM_STORAGE)),
            databases: dirs::data_local_dir().map(|dir| dir.join(name).join(CHROMIUM_DATABASES)),
            webkit: dirs::home_dir().map(|dir| dir.join("Library/WebKit").join(name)),
        })
        .collect();
    carry(&config, &homes);
    carry_databases(&config, &homes);
}

struct Home {
    chromium: Option<PathBuf>,
    databases: Option<PathBuf>,
    webkit: Option<PathBuf>,
}

fn waiting() -> MutexGuard<'static, Option<String>> {
    WAITING.lock().unwrap_or_else(PoisonError::into_inner)
}

fn carry_databases(config: &Path, homes: &[Home]) {
    if config.join(DATABASES_CARRIED).exists() {
        return;
    }
    let profile = config
        .join(orden_web_engine::ROOT)
        .join(orden_web_engine::APP_PROFILE);
    for home in homes {
        if let Some(old) = home.databases.as_deref().filter(|dir| dir.is_dir()) {
            if databases::carry_chromium(old, &profile).is_ok() {
                databases_carried(config);
            }
            return;
        }
        if let Some(dir) = home.webkit.as_deref().filter(|dir| dir.is_dir()) {
            let found = databases::webkit(dir);
            if found.is_empty() {
                databases_carried(config);
            } else {
                *waiting() = serde_json::to_string(&found).ok();
            }
            return;
        }
    }
}

fn databases_carried(config: &Path) {
    if orden_base::paths::made(config).is_ok() {
        let _ = orden_base::paths::write_atomically(&config.join(DATABASES_CARRIED), b"");
    }
}

pub fn script() -> &'static str {
    if waiting().is_some() {
        WAITING_SCRIPT
    } else {
        ""
    }
}

#[tauri::command(async)]
pub fn old_engine_databases() -> Option<String> {
    waiting().clone()
}

#[tauri::command(async)]
pub fn old_engine_databases_carried(app: tauri::AppHandle) {
    if waiting().take().is_some() {
        if let Ok(config) = orden_base::paths::config_dir(&app) {
            databases_carried(&config);
        }
    }
}

fn carry(config: &Path, homes: &[Home]) {
    let done = config.join(CARRIED);
    if done.exists() {
        return;
    }
    let Some(values) = homes.iter().find_map(left_in) else {
        return;
    };
    let folder = config.join(crate::kept::FOLDER);
    let mut whole = true;
    for (key, value) in values {
        whole &= crate::kept::keep_unless_said(&folder, &key, value).is_ok();
    }
    if whole && orden_base::paths::made(config).is_ok() {
        let _ = orden_base::paths::write_atomically(&done, b"");
    }
}

fn left_in(home: &Home) -> Option<Values> {
    if let Some(dir) = home.chromium.as_deref().filter(|dir| dir.is_dir()) {
        return Some(chromium(dir));
    }
    let dir = home.webkit.as_deref().filter(|dir| dir.is_dir())?;
    Some(webkit(dir))
}

struct Latest(BTreeMap<Vec<u8>, (u64, Option<Vec<u8>>)>);

impl Latest {
    fn heard(&mut self, key: &[u8], sequence: u64, value: Option<&[u8]>) {
        if !key.starts_with(CHROMIUM_ORIGIN) {
            return;
        }
        if self.0.get(key).is_some_and(|(at, _)| *at >= sequence) {
            return;
        }
        self.0
            .insert(key.to_vec(), (sequence, value.map(<[u8]>::to_vec)));
    }
}

fn chromium(dir: &Path) -> Values {
    let mut latest = Latest(BTreeMap::new());
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let kind = path.extension().and_then(|one| one.to_str()).unwrap_or("");
        if !matches!(kind, "ldb" | "sst" | "log") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if kind == "log" {
            log(&bytes, &mut latest);
        } else {
            let _ = table(&bytes, &mut latest);
        }
    }
    latest
        .0
        .into_iter()
        .filter_map(|(key, (_, value))| {
            Some((
                chromium_text(&key[CHROMIUM_ORIGIN.len()..])?,
                chromium_text(&value?)?,
            ))
        })
        .collect()
}

fn chromium_text(bytes: &[u8]) -> Option<String> {
    let (kind, rest) = bytes.split_first()?;
    match kind {
        0 => utf16(rest),
        1 => Some(rest.iter().map(|byte| char::from(*byte)).collect()),
        _ => None,
    }
}

fn utf16(bytes: &[u8]) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    String::from_utf16(&units).ok()
}

fn varint(bytes: &[u8], mut at: usize) -> Option<(usize, usize)> {
    let mut value: u64 = 0;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(at)?;
        at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((usize::try_from(value).ok()?, at));
        }
    }
    None
}

fn sized(bytes: &[u8], at: usize) -> Option<(&[u8], usize)> {
    let (size, at) = varint(bytes, at)?;
    let end = at.checked_add(size)?;
    Some((bytes.get(at..end)?, end))
}

fn log(bytes: &[u8], latest: &mut Latest) {
    let mut record = Vec::new();
    let mut at = 0;
    while at + 7 <= bytes.len() {
        let left = LOG_BLOCK - at % LOG_BLOCK;
        if left < 7 {
            at += left;
            continue;
        }
        let size = usize::from(u16::from_le_bytes([bytes[at + 4], bytes[at + 5]]));
        let kind = bytes[at + 6];
        let Some(data) = bytes.get(at + 7..at + 7 + size) else {
            return;
        };
        at += 7 + size;
        match kind {
            1 => {
                let _ = batch(data, latest);
            }
            2 => record = data.to_vec(),
            3 => record.extend_from_slice(data),
            4 => {
                record.extend_from_slice(data);
                let _ = batch(&record, latest);
                record.clear();
            }
            _ => at = at.div_ceil(LOG_BLOCK) * LOG_BLOCK,
        }
    }
}

fn batch(data: &[u8], latest: &mut Latest) -> Option<()> {
    let sequence = u64::from_le_bytes(data.get(..8)?.try_into().ok()?);
    let count = u32::from_le_bytes(data.get(8..12)?.try_into().ok()?);
    let mut at = 12;
    for one in 0..u64::from(count) {
        let kind = *data.get(at)?;
        let (key, next) = sized(data, at + 1)?;
        at = next;
        let value = if kind == 1 {
            let (value, next) = sized(data, at)?;
            at = next;
            Some(value)
        } else {
            None
        };
        latest.heard(key, sequence.saturating_add(one), value);
    }
    Some(())
}

fn table(bytes: &[u8], latest: &mut Latest) -> Option<()> {
    let footer = bytes.get(bytes.len().checked_sub(48)?..)?;
    if footer[40..] != TABLE_MAGIC.to_le_bytes() {
        return None;
    }
    let (_, at) = varint(footer, 0)?;
    let (_, at) = varint(footer, at)?;
    let (offset, at) = varint(footer, at)?;
    let (size, _) = varint(footer, at)?;
    for (_, handle) in entries(&block(bytes, offset, size)?)? {
        let (offset, at) = varint(&handle, 0)?;
        let (size, _) = varint(&handle, at)?;
        for (key, value) in entries(&block(bytes, offset, size)?)? {
            let split = key.len().checked_sub(8)?;
            let tag = u64::from_le_bytes(key[split..].try_into().ok()?);
            latest.heard(
                &key[..split],
                tag >> 8,
                (tag & 0xff == 1).then_some(&value[..]),
            );
        }
    }
    Some(())
}

fn block(bytes: &[u8], offset: usize, size: usize) -> Option<Vec<u8>> {
    let end = offset.checked_add(size)?;
    let raw = bytes.get(offset..end)?;
    match bytes.get(end)? {
        0 => Some(raw.to_vec()),
        1 => unsnappy(raw),
        _ => None,
    }
}

fn entries(block: &[u8]) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
    let count = u32::from_le_bytes(block.get(block.len().checked_sub(4)?..)?.try_into().ok()?);
    let end = block
        .len()
        .checked_sub(4)?
        .checked_sub(usize::try_from(count).ok()?.checked_mul(4)?)?;
    let mut out = Vec::new();
    let mut key: Vec<u8> = Vec::new();
    let mut at = 0;
    while at < end {
        let (shared, next) = varint(block, at)?;
        let (own, next) = varint(block, next)?;
        let (size, next) = varint(block, next)?;
        if shared > key.len() {
            return None;
        }
        key.truncate(shared);
        key.extend_from_slice(block.get(next..next.checked_add(own)?)?);
        let value_at = next + own;
        out.push((
            key.clone(),
            block.get(value_at..value_at.checked_add(size)?)?.to_vec(),
        ));
        at = value_at + size;
    }
    Some(out)
}

fn unsnappy(input: &[u8]) -> Option<Vec<u8>> {
    let (length, mut at) = varint(input, 0)?;
    let mut out: Vec<u8> = Vec::with_capacity(length.min(1 << 24));
    while at < input.len() {
        let tag = input[at];
        at += 1;
        let (size, offset) = match tag & 3 {
            0 => {
                let mut size = usize::from(tag >> 2);
                if size >= 60 {
                    let extra = size - 59;
                    let mut said = [0u8; 8];
                    said[..extra].copy_from_slice(input.get(at..at + extra)?);
                    size = usize::try_from(u64::from_le_bytes(said)).ok()?;
                    at += extra;
                }
                let end = at.checked_add(size)?.checked_add(1)?;
                out.extend_from_slice(input.get(at..end)?);
                at = end;
                continue;
            }
            1 => {
                let low = usize::from(*input.get(at)?);
                at += 1;
                (
                    4 + usize::from((tag >> 2) & 7),
                    (usize::from(tag & 0xe0) << 3) | low,
                )
            }
            2 => {
                let said = u16::from_le_bytes(input.get(at..at + 2)?.try_into().ok()?);
                at += 2;
                (1 + usize::from(tag >> 2), usize::from(said))
            }
            _ => {
                let said = u32::from_le_bytes(input.get(at..at + 4)?.try_into().ok()?);
                at += 4;
                (1 + usize::from(tag >> 2), usize::try_from(said).ok()?)
            }
        };
        if offset == 0 || offset > out.len() {
            return None;
        }
        for _ in 0..size {
            out.push(out[out.len() - offset]);
        }
    }
    (out.len() == length).then_some(out)
}

fn webkit(dir: &Path) -> Values {
    let mut found = Vec::new();
    webkit_stores(dir, 0, &mut found);
    found.sort_by_key(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok());
    found
        .last()
        .and_then(|path| webkit_values(path).ok())
        .unwrap_or_default()
}

fn webkit_stores(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth > 8 {
        return;
    }
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            webkit_stores(&path, depth + 1, found);
            continue;
        }
        let name = entry.file_name();
        if name == WEBKIT_LEGACY
            || (name == WEBKIT_STORE
                && path
                    .parent()
                    .and_then(Path::parent)
                    .is_some_and(webkit_app_origin))
        {
            found.push(path);
        }
    }
}

fn webkit_app_origin(origin: &Path) -> bool {
    let first_party = origin.parent().and_then(Path::file_name) == origin.file_name();
    first_party
        && fs::read(origin.join("origin")).is_ok_and(|said| {
            [&b"tauri"[..], b"localhost"]
                .iter()
                .all(|word| said.windows(word.len()).any(|one| one == *word))
        })
}

fn webkit_values(path: &Path) -> rusqlite::Result<Values> {
    let db = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let mut query = db.prepare("SELECT key, value FROM ItemTable")?;
    let rows = query.query_map([], |row| {
        let key: String = row.get(0)?;
        let value = match row.get::<_, rusqlite::types::Value>(1)? {
            rusqlite::types::Value::Text(text) => Some(text),
            rusqlite::types::Value::Blob(bytes) => utf16(&bytes),
            _ => None,
        };
        Ok(value.map(|value| (key, value)))
    })?;
    Ok(rows.flatten().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::{carry, chromium, unsnappy, webkit, Home, CARRIED};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orden-old-engine-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fixture() -> PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/old-engine/chromium")
    }

    fn webkit_store(path: &Path, rows: &[(&str, &str)]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let db = rusqlite::Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)")
            .unwrap();
        for (key, value) in rows {
            let bytes: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
            db.execute(
                "INSERT INTO ItemTable VALUES (?1, ?2)",
                rusqlite::params![key, bytes],
            )
            .unwrap();
        }
    }

    #[test]
    fn where_the_app_keeps_its_storage_never_moves() {
        assert_eq!(orden_web_engine::ROOT, "chromium");
        assert_eq!(orden_web_engine::APP_PROFILE, "app");
        assert_eq!(crate::kept::FOLDER, "kept");
    }

    #[test]
    fn snappy_copies_back_what_it_points_at() {
        assert_eq!(
            unsnappy(&[12, 8, b'a', b'b', b'c', 0x15, 3]).as_deref(),
            Some(&b"abcabcabcabc"[..])
        );
        assert_eq!(unsnappy(&[12, 8, b'a', b'b', b'c', 0x15, 9]), None);
    }

    #[test]
    fn chromium_storage_is_read_as_the_page_last_left_it() {
        let values = chromium(&fixture());
        assert_eq!(
            values.get("orden:session").map(String::as_str),
            Some("the-token")
        );
        assert_eq!(
            values.get("orden:device").map(String::as_str),
            Some("dev-1")
        );
        assert_eq!(values.get("orden:font").map(String::as_str), Some("Lato"));
        assert!(values
            .get("orden:words")
            .is_some_and(|words| words.starts_with("Grüße ✓ notes ")));
        assert!(!values.contains_key("orden:gone-later"));
        assert!(!values.contains_key("orden:filler-0"));
        assert!(values.values().all(|value| value != "someone-else"));
    }

    #[test]
    fn an_update_from_the_old_engine_keeps_the_session() {
        let config = scratch("update");
        let homes = [Home {
            chromium: Some(fixture()),
            databases: None,
            webkit: None,
        }];
        carry(&config, &homes);
        let kept = crate::kept::read_back(&config.join(crate::kept::FOLDER));
        assert_eq!(
            kept.values.get("orden:session").map(String::as_str),
            Some("the-token")
        );
        assert!(crate::kept::kept_script_of(kept).contains("the-token"));
        assert!(config.join(CARRIED).is_file());
        let _ = fs::remove_dir_all(&config);
    }

    #[test]
    fn what_the_new_engine_already_said_wins_and_it_is_carried_once() {
        let config = scratch("once");
        let folder = config.join(crate::kept::FOLDER);
        crate::kept::keep_unless_said(&folder, "orden:font", "Mono".into()).unwrap();
        crate::kept::forget_now(&folder, "orden:device").unwrap();
        let homes = [Home {
            chromium: Some(fixture()),
            databases: None,
            webkit: None,
        }];
        carry(&config, &homes);
        let kept = crate::kept::read_back(&folder);
        assert_eq!(
            kept.values.get("orden:font").map(String::as_str),
            Some("Mono")
        );
        assert!(!kept.values.contains_key("orden:device"));
        assert_eq!(
            kept.values.get("orden:session").map(String::as_str),
            Some("the-token")
        );
        crate::kept::forget_now(&folder, "orden:session").unwrap();
        carry(&config, &homes);
        assert!(!crate::kept::read_back(&folder)
            .values
            .contains_key("orden:session"));
        let _ = fs::remove_dir_all(&config);
    }

    #[test]
    fn the_newer_home_is_read_and_the_former_one_only_without_it() {
        let config = scratch("homes");
        let missing = config.join("nowhere");
        let former = scratch("former-webkit");
        webkit_store(
            &former.join(format!("WebsiteData/LocalStorage/{}", super::WEBKIT_LEGACY)),
            &[("orden:session", "older")],
        );
        let homes = [
            Home {
                chromium: Some(missing.clone()),
                databases: None,
                webkit: Some(missing),
            },
            Home {
                chromium: None,
                databases: None,
                webkit: Some(former.clone()),
            },
        ];
        carry(&config, &homes);
        let kept = crate::kept::read_back(&config.join(crate::kept::FOLDER));
        assert_eq!(
            kept.values.get("orden:session").map(String::as_str),
            Some("older")
        );
        let _ = fs::remove_dir_all(&config);
        let _ = fs::remove_dir_all(&former);
    }

    #[test]
    fn webkit_storage_of_the_app_is_read_and_a_frame_inside_it_is_not() {
        let dir = scratch("webkit");
        let app = dir.join("WebsiteData/Default/A1/A1");
        webkit_store(
            &app.join("LocalStorage/localstorage.sqlite3"),
            &[("orden:session", "mac-token"), ("orden:words", "Grüße ✓")],
        );
        fs::write(
            app.join("origin"),
            b"\x05\0\0\0\x01tauri\x09\0\0\0\x01localhost",
        )
        .unwrap();
        let frame = dir.join("WebsiteData/Default/A1/B2");
        webkit_store(
            &frame.join("LocalStorage/localstorage.sqlite3"),
            &[("orden:session", "a-frame")],
        );
        fs::write(frame.join("origin"), b"tauri localhost example.com").unwrap();
        let values = webkit(&dir);
        assert_eq!(
            values.get("orden:session").map(String::as_str),
            Some("mac-token")
        );
        assert_eq!(
            values.get("orden:words").map(String::as_str),
            Some("Grüße ✓")
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
