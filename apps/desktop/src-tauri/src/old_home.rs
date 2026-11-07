use std::fs;
use std::path::{Path, PathBuf};

const OLD: &str = "ch.emilvinu.nib";

const NEW: &str = "so.orden.Orden";

pub fn carry_home() {
    if env!("ORDEN_IDENTIFIER") != NEW {
        return;
    }
    let moved: Vec<(PathBuf, PathBuf)> = places()
        .into_iter()
        .filter(|(old, new)| merged(old, new))
        .collect();
    let Some(config) = dirs::config_dir().map(|dir| dir.join(NEW)) else {
        return;
    };
    for (old, new) in &moved {
        repoint(&config.join(crate::paths::SPACES_KEPT), old, new);
        rebase_kept(&config.join(crate::kept::FOLDER), old, new);
    }
}

fn places() -> Vec<(PathBuf, PathBuf)> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut bases: Vec<PathBuf> = [
        dirs::data_dir(),
        dirs::config_dir(),
        dirs::cache_dir(),
        dirs::data_local_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();
    #[cfg(target_os = "macos")]
    if let Some(library) = dirs::home_dir().map(|home| home.join("Library")) {
        for one in ["WebKit", "HTTPStorages", "Logs"] {
            bases.push(library.join(one));
        }
    }
    bases.sort();
    bases.dedup();
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut pairs: Vec<(PathBuf, PathBuf)> = bases
        .iter()
        .map(|base| (base.join(OLD), base.join(NEW)))
        .collect();
    #[cfg(target_os = "macos")]
    if let Some(prefs) = dirs::home_dir().map(|home| home.join("Library/Preferences")) {
        pairs.push((
            prefs.join(format!("{OLD}.plist")),
            prefs.join(format!("{NEW}.plist")),
        ));
    }
    pairs
}

fn merged(old: &Path, new: &Path) -> bool {
    if fs::symlink_metadata(old).is_err() {
        return false;
    }
    if crate::carry::rename_new(old, new).is_ok() {
        return true;
    }
    if !old.is_dir() || !new.is_dir() {
        return false;
    }
    let Ok(children) = fs::read_dir(old) else {
        return false;
    };
    let mut any = false;
    for child in children.flatten() {
        let there = new.join(child.file_name());
        if crate::carry::rename_new(&child.path(), &there).is_ok() {
            any = true;
        }
    }
    let _ = fs::remove_dir(old);
    any
}

fn repoint(file: &Path, old: &Path, new: &Path) {
    let Ok(said) = fs::read_to_string(file) else {
        return;
    };
    let Ok(rest) = Path::new(said.trim()).strip_prefix(old) else {
        return;
    };
    let _ = fs::write(file, new.join(rest).to_string_lossy().as_bytes());
}

fn rebased(text: &str, old: &Path, new: &Path) -> String {
    let (old, new) = (old.to_string_lossy(), new.to_string_lossy());
    let escaped = |path: &str| path.replace('\\', "\\\\");
    let mut text = text.to_owned();
    for (from, to) in [
        (old.to_string(), new.to_string()),
        (escaped(&old), escaped(&new)),
    ] {
        for cut in ["/", "\\", "\""] {
            text = text.replace(&format!("{from}{cut}"), &format!("{to}{cut}"));
        }
    }
    text
}

fn rebase_kept(folder: &Path, old: &Path, new: &Path) {
    let Ok(files) = fs::read_dir(folder) else {
        return;
    };
    for file in files.flatten() {
        let path = file.path();
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let moved = rebased(&text, old, new);
        if moved != text {
            let _ = crate::paths::write_atomically(&path, moved.as_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_moves_whole_when_nothing_waits_under_the_new_name() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        fs::create_dir_all(old.join("Spaces/Work")).unwrap();
        fs::write(old.join("Spaces/Work/Plan.md"), "# Plan").unwrap();

        assert!(merged(&old, &new));
        assert_eq!(
            fs::read_to_string(new.join("Spaces/Work/Plan.md")).unwrap(),
            "# Plan"
        );
        assert!(!old.exists());
        assert!(!merged(&old, &new));
    }

    #[test]
    fn what_a_start_already_made_under_the_new_name_is_kept_and_the_rest_joins_it() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        fs::create_dir_all(old.join("Spaces")).unwrap();
        fs::write(old.join("settings.json"), "old").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), "new").unwrap();

        assert!(merged(&old, &new));
        assert!(new.join("Spaces").is_dir());
        assert_eq!(
            fs::read_to_string(new.join("settings.json")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(old.join("settings.json")).unwrap(),
            "old"
        );
    }

    #[test]
    fn the_kept_spaces_folder_follows_the_move_and_one_outside_stays() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        let file = root.path().join("spaces-folder");
        fs::write(&file, old.join("Spaces").to_string_lossy().as_bytes()).unwrap();
        repoint(&file, &old, &new);
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            new.join("Spaces").to_string_lossy()
        );

        fs::write(&file, "/home/ada/Notes").unwrap();
        repoint(&file, &old, &new);
        assert_eq!(fs::read_to_string(&file).unwrap(), "/home/ada/Notes");
    }

    #[test]
    fn a_path_kept_by_the_window_follows_the_move_and_a_longer_name_does_not() {
        let old = Path::new("/home/ada/.local/share/ch.emilvinu.nib");
        let new = Path::new("/home/ada/.local/share/so.orden.Orden");
        let text = r#"{"root":"/home/ada/.local/share/ch.emilvinu.nib/Spaces","x":"/home/ada/.local/share/ch.emilvinu.nibs/a"}"#;
        assert_eq!(
            rebased(text, old, new),
            r#"{"root":"/home/ada/.local/share/so.orden.Orden/Spaces","x":"/home/ada/.local/share/ch.emilvinu.nibs/a"}"#
        );
    }
}
