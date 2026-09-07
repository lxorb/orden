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
            let taken_at = moment(&file)?;

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

/// A day and an hour in milliseconds, which is the unit every snapshot's name
/// is in.
const HOUR: u64 = 60 * 60 * 1000;
const DAY: u64 = 24 * HOUR;

/// Which of one note's versions have had their day, given when they were taken
/// and what time it is now.
///
/// Two rules, and a version has to survive both. Nothing older than the
/// retention is kept, which is what the person asked for. And past the first
/// day only the last version of each hour is kept: today is when a bad edit is
/// noticed and every step of it is worth having, while a week ago one version
/// an hour is a history and the other ninety-nine are a disk full. That second
/// rule is the size cap, so a long note written in all day leaves twenty-four
/// versions of that day behind rather than hundreds.
///
/// The same policy runs in the browser, over IndexedDB; see
/// src/lib/recovery.ts.
fn stale(taken: &[u64], now: u64, days: u64) -> Vec<u64> {
    let mut newest_first: Vec<u64> = taken.to_vec();
    newest_first.sort_unstable_by(|a, b| b.cmp(a));

    let mut stale = Vec::new();
    let mut hours_kept = std::collections::HashSet::new();

    for at in newest_first {
        let age = now.saturating_sub(at);
        if age > days * DAY {
            stale.push(at);
        } else if age > DAY && !hours_kept.insert(at / HOUR) {
            // Newest first, so the first version met in an hour is the one that
            // hour keeps and every older one in it goes.
            stale.push(at);
        }
    }

    stale
}

/// Sweeps every note's history by the policy above. Answers how many versions
/// went, which is what the caller logs and nothing else reads.
#[tauri::command]
pub fn purge_snapshots(app: AppHandle, days: u64) -> Result<usize, String> {
    let root = history_dir(&app)?;
    let Ok(entries) = fs::read_dir(&root) else {
        // Nothing has ever been kept, so there is nothing to sweep.
        return Ok(0);
    };

    let now = clock::now();
    let mut dropped = 0;

    for note in entries.flatten().map(|entry| entry.path()) {
        if !note.is_dir() {
            continue;
        }

        let files = snapshot_files(&note);
        let taken: Vec<u64> = files.iter().filter_map(|file| moment(file)).collect();

        for at in stale(&taken, now, days) {
            if fs::remove_file(note.join(format!("{at}.md"))).is_ok() {
                dropped += 1;
            }
        }

        // A note whose every version has gone leaves an empty folder and the
        // note's path in it; both go with the last version.
        if snapshot_files(&note).is_empty() {
            let _ = fs::remove_file(note.join("origin.txt"));
            let _ = fs::remove_dir(&note);
        }
    }

    Ok(dropped)
}

/// The moment a snapshot was taken, which is its file name.
fn moment(file: &Path) -> Option<u64> {
    file.file_stem()
        .and_then(OsStr::to_str)
        .and_then(|stem| stem.parse::<u64>().ok())
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
    use super::{key, snapshot_files, stale, DAY, HOUR};

    /// A fixed moment, so what the policy answers never depends on the day the
    /// tests are run.
    const NOW: u64 = 1_773_500_400_000;

    fn kept(taken: &[u64], days: u64) -> Vec<u64> {
        let dropped = stale(taken, NOW, days);
        taken
            .iter()
            .copied()
            .filter(|at| !dropped.contains(at))
            .collect()
    }

    #[test]
    fn everything_from_the_last_day_is_kept() {
        let today = [NOW - 60_000, NOW - 120_000, NOW - HOUR, NOW - DAY + 1];
        assert!(stale(&today, NOW, 7).is_empty());
    }

    #[test]
    fn nothing_older_than_the_retention_is_kept() {
        let old = NOW - 8 * DAY;
        assert_eq!(stale(&[old], NOW, 7), vec![old]);
        assert!(stale(&[old], NOW, 30).is_empty());
    }

    #[test]
    fn one_version_an_hour_past_the_first_day() {
        let hour = NOW - 2 * DAY;
        let versions = [hour, hour + 10 * 60_000, hour + 20 * 60_000];
        assert_eq!(kept(&versions, 7), vec![hour + 20 * 60_000]);
    }

    #[test]
    fn a_version_a_minute_for_a_day_thins_to_a_version_an_hour() {
        let start = NOW - 3 * DAY;
        let versions: Vec<u64> = (0..24 * 60).map(|minute| start + minute * 60_000).collect();

        assert_eq!(versions.len(), 1440);
        assert_eq!(kept(&versions, 7).len(), 24);
    }

    #[test]
    fn a_note_with_no_versions_has_nothing_to_sweep() {
        assert!(stale(&[], NOW, 7).is_empty());
    }

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
