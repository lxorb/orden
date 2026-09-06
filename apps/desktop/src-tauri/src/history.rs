//! Every version of a note the app has seen. A copy is kept before a note is
//! overwritten, so a bad edit or a sync conflict is never the end of the story.
//!
//! The copies live in the app's own config folder rather than beside the note:
//! a note's folder belongs to the person who owns it, and history would clutter
//! it. Each note gets a folder named after a hash of its path, and the snapshots
//! in it are named after the moment they were taken.

use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::clock;
use crate::paths::{cannot, folded, inside, write_atomically};

/// How many snapshots of one note are kept before the oldest is dropped.
const KEEP: usize = 40;

/// One kept version of a note.
#[derive(Serialize)]
pub struct Snapshot {
    /// Milliseconds since the epoch, and also the file's name.
    taken_at: u64,
    size: u64,
    path: String,
}

/// Keeps a copy of a note before it is overwritten. Does nothing for a note with
/// no text in it, which is what an empty new note is, and nothing when the text
/// has not changed since the last copy.
#[tauri::command]
pub fn snapshot_note(app: AppHandle, path: String, content: String) -> Result<(), String> {
    if content.trim().is_empty() {
        return Ok(());
    }

    let dir = history_root(&app, &path)?;

    let mut existing = snapshot_files(&dir);
    if let Some(last) = existing.last() {
        if fs::read_to_string(last).is_ok_and(|body| body == content) {
            return Ok(());
        }
    }

    // The name is the moment it was taken, so two saves inside one millisecond
    // would otherwise be the same file. The later one moves on by a millisecond
    // rather than replacing the earlier.
    let mut taken_at = clock::now();
    while dir.join(format!("{taken_at}.md")).exists() {
        taken_at += 1;
    }
    write_atomically(&dir.join(format!("{taken_at}.md")), content.as_bytes())?;

    existing = snapshot_files(&dir);
    if existing.len() > KEEP {
        for stale in &existing[..existing.len() - KEEP] {
            let _ = fs::remove_file(stale);
        }
    }

    // The note's own path is recorded so history can be listed by name later. Not
    // worth failing a snapshot over.
    let _ = fs::write(dir.join("origin.txt"), &path);
    Ok(())
}

/// Every kept version of one note, newest first.
#[tauri::command]
pub fn list_snapshots(app: AppHandle, path: String) -> Result<Vec<Snapshot>, String> {
    let dir = history_root(&app, &path)?;

    let mut snapshots: Vec<Snapshot> = snapshot_files(&dir)
        .into_iter()
        .filter_map(|file| {
            let taken_at = file
                .file_stem()
                .and_then(OsStr::to_str)
                .and_then(|stem| stem.parse::<u64>().ok())?;

            Some(Snapshot {
                taken_at,
                size: fs::metadata(&file).map_or(0, |one| one.len()),
                path: file.to_string_lossy().to_string(),
            })
        })
        .collect();

    snapshots.reverse();
    Ok(snapshots)
}

/// Reads one kept version back. Only the history folder is readable this way; a
/// note itself is read by `read_note`.
#[tauri::command]
pub fn read_snapshot(app: AppHandle, path: String) -> Result<String, String> {
    let kept = folded(Path::new(&path));
    if !inside(&history_dir(&app)?, &kept) {
        return Err(format!("{path} is not a kept version of a note"));
    }

    fs::read_to_string(&kept).map_err(|error| cannot("read", &kept, &error))
}

/// The folder every note's history lives under.
fn history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("could not find the settings folder: {error}"))?
        .join("history"))
}

/// The folder this one note's history lives in, made if it is not there yet.
fn history_root(app: &AppHandle, note_path: &str) -> Result<PathBuf, String> {
    let dir = history_dir(app)?.join(key(note_path));
    fs::create_dir_all(&dir).map_err(|error| cannot("create", &dir, &error))?;
    Ok(dir)
}

/// A stable, filesystem-safe folder name for a note's full path. Any hash would
/// do; this one is `FNV-1a`, which is a dozen lines and needs no dependency.
fn key(note_path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in note_path.to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The snapshots in one folder, oldest first. The names are all the same length
/// until the year 2286, so sorting them as text sorts them by age.
fn snapshot_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(OsStr::to_str) == Some("md"))
        .collect();

    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::{key, snapshot_files};

    #[test]
    fn the_same_path_always_gets_the_same_folder() {
        assert_eq!(key("/notes/a.md"), key("/notes/a.md"));
    }

    #[test]
    fn different_paths_get_different_folders() {
        assert_ne!(key("/notes/a.md"), key("/notes/b.md"));
    }

    #[test]
    fn the_same_note_in_another_case_is_the_same_note() {
        assert_eq!(key(r"C:\Notes\A.md"), key(r"c:\notes\a.md"));
    }

    #[test]
    fn the_name_is_filesystem_safe() {
        let name = key(r"C:\notes\a b.md");
        assert_eq!(name.len(), 16);
        assert!(name.chars().all(|letter| letter.is_ascii_hexdigit()));
    }

    #[test]
    fn snapshots_come_back_oldest_first_and_nothing_else_does() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("1700000000002.md"), "second").expect("a snapshot");
        std::fs::write(here.join("1700000000001.md"), "first").expect("an older snapshot");
        std::fs::write(here.join("origin.txt"), "/notes/a.md").expect("the origin");

        let files = snapshot_files(here);
        let names: Vec<String> = files
            .iter()
            .filter_map(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .collect();

        assert_eq!(names, ["1700000000001.md", "1700000000002.md"]);
    }
}
