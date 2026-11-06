use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Webview};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct History {
    pub cols: u16,
    pub rows: u16,
    pub at: u64,
    pub text: String,
}

const MOST_TEXT: usize = 2 << 20;

const MOST_FILE: usize = 16 << 20;

const MOST_PER_SPACE: usize = 32;

const NO_SPACE: &str = "none";

fn root(webview: &Webview) -> Result<PathBuf, String> {
    let data = webview
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(data.join("terminal"))
}

fn name(id: &str) -> Result<&str, String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(id)
    } else {
        Err(format!("{id:?} is not a terminal's name"))
    }
}

fn folder(root: &Path, space: Option<&str>) -> Result<PathBuf, String> {
    Ok(root.join(match space {
        Some(space) => name(space)?,
        None => NO_SPACE,
    }))
}

fn file(root: &Path, space: Option<&str>, key: &str) -> Result<PathBuf, String> {
    Ok(folder(root, space)?.join(format!("{}.json", name(key)?)))
}

fn read(path: &Path) -> Option<History> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() > MOST_FILE {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

fn scratch(path: &Path) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let turn = NEXT.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("{turn}.part"))
}

fn write(path: &Path, history: &History) -> Result<(), String> {
    if history.text.len() > MOST_TEXT {
        return Err("a terminal's history is kept to two megabytes".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "a history has a folder".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let bytes = serde_json::to_vec(history).map_err(|error| error.to_string())?;
    let part = scratch(path);
    fs::write(&part, bytes).map_err(|error| error.to_string())?;
    fs::rename(&part, path).map_err(|error| {
        let _ = fs::remove_file(&part);
        error.to_string()
    })
}

fn prune(folder: &Path) {
    let Ok(listed) = fs::read_dir(folder) else {
        return;
    };
    let mut kept = Vec::new();
    for entry in listed.flatten() {
        let path = entry.path();
        match path.extension().and_then(|one| one.to_str()) {
            Some("json") => {
                let when = entry.metadata().and_then(|one| one.modified()).ok();
                kept.push((when, path));
            }
            Some("part") if is_stale(&entry) => {
                let _ = fs::remove_file(&path);
            }
            _ => {}
        }
    }

    if kept.len() <= MOST_PER_SPACE {
        return;
    }
    kept.sort_by_key(|one| std::cmp::Reverse(one.0));
    for (_, path) in kept.into_iter().skip(MOST_PER_SPACE) {
        let _ = fs::remove_file(path);
    }
}

fn is_stale(entry: &fs::DirEntry) -> bool {
    entry
        .metadata()
        .and_then(|one| one.modified())
        .ok()
        .and_then(|when| when.elapsed().ok())
        .is_some_and(|age| age.as_secs() > 60)
}

#[tauri::command(async)]
pub fn terminal_history_read(
    webview: Webview,
    space: Option<String>,
    key: String,
) -> Result<Option<History>, String> {
    super::owner(&webview)?;
    Ok(read(&file(&root(&webview)?, space.as_deref(), &key)?))
}

#[tauri::command(async)]
pub fn terminal_history_write(
    webview: Webview,
    space: Option<String>,
    key: String,
    history: History,
) -> Result<(), String> {
    super::owner(&webview)?;
    let root = root(&webview)?;
    let path = file(&root, space.as_deref(), &key)?;
    write(&path, &history)?;
    prune(&folder(&root, space.as_deref())?);
    Ok(())
}

#[tauri::command(async)]
pub fn terminal_history_forget(
    webview: Webview,
    space: Option<String>,
    key: Option<String>,
) -> Result<(), String> {
    super::owner(&webview)?;
    let root = root(&webview)?;
    let gone = match key {
        Some(key) => fs::remove_file(file(&root, space.as_deref(), &key)?),
        None => fs::remove_dir_all(&root),
    };
    match gone {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(text: &str, at: u64) -> History {
        History {
            cols: 120,
            rows: 30,
            at,
            text: text.to_owned(),
        }
    }

    #[test]
    fn a_name_is_an_id_and_nothing_else() {
        let root = Path::new("data");
        assert_eq!(
            file(root, Some("0-abc123"), "k-1").unwrap(),
            root.join("0-abc123").join("k-1.json")
        );
        assert_eq!(
            file(root, None, "k").unwrap(),
            root.join("none").join("k.json")
        );
        for bad in [
            "",
            "..",
            "../x",
            "a/b",
            "a\\b",
            "c:",
            "a b",
            &"x".repeat(81),
        ] {
            assert!(file(root, None, bad).is_err(), "key {bad:?} was taken");
            assert!(
                file(root, Some(bad), "k").is_err(),
                "space {bad:?} was taken"
            );
        }
    }

    #[test]
    fn a_history_comes_back_as_it_was_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(dir.path(), Some("space"), "key").unwrap();
        let written = history("\u{1b}[31mfailed\u{1b}[0m\r\nC:\\>", 1_700_000_000_000);

        write(&path, &written).unwrap();
        assert_eq!(read(&path), Some(written));

        let again = history("C:\\>", 1_700_000_001_000);
        write(&path, &again).unwrap();
        assert_eq!(read(&path), Some(again));
        let left: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|one| one.file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("key.json")]);
    }

    #[test]
    fn what_does_not_read_as_a_history_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.json");
        assert_eq!(read(&path), None);

        fs::write(&path, b"{\"cols\": \"wide\"}").unwrap();
        assert_eq!(read(&path), None);

        fs::write(&path, b"not json").unwrap();
        assert_eq!(read(&path), None);
    }

    #[test]
    fn more_than_two_megabytes_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.json");
        let huge = history(&"x".repeat(MOST_TEXT + 1), 0);
        assert!(write(&path, &huge).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn a_space_keeps_its_newest_histories() {
        let dir = tempfile::tempdir().unwrap();
        let space = dir.path().join("space");
        fs::create_dir_all(&space).unwrap();

        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for turn in 0..MOST_PER_SPACE + 3 {
            let path = space.join(format!("t{turn}.json"));
            write(&path, &history("screen", 0)).unwrap();
            if turn < 3 {
                fs::File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_modified(old)
                    .unwrap();
            }
        }
        let part = space.join("t0.7.part");
        fs::write(&part, b"half").unwrap();
        fs::File::options()
            .write(true)
            .open(&part)
            .unwrap()
            .set_modified(old)
            .unwrap();

        prune(&space);

        let left = fs::read_dir(&space).unwrap().count();
        assert_eq!(left, MOST_PER_SPACE);
        for gone in ["t0.json", "t1.json", "t2.json", "t0.7.part"] {
            assert!(!space.join(gone).exists(), "{gone} is still there");
        }
        assert!(space.join("t3.json").exists());
    }
}
