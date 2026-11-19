use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rusqlite::types::Value as Column;
use serde_json::{json, Map, Value};

const CHROMIUM_PREFIX: &str = "http_tauri.localhost_0.indexeddb.";
const WEBKIT_DATABASE: &str = "IndexedDB.sqlite3";
const WEBKIT_LEGACY_ORIGIN: &str = "tauri_localhost_0";
const TERMINATOR: u32 = 0xffff_ffff;
const STRING_POOL: u32 = 0xffff_fffe;
const EIGHT_BIT: u32 = 0x8000_0000;
pub(super) fn carry_chromium(old: &Path, profile: &Path) -> Result<bool, String> {
    let to = profile.join("IndexedDB");
    let mut carried = false;
    for entry in fs::read_dir(old)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with(CHROMIUM_PREFIX) || !entry.path().is_dir() {
            continue;
        }
        let target = to.join(&name);
        if fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        let mut carrying = name.clone();
        carrying.push(".carrying");
        let half = to.join(carrying);
        let _ = fs::remove_dir_all(&half);
        copied(&entry.path(), &half).map_err(|error| error.to_string())?;
        fs::rename(&half, &target).map_err(|error| error.to_string())?;
        carried = true;
    }
    Ok(carried)
}
fn copied(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if entry.file_type()?.is_dir() {
            copied(&path, &to.join(&name))?;
        } else if name != "LOCK" {
            fs::copy(&path, to.join(&name))?;
        }
    }
    Ok(())
}
pub(super) fn webkit(root: &Path) -> Vec<Value> {
    let mut found = Vec::new();
    webkit_databases(root, 0, &mut found);
    found.sort_by_key(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok());
    let mut named: Vec<Value> = Vec::new();
    for path in found.iter().rev() {
        let Some(database) = webkit_database(path) else {
            continue;
        };
        if !named.iter().any(|one| one["name"] == database["name"]) {
            named.push(database);
        }
    }
    named
}
fn webkit_databases(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth > 8 {
        return;
    }
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            webkit_databases(&path, depth + 1, found);
        } else if entry.file_name() == WEBKIT_DATABASE && of_the_app(&path) {
            found.push(path);
        }
    }
}
fn of_the_app(database: &Path) -> bool {
    let folder = database.parent().and_then(Path::parent);
    if folder
        .and_then(Path::file_name)
        .is_some_and(|name| name == WEBKIT_LEGACY_ORIGIN)
    {
        return true;
    }
    folder
        .filter(|one| one.file_name().is_some_and(|name| name == "IndexedDB"))
        .and_then(Path::parent)
        .is_some_and(super::webkit_app_origin)
}
fn text_of(column: Column) -> Option<String> {
    match column {
        Column::Text(text) => Some(text),
        Column::Blob(bytes) => super::utf16(&bytes),
        Column::Integer(number) => Some(number.to_string()),
        _ => None,
    }
}
fn webkit_database(path: &Path) -> Option<Value> {
    let db = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let info: Vec<(String, Column)> = db
        .prepare("SELECT key, value FROM IDBDatabaseInfo")
        .ok()?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok()?
        .flatten()
        .collect();
    let said = |key: &str| {
        info.iter()
            .find(|(one, _)| one == key)
            .and_then(|(_, value)| text_of(value.clone()))
    };
    let name = said("DatabaseName")?;
    let version: u64 = said("DatabaseVersion")?.parse().ok()?;
    let mut stores = Vec::new();
    let mut skipped = 0;
    let listed: Vec<(i64, Column, Vec<u8>, bool)> = db
        .prepare("SELECT id, name, keyPath, autoInc FROM ObjectStoreInfo ORDER BY id")
        .ok()?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .ok()?
        .flatten()
        .collect();
    let indexes: Vec<(i64, Value)> = db
        .prepare("SELECT objectStoreID, name, keyPath, isUnique, multiEntry FROM IndexInfo")
        .ok()?
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Column>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })
        .ok()?
        .flatten()
        .filter_map(|(store, name, path, unique, multi)| {
            Some((
                store,
                json!({
                    "name": text_of(name)?,
                    "keyPath": key_path(&path)?,
                    "unique": unique,
                    "multiEntry": multi,
                }),
            ))
        })
        .collect();
    let records: Vec<(i64, Vec<u8>, Vec<u8>)> = db
        .prepare("SELECT objectStoreID, CAST(key AS BLOB), value FROM Records ORDER BY recordID")
        .ok()?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .ok()?
        .flatten()
        .collect();
    for (id, store, path, auto) in listed {
        let mut keys = Vec::new();
        let mut values = Vec::new();
        for (_, key, value) in records.iter().filter(|(one, _, _)| *one == id) {
            match (record_key(key), Script::read(value)) {
                (Some(key), Some(value)) => {
                    keys.push(key);
                    values.push(value);
                }
                _ => skipped += 1,
            }
        }
        let indexes: Vec<&Value> = indexes
            .iter()
            .filter(|(one, _)| *one == id)
            .map(|(_, index)| index)
            .collect();
        stores.push(json!({
            "name": text_of(store)?,
            "keyPath": key_path(&path)?,
            "autoIncrement": auto,
            "indexes": indexes,
            "keys": keys,
            "values": values,
        }));
    }
    Some(json!({ "name": name, "version": version, "stores": stores, "skipped": skipped }))
}
fn key_path(bytes: &[u8]) -> Option<Value> {
    let said: plist::Value = plist::from_bytes(bytes).ok()?;
    let said = said.as_dictionary()?;
    let one = |part: &plist::Value| {
        part.as_dictionary()
            .and_then(|part| part.get("string"))
            .and_then(plist::Value::as_string)
            .map(|text| Value::String(text.to_owned()))
    };
    match said.get("type")?.as_unsigned_integer()? {
        0 => Some(Value::Null),
        1 => Some(Value::String(said.get("string")?.as_string()?.to_owned())),
        2 => Some(Value::Array(
            said.get("array")?
                .as_array()?
                .iter()
                .map(one)
                .collect::<Option<Vec<_>>>()?,
        )),
        _ => None,
    }
}
fn record_key(bytes: &[u8]) -> Option<Value> {
    let (version, rest) = bytes.split_first()?;
    if *version != 0 {
        return None;
    }
    let (key, rest) = key_of(rest)?;
    rest.is_empty().then_some(key)
}
fn key_of(bytes: &[u8]) -> Option<(Value, &[u8])> {
    let (kind, rest) = bytes.split_first()?;
    match kind {
        0x20 => {
            let (number, rest) = take::<8>(rest)?;
            Some((number_of(f64::from_le_bytes(number))?, rest))
        }
        0x40 => {
            let (at, rest) = take::<8>(rest)?;
            Some((marked("date", json!(f64::from_le_bytes(at))), rest))
        }
        0x60 => {
            let (length, rest) = take::<4>(rest)?;
            let size = usize::try_from(u32::from_le_bytes(length))
                .ok()?
                .checked_mul(2)?;
            let text = super::utf16(rest.get(..size)?)?;
            Some((Value::String(text), &rest[size..]))
        }
        0xa0 => {
            let (count, mut rest) = take::<8>(rest)?;
            let mut parts = Vec::new();
            for _ in 0..u64::from_le_bytes(count) {
                let (part, after) = key_of(rest)?;
                parts.push(part);
                rest = after;
            }
            Some((Value::Array(parts), rest))
        }
        _ => None,
    }
}
fn take<const N: usize>(bytes: &[u8]) -> Option<([u8; N], &[u8])> {
    let (head, rest) = bytes.split_first_chunk::<N>()?;
    Some((*head, rest))
}
fn number_of(number: f64) -> Option<Value> {
    serde_json::Number::from_f64(number).map(Value::Number)
}
fn marked(kind: &str, said: Value) -> Value {
    let mut out = Map::new();
    out.insert("$orden".into(), Value::String(kind.into()));
    out.insert("said".into(), said);
    Value::Object(out)
}
enum Text {
    Said(String),
    Ended,
}
struct Script<'a> {
    bytes: &'a [u8],
    at: usize,
    pool: Vec<String>,
}
impl Script<'_> {
    fn read(bytes: &[u8]) -> Option<Value> {
        let mut script = Script {
            bytes,
            at: 0,
            pool: Vec::new(),
        };
        script.u32()?;
        let value = script.value()?;
        (script.at == bytes.len()).then_some(value)
    }
    fn byte(&mut self) -> Option<u8> {
        let one = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(one)
    }
    fn slice(&mut self, size: usize) -> Option<&[u8]> {
        let end = self.at.checked_add(size)?;
        let out = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(out)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.slice(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.slice(8)?.try_into().ok()?))
    }
    fn f64(&mut self) -> Option<f64> {
        Some(f64::from_le_bytes(self.slice(8)?.try_into().ok()?))
    }
    fn pooled(&mut self) -> Option<String> {
        let at = if self.pool.len() <= 0xff {
            usize::from(self.byte()?)
        } else if self.pool.len() <= 0xffff {
            usize::from(u16::from_le_bytes(self.slice(2)?.try_into().ok()?))
        } else {
            usize::try_from(self.u32()?).ok()?
        };
        self.pool.get(at).cloned()
    }
    fn string(&mut self) -> Option<Text> {
        let length = self.u32()?;
        if length == TERMINATOR {
            return Some(Text::Ended);
        }
        if length == STRING_POOL {
            return self.pooled().map(Text::Said);
        }
        let units = usize::try_from(length & !EIGHT_BIT).ok()?;
        let text = if length & EIGHT_BIT == 0 {
            super::utf16(self.slice(units.checked_mul(2)?)?)?
        } else {
            self.slice(units)?
                .iter()
                .map(|one| char::from(*one))
                .collect()
        };
        self.pool.push(text.clone());
        Some(Text::Said(text))
    }
    fn properties(&mut self, out: &mut Map<String, Value>) -> Option<()> {
        while let Text::Said(name) = self.string()? {
            let value = self.value()?;
            out.insert(name, value);
        }
        Some(())
    }
    fn value(&mut self) -> Option<Value> {
        match self.byte()? {
            1 => {
                let length = self.u32()?;
                let mut items = vec![Value::Null; usize::try_from(length).ok()?.min(1 << 20)];
                loop {
                    let at = self.u32()?;
                    if at == TERMINATOR {
                        break;
                    }
                    let value = self.value()?;
                    *items.get_mut(usize::try_from(at).ok()?)? = value;
                }
                let mut rest = Map::new();
                self.properties(&mut rest)?;
                rest.is_empty().then_some(Value::Array(items))
            }
            2 => {
                let mut out = Map::new();
                self.properties(&mut out)?;
                Some(Value::Object(out))
            }
            3 => Some(marked("undefined", Value::Null)),
            4 => Some(Value::Null),
            5 => Some(json!(i32::from_le_bytes(self.slice(4)?.try_into().ok()?))),
            6 => Some(json!(0)),
            7 => Some(json!(1)),
            8 => Some(Value::Bool(false)),
            9 => Some(Value::Bool(true)),
            10 => {
                let number = self.f64()?;
                number_of(number)
            }
            11 => {
                let at = self.f64()?;
                Some(marked("date", number_of(at)?))
            }
            16 => match self.string()? {
                Text::Said(text) => Some(Value::String(text)),
                Text::Ended => None,
            },
            17 => Some(Value::String(String::new())),
            22 => {
                if self.byte()? != 2 {
                    return None;
                }
                let offset = usize::try_from(self.u64()?).ok()?;
                let length = usize::try_from(self.u64()?).ok()?;
                if self.byte()? != 21 {
                    return None;
                }
                let size = usize::try_from(self.u64()?).ok()?;
                let buffer = self.slice(size)?;
                let bytes = buffer.get(offset..offset.checked_add(length)?)?;
                Some(marked("bytes", Value::String(BASE64.encode(bytes))))
            }
            _ => None,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{carry_chromium, key_path, record_key, webkit, Script};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orden-old-databases-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn fixture() -> PathBuf {
        let dir =
            scratch(&format!("webkit-{:?}", std::thread::current().id()).replace(['(', ')'], ""));
        super::copied(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/old-engine/webkit"),
            &dir,
        )
        .unwrap();
        dir
    }
    fn named<'a>(found: &'a [serde_json::Value], name: &str) -> &'a serde_json::Value {
        found.iter().find(|one| one["name"] == name).expect(name)
    }
    fn store<'a>(database: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
        database["stores"]
            .as_array()
            .unwrap()
            .iter()
            .find(|one| one["name"] == name)
            .expect(name)
    }
    #[test]
    fn what_the_last_release_kept_in_webkit_comes_back_as_it_was_written() {
        let found = webkit(&fixture());
        let ci = named(&found, "orden-ci-2161");
        assert_eq!(ci["version"], 3);
        assert_eq!(ci["skipped"], 0);
        let kept = store(ci, "kept");
        assert_eq!(kept["keyPath"], json!(null));
        let at = kept["keys"]
            .as_array()
            .unwrap()
            .iter()
            .position(|key| key == "owner-1")
            .unwrap();
        let rich = &kept["values"][at];
        assert_eq!(
            rich["doc"],
            json!({ "$orden": "bytes", "said": "AQID+gD/" })
        );
        assert_eq!(rich["server"], json!({ "$orden": "bytes", "said": "" }));
        assert_eq!(
            rich["wrote"],
            json!([{ "$orden": "bytes", "said": "CQg=" }])
        );
        assert_eq!(rich["text"], "Grüße ✓ 😀");
        assert_eq!(rich["again"], "plain words");
        assert_eq!(rich["n"], 42);
        assert_eq!(rich["f"], 1.5);
        assert_eq!(rich["neg"], -7);
        assert_eq!(rich["big"], json!(2f64.powi(40)));
        assert_eq!(rich["zero"], 0);
        assert_eq!(rich["one"], 1);
        assert_eq!(rich["t"], true);
        assert_eq!(rich["no"], false);
        assert_eq!(rich["nil"], json!(null));
        assert_eq!(
            rich["nothing"],
            json!({ "$orden": "undefined", "said": null })
        );
        assert_eq!(
            rich["nested"],
            json!({ "a": [1, "x", { "b": 2 }], "empty": {}, "list": [] })
        );
        assert!(kept["keys"]
            .as_array()
            .unwrap()
            .contains(&json!(["arr", 1.0])));
        assert!(kept["keys"].as_array().unwrap().contains(&json!(5.0)));
        assert!(kept["values"].as_array().unwrap().contains(&json!("")));
        let items = store(ci, "items");
        assert_eq!(items["keyPath"], json!(["vault", "id"]));
        assert_eq!(
            items["indexes"],
            json!([{ "name": "byAt", "keyPath": "at", "unique": false, "multiEntry": false }])
        );
        assert_eq!(items["values"][0]["pending"], true);
        assert_eq!(items["values"][1]["body"].as_str().unwrap().len(), 5000);
        assert_eq!(store(ci, "auto")["autoIncrement"], true);
    }
    #[test]
    fn pass_comes_back_sealed_as_it_was_kept() {
        let found = webkit(&fixture());
        let pass = named(&found, "orden-pass");
        assert_eq!(pass["skipped"], 0);
        let keyring = store(pass, "keyring");
        assert_eq!(keyring["keys"], json!(["this"]));
        assert_eq!(
            keyring["values"][0]["keyring"]["password"]["sealed"],
            "U0VBTEVE"
        );
        assert_eq!(keyring["values"][0]["pending"], true);
        let device = store(pass, "device");
        assert_eq!(device["values"][0]["seal"]["way"], "pin");
        assert_eq!(device["values"][0]["seal"]["tries"], 1);
        let files = store(pass, "files");
        assert_eq!(files["keyPath"], json!(["item", "file", "part"]));
        let bytes = files["values"][0]["bytes"]["said"].as_str().unwrap();
        let bytes =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, bytes).unwrap();
        assert_eq!(bytes.len(), 70000);
        assert!(bytes
            .iter()
            .enumerate()
            .all(|(at, one)| usize::from(*one) == at % 251));
    }
    #[test]
    fn a_value_or_key_it_does_not_know_is_left_out_rather_than_guessed() {
        assert_eq!(Script::read(&[15, 0, 0, 0, 0x7f]), None);
        assert_eq!(Script::read(&[15, 0, 0, 0, 16, 3, 0, 0, 0x80, b'a']), None);
        assert_eq!(Script::read(&[15, 0, 0, 0, 9, 9]), None);
        assert_eq!(record_key(&[0, 0x80, 1]), None);
        assert_eq!(
            record_key(&[0, 0x60, 1, 0, 0, 0, b'a', 0]),
            Some(json!("a"))
        );
        assert_eq!(key_path(b"not a plist"), None);
    }
    #[test]
    fn chromium_databases_are_carried_whole_and_never_over_what_cef_wrote() {
        let dir = scratch("chromium");
        let old = dir.join("old");
        let profile = dir.join("profile");
        let ours = old.join("http_tauri.localhost_0.indexeddb.leveldb");
        fs::create_dir_all(ours.join("deeper")).unwrap();
        fs::write(ours.join("000003.log"), b"old").unwrap();
        fs::write(ours.join("LOCK"), b"").unwrap();
        fs::write(ours.join("deeper/blob"), b"part").unwrap();
        fs::create_dir_all(old.join("https_example.com_0.indexeddb.leveldb")).unwrap();
        assert_eq!(carry_chromium(&old, &profile), Ok(true));
        let carried = profile.join("IndexedDB/http_tauri.localhost_0.indexeddb.leveldb");
        assert_eq!(fs::read(carried.join("000003.log")).unwrap(), b"old");
        assert_eq!(fs::read(carried.join("deeper/blob")).unwrap(), b"part");
        assert!(!carried.join("LOCK").exists());
        assert!(!profile
            .join("IndexedDB/https_example.com_0.indexeddb.leveldb")
            .exists());
        fs::write(carried.join("000003.log"), b"cef").unwrap();
        assert_eq!(carry_chromium(&old, &profile), Ok(false));
        assert_eq!(fs::read(carried.join("000003.log")).unwrap(), b"cef");
        let _ = fs::remove_dir_all(&dir);
    }
}
