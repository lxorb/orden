//! A spaces folder somebody pointed at a folder of their own (#552), by writing it into
//! `spaces-folder` by hand: an Obsidian vault, or any folder Orden did not make. Orden
//! keeps every note in its own folder, and an outside folder is only ever imported, so
//! such a folder is never used where it is (`SPACES_OUTSIDE` in paths.rs).
//!
//! What was a space there is taken in once instead: each space's folder copied whole
//! into Orden's own and checked byte for byte against the one it came from, under a
//! name no space there has. The outside folder is left exactly as it was. The page then
//! says every path it kept under the old folder again under the new one, which keeps
//! the spaces' ids, versions and sync (workspace/outside.ts), and only then is
//! `spaces-folder` written with Orden's own folder (`settle_outside`). What did not
//! copy is tried again at the next launch; what did is written down (`TAKEN`), so it is
//! never copied twice.

use serde::Serialize;
use std::fmt::Write as _;
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;

use crate::carry::copy_whole;
use crate::paths::{
    self, cannot, config_dir, inside, made, write_atomically, SPACES_KEPT, SPACES_OUTSIDE,
};

/// What was taken in so far, one line each: the root it had, a tab, the root it has.
const TAKEN: &str = "spaces-taken-in";

/// Where the spaces Orden keeps itself are, in a spaces folder (internal/spaces.ts).
const KEPT: &str = ".orden";

/// What a kept space says it was made of, and the folders such spaces were made of
/// that are no space any more (internal/spaces.ts): none of them is a space to copy.
const FROM: &str = ".from";
const RETIRED: &str = ".retired";

/// What a kept space holds while it is still being made: no space yet.
const CONVERTING: &str = ".converting";

/// How many times a taken name is numbered, as `create_space` does.
const MAX_TRIES: usize = 500;

/// One taking in at a time, whichever window asks.
static TAKING: Mutex<()> = Mutex::new(());

/// One space's root before and after.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Moved {
    from: String,
    to: String,
}

/// What a taking in did: the outside folder, every space of it that is in Orden's own
/// folder now, and the names of those that are not.
#[derive(Serialize, Debug)]
pub struct TakenIn {
    folder: String,
    moved: Vec<Moved>,
    left: Vec<String>,
}

fn outside_pending() -> Option<PathBuf> {
    SPACES_OUTSIDE.lock().ok()?.clone()
}

/// The outside folder still to be taken in, if there is one. Only reads a mutex, so
/// the page asks before anything of it has read its storage (early.ts).
#[tauri::command]
pub fn outside_spaces() -> Option<String> {
    outside_pending().map(|folder| folder.to_string_lossy().to_string())
}

/// Every space of the outside folder copied into Orden's own; see the top of this file.
/// Nothing while there is no outside folder, or while it is not there to be read: a
/// drive not plugged in is tried again at the next launch.
#[tauri::command(async)]
pub fn take_in_outside(app: AppHandle) -> Result<Option<TakenIn>, String> {
    let _one = TAKING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(folder) = outside_pending() else {
        return Ok(None);
    };
    if !folder.is_dir() {
        return Ok(None);
    }
    let own = paths::spaces_root(&app)?;
    let taken = take_in_from(&folder, &own, &config_dir(&app)?.join(TAKEN));
    for name in &taken.left {
        crate::logs::say(
            &app,
            "error",
            &format!(
                "{name} stays in {} only: it could not be copied",
                folder.display()
            ),
        );
    }
    Ok(Some(taken))
}

/// Orden's own folder written as the spaces folder, once the page has followed every
/// space taken in: the outside folder is not asked about again.
#[tauri::command(async)]
pub fn settle_outside(app: AppHandle) -> Result<(), String> {
    let _one = TAKING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let own = paths::spaces_dir(&app)?;
    let settings = config_dir(&app)?;
    write_atomically(
        &settings.join(SPACES_KEPT),
        own.to_string_lossy().as_bytes(),
    )?;
    let _ = fs::remove_file(settings.join(TAKEN));
    if let Ok(mut pending) = SPACES_OUTSIDE.lock() {
        *pending = None;
    }
    Ok(())
}

/// The taking in, apart from the app: the spaces of `folder` into `own`, with what was
/// taken in before read from and written to `record`.
fn take_in_from(folder: &Path, own: &Path, record: &Path) -> TakenIn {
    let mut done = taken_before(record);
    let mut left = Vec::new();
    for (from, into, kept) in spaces_outside(folder, own) {
        let root = space_root_of(&from, kept);
        if done.iter().any(|one| one.from == root) {
            continue;
        }
        match carried_into(&from, &into, kept) {
            Ok(to) => {
                let moved = Moved {
                    from: root,
                    to: space_root_of(&to, kept),
                };
                note_taken(record, &done, &moved);
                done.push(moved);
            }
            Err(_) => left.push(leaf_name(&from)),
        }
    }
    TakenIn {
        folder: folder.to_string_lossy().to_string(),
        moved: done,
        left,
    }
}

fn leaf_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// The root the rest of the app holds a space by: its folder, or for a space Orden
/// keeps itself the file in its folder named as it.
fn space_root_of(folder: &Path, kept: bool) -> String {
    let root = if kept {
        folder.join(leaf_name(folder))
    } else {
        folder.to_path_buf()
    };
    root.to_string_lossy().to_string()
}

fn taken_before(record: &Path) -> Vec<Moved> {
    fs::read_to_string(record)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(from, to)| Moved {
            from: from.to_owned(),
            to: to.to_owned(),
        })
        .collect()
}

fn note_taken(record: &Path, done: &[Moved], moved: &Moved) {
    let mut lines = String::new();
    for one in done.iter().chain([moved]) {
        let _ = writeln!(lines, "{}\t{}", one.from, one.to);
    }
    if let Some(dir) = record.parent() {
        let _ = made(dir);
    }
    let _ = write_atomically(record, lines.as_bytes());
}

/// What is a space in `folder`, the way `list_spaces` and internal/spaces.ts find them,
/// each with the folder it goes into and whether it is a kept one: every folder not
/// dotted, bar those a kept space was made of, and every kept space whole. Not one that
/// holds Orden's own folder, which would be copied into itself.
fn spaces_outside(folder: &Path, own: &Path) -> Vec<(PathBuf, PathBuf, bool)> {
    let home = folder.join(KEPT);
    let mut made_of: Vec<String> = lines_in_file(&home.join(RETIRED));
    let mut out = Vec::new();
    for space in undotted_folders(&home) {
        if fs::symlink_metadata(space.join(CONVERTING)).is_ok() {
            continue;
        }
        made_of.extend(lines_in_file(&space.join(FROM)));
        out.push((space, own.join(KEPT), true));
    }
    for space in undotted_folders(folder) {
        if made_of.iter().any(|one| Path::new(one) == space) {
            continue;
        }
        out.push((space, own.to_path_buf(), false));
    }
    out.retain(|(from, _, _)| !inside(from, own));
    out
}

fn lines_in_file(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The folders directly in `dir` whose names have no dot in front, by name.
fn undotted_folders(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    found.sort();
    found
}

/// `from` copied whole into `into` under its name, else the first `name 2`, `name 3`
/// that nothing there answers to, and read back. Answers where it landed. A copy that
/// did not read back as it was is taken away again.
fn carried_into(from: &Path, into: &Path, kept: bool) -> Result<PathBuf, String> {
    let name = leaf_name(from);
    made(into)?;
    let mut to = into.join(&name);
    for counter in 2..=MAX_TRIES {
        if fs::symlink_metadata(&to).is_err() {
            break;
        }
        to = into.join(format!("{name} {counter}"));
    }
    copy_whole(from, &to)?;
    if let Err(error) = copied_alike(from, &to) {
        let _ = fs::remove_dir_all(&to);
        return Err(error);
    }
    if kept && to.file_name() != from.file_name() {
        // A kept space's root is the file named as its folder.
        let _ = fs::rename(to.join(&name), to.join(leaf_name(&to)));
    }
    Ok(to)
}

/// Whether every file under `from` reads at `to` as it does there. A link to a folder
/// is copied as the link, and is not followed.
fn copied_alike(from: &Path, to: &Path) -> Result<(), String> {
    let kind = fs::symlink_metadata(from).map_err(|error| cannot("read", from, &error))?;
    if kind.is_symlink() && !from.is_file() {
        return Ok(());
    }
    if from.is_dir() {
        for entry in fs::read_dir(from).map_err(|error| cannot("read", from, &error))? {
            let entry = entry.map_err(|error| cannot("read", from, &error))?;
            copied_alike(&entry.path(), &to.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if bytes_alike(from, to)? {
        Ok(())
    } else {
        Err(format!("{} did not copy as it was", from.display()))
    }
}

fn bytes_alike(one: &Path, other: &Path) -> Result<bool, String> {
    let open = |path: &Path| fs::File::open(path).map_err(|error| cannot("read", path, &error));
    let (mut first, mut second) = (open(one)?, open(other)?);
    let (mut a, mut b) = (vec![0; 1 << 16], vec![0; 1 << 16]);
    loop {
        let got = read_full(&mut first, &mut a).map_err(|error| cannot("read", one, &error))?;
        let also = read_full(&mut second, &mut b).map_err(|error| cannot("read", other, &error))?;
        if a.get(..got) != b.get(..also) {
            return Ok(false);
        }
        if got == 0 {
            return Ok(true);
        }
    }
}

/// As much of `buffer` as the file fills, which is less only at its end.
fn read_full(file: &mut fs::File, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut at = 0;
    while at < buffer.len() {
        match file.read(&mut buffer[at..]) {
            Ok(0) => break,
            Ok(read) => at += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(at)
}

#[cfg(test)]
mod tests {
    use super::{take_in_from, Moved, TAKEN};
    use std::fs;
    use std::path::Path;

    fn put_text(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().expect("a folder")).expect("its folder");
        fs::write(path, text).expect("a file");
    }

    fn said_in(path: &Path) -> String {
        fs::read_to_string(path).expect("a file")
    }

    #[test]
    fn every_space_of_an_outside_folder_is_copied_in_once_and_the_folder_left_as_it_was() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let vault = dir.path().join("Vault");
        let own = dir.path().join("data").join("Spaces");
        let record = dir.path().join("settings").join(TAKEN);
        put_text(&vault.join("Work").join("Plans.md"), "# Plans");
        put_text(&vault.join("Work").join(".obsidian").join("app.json"), "{}");
        put_text(&vault.join("Home").join("deep").join("List.md"), "- milk");
        put_text(&vault.join("Loose.md"), "not in a space");
        put_text(&vault.join(".obsidian").join("app.json"), "{}");
        put_text(&own.join("Work").join("Old.md"), "already here");

        let taken = take_in_from(&vault, &own, &record);

        let path = |at: &Path| at.to_string_lossy().to_string();
        assert_eq!(
            taken.moved,
            vec![
                Moved {
                    from: path(&vault.join("Home")),
                    to: path(&own.join("Home")),
                },
                Moved {
                    from: path(&vault.join("Work")),
                    to: path(&own.join("Work 2")),
                },
            ]
        );
        assert!(taken.left.is_empty());
        assert_eq!(said_in(&own.join("Work 2").join("Plans.md")), "# Plans");
        assert_eq!(
            said_in(&own.join("Work 2").join(".obsidian").join("app.json")),
            "{}"
        );
        assert_eq!(
            said_in(&own.join("Home").join("deep").join("List.md")),
            "- milk"
        );
        assert_eq!(said_in(&own.join("Work").join("Old.md")), "already here");
        assert!(!own.join("Loose.md").exists());
        assert!(!own.join(".obsidian").exists());
        assert_eq!(said_in(&vault.join("Work").join("Plans.md")), "# Plans");

        // Asked again, as a launch cut short would: nothing is copied twice.
        let again = take_in_from(&vault, &own, &record);
        assert_eq!(again.moved, taken.moved);
        assert!(!own.join("Work 3").exists());
        assert!(!own.join("Home 2").exists());
    }

    #[test]
    fn a_kept_space_comes_whole_and_the_folder_it_was_made_of_does_not() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let outside = dir.path().join("Elsewhere");
        let own = dir.path().join("Spaces");
        let record = dir.path().join(TAKEN);
        let made_of = outside.join("Notes");
        put_text(&made_of.join("a.md"), "the folder it was");
        let kept = outside.join(".orden").join("Notes");
        put_text(&kept.join("Notes"), "");
        put_text(&kept.join(".index.0.json"), "{}");
        put_text(&kept.join(".from"), &made_of.to_string_lossy());
        put_text(&outside.join(".orden").join("Half").join(".converting"), "");

        let taken = take_in_from(&outside, &own, &record);

        let path = |at: &Path| at.to_string_lossy().to_string();
        assert_eq!(
            taken.moved,
            vec![Moved {
                from: path(&kept.join("Notes")),
                to: path(&own.join(".orden").join("Notes").join("Notes")),
            }]
        );
        assert_eq!(
            said_in(&own.join(".orden").join("Notes").join(".index.0.json")),
            "{}"
        );
        assert!(!own.join("Notes").exists());
        assert!(!own.join(".orden").join("Half").exists());
    }
}
