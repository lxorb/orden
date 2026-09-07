//! Recently deleted, on this machine. A deleted note, folder or space is not
//! removed but moved into `Documents/Nib/.trash/<id>/`, and a manifest beside
//! those folders remembers what each one was and where it came from, so it can
//! be put back for fourteen days. The app sweeps what is older.
//!
//! This module owns that folder, that manifest, and nothing else.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf, MAIN_SEPARATOR_STR};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::AppHandle;

use crate::clock;
use crate::paths::{
    cannot, free_spot, in_spaces, move_highlights, spaces_root, write_atomically, TRASH,
};

/// The record of what is in the trash, written beside the folders it describes.
const MANIFEST: &str = "manifest.json";

/// What the app knows how to put back. The kind decides how a name is numbered if
/// its old place has been taken in the meantime.
const KINDS: [&str; 3] = ["note", "folder", "space"];

/// Two deletions in the same millisecond still get different folders.
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// The manifest is read, changed and written whole. Two windows deleting at the
/// same moment would otherwise each write a manifest that does not know about the
/// other's entry, and one of the two notes would be unreachable. Only one process
/// ever runs, so one lock covers it.
static MANIFEST_LOCK: Mutex<()> = Mutex::new(());

/// One thing waiting in the trash.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// The folder inside the trash that holds it.
    pub id: String,
    /// `note`, `folder` or `space`: what the app should call it, and how to
    /// number it if its place is taken on the way back.
    pub kind: String,
    /// The name it had, which is also the name it is stored under.
    pub name: String,
    /// Where it was, relative to the notes folder, with `/` between parts.
    pub from: String,
    /// When it was deleted, in milliseconds since the epoch.
    pub trashed_at: u64,
}

/// Moves a note, folder or space into the trash and says what it became.
#[tauri::command]
pub fn trash_item(app: AppHandle, path: String, kind: String) -> Result<TrashEntry, String> {
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("{kind} is not something Nib can delete"));
    }

    let base = spaces_root(&app)?;
    // Refuses anything outside the notes folder, and the trash itself: what is
    // already deleted cannot be deleted again.
    let source = in_spaces(&app, &path)?;

    let relative = source
        .strip_prefix(&base)
        .map_err(|_| format!("{path} is not in the notes folder"))?;
    if relative.as_os_str().is_empty() {
        return Err("that cannot be deleted".into());
    }
    if !source.exists() {
        return Err("nothing is there".into());
    }

    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or("that has no name")?;

    let _guard = locked();
    let dir = trash_dir(&app)?;
    let id = new_id();
    let slot = dir.join(&id);
    fs::create_dir_all(&slot).map_err(|error| cannot("create", &slot, &error))?;

    let held = slot.join(&name);
    if let Err(error) = fs::rename(&source, &held) {
        let _ = fs::remove_dir_all(&slot);
        return Err(cannot("delete", &source, &error));
    }

    // A deleted PDF takes its highlights into the same folder, so putting it
    // back puts them back with it.
    move_highlights(&source, &held);

    let entry = TrashEntry {
        id,
        kind,
        name,
        from: relative.to_string_lossy().replace('\\', "/"),
        trashed_at: clock::now(),
    };

    let mut entries = read_manifest(&dir);
    entries.push(entry.clone());

    // An entry that cannot be written down is a note nobody could find again, so
    // it goes back where it came from instead.
    if let Err(error) = write_manifest(&dir, &entries) {
        let _ = fs::rename(&held, &source);
        move_highlights(&held, &source);
        let _ = fs::remove_dir_all(&slot);
        return Err(error);
    }

    Ok(entry)
}

/// Everything in the trash, newest first.
#[tauri::command]
pub fn list_trash(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.trashed_at));
    Ok(entries)
}

/// Puts something back where it was and returns where it landed, which is the
/// old place unless that is taken by now.
#[tauri::command]
pub fn restore_trash(app: AppHandle, id: String) -> Result<String, String> {
    let base = spaces_root(&app)?;

    let _guard = locked();
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

    let wanted = base.join(entry.from.replace('/', MAIN_SEPARATOR_STR));
    let target = free_spot(&wanted, entry.kind == "note");
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| cannot("create", parent, &error))?;
    }

    fs::rename(&held, &target).map_err(|error| cannot("restore", &target, &error))?;
    // The highlights come back under whatever name the PDF landed under, which
    // is not the old one when something has taken its place in the meantime.
    move_highlights(&held, &target);
    let _ = fs::remove_dir_all(&slot);

    entries.remove(position);
    write_manifest(&dir, &entries)?;
    Ok(target.to_string_lossy().to_string())
}

/// Takes one thing away for good.
#[tauri::command]
pub fn purge_trash(app: AppHandle, id: String) -> Result<(), String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    purge(&dir, &mut entries, &id);
    write_manifest(&dir, &entries)
}

/// The sweep: everything that has waited longer than `age` milliseconds goes.
/// Returns how many did.
#[tauri::command]
pub fn purge_trash_older_than(app: AppHandle, age: u64) -> Result<u32, String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    let cutoff = clock::now().saturating_sub(age);

    let old: Vec<String> = entries
        .iter()
        .filter(|entry| entry.trashed_at < cutoff)
        .map(|entry| entry.id.clone())
        .collect();
    for id in &old {
        purge(&dir, &mut entries, id);
    }

    write_manifest(&dir, &entries)?;
    Ok(u32::try_from(old.len()).unwrap_or(u32::MAX))
}

/// The trash folder, made if it is not there yet.
fn trash_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = spaces_root(app)?.join(TRASH);
    fs::create_dir_all(&dir).map_err(|error| cannot("create", &dir, &error))?;
    Ok(dir)
}

/// The lock, whether or not whoever held it last panicked: what it protects is a
/// file on disk, and that file is no less readable for it.
fn locked() -> MutexGuard<'static, ()> {
    MANIFEST_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A folder name no other deletion will use.
fn new_id() -> String {
    format!(
        "{}-{}",
        clock::now(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// The manifest, or an empty one when there is nothing to read.
fn read_manifest(dir: &Path) -> Vec<TrashEntry> {
    let path = dir.join(MANIFEST);
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };

    serde_json::from_str(&text).unwrap_or_else(|_| {
        // A manifest that cannot be read is kept rather than written over: the
        // folders beside it still hold the notes, and this is the only record of
        // where each of them came from.
        let _ = fs::rename(&path, dir.join(format!("{MANIFEST}.unreadable")));
        Vec::new()
    })
}

/// Written whole and renamed into place, so a crash mid-write cannot leave half
/// a manifest behind.
fn write_manifest(dir: &Path, entries: &[TrashEntry]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("could not write down what is in the trash: {error}"))?;
    write_atomically(&dir.join(MANIFEST), text.as_bytes())
}

/// Forgets one entry and takes its folder with it.
fn purge(dir: &Path, entries: &mut Vec<TrashEntry>, id: &str) {
    let _ = fs::remove_dir_all(dir.join(id));
    entries.retain(|entry| entry.id != id);
}

#[cfg(test)]
mod tests {
    use super::{read_manifest, write_manifest, TrashEntry, MANIFEST};

    fn entry(id: &str, name: &str, from: &str) -> TrashEntry {
        TrashEntry {
            id: id.into(),
            kind: "note".into(),
            name: name.into(),
            from: from.into(),
            trashed_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn a_manifest_survives_the_round_trip() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let written = vec![
            entry("1-0", "Idea.md", "Work/Idea.md"),
            entry(
                "1-1",
                "Notizen über Bücher.md",
                "Privat/Notizen über Bücher.md",
            ),
        ];

        write_manifest(dir.path(), &written).expect("the manifest");
        let read = read_manifest(dir.path());

        assert_eq!(read.len(), 2);
        assert_eq!(read[1].name, "Notizen über Bücher.md");
        assert_eq!(read[1].from, "Privat/Notizen über Bücher.md");
        assert_eq!(read[0].trashed_at, 1_700_000_000_000);
    }

    #[test]
    fn the_manifest_is_the_camel_case_the_window_reads() {
        let dir = tempfile::tempdir().expect("a temp folder");
        write_manifest(dir.path(), &[entry("1-0", "Idea.md", "Idea.md")]).expect("the manifest");

        let text = std::fs::read_to_string(dir.path().join(MANIFEST)).expect("the file");
        assert!(text.contains("\"trashedAt\""));
        assert!(!text.contains("trashed_at"));
    }

    #[test]
    fn nothing_written_yet_reads_as_an_empty_trash() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert!(read_manifest(dir.path()).is_empty());
    }

    #[test]
    fn a_manifest_that_cannot_be_read_is_kept_rather_than_lost() {
        let dir = tempfile::tempdir().expect("a temp folder");
        std::fs::write(dir.path().join(MANIFEST), "{ not json").expect("a broken manifest");

        assert!(read_manifest(dir.path()).is_empty());
        assert!(dir.path().join("manifest.json.unreadable").exists());
    }
}
