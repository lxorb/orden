use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const SCRIPT: &str = include_str!("kept.js");

const EMPTY: &str = "/* kept */ { values: {}, gone: [] }";

const FOLDER: &str = "kept";

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Said {
    Value(String),
    Gone,
}

struct Write {
    folder: PathBuf,
    key: String,
    said: Said,
}

static WRITER: OnceLock<Mutex<Sender<Write>>> = OnceLock::new();

static READ: Mutex<Option<Kept>> = Mutex::new(None);

fn kept_writer() -> &'static Mutex<Sender<Write>> {
    WRITER.get_or_init(|| {
        let (sending, writes) = channel::<Write>();
        std::thread::spawn(move || {
            for one in writes {
                if let Err(error) = write_down(&one) {
                    eprintln!("kept: {} was not written: {error}", one.key);
                }
            }
        });
        Mutex::new(sending)
    })
}

fn kept_file(folder: &Path, key: &str) -> PathBuf {
    let mut name = String::with_capacity(key.len() * 2);
    for byte in key.bytes() {
        let _ = write!(name, "{byte:02x}");
    }
    folder.join(name)
}

fn kept_key(name: &str) -> Option<String> {
    if !name.len().is_multiple_of(2) || name.is_empty() {
        return None;
    }
    let bytes: Option<Vec<u8>> = (0..name.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(name.get(at..at + 2)?, 16).ok())
        .collect();
    String::from_utf8(bytes?).ok()
}

fn write_down(one: &Write) -> Result<(), String> {
    crate::paths::made(&one.folder)?;
    let bytes = serde_json::to_vec(&one.said).map_err(|error| error.to_string())?;
    crate::paths::write_atomically(&kept_file(&one.folder, &one.key), &bytes)
}

fn kept_folder(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::paths::config_dir(app)?.join(FOLDER))
}

fn to_writer(app: &AppHandle, key: String, said: Said) -> Result<(), String> {
    let folder = kept_folder(app)?;
    kept_writer()
        .lock()
        .map_err(|_| "the writer is gone".to_string())?
        .send(Write { folder, key, said })
        .map_err(|_| "the writer is gone".to_string())
}

#[tauri::command]
pub fn kept_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    to_writer(&app, key, Said::Value(value))
}

#[tauri::command]
pub fn kept_forget(app: AppHandle, key: String) -> Result<(), String> {
    to_writer(&app, key, Said::Gone)
}

#[derive(Serialize, Default, Debug, PartialEq, Eq)]
struct Kept {
    values: BTreeMap<String, String>,
    gone: Vec<String>,
}

fn read_back(folder: &Path) -> Kept {
    let mut kept = Kept::default();
    let Ok(entries) = std::fs::read_dir(folder) else {
        return kept;
    };
    for entry in entries.flatten() {
        let Some(key) = entry.file_name().to_str().and_then(kept_key) else {
            continue;
        };
        let Ok(text) = std::fs::read(entry.path()) else {
            continue;
        };
        match serde_json::from_slice::<Said>(&text) {
            Ok(Said::Value(value)) => {
                kept.values.insert(key, value);
            }
            Ok(Said::Gone) => kept.gone.push(key),
            Err(_) => {}
        }
    }
    kept
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn read_kept(app: &AppHandle) {
    let kept = kept_folder(app)
        .map(|folder| read_back(&folder))
        .unwrap_or_default();
    *READ.lock().unwrap_or_else(PoisonError::into_inner) = Some(kept);
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn kept_script() -> String {
    let kept = READ
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
        .unwrap_or_default();
    let json = serde_json::to_string(&kept)
        .unwrap_or_else(|_| r#"{"values":{},"gone":[]}"#.to_string())
        .replace('<', "\\u003c");
    SCRIPT.replace(EMPTY, &json)
}

#[cfg(test)]
mod tests {
    use super::{kept_file, kept_key, read_back, write_down, Kept, Said, Write, EMPTY, SCRIPT};
    use std::path::Path;

    #[test]
    fn a_key_is_a_file_name_and_back() {
        let folder = Path::new("/kept");
        for key in ["orden:session", "orden:font/ui", "ü ✓", ""] {
            let file = kept_file(folder, key);
            let name = file
                .file_name()
                .and_then(|one| one.to_str())
                .unwrap_or_default();
            if key.is_empty() {
                assert_eq!(kept_key(name), None);
            } else {
                assert_eq!(kept_key(name).as_deref(), Some(key));
            }
        }
        assert_eq!(kept_key("zz"), None);
        assert_eq!(kept_key("abc"), None);
    }

    #[test]
    fn what_was_written_and_taken_away_is_read_back() {
        let folder = std::env::temp_dir().join(format!("nib-kept-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        for (key, said) in [
            ("orden:font", Said::Value("Inter".into())),
            ("orden:draft", Said::Value("words".into())),
            ("orden:old", Said::Gone),
        ] {
            write_down(&Write {
                folder: folder.clone(),
                key: key.into(),
                said,
            })
            .expect("written");
        }
        write_down(&Write {
            folder: folder.clone(),
            key: "orden:font".into(),
            said: Said::Value("Lato".into()),
        })
        .expect("written");
        let kept: Kept = read_back(&folder);
        assert_eq!(
            kept.values.get("orden:font").map(String::as_str),
            Some("Lato")
        );
        assert_eq!(
            kept.values.get("orden:draft").map(String::as_str),
            Some("words")
        );
        assert_eq!(kept.gone, vec!["orden:old".to_string()]);
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn the_script_puts_back_and_follows() {
        assert!(SCRIPT.contains(EMPTY));
        assert!(SCRIPT.contains("'kept_write'"));
        assert!(SCRIPT.contains("'kept_forget'"));
        assert!(SCRIPT.contains("sessionStorage"));
    }
}
