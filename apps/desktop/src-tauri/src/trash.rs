//! Recently deleted, on this machine. Signed out, a deleted note or space is
//! not removed but moved into `Documents/Nib/.trash/<id>/`, and a manifest
//! next to those folders remembers what each one was and where it came from,
//! so it can be put back for 14 days. The app sweeps what is older.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::spaces::root;

const TRASH: &str = ".trash";
const MANIFEST: &str = "manifest.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    /// `note`, `folder` or `space`: what the app should call it, and how to
    /// number it if its place is taken on the way back.
    pub kind: String,
    pub name: String,
    /// Where it was, relative to the notes folder, with `/` between parts.
    pub from: String,
    pub trashed_at: u64,
}

fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Two deletions in the same millisecond still get different folders.
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    format!("{}-{}", millis(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn trash_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root(app)?.join(TRASH);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_manifest(dir: &Path) -> Vec<TrashEntry> {
    fs::read_to_string(dir.join(MANIFEST))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Written whole and renamed into place, so a crash mid-write cannot leave
/// half a manifest behind.
fn write_manifest(dir: &Path, entries: &[TrashEntry]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    let temp = dir.join(format!("{MANIFEST}.tmp"));
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    fs::rename(&temp, dir.join(MANIFEST)).map_err(|e| e.to_string())
}

/// `path` if nothing is there, else the first free `name 2`, `name 3`... - the
/// number before the extension for a file, after the name for a folder.
pub fn free_spot(path: &Path, is_file: bool) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let (stem, extension) = match file_name.rfind('.') {
        Some(dot) if is_file && dot > 0 => {
            (file_name[..dot].to_string(), file_name[dot..].to_string())
        }
        _ => (file_name.clone(), String::new()),
    };

    let mut counter = 2;
    loop {
        let candidate = parent.join(format!("{stem} {counter}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// Moves a note, folder or space into Recently deleted and says what it became.
#[tauri::command]
pub fn trash_item(app: AppHandle, path: String, kind: String) -> Result<TrashEntry, String> {
    let base = root(&app)?;
    let source = PathBuf::from(&path);

    let relative = source
        .strip_prefix(&base)
        .map_err(|_| "that is not in the notes folder".to_string())?;
    if relative.as_os_str().is_empty() || relative.starts_with(TRASH) {
        return Err("that cannot be deleted".into());
    }
    if !source.exists() {
        return Err("nothing is there".into());
    }

    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("that has no name")?;

    let dir = trash_dir(&app)?;
    let id = new_id();
    let slot = dir.join(&id);
    fs::create_dir_all(&slot).map_err(|e| e.to_string())?;
    fs::rename(&source, slot.join(&name)).map_err(|e| e.to_string())?;

    let entry = TrashEntry {
        id,
        kind,
        name,
        from: relative.to_string_lossy().replace('\\', "/"),
        trashed_at: millis(),
    };

    let mut entries = read_manifest(&dir);
    entries.push(entry.clone());
    write_manifest(&dir, &entries)?;
    Ok(entry)
}

/// Newest first.
#[tauri::command]
pub fn list_trash(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let dir = trash_dir(&app)?;
    let mut entries = read_manifest(&dir);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.trashed_at));
    Ok(entries)
}

/// Puts something back where it was and returns where it landed, which is the
/// old place unless that is taken by now.
#[tauri::command]
pub fn restore_trash(app: AppHandle, id: String) -> Result<String, String> {
    let base = root(&app)?;
    let dir = trash_dir(&app)?;
    let mut entries = read_manifest(&dir);

    let position = entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or("nothing to restore")?;
    let entry = entries[position].clone();

    let slot = dir.join(&entry.id);
    let held = slot.join(&entry.name);
    if !held.exists() {
        entries.remove(position);
        write_manifest(&dir, &entries)?;
        return Err("it is already gone".into());
    }

    let wanted = base.join(entry.from.replace('/', std::path::MAIN_SEPARATOR_STR));
    let target = free_spot(&wanted, entry.kind == "note");
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&held, &target).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&slot);

    entries.remove(position);
    write_manifest(&dir, &entries)?;
    Ok(target.to_string_lossy().to_string())
}

fn purge(dir: &Path, entries: &mut Vec<TrashEntry>, id: &str) {
    let _ = fs::remove_dir_all(dir.join(id));
    entries.retain(|entry| entry.id != id);
}

/// Takes one thing away for good.
#[tauri::command]
pub fn purge_trash(app: AppHandle, id: String) -> Result<(), String> {
    let dir = trash_dir(&app)?;
    let mut entries = read_manifest(&dir);
    purge(&dir, &mut entries, &id);
    write_manifest(&dir, &entries)
}

/// The sweep: everything that has waited longer than `age` milliseconds goes.
/// Returns how many did.
#[tauri::command]
pub fn purge_trash_older_than(app: AppHandle, age: u64) -> Result<u32, String> {
    let dir = trash_dir(&app)?;
    let mut entries = read_manifest(&dir);
    let cutoff = millis().saturating_sub(age);

    let old: Vec<String> = entries
        .iter()
        .filter(|entry| entry.trashed_at < cutoff)
        .map(|entry| entry.id.clone())
        .collect();
    for id in &old {
        purge(&dir, &mut entries, id);
    }

    write_manifest(&dir, &entries)?;
    Ok(old.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::free_spot;
    use std::fs;

    #[test]
    fn numbering_goes_before_the_extension_for_files() {
        let dir = std::env::temp_dir().join(format!("nib-trash-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Idea.md"), "").unwrap();
        fs::write(dir.join("Idea 2.md"), "").unwrap();
        fs::create_dir_all(dir.join("Notes")).unwrap();

        assert_eq!(free_spot(&dir.join("Idea.md"), true), dir.join("Idea 3.md"));
        assert_eq!(free_spot(&dir.join("Notes"), false), dir.join("Notes 2"));
        assert_eq!(free_spot(&dir.join("New.md"), true), dir.join("New.md"));

        let _ = fs::remove_dir_all(&dir);
    }
}
