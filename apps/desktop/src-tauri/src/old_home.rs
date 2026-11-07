use std::fs;
use std::path::{Path, PathBuf};

const OLD: &str = "ch.emilvinu.nib";

const NEW: &str = "so.orden.Orden";

const PROFILES: [&str; 4] = ["EBWebView", "chromium", "web", "web-stores"];

const SWAPS: bool = cfg!(not(feature = "cef"));

const AFTER_MOVE: &str = "after-move.json";

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub(crate) struct Home {
    from: String,
    to: String,
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub(crate) struct Former {
    homes: Vec<Home>,
    waiting: bool,
    dumped: bool,
    after: Option<String>,
}

pub fn carry_home() {
    if env!("ORDEN_IDENTIFIER") != NEW {
        return;
    }
    let swap = SWAPS && after_move().is_some_and(|file| file.is_file());
    let moved: Vec<(PathBuf, PathBuf)> = places()
        .into_iter()
        .filter(|(old, new)| merged(old, new, swap))
        .collect();
    let Some(config) = dirs::config_dir().map(|dir| dir.join(NEW)) else {
        return;
    };
    for (old, new) in &moved {
        repoint(&config.join(crate::paths::SPACES_KEPT), old, new);
        rebase_kept(&config.join(crate::kept::FOLDER), old, new);
    }
}

fn after_move() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join(NEW).join(AFTER_MOVE))
}

const SCRIPT: &str = include_str!("former.js");

pub(crate) fn script() -> String {
    let said = serde_json::to_string(&former_homes()).unwrap_or_else(|_| "null".into());
    SCRIPT.replace("/* __FORMER__ */ null", &said.replace('<', "\\u003c"))
}

#[tauri::command(async)]
pub(crate) fn former_homes() -> Former {
    if env!("ORDEN_IDENTIFIER") != NEW {
        return Former {
            homes: Vec::new(),
            waiting: false,
            dumped: false,
            after: None,
        };
    }
    let pairs = places();
    let waiting = profiles_waiting(&pairs);
    let said = after_move().and_then(|file| fs::read_to_string(file).ok());
    Former {
        homes: homes_of(pairs),
        waiting,
        dumped: said.is_some(),
        after: if waiting { None } else { said },
    }
}

#[tauri::command(async)]
pub(crate) fn keep_after_move(text: String) -> Result<(), String> {
    let file = after_move().ok_or("no settings folder")?;
    if let Some(dir) = file.parent() {
        crate::paths::made(dir)?;
    }
    crate::paths::write_atomically(&file, text.as_bytes())
}

#[tauri::command(async)]
pub(crate) fn drop_after_move() {
    if let Some(file) = after_move() {
        let _ = fs::remove_file(file);
    }
}

fn homes_of(pairs: Vec<(PathBuf, PathBuf)>) -> Vec<Home> {
    pairs
        .into_iter()
        .filter(|(_, new)| new.is_dir())
        .map(|(old, new)| Home {
            from: old.to_string_lossy().into_owned(),
            to: new.to_string_lossy().into_owned(),
        })
        .collect()
}

fn holds_any(dir: &Path) -> bool {
    fs::read_dir(dir).is_ok_and(|mut children| children.next().is_some())
}

fn profiles_waiting(pairs: &[(PathBuf, PathBuf)]) -> bool {
    if !SWAPS {
        return false;
    }
    pairs.iter().any(|(old, new)| {
        let whole = profile(old) && holds_any(old) && new.is_dir();
        let inner = PROFILES
            .iter()
            .any(|name| holds_any(&old.join(name)) && new.join(name).is_dir());
        whole || inner
    })
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

fn merged(old: &Path, new: &Path, swap: bool) -> bool {
    if fs::symlink_metadata(old).is_err() {
        return false;
    }
    if fs::symlink_metadata(new).is_err() && fs::rename(old, new).is_ok() {
        return true;
    }
    if !old.is_dir() || !new.is_dir() {
        return false;
    }
    if profile(old) {
        return swap && swapped(old, new);
    }
    let Ok(children) = fs::read_dir(old) else {
        return false;
    };
    let mut any = false;
    for child in children.flatten() {
        any |= merged(&child.path(), &new.join(child.file_name()), swap);
    }
    let _ = fs::remove_dir(old);
    any
}

fn named(path: Option<&Path>, name: &str) -> bool {
    path.and_then(Path::file_name)
        .is_some_and(|one| one == name)
}

fn profile(old: &Path) -> bool {
    let parent = old.parent();
    let whole = named(Some(old), OLD) && named(parent, "WebKit");
    let inner = named(parent, OLD) && PROFILES.iter().any(|one| named(Some(old), one));
    whole || inner
}

fn swapped(old: &Path, new: &Path) -> bool {
    if !holds_any(old) {
        let _ = fs::remove_dir(old);
        return false;
    }
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |time| time.as_secs());
    let mut name = new.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".after-move-{since}"));
    let aside = new.with_file_name(name);
    if fs::rename(new, &aside).is_err() {
        return false;
    }
    if fs::rename(old, new).is_ok() {
        return true;
    }
    let _ = fs::rename(&aside, new);
    false
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

        assert!(merged(&old, &new, false));
        assert_eq!(
            fs::read_to_string(new.join("Spaces/Work/Plan.md")).unwrap(),
            "# Plan"
        );
        assert!(!old.exists());
        assert!(!merged(&old, &new, false));
    }

    #[test]
    fn what_a_start_already_made_under_the_new_name_is_kept_and_the_rest_joins_it() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        fs::create_dir_all(old.join("Spaces")).unwrap();
        fs::write(old.join("settings.json"), "old").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), "new").unwrap();

        assert!(merged(&old, &new, false));
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
    fn a_folder_made_new_by_an_early_start_takes_in_what_the_old_one_still_holds() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        fs::create_dir_all(old.join("Spaces/Work/Projects")).unwrap();
        fs::write(old.join("Spaces/Work/Projects/Plan.md"), "- [ ] ship").unwrap();
        fs::write(old.join("Spaces/Work/Same.md"), "old").unwrap();
        fs::create_dir_all(new.join("Spaces/Work")).unwrap();
        fs::write(new.join("Spaces/Work/Same.md"), "new").unwrap();

        assert!(merged(&old, &new, false));
        assert_eq!(
            fs::read_to_string(new.join("Spaces/Work/Projects/Plan.md")).unwrap(),
            "- [ ] ship"
        );
        assert_eq!(
            fs::read_to_string(new.join("Spaces/Work/Same.md")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(old.join("Spaces/Work/Same.md")).unwrap(),
            "old"
        );
    }

    #[test]
    fn a_browser_profile_is_left_where_it_is_until_the_app_has_kept_what_the_new_one_holds() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        for (dir, said) in [(&old, "old"), (&new, "new")] {
            fs::create_dir_all(dir.join("EBWebView/Default")).unwrap();
            fs::write(dir.join("EBWebView/Default/state"), said).unwrap();
        }
        let pairs = vec![(old.clone(), new.clone())];
        assert_eq!(profiles_waiting(&pairs), SWAPS);

        assert!(!merged(&old, &new, false));
        assert_eq!(
            fs::read_to_string(old.join("EBWebView/Default/state")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(new.join("EBWebView/Default/state")).unwrap(),
            "new"
        );

        assert!(merged(&old, &new, true));
        assert!(!profiles_waiting(&pairs));
    }

    #[test]
    fn a_browser_profile_made_new_by_an_early_start_steps_aside_for_the_old_one() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        for (dir, said) in [(&old, "old"), (&new, "new")] {
            fs::create_dir_all(dir.join("EBWebView/Default/Local Storage")).unwrap();
            fs::write(dir.join("EBWebView/Default/Local Storage/leveldb"), said).unwrap();
        }

        assert!(merged(&old, &new, true));
        assert_eq!(
            fs::read_to_string(new.join("EBWebView/Default/Local Storage/leveldb")).unwrap(),
            "old"
        );
        let aside: Vec<String> = fs::read_dir(&new)
            .unwrap()
            .flatten()
            .map(|one| one.file_name().to_string_lossy().into_owned())
            .filter(|one| one.starts_with("EBWebView.after-move-"))
            .collect();
        assert_eq!(aside.len(), 1);
        assert_eq!(
            fs::read_to_string(new.join(&aside[0]).join("Default/Local Storage/leveldb")).unwrap(),
            "new"
        );
        assert!(!old.exists());
    }

    #[test]
    fn a_mac_web_store_made_new_by_an_early_start_steps_aside_for_the_old_one() {
        let root = tempfile::tempdir().unwrap();
        let webkit = root.path().join("WebKit");
        let (old, new) = (webkit.join(OLD), webkit.join(NEW));
        fs::create_dir_all(old.join("WebsiteData/LocalStorage")).unwrap();
        fs::write(old.join("WebsiteData/LocalStorage/db"), "old").unwrap();
        fs::create_dir_all(new.join("WebsiteData/LocalStorage")).unwrap();
        fs::write(new.join("WebsiteData/LocalStorage/db"), "new").unwrap();

        assert!(merged(&old, &new, true));
        assert_eq!(
            fs::read_to_string(new.join("WebsiteData/LocalStorage/db")).unwrap(),
            "old"
        );
        assert!(!old.exists());
    }

    #[test]
    fn a_folder_named_like_a_profile_inside_a_space_is_merged_not_swapped() {
        let root = tempfile::tempdir().unwrap();
        let (old, new) = (root.path().join(OLD), root.path().join(NEW));
        fs::create_dir_all(old.join("Spaces/web")).unwrap();
        fs::write(old.join("Spaces/web/a.md"), "a").unwrap();
        fs::create_dir_all(new.join("Spaces/web")).unwrap();
        fs::write(new.join("Spaces/web/b.md"), "b").unwrap();

        assert!(merged(&old, &new, false));
        assert!(new.join("Spaces/web/a.md").is_file());
        assert!(new.join("Spaces/web/b.md").is_file());
    }

    #[test]
    fn the_window_is_given_what_the_former_home_holds() {
        assert!(SCRIPT.contains("/* __FORMER__ */ null"));
        let given = script();
        assert!(!given.contains("/* __FORMER__ */ null"));
        assert!(given.contains("__ORDEN_FORMER__"));
    }

    #[test]
    fn the_homes_named_are_those_whose_new_folder_is_there() {
        let root = tempfile::tempdir().unwrap();
        let there = (
            root.path().join("a").join(OLD),
            root.path().join("a").join(NEW),
        );
        let missing = (
            root.path().join("b").join(OLD),
            root.path().join("b").join(NEW),
        );
        fs::create_dir_all(&there.1).unwrap();
        assert_eq!(
            homes_of(vec![there.clone(), missing]),
            vec![Home {
                from: there.0.to_string_lossy().into_owned(),
                to: there.1.to_string_lossy().into_owned(),
            }]
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
