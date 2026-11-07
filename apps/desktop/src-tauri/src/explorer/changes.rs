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

#[tauri::command]
pub async fn explorer_make(
    app: AppHandle,
    folder: String,
    name: String,
    file: bool,
) -> Result<String, String> {
    crate::lane::off_the_runtime(move || -> Result<String, String> {
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
    })
    .await
}

#[tauri::command]
pub async fn explorer_write(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let (said, bytes) = crate::notes::raw_sent(request.headers(), request.body())?;
    let bytes = bytes.into_owned();
    crate::lane::off_the_runtime(move || {
        let folder = asked(&app, &said.folder, Use::Into)?;
        wrote(&folder, &said, &bytes).map(|path| path.display().to_string())
    })
    .await
}

#[derive(serde::Deserialize)]
struct Written {
    folder: String,
    under: String,
    #[serde(default)]
    more: bool,
    #[serde(default)]
    fresh: bool,
}

fn wrote(folder: &Path, said: &Written, bytes: &[u8]) -> Result<PathBuf, String> {
    let path = placed(folder, &said.under)?;
    if said.fresh {
        if let Some((top, _)) = said.under.split_once('/') {
            let top = folder.join(top);
            fs::create_dir(&top).map_err(|why| format!("{}: {why}", top.display()))?;
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|why| format!("{}: {why}", parent.display()))?;
    }
    let opened = if said.more {
        fs::OpenOptions::new().append(true).open(&path)
    } else {
        fs::File::create_new(&path)
    };
    let mut file = opened.map_err(|why| format!("{}: {why}", path.display()))?;
    std::io::Write::write_all(&mut file, bytes)
        .map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(path)
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

#[tauri::command]
pub async fn explorer_rename(app: AppHandle, path: String, name: String) -> Result<String, String> {
    crate::lane::off_the_runtime(move || -> Result<String, String> {
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
    })
    .await
}

pub(super) fn renamed(from: &Path, to: &Path) -> Result<(), String> {
    let taken = fs::symlink_metadata(to).is_ok();
    if taken && !crate::notes::same_entry(from, to) {
        return Err(format!("{} is there already", to.display()));
    }
    let moved = if taken {
        fs::rename(from, to)
    } else {
        crate::carry::rename_new(from, to)
    };
    moved.map_err(|why| format!("{}: {why}", from.display()))
}

#[tauri::command]
pub async fn explorer_trash(app: AppHandle, paths: Vec<String>) -> Result<Vec<Ticket>, Trashing> {
    crate::lane::off_the_runtime(move || -> Result<Vec<Ticket>, Trashing> {
        let mut went = Vec::new();
        for one in &paths {
            match asked(&app, one, Use::Change).and_then(|path| bin::trash(&path)) {
                Ok(ticket) => went.push(ticket),
                Err(why) => return Err(Trashing { why, went }),
            }
        }
        Ok(went)
    })
    .await
}

#[derive(serde::Serialize, Debug)]
pub struct Trashing {
    pub why: String,
    pub went: Vec<Ticket>,
}

#[tauri::command]
pub async fn explorer_untrash(app: AppHandle, tickets: Vec<Ticket>) -> Vec<String> {
    crate::lane::off_the_runtime(move || -> Vec<String> {
        tickets
            .iter()
            .filter(|ticket| asked(&app, &ticket.path, Use::Change).is_ok())
            .filter_map(|ticket| bin::untrash(ticket).ok())
            .map(|path| path.display().to_string())
            .collect()
    })
    .await
}

#[tauri::command]
pub async fn explorer_delete(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let judged: Vec<PathBuf> = paths
            .iter()
            .map(|one| asked(&app, one, Use::Change))
            .collect::<Result<_, _>>()?;
        for path in judged {
            gone(&path)?;
        }
        Ok(())
    })
    .await
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
    use super::{bad_name, renamed, wrote, Written};
    use std::fs;

    #[test]
    fn a_dropped_folder_is_made_new_and_never_written_into_one_already_there() {
        let dir = tempfile::tempdir().expect("a folder");
        let mine = dir.path().join("Photos");
        fs::create_dir(&mine).expect("a folder of one's own");
        fs::write(mine.join("a.png"), "mine").expect("a picture");
        let said = |under: &str, fresh: bool| Written {
            folder: String::new(),
            under: under.to_owned(),
            more: false,
            fresh,
        };

        assert!(wrote(dir.path(), &said("Photos/b.png", true), b"new").is_err());
        assert!(!mine.join("b.png").exists());
        assert!(wrote(dir.path(), &said("Photos.png", true), b"new").is_ok());
        assert!(wrote(dir.path(), &said("Photos.png", true), b"again").is_err());

        wrote(dir.path(), &said("Photos 2/b.png", true), b"new").expect("a new folder");
        wrote(dir.path(), &said("Photos 2/c.png", false), b"new").expect("into it");
        assert!(dir.path().join("Photos 2").join("c.png").is_file());
        assert_eq!(
            fs::read_to_string(mine.join("a.png")).expect("kept"),
            "mine"
        );
    }

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
