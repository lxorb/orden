use std::ffi::{c_char, CStr};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use security_framework::os::macos::code_signing::{Flags, SecCode, SecRequirement};
use tauri::{AppHandle, Emitter as _};

use crate::paths::{config_dir, inside, made, spaces_dir, write_atomically, TRASH};

const INBOX: &str = ".Inbox.md";

const FRONT: &str = "inbox.txt";

const ADDED: &str = "added";

pub const ADDED_EVENT: &str = "orden://shortcuts-added";

static APP: OnceLock<AppHandle> = OnceLock::new();

static COUNT: AtomicU32 = AtomicU32::new(0);

pub fn offered() -> bool {
    static OFFERED: OnceLock<bool> = OnceLock::new();
    *OFFERED.get_or_init(signed_by_a_team)
}

fn signed_by_a_team() -> bool {
    let Ok(requirement) = "anchor apple generic".parse::<SecRequirement>() else {
        return false;
    };
    SecCode::for_self(Flags::NONE)
        .and_then(|code| code.check_validity(Flags::NONE, &requirement))
        .is_ok()
}

#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn nib_add_to_inbox(text: *const c_char) -> i32 {
    if text.is_null() {
        return 1;
    }
    let text = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let added = crate::mcp::home::config_dir()
        .ok_or_else(|| "no settings folder".to_owned())
        .and_then(|dir| queued(&dir.join(ADDED), &text));
    match added {
        Ok(_) => {
            told();
            0
        }
        Err(error) => {
            eprintln!("siri: no task added: {error}");
            1
        }
    }
}

fn told() {
    let Some(app) = APP.get() else {
        return;
    };
    if let Some(window) = crate::agents::shell::host(app) {
        let _ = app.emit_to(window.label(), ADDED_EVENT, ());
    }
}

fn queued(folder: &Path, text: &str) -> Result<PathBuf, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("no words".to_owned());
    }
    made(folder)?;
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    let file = folder.join(format!("{at:024}-{count:06}.txt"));
    write_atomically(&file, text.as_bytes())?;
    Ok(file)
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct Added {
    id: String,
    text: String,
}

pub fn added(app: &AppHandle) -> Result<Vec<Added>, String> {
    let _ = APP.set(app.clone());
    Ok(waiting(&config_dir(app)?.join(ADDED)))
}

fn waiting(folder: &Path) -> Vec<Added> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut out: Vec<Added> = entries
        .flatten()
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_owned();
            if !one_of_ours(&id) {
                return None;
            }
            let text = fs::read_to_string(entry.path()).ok()?;
            Some(Added { id, text })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn one_of_ours(id: &str) -> bool {
    id.strip_suffix(".txt").is_some_and(|stem| {
        !stem.is_empty()
            && stem
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'-')
    })
}

pub fn taken(app: &AppHandle, id: &str) -> Result<(), String> {
    gone(&config_dir(app)?.join(ADDED), id)
}

fn gone(folder: &Path, id: &str) -> Result<(), String> {
    if !one_of_ours(id) {
        return Err(format!("{id} is not a task Shortcuts added"));
    }
    match fs::remove_file(folder.join(id)) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            Err(format!("could not let go of {id}: {error}"))
        }
        _ => Ok(()),
    }
}

pub fn left_inbox(app: &AppHandle) -> Option<PathBuf> {
    let front = config_dir(app)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join(FRONT)).ok())
        .map(|said| PathBuf::from(said.trim()));
    inbox_in(&spaces_dir(app).ok()?, front.as_deref()).ok()
}

fn inbox_in(spaces: &Path, front: Option<&Path>) -> Result<PathBuf, String> {
    let named = front.filter(|path| {
        inside(spaces, path)
            && !inside(&spaces.join(TRASH), path)
            && path
                .parent()
                .is_some_and(|folder| folder != spaces && folder.is_dir())
    });
    match named {
        Some(path) => Ok(path.to_path_buf()),
        None => Ok(default_space(spaces)?.join(INBOX)),
    }
}

fn default_space(spaces: &Path) -> Result<PathBuf, String> {
    let entries = fs::read_dir(spaces)
        .map_err(|error| format!("could not read {}: {error}", spaces.display()))?;
    entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .min_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase())
        .map(|entry| entry.path())
        .ok_or_else(|| format!("no space in {}", spaces.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_task_waits_for_the_app_and_writes_into_no_space() {
        let dir = tempfile::tempdir().unwrap();
        let spaces = dir.path().join("Nib");
        fs::create_dir_all(spaces.join("Notes")).unwrap();
        let folder = dir.path().join(ADDED);

        queued(&folder, "  buy\n milk ").unwrap();
        queued(&folder, "bread").unwrap();

        let waiting = waiting(&folder);
        assert_eq!(
            waiting
                .iter()
                .map(|one| one.text.as_str())
                .collect::<Vec<_>>(),
            ["buy milk", "bread"]
        );
        assert!(!spaces.join("Notes").join(INBOX).exists());

        gone(&folder, &waiting[0].id).unwrap();
        gone(&folder, &waiting[0].id).unwrap();
        assert_eq!(
            super::waiting(&folder)
                .into_iter()
                .map(|one| one.text)
                .collect::<Vec<_>>(),
            ["bread"]
        );
    }

    #[test]
    fn nothing_waits_without_words() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join(ADDED);
        assert!(queued(&folder, " \n ").is_err());
        assert!(waiting(&folder).is_empty());
    }

    #[test]
    fn only_a_waiting_task_is_let_go() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("keep.txt");
        fs::write(&outside, "kept").unwrap();
        let folder = dir.path().join(ADDED);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("notes.md"), "kept").unwrap();

        for id in ["../keep.txt", "notes.md", "", ".txt"] {
            assert!(gone(&folder, id).is_err(), "{id}");
        }
        assert!(outside.exists());
        assert!(waiting(&folder).is_empty());
    }

    #[test]
    fn the_default_space_is_the_first_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        for name in [".trash", ".orden", "Work", "notes"] {
            fs::create_dir(dir.path().join(name)).unwrap();
        }
        assert_eq!(default_space(dir.path()).unwrap(), dir.path().join("notes"));
    }

    #[test]
    fn the_inbox_an_older_build_wrote_to_is_the_one_in_front() {
        let dir = tempfile::tempdir().unwrap();
        let work = dir.path().join("Work").join("Lists");
        fs::create_dir_all(&work).unwrap();
        fs::create_dir(dir.path().join("Notes")).unwrap();
        let front = work.join("Todo.md");

        assert_eq!(inbox_in(dir.path(), Some(&front)).unwrap(), front);
    }

    #[test]
    fn an_inbox_that_is_gone_falls_back_to_the_first_space() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(TRASH).join("Old")).unwrap();
        fs::create_dir(dir.path().join("Notes")).unwrap();
        let first = dir.path().join("Notes").join(INBOX);
        let outside = tempfile::tempdir().unwrap();

        for front in [
            outside.path().join("Work").join(INBOX),
            dir.path().join(TRASH).join("Old").join(INBOX),
            dir.path().join("Gone").join(INBOX),
            dir.path().join(INBOX),
        ] {
            assert_eq!(inbox_in(dir.path(), Some(&front)).unwrap(), first);
        }
    }

    #[test]
    fn an_ad_hoc_build_is_not_offered_the_shortcuts() {
        assert!(!signed_by_a_team());
    }
}
