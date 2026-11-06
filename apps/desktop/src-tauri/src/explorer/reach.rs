use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager as _};

use crate::paths::{folded, inside, path_key, spoken};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Use {
    List,
    Look,
    Change,
    Into,
}

#[derive(Default)]
pub struct Explored(Mutex<HashSet<String>>);

impl Explored {
    pub fn saw(&self, folder: &Path) {
        if let Ok(mut seen) = self.0.lock() {
            seen.insert(path_key(folder));
        }
    }

    pub fn seen(&self, folder: &Path) -> bool {
        self.0
            .lock()
            .is_ok_and(|seen| seen.contains(&path_key(folder)))
    }
}

pub struct Fences {
    pub spaces: Option<PathBuf>,
    pub own: Vec<PathBuf>,
    pub home: Option<PathBuf>,
}

impl Fences {
    pub fn of(app: &AppHandle) -> Self {
        Self {
            spaces: crate::paths::spaces_dir(app).ok(),
            own: crate::agents::files::own_folders(app),
            home: app.path().home_dir().ok(),
        }
    }

    pub fn in_spaces(&self, path: &Path) -> bool {
        self.spaces
            .as_deref()
            .is_some_and(|spaces| inside(spaces, path))
    }

    pub fn in_own(&self, path: &Path, real: &impl Fn(&Path) -> PathBuf) -> bool {
        let real_path = real(path);
        self.own
            .iter()
            .any(|own| inside(own, path) || inside(&real(own), &real_path))
    }
}

pub fn judged(
    fences: &Fences,
    seen: &impl Fn(&Path) -> bool,
    real: &impl Fn(&Path) -> PathBuf,
    asked: &str,
    using: Use,
) -> Result<PathBuf, String> {
    let path = folded(Path::new(asked.trim()));
    if !path.is_absolute() {
        return Err(format!("{asked} is not a full path"));
    }
    if !spoken(&path) {
        return Err(format!("{asked} is not a file name"));
    }
    stored(fences, real, &path)?;
    match using {
        Use::List => {}
        Use::Look => {
            if !seen(&path) && !path.parent().is_some_and(seen) {
                return Err(unseen(&path));
            }
        }
        Use::Change => {
            if !path.parent().is_some_and(seen) {
                return Err(unseen(&path));
            }
            if is_top(fences, &path) {
                return Err(format!("{} is not something to change", path.display()));
            }
            fenced(fences, real, &path, true)?;
        }
        Use::Into => {
            if !seen(&path) {
                return Err(unseen(&path));
            }
            fenced(fences, real, &path, false)?;
        }
    }
    Ok(path)
}

fn unseen(path: &Path) -> String {
    format!(
        "{} is not in a folder a file explorer has shown",
        path.display()
    )
}

fn stored(fences: &Fences, real: &impl Fn(&Path) -> PathBuf, path: &Path) -> Result<(), String> {
    let Some(spaces) = fences.spaces.as_deref() else {
        return Ok(());
    };
    let kept = spaces.join(".orden");
    let working = kept.join(".work");
    let real_path = real(path);
    let meets = |fence: &Path| inside(fence, path) || inside(&real(fence), &real_path);
    if meets(&kept) && !meets(&working) {
        return Err(format!(
            "{} is where Orden keeps your spaces: open them in the file list",
            path.display()
        ));
    }
    Ok(())
}

const SHALLOWEST: usize = if cfg!(windows) { 1 } else { 2 };

fn is_top(fences: &Fences, path: &Path) -> bool {
    let depth = path
        .components()
        .filter(|part| matches!(part, Component::Normal(_)))
        .count();
    depth < SHALLOWEST
        || fences
            .home
            .as_deref()
            .is_some_and(|home| inside(path, home))
}

fn fenced(
    fences: &Fences,
    real: &impl Fn(&Path) -> PathBuf,
    path: &Path,
    whole: bool,
) -> Result<(), String> {
    let real_path = real(path);
    let meets = |fence: &Path| {
        let real_fence = real(fence);
        inside(fence, path)
            || inside(&real_fence, &real_path)
            || (whole && (inside(path, fence) || inside(&real_path, &real_fence)))
    };
    if fences.spaces.as_deref().is_some_and(meets) {
        return Err(format!(
            "{} is in your spaces: the file list changes those",
            path.display()
        ));
    }
    if fences.own.iter().any(|own| meets(own)) {
        return Err(format!(
            "{} is in Orden's own folder, with the agents' grants and the sites' cookies",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::{judged, Explored, Fences, Use};
    use std::path::{Path, PathBuf};

    fn fences() -> Fences {
        Fences {
            spaces: Some(PathBuf::from("/home/me/Documents/Orden")),
            own: vec![PathBuf::from("/home/me/.config/orden")],
            home: Some(PathBuf::from("/home/me")),
        }
    }

    fn plain(path: &Path) -> PathBuf {
        path.to_path_buf()
    }

    fn judge(seen: &Explored, asked: &str, using: Use) -> Result<PathBuf, String> {
        judged(&fences(), &|one| seen.seen(one), &plain, asked, using)
    }

    #[test]
    fn a_folder_is_listed_wherever_the_reader_points() {
        let seen = Explored::default();
        assert!(judge(&seen, "/etc", Use::List).is_ok());
        assert!(judge(&seen, "/home/me/.config/orden", Use::List).is_ok());
        assert!(judge(&seen, "relative/folder", Use::List).is_err());
    }

    #[test]
    fn nothing_is_looked_at_or_changed_in_a_folder_no_tab_has_shown() {
        let seen = Explored::default();
        for using in [Use::Look, Use::Change, Use::Into] {
            assert!(
                judge(&seen, "/home/me/Pictures/a.png", using).is_err(),
                "{using:?}"
            );
        }
        seen.saw(Path::new("/home/me/Pictures"));
        assert!(judge(&seen, "/home/me/Pictures/a.png", Use::Look).is_ok());
        assert!(judge(&seen, "/home/me/Pictures/a.png", Use::Change).is_ok());
        assert!(judge(&seen, "/home/me/Pictures", Use::Into).is_ok());
        assert!(judge(&seen, "/home/me/Pictures/sub/a.png", Use::Look).is_err());
        assert!(judge(&seen, "/home/me/Pictures/sub", Use::Into).is_err());
    }

    #[test]
    fn a_path_is_judged_by_where_it_points() {
        let seen = Explored::default();
        seen.saw(Path::new("/home/me/Pictures"));
        assert!(judge(&seen, "/home/me/Music/../Pictures/a.png", Use::Change).is_ok());
        assert!(judge(&seen, "/home/me/Pictures/../Music/a.png", Use::Change).is_err());
    }

    #[test]
    fn the_spaces_and_orden_s_own_folders_are_never_changed() {
        let seen = Explored::default();
        for folder in [
            "/home/me/Documents/Orden/Work",
            "/home/me/.config/orden",
            "/home/me/Documents",
            "/home/me/.config",
        ] {
            seen.saw(Path::new(folder));
        }
        assert!(judge(&seen, "/home/me/Documents/Orden/Work/a.md", Use::Change).is_err());
        assert!(judge(&seen, "/home/me/Documents/Orden/Work", Use::Into).is_err());
        assert!(judge(&seen, "/home/me/.config/orden/agents.json", Use::Change).is_err());
        assert!(judge(&seen, "/home/me/.config/orden", Use::Into).is_err());
        assert!(judge(&seen, "/home/me/Documents/Orden", Use::Change).is_err());
        assert!(judge(&seen, "/home/me/.config", Use::Change).is_err());
        assert!(judge(&seen, "/home/me/Documents/letter.odt", Use::Change).is_ok());
        assert!(judge(&seen, "/home/me/Documents", Use::Into).is_ok());
        assert!(judge(&seen, "/home/me/.config/orden/custom.css", Use::Look).is_ok());
    }

    #[test]
    fn orden_s_own_storage_of_the_spaces_is_not_shown_only_a_working_folder() {
        let seen = Explored::default();
        let kept = "/home/me/Documents/Orden/.orden";
        for folder in [kept, "/home/me/Documents/Orden/.orden/Notes"] {
            seen.saw(Path::new(folder));
            assert!(judge(&seen, folder, Use::List).is_err(), "{folder}");
        }
        assert!(judge(
            &seen,
            "/home/me/Documents/Orden/.orden/Notes/.entries/k1.md",
            Use::Look
        )
        .is_err());
        let working = "/home/me/Documents/Orden/.orden/.work/Notes";
        assert!(judge(&seen, working, Use::List).is_ok());
        seen.saw(Path::new(working));
        assert!(judge(&seen, &format!("{working}/Plan.md"), Use::Look).is_ok());
        assert!(judge(&seen, &format!("{working}/Plan.md"), Use::Change).is_err());
        assert!(judge(&seen, "/home/me/Documents/Orden", Use::List).is_ok());
    }

    #[test]
    fn a_link_into_a_fence_is_the_fence() {
        let seen = Explored::default();
        seen.saw(Path::new("/home/me/Desktop"));
        let real = |path: &Path| match path.strip_prefix("/home/me/Desktop/settings") {
            Ok(rest) => Path::new("/home/me/.config/orden").join(rest),
            Err(_) => path.to_path_buf(),
        };
        let asked = "/home/me/Desktop/settings/agents.json";
        seen.saw(Path::new("/home/me/Desktop/settings"));
        assert!(judged(&fences(), &|one| seen.seen(one), &real, asked, Use::Change).is_err());
        assert!(judged(&fences(), &|one| seen.seen(one), &plain, asked, Use::Change).is_ok());
    }

    #[test]
    fn the_top_of_a_disk_and_the_home_folder_are_not_changed() {
        let seen = Explored::default();
        for folder in ["/", "/home", "/media/me"] {
            seen.saw(Path::new(folder));
        }
        assert!(judge(&seen, "/home", Use::Change).is_err());
        assert!(judge(&seen, "/home/me", Use::Change).is_err());
        assert!(judge(&seen, "/media", Use::Change).is_err());
        assert!(judge(&seen, "/media/me/Stick", Use::Change).is_ok());
    }
}
