use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::paths::{made, write_privately};

const MOST_BYTES: usize = 64 * 1024 * 1024;

static LISTS: Mutex<()> = Mutex::new(());

fn ours(webview: &tauri::Webview) -> Result<(), String> {
    let label = webview.label();
    #[cfg(desktop)]
    let own = crate::launch::is_document_window(label);
    #[cfg(mobile)]
    let own = true;
    if own && label == webview.window().label() {
        Ok(())
    } else {
        Err("only nib's own window may ask that".into())
    }
}

fn named(id: &str) -> Result<&str, String> {
    let fits = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(id)
    } else {
        Err(format!("{id} is not an id"))
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(folder.join("ai").join("threads"))
}

fn space_dir(root: &Path, space: &str) -> Result<PathBuf, String> {
    Ok(root.join(named(space)?))
}

fn read_list(dir: &Path) -> BTreeMap<String, Value> {
    fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_list(dir: &Path, list: &BTreeMap<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string(list).map_err(|error| error.to_string())?;
    write_privately(&dir.join("index.json"), text.as_bytes())
}

pub fn list(root: &Path, space: &str) -> Result<Vec<Value>, String> {
    let dir = space_dir(root, space)?;
    Ok(read_list(&dir).into_values().collect())
}

pub fn read(root: &Path, space: &str, id: &str) -> Result<Option<String>, String> {
    let path = space_dir(root, space)?.join(format!("{}.json", named(id)?));
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read that thread: {error}")),
    }
}

pub fn write(root: &Path, space: &str, id: &str, head: Value, body: &str) -> Result<(), String> {
    if body.len() > MOST_BYTES {
        return Err("that thread is too long to keep".into());
    }
    let dir = space_dir(root, space)?;
    let file = format!("{}.json", named(id)?);
    made(&dir)?;
    let _held = LISTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    write_privately(&dir.join(file), body.as_bytes())?;
    let mut list = read_list(&dir);
    list.insert(id.to_owned(), head);
    write_list(&dir, &list)
}

pub fn delete(root: &Path, space: &str, id: &str) -> Result<(), String> {
    let dir = space_dir(root, space)?;
    let path = dir.join(format!("{}.json", named(id)?));
    let _held = LISTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not delete that thread: {error}")),
    }
    let mut list = read_list(&dir);
    if list.remove(id).is_some() {
        write_list(&dir, &list)?;
    }
    Ok(())
}

pub fn forget(root: &Path, space: &str) -> Result<(), String> {
    let dir = space_dir(root, space)?;
    let _held = LISTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not delete those threads: {error}")),
    }
}

#[tauri::command(async)]
pub fn ai_threads_list(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
) -> Result<Vec<Value>, String> {
    ours(&webview)?;
    list(&root(&app)?, &space)
}

#[tauri::command(async)]
pub fn ai_thread_read(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
    id: String,
) -> Result<Option<String>, String> {
    ours(&webview)?;
    read(&root(&app)?, &space, &id)
}

#[tauri::command(async)]
pub fn ai_thread_write(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
    id: String,
    head: Value,
    body: String,
) -> Result<(), String> {
    ours(&webview)?;
    write(&root(&app)?, &space, &id, head, &body)
}

#[tauri::command(async)]
pub fn ai_thread_delete(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
    id: String,
) -> Result<(), String> {
    ours(&webview)?;
    delete(&root(&app)?, &space, &id)
}

#[tauri::command(async)]
pub fn ai_threads_forget(
    webview: tauri::Webview,
    app: AppHandle,
    space: String,
) -> Result<(), String> {
    ours(&webview)?;
    forget(&root(&app)?, &space)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orden-ai-threads-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_thread_written_reads_back_with_its_line_in_the_list() {
        let root = folder("round");
        write(
            &root,
            "space-1",
            "t-1",
            json!({"id": "t-1", "title": "Herons"}),
            "{\"id\":\"t-1\"}",
        )
        .expect("written");
        write(
            &root,
            "space-1",
            "t-2",
            json!({"id": "t-2", "title": "Egrets"}),
            "{\"id\":\"t-2\"}",
        )
        .expect("written");
        assert_eq!(
            read(&root, "space-1", "t-1").expect("read").as_deref(),
            Some("{\"id\":\"t-1\"}")
        );
        let titles: Vec<String> = list(&root, "space-1")
            .expect("listed")
            .iter()
            .map(|head| head["title"].as_str().unwrap_or_default().to_owned())
            .collect();
        assert_eq!(titles, ["Herons", "Egrets"]);
        assert!(list(&root, "space-2").expect("listed").is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writing_again_replaces_the_line_rather_than_adding_one() {
        let root = folder("again");
        write(&root, "s", "t", json!({"title": "one"}), "1").expect("written");
        write(&root, "s", "t", json!({"title": "two"}), "2").expect("written");
        let heads = list(&root, "s").expect("listed");
        assert_eq!(heads.len(), 1);
        assert_eq!(heads[0]["title"], "two");
        assert_eq!(read(&root, "s", "t").expect("read").as_deref(), Some("2"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_thread_deleted_is_gone_from_the_folder_and_the_list() {
        let root = folder("delete");
        write(&root, "s", "t", json!({}), "x").expect("written");
        delete(&root, "s", "t").expect("deleted");
        assert_eq!(read(&root, "s", "t").expect("read"), None);
        assert!(list(&root, "s").expect("listed").is_empty());
        delete(&root, "s", "t").expect("deleting nothing is fine");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_space_forgotten_takes_every_thread_and_no_other_space() {
        let root = folder("forget");
        write(&root, "a", "t", json!({}), "x").expect("written");
        write(&root, "b", "t", json!({}), "y").expect("written");
        forget(&root, "a").expect("forgotten");
        assert_eq!(read(&root, "a", "t").expect("read"), None);
        assert_eq!(read(&root, "b", "t").expect("read").as_deref(), Some("y"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_id_that_could_name_another_file_is_refused() {
        let root = folder("names");
        for bad in ["", "..", "../x", "a/b", "a\\b", "c:", &"x".repeat(65)] {
            assert!(
                write(&root, bad, "t", json!({}), "x").is_err(),
                "space {bad:?}"
            );
            assert!(
                write(&root, "s", bad, json!({}), "x").is_err(),
                "thread {bad:?}"
            );
            assert!(read(&root, "s", bad).is_err(), "read {bad:?}");
        }
        assert!(!root.exists());
    }

    #[test]
    fn a_thread_too_long_to_keep_is_refused() {
        let root = folder("long");
        let body = "x".repeat(MOST_BYTES + 1);
        assert!(write(&root, "s", "t", json!({}), &body).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
