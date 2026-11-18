use orden_base::Held as _;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Ticket {
    pub path: String,
    pub back: String,
    pub at: i64,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            i64::try_from(since.as_secs()).unwrap_or(i64::MAX)
        })
}

static GIVEN: Mutex<Option<HashSet<Ticket>>> = Mutex::new(None);

fn given() -> MutexGuard<'static, Option<HashSet<Ticket>>> {
    GIVEN.held()
}

fn hand_out(ticket: Ticket) -> Ticket {
    given()
        .get_or_insert_with(HashSet::new)
        .insert(ticket.clone());
    ticket
}

fn take_back(ticket: &Ticket) -> bool {
    given().as_mut().is_some_and(|all| all.remove(ticket))
}

pub fn trash(path: &Path) -> Result<Ticket, String> {
    trashed(path).map(hand_out)
}

pub fn untrash(ticket: &Ticket) -> Result<PathBuf, String> {
    if !take_back(ticket) {
        return Err(format!("{} was not put in the trash here", ticket.path));
    }
    restored(ticket).inspect_err(|_| {
        hand_out(ticket.clone());
    })
}

#[cfg(target_os = "macos")]
fn trashed(path: &Path) -> Result<Ticket, String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let mut went = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut went))
        .map_err(|error| format!("{}: {}", path.display(), error.localizedDescription()))?;
    let back = went
        .and_then(|url| url.path())
        .map(|one| one.to_string())
        .ok_or_else(|| {
            format!(
                "{} went to the trash, which did not say where",
                path.display()
            )
        })?;
    Ok(Ticket {
        path: path.display().to_string(),
        back,
        at: now(),
    })
}

#[cfg(target_os = "macos")]
fn restored(ticket: &Ticket) -> Result<PathBuf, String> {
    let back = Path::new(&ticket.back);
    let path = PathBuf::from(&ticket.path);
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err(format!("{} is there again", path.display()));
    }
    orden_base::carry::rename_new(back, &path)
        .map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(path)
}

#[cfg(any(target_os = "linux", windows))]
fn trashed(path: &Path) -> Result<Ticket, String> {
    let back = match (path.parent(), path.file_name()) {
        (Some(folder), Some(name)) => std::fs::canonicalize(folder)
            .map_or_else(|_| path.to_path_buf(), |folder| folder.join(name)),
        _ => path.to_path_buf(),
    };
    let at = now();
    trash::delete(path).map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(Ticket {
        path: path.display().to_string(),
        back: back.display().to_string(),
        at,
    })
}

#[cfg(any(target_os = "linux", windows))]
fn restored(ticket: &Ticket) -> Result<PathBuf, String> {
    let path = PathBuf::from(&ticket.path);
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err(format!("{} is there again", path.display()));
    }
    let listed = trash::os_limited::list().map_err(|why| why.to_string())?;
    let back = Path::new(&ticket.back);
    let found = newest_from(
        listed.into_iter().map(|item| {
            let from = item.original_path();
            let at = item.time_deleted;
            (item, from, at)
        }),
        back,
        ticket.at,
    )
    .ok_or_else(|| format!("{} is no longer in the trash", path.display()))?;
    trash::os_limited::restore_all([found]).map_err(|why| why.to_string())?;
    Ok(path)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn trashed(path: &Path) -> Result<Ticket, String> {
    Err(format!(
        "{}: this system has no trash Orden reaches",
        path.display()
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn restored(ticket: &Ticket) -> Result<PathBuf, String> {
    Err(format!(
        "{}: this system has no trash Orden reaches",
        ticket.path
    ))
}

#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
fn newest_from<T>(
    held: impl Iterator<Item = (T, PathBuf, i64)>,
    back: &Path,
    at: i64,
) -> Option<T> {
    held.filter(|(_, from, when)| {
        *when >= at - 2
            && orden_base::paths::inside(from, back)
            && orden_base::paths::inside(back, from)
    })
    .max_by_key(|(_, _, when)| *when)
    .map(|(item, _, _)| item)
}

#[cfg(test)]
mod tests {
    use super::{hand_out, newest_from, take_back, untrash, Ticket};
    use std::path::{Path, PathBuf};

    #[test]
    fn a_ticket_the_trash_never_gave_brings_nothing_back() {
        let dir = tempfile::tempdir().unwrap();
        let kept = dir.path().join("kept.json");
        std::fs::write(&kept, "grants").unwrap();
        let ticket = Ticket {
            path: dir.path().join("out.json").display().to_string(),
            back: kept.display().to_string(),
            at: 0,
        };
        assert!(!take_back(&ticket));
        assert!(untrash(&ticket).is_err());
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "grants");
        assert!(!dir.path().join("out.json").exists());
    }

    #[test]
    fn a_ticket_the_trash_gave_is_taken_back_once() {
        let ticket = Ticket {
            path: "/nowhere/given.txt".into(),
            back: "/nowhere/.Trash/given.txt".into(),
            at: 7,
        };
        hand_out(ticket.clone());
        assert!(take_back(&ticket));
        assert!(!take_back(&ticket));
    }

    #[test]
    fn the_way_back_is_the_newest_from_that_place_since_it_went() {
        let held = || {
            vec![
                ("old", PathBuf::from("/a/plan.txt"), 100),
                ("other", PathBuf::from("/a/other.txt"), 205),
                ("ours", PathBuf::from("/a/plan.txt"), 201),
                ("again", PathBuf::from("/a/plan.txt"), 199),
            ]
            .into_iter()
        };
        assert_eq!(
            newest_from(held(), Path::new("/a/plan.txt"), 200),
            Some("ours")
        );
        assert_eq!(newest_from(held(), Path::new("/a/plan.txt"), 300), None);
        assert_eq!(newest_from(held(), Path::new("/b/plan.txt"), 0), None);
    }
}
