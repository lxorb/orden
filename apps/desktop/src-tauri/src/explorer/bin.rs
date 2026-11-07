use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[cfg(target_os = "macos")]
pub fn trash(path: &Path) -> Result<Ticket, String> {
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
pub fn untrash(ticket: &Ticket) -> Result<PathBuf, String> {
    let back = Path::new(&ticket.back);
    let path = PathBuf::from(&ticket.path);
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err(format!("{} is there again", path.display()));
    }
    crate::carry::rename_new(back, &path).map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(path)
}

#[cfg(any(target_os = "linux", windows))]
pub fn trash(path: &Path) -> Result<Ticket, String> {
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
pub fn untrash(ticket: &Ticket) -> Result<PathBuf, String> {
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
pub fn trash(path: &Path) -> Result<Ticket, String> {
    Err(format!(
        "{}: this system has no trash Orden reaches",
        path.display()
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub fn untrash(ticket: &Ticket) -> Result<PathBuf, String> {
    Err(format!(
        "{}: this system has no trash Orden reaches",
        ticket.path
    ))
}

#[cfg_attr(
    not(any(target_os = "linux", windows)),
    allow(dead_code, reason = "a Mac's trash says where it put a file")
)]
fn newest_from<T>(
    held: impl Iterator<Item = (T, PathBuf, i64)>,
    back: &Path,
    at: i64,
) -> Option<T> {
    held.filter(|(_, from, when)| {
        *when >= at - 2 && crate::paths::inside(from, back) && crate::paths::inside(back, from)
    })
    .max_by_key(|(_, _, when)| *when)
    .map(|(item, _, _)| item)
}

#[cfg(test)]
mod tests {
    use super::newest_from;
    use std::path::{Path, PathBuf};

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
