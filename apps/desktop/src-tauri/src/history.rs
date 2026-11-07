use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::clock;
use crate::paths::{
    cannot, config_dir, folded, inside, kept_folder, made, write_atomically, ORIGIN,
};

const KEEP: usize = 40;

#[derive(Serialize)]
pub struct Snapshot {
    taken_at: u64,
    size: u64,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

const SOURCE: &str = "by";

const LONGEST_SOURCE: usize = 64;

#[tauri::command(async)]
pub fn snapshot_note(
    app: AppHandle,
    path: String,
    content: String,
    source: Option<String>,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Ok(());
    }

    keep_in(
        &history_root(&app, &path)?,
        &path,
        &content,
        source.as_deref(),
    )
}

fn keep_in(dir: &Path, path: &str, content: &str, source: Option<&str>) -> Result<(), String> {
    let mut existing = snapshot_files(dir);
    if let Some(last) = existing.last() {
        if fs::read_to_string(last).is_ok_and(|body| body == content) {
            if let Some(source) = source {
                name_source(last, source);
            }
            return Ok(());
        }
    }

    let mut taken_at = clock::now();
    while dir.join(format!("{taken_at}.md")).exists() {
        taken_at += 1;
    }
    let file = dir.join(format!("{taken_at}.md"));
    write_atomically(&file, content.as_bytes())?;
    if let Some(source) = source {
        name_source(&file, source);
    }

    existing = snapshot_files(dir);
    if existing.len() > KEEP {
        for old in &existing[..existing.len() - KEEP] {
            drop_version(old);
        }
    }

    let _ = fs::write(dir.join(ORIGIN), path);
    Ok(())
}

fn name_source(snapshot: &Path, source: &str) {
    let name: String = source.trim().chars().take(LONGEST_SOURCE).collect();
    if !name.is_empty() {
        let _ = fs::write(snapshot.with_extension(SOURCE), name);
    }
}

fn source_of(snapshot: &Path) -> Option<String> {
    let name = fs::read_to_string(snapshot.with_extension(SOURCE)).ok()?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

fn drop_version(snapshot: &Path) -> bool {
    let _ = fs::remove_file(snapshot.with_extension(SOURCE));
    fs::remove_file(snapshot).is_ok()
}

#[tauri::command(async)]
pub fn list_snapshots(app: AppHandle, path: String) -> Result<Vec<Snapshot>, String> {
    Ok(listed(&history_root(&app, &path)?))
}

fn listed(dir: &Path) -> Vec<Snapshot> {
    let mut snapshots: Vec<Snapshot> = snapshot_files(dir)
        .into_iter()
        .filter_map(|file| {
            let taken_at = moment(&file)?;

            Some(Snapshot {
                taken_at,
                size: fs::metadata(&file).map_or(0, |one| one.len()),
                source: source_of(&file),
                path: file.to_string_lossy().to_string(),
            })
        })
        .collect();

    snapshots.reverse();
    snapshots
}

const HOUR: u64 = 60 * 60 * 1000;
const DAY: u64 = 24 * HOUR;

fn stale(taken: &[u64], now: u64, days: u64) -> Vec<u64> {
    let mut newest_first: Vec<u64> = taken.to_vec();
    newest_first.sort_unstable_by(|a, b| b.cmp(a));

    let mut stale = Vec::new();
    let mut hours_kept = HashSet::new();
    let retention = days.saturating_mul(DAY);

    for at in newest_first {
        let age = now.saturating_sub(at);
        if age > retention || (age > DAY && !hours_kept.insert(at / HOUR)) {
            stale.push(at);
        }
    }

    stale
}

#[tauri::command(async)]
pub fn purge_snapshots(app: AppHandle, days: u64) -> Result<usize, String> {
    let root = history_dir(&app)?;
    let Ok(entries) = fs::read_dir(&root) else {
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
            if drop_version(&note.join(format!("{at}.md"))) {
                dropped += 1;
            }
        }

        if snapshot_files(&note).is_empty() {
            let _ = fs::remove_file(note.join(ORIGIN));
            let _ = fs::remove_dir(&note);
        }
    }

    Ok(dropped)
}

#[tauri::command(async)]
pub fn rehome_snapshots(app: AppHandle, from: String, to: String) -> Result<usize, String> {
    Ok(rehome_in(&history_dir(&app)?, &from, &to))
}

fn rehome_in(root: &Path, from: &str, to: &str) -> usize {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };

    let mut moved = 0;
    for note in entries.flatten().map(|entry| entry.path()) {
        let Ok(was) = fs::read_to_string(note.join(ORIGIN)) else {
            continue;
        };
        let Some(rest) = was.strip_prefix(from) else {
            continue;
        };
        if !rest.starts_with(['/', '\\']) {
            continue;
        }

        let now = format!("{to}{rest}");
        let there = kept_folder(root, &now);
        if there.exists() {
            continue;
        }
        if crate::carry::rename_new(&note, &there).is_ok() {
            let _ = fs::write(there.join(ORIGIN), &now);
            moved += 1;
        }
    }

    moved
}

fn moment(file: &Path) -> Option<u64> {
    file.file_stem()
        .and_then(OsStr::to_str)
        .and_then(|stem| stem.parse::<u64>().ok())
}

#[tauri::command(async)]
pub fn read_snapshot(app: AppHandle, path: String) -> Result<String, String> {
    let kept = folded(Path::new(&path));
    if !inside(&history_dir(&app)?, &kept) {
        return Err(format!("{path} is not a kept version of a note"));
    }

    fs::read_to_string(&kept).map_err(|error| cannot("read", &kept, &error))
}

fn history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("history"))
}

fn history_root(app: &AppHandle, note_path: &str) -> Result<PathBuf, String> {
    let dir = kept_folder(&history_dir(app)?, note_path);
    made(&dir)?;
    Ok(dir)
}

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
    use super::{keep_in, listed, rehome_in, snapshot_files, stale, DAY, HOUR, KEEP};
    use crate::paths::{folder_key, ORIGIN};
    use std::fs;

    const OLD: &str = "/var/mobile/Containers/Data/Application/03742EE0/Documents/Orden";
    const NEW: &str = "/var/mobile/Containers/Data/Application/853E8E51/Documents/Orden";

    fn kept_at(root: &std::path::Path, note: &str) -> std::path::PathBuf {
        let dir = root.join(folder_key(note));
        fs::create_dir_all(&dir).expect("a history folder");
        fs::write(dir.join(ORIGIN), note).expect("its origin");
        fs::write(dir.join("1773500400000.md"), "a version").expect("a version");
        dir
    }

    #[test]
    fn a_history_follows_its_note_when_the_spaces_folder_moves() {
        let root = tempfile::tempdir().expect("a temp folder");
        let before = kept_at(root.path(), &format!("{OLD}/Notes/Read me.md"));

        assert_eq!(rehome_in(root.path(), OLD, NEW), 1);

        let now = format!("{NEW}/Notes/Read me.md");
        let after = root.path().join(folder_key(&now));
        assert!(!before.exists());
        assert_eq!(
            fs::read_to_string(after.join(ORIGIN)).expect("the origin"),
            now
        );
        assert!(after.join("1773500400000.md").exists());
    }

    #[test]
    fn a_history_outside_the_old_folder_stays_where_it_is() {
        let root = tempfile::tempdir().expect("a temp folder");
        let beside = kept_at(root.path(), &format!("{OLD}2/Notes/a.md"));
        let elsewhere = kept_at(root.path(), "/somewhere/else/a.md");

        assert_eq!(rehome_in(root.path(), OLD, NEW), 0);
        assert!(beside.exists());
        assert!(elsewhere.exists());
    }

    #[test]
    fn a_history_already_kept_at_the_new_path_is_not_written_over() {
        let root = tempfile::tempdir().expect("a temp folder");
        let before = kept_at(root.path(), &format!("{OLD}/Notes/a.md"));
        let already = kept_at(root.path(), &format!("{NEW}/Notes/a.md"));

        assert_eq!(rehome_in(root.path(), OLD, NEW), 0);
        assert!(before.exists());
        assert!(already.exists());
    }

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
    fn a_retention_too_large_to_multiply_keeps_everything() {
        let versions = [NOW - 60_000, NOW - 8 * DAY, NOW - 400 * DAY];

        assert!(stale(&versions, NOW, 1 << 54).is_empty());
        assert!(stale(&versions, NOW, u64::MAX).is_empty());
    }

    #[test]
    fn a_version_kept_for_an_agent_says_whose() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();

        keep_in(here, "/notes/a.md", "saved", None).expect("a save");
        keep_in(here, "/notes/a.md", "before the agent", Some("Claude Code")).expect("kept");

        let versions = listed(here);
        let sources: Vec<Option<&str>> = versions.iter().map(|one| one.source.as_deref()).collect();
        assert_eq!(sources, [Some("Claude Code"), None]);
    }

    #[test]
    fn the_same_words_as_the_last_version_are_that_version() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();

        keep_in(here, "/notes/a.md", "saved", None).expect("a save");
        keep_in(here, "/notes/a.md", "saved", Some("Codex")).expect("kept");

        let versions = listed(here);
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].source.as_deref(), Some("Codex"));
    }

    #[test]
    fn who_a_version_was_kept_for_goes_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();

        keep_in(here, "/notes/a.md", "first", Some("Claude Code")).expect("kept");
        for at in 0..KEEP {
            keep_in(here, "/notes/a.md", &format!("save {at}"), None).expect("a save");
        }

        let left = fs::read_dir(here)
            .expect("the folder")
            .flatten()
            .filter(|entry| entry.path().extension().is_some_and(|one| one == "by"))
            .count();
        assert_eq!(left, 0);
        assert_eq!(listed(here).len(), KEEP);
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
