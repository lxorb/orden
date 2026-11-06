use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::bin::{self, Ticket};
use super::listing::asked;
use super::reach::Use;

pub(super) fn bad_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Some("a name has to say something".to_owned());
    }
    if name.contains('/') || (cfg!(windows) && name.contains(['\\', ':'])) || name.contains('\0') {
        return Some(format!("{name} is more than one name"));
    }
    None
}

#[tauri::command(async)]
pub fn explorer_make(
    app: AppHandle,
    folder: String,
    name: String,
    file: bool,
) -> Result<String, String> {
    if let Some(why) = bad_name(&name) {
        return Err(why);
    }
    let folder = asked(&app, &folder, Use::Into)?;
    let path = crate::paths::free_spot(&folder.join(name.trim()), file);
    if file {
        fs::File::create_new(&path).map_err(|why| format!("{}: {why}", path.display()))?;
    } else {
        fs::create_dir(&path).map_err(|why| format!("{}: {why}", path.display()))?;
    }
    Ok(path.display().to_string())
}

#[tauri::command(async)]
pub fn explorer_write(
    app: AppHandle,
    folder: String,
    under: String,
    bytes: String,
) -> Result<String, String> {
    use base64::Engine as _;
    let folder = asked(&app, &folder, Use::Into)?;
    let path = placed(&folder, &under)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes)
        .map_err(|why| why.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|why| format!("{}: {why}", parent.display()))?;
    }
    let mut file =
        fs::File::create_new(&path).map_err(|why| format!("{}: {why}", path.display()))?;
    std::io::Write::write_all(&mut file, &bytes)
        .map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(path.display().to_string())
}

pub(super) fn placed(folder: &Path, under: &str) -> Result<PathBuf, String> {
    let steps: Vec<&str> = under.split('/').collect();
    if steps.iter().any(|step| bad_name(step).is_some()) {
        return Err(format!("{under} is not a place in a folder"));
    }
    Ok(steps
        .iter()
        .fold(folder.to_path_buf(), |path, step| path.join(step)))
}

#[tauri::command(async)]
pub fn explorer_rename(app: AppHandle, path: String, name: String) -> Result<String, String> {
    if let Some(why) = bad_name(&name) {
        return Err(why);
    }
    let from = asked(&app, &path, Use::Change)?;
    let to = from
        .parent()
        .map(|folder| folder.join(name.trim()))
        .ok_or_else(|| format!("{} has no folder", from.display()))?;
    renamed(&from, &to)?;
    Ok(to.display().to_string())
}

pub(super) fn renamed(from: &Path, to: &Path) -> Result<(), String> {
    let same = crate::paths::inside(from, to) && crate::paths::inside(to, from);
    if !same && fs::symlink_metadata(to).is_ok() {
        return Err(format!("{} is there already", to.display()));
    }
    fs::rename(from, to).map_err(|why| format!("{}: {why}", from.display()))
}

#[tauri::command(async)]
pub fn explorer_trash(app: AppHandle, paths: Vec<String>) -> Result<Vec<Ticket>, Trashing> {
    let mut went = Vec::new();
    for one in &paths {
        match asked(&app, one, Use::Change).and_then(|path| bin::trash(&path)) {
            Ok(ticket) => went.push(ticket),
            Err(why) => return Err(Trashing { why, went }),
        }
    }
    Ok(went)
}

#[derive(serde::Serialize, Debug)]
pub struct Trashing {
    pub why: String,
    pub went: Vec<Ticket>,
}

#[tauri::command(async)]
pub fn explorer_untrash(app: AppHandle, tickets: Vec<Ticket>) -> Vec<String> {
    tickets
        .iter()
        .filter(|ticket| asked(&app, &ticket.path, Use::Change).is_ok())
        .filter_map(|ticket| bin::untrash(ticket).ok())
        .map(|path| path.display().to_string())
        .collect()
}

#[tauri::command(async)]
pub fn explorer_delete(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let judged: Vec<PathBuf> = paths
        .iter()
        .map(|one| asked(&app, one, Use::Change))
        .collect::<Result<_, _>>()?;
    for path in judged {
        gone(&path)?;
    }
    Ok(())
}

pub(super) fn gone(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|why| format!("{}: {why}", path.display()))?;
    let done = if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    done.map_err(|why| format!("{}: {why}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{bad_name, renamed};
    use std::fs;

    #[test]
    fn a_dropped_file_lands_under_the_folder_and_nowhere_else() {
        let folder = std::path::Path::new("/a/b");
        assert_eq!(
            super::placed(folder, "Photos/2026/x.png").expect("placed"),
            folder.join("Photos").join("2026").join("x.png")
        );
        for bad in ["../x", "a/../../x", "/x", "a//b", "a/./b"] {
            assert!(super::placed(folder, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_name_is_one_name() {
        for bad in ["", "  ", ".", "..", "a/b", "a\0b"] {
            assert!(bad_name(bad).is_some(), "{bad:?}");
        }
        for good in ["Plan.md", ".config", "Photos 2026", "a..b"] {
            assert!(bad_name(good).is_none(), "{good:?}");
        }
    }

    #[test]
    fn a_rename_never_lands_on_another_file() {
        let dir = tempfile::tempdir().expect("a folder");
        let (one, other) = (dir.path().join("one.txt"), dir.path().join("other.txt"));
        fs::write(&one, "1").expect("one");
        fs::write(&other, "2").expect("other");
        assert!(renamed(&one, &other).is_err());
        assert_eq!(fs::read_to_string(&other).expect("other"), "2");
        let third = dir.path().join("third.txt");
        renamed(&one, &third).expect("renamed");
        assert!(third.is_file() && !one.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_goes_and_what_it_leads_to_stays() {
        use super::gone;

        let dir = tempfile::tempdir().expect("a folder");
        let real = dir.path().join("real");
        fs::create_dir(&real).expect("a folder");
        fs::write(real.join("kept.txt"), "kept").expect("a file");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).expect("a link");
        gone(&link).expect("gone");
        assert!(real.join("kept.txt").is_file());
        assert!(fs::symlink_metadata(&link).is_err());
    }
}
