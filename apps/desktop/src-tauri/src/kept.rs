//! What the app's own page keeps in `localStorage`, kept on the disk the moment it is
//! written, so a kill cannot take it.
//!
//! "Anything written to `localStorage` in the few seconds before the app is killed is
//! gone after a restart" (#961): a setting just changed, and an Untitled draft with words
//! in it, which is neither restored nor in the trash. Chromium holds a page's
//! `localStorage` in memory and commits it to its database a few seconds later, in a
//! batch; a quit commits what is waiting, and a kill - `pkill`, a crash, the session
//! ending - takes it with the process. Every setting the app has, and the session its
//! tabs and drafts come back from, is in `localStorage`.
//!
//! So every write the page makes to it is written here too, at once, as a file of its
//! own (`kept/`, one per key), and the next run's first page puts back whatever the
//! engine lost before the app reads a thing. The page is not changed: `kept.js` is put in
//! front of it, as the window is made, and sees every write whoever makes it.
//!
//! Only on Orden's own Chromium, where it was measured; the system's engines commit on
//! their own schedule and are not touched by this.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// What the page runs first; see the top of this file.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const SCRIPT: &str = include_str!("kept.js");

/// What the script says where it is given what was kept: nothing, until this writes it in.
const EMPTY: &str = "/* kept */ { values: {}, gone: [] }";

/// The folder the keys are kept in, inside the app's settings folder.
const FOLDER: &str = "kept";

/// One key's last word: its value, or that it was taken away.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Said {
    Value(String),
    Gone,
}

/// One write to make, in the order the page made them.
struct Write {
    folder: PathBuf,
    key: String,
    said: Said,
}

/// The one thread that writes, so two writes of a key land in the order they were made:
/// the commands arrive in order on the window's thread and are handed over here.
static WRITER: OnceLock<Mutex<Sender<Write>>> = OnceLock::new();

/// What was kept, read as the app starts and given to the first window made; see
/// `kept_script`.
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

/// A key's file: its name in hex, so any key is a file name and no two keys share one.
fn kept_file(folder: &Path, key: &str) -> PathBuf {
    let mut name = String::with_capacity(key.len() * 2);
    for byte in key.bytes() {
        let _ = write!(name, "{byte:02x}");
    }
    folder.join(name)
}

/// The key a file is for, or `None` for a file that is not one of these.
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

/// A key the page wrote. On the window's thread, so the writes reach the writer in the
/// order the page made them; the disk is the writer's.
#[tauri::command]
pub fn kept_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    to_writer(&app, key, Said::Value(value))
}

/// A key the page took away.
#[tauri::command]
pub fn kept_forget(app: AppHandle, key: String) -> Result<(), String> {
    to_writer(&app, key, Said::Gone)
}

/// Everything kept, as the script takes it: values, and the keys taken away.
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
            // Half a write never lands, since each is atomic; anything else is not ours.
            Err(_) => {}
        }
    }
    kept
}

/// Reads what was kept, once, as the app starts and before its first window is made:
/// on the thread that sets the app up, where the disk may be waited on.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn read_kept(app: &AppHandle) {
    let kept = kept_folder(app)
        .map(|folder| read_back(&folder))
        .unwrap_or_default();
    *READ.lock().unwrap_or_else(PoisonError::into_inner) = Some(kept);
}

/// The script a window of the app's own runs first. The first window of the run is given
/// what was kept, to put back; every window after it only follows the writes, since the
/// engine's own copy is current by then and older words would undo newer ones.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn kept_script() -> String {
    let kept = READ
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
        .unwrap_or_default();
    // Written into a script, so only what serde wrote as JSON is ever put there; `<` is
    // escaped, so no value can close a tag around it either.
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
        for key in ["nib:session", "nib:font/ui", "ü ✓", ""] {
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
            ("nib:font", Said::Value("Inter".into())),
            ("nib:draft", Said::Value("words".into())),
            ("nib:old", Said::Gone),
        ] {
            write_down(&Write {
                folder: folder.clone(),
                key: key.into(),
                said,
            })
            .expect("written");
        }
        // A later word on a key is the one kept.
        write_down(&Write {
            folder: folder.clone(),
            key: "nib:font".into(),
            said: Said::Value("Lato".into()),
        })
        .expect("written");
        let kept: Kept = read_back(&folder);
        assert_eq!(
            kept.values.get("nib:font").map(String::as_str),
            Some("Lato")
        );
        assert_eq!(
            kept.values.get("nib:draft").map(String::as_str),
            Some("words")
        );
        assert_eq!(kept.gone, vec!["nib:old".to_string()]);
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
