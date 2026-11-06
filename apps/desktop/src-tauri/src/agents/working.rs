use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use tauri::AppHandle;

pub const VERB: &str = "agent.working_folder";

const KEPT: &str = ".orden";

const WORKING: &str = ".work";

const PATIENCE: Duration = Duration::from_secs(120);

#[derive(Debug, PartialEq, Eq)]
enum Kept {
    No,
    Store,
    Space,
}

fn same_name(one: &str, other: &str) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        one.to_lowercase() == other.to_lowercase()
    } else {
        one == other
    }
}

fn kept(spaces: &Path, path: &Path) -> Kept {
    let home = spaces.join(KEPT);
    if !crate::paths::inside(&home, path) {
        return Kept::No;
    }
    let names: Vec<String> = crate::paths::folded(path)
        .components()
        .skip(crate::paths::folded(&home).components().count())
        .filter_map(|part| match part {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    match names.as_slice() {
        [first, ..] if same_name(first, WORKING) => Kept::No,
        [name, root, ..] if !name.starts_with('.') && same_name(name, root) => Kept::Space,
        _ => Kept::Store,
    }
}

pub fn kept_twin(spaces: &Path, path: &Path) -> Option<PathBuf> {
    let rest = crate::paths::folded(path)
        .strip_prefix(crate::paths::folded(spaces))
        .ok()?
        .to_path_buf();
    let mut parts = rest.components();
    let Some(Component::Normal(name)) = parts.next() else {
        return None;
    };
    if name.to_string_lossy().starts_with('.') {
        return None;
    }
    let root = spaces.join(KEPT).join(name).join(name);
    root.is_file().then(|| root.join(parts.as_path()))
}

pub fn on_disk(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let Ok(spaces) = crate::paths::spaces_dir(app) else {
        return Ok(path.to_path_buf());
    };
    match kept(&spaces, path) {
        Kept::No => Ok(path.to_path_buf()),
        Kept::Store => Err(format!(
            "{} is Orden's own storage of a space: reach a space's files by its notes, or by its working folder",
            path.display()
        )),
        Kept::Space => {
            let said = crate::endpoint::ask(
                app,
                VERB,
                serde_json::json!({ "path": path.to_string_lossy() }),
                PATIENCE,
            )?;
            said.as_str()
                .filter(|one| !one.is_empty())
                .map(PathBuf::from)
                .ok_or_else(|| format!("{} has no working folder", path.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_space_named_by_its_name_is_found_where_orden_keeps_it() {
        let dir = tempfile::tempdir().expect("a folder");
        let spaces = dir.path();
        std::fs::create_dir_all(spaces.join(KEPT).join("Notes")).expect("kept");
        std::fs::write(spaces.join(KEPT).join("Notes").join("Notes"), "").expect("root");
        std::fs::create_dir_all(spaces.join("Work")).expect("a folder space");

        assert_eq!(
            kept_twin(spaces, &spaces.join("Notes").join("Lists").join("a.pdf")),
            Some(
                spaces
                    .join(KEPT)
                    .join("Notes")
                    .join("Notes")
                    .join("Lists")
                    .join("a.pdf")
            )
        );
        assert_eq!(kept_twin(spaces, &spaces.join("Work").join("a.pdf")), None);
        assert_eq!(kept_twin(spaces, &spaces.join(KEPT).join("Notes")), None);
        assert_eq!(kept_twin(spaces, Path::new("/elsewhere/Notes/a.pdf")), None);
    }

    #[test]
    fn a_path_of_a_kept_space_is_told_from_its_storage_and_from_the_rest() {
        let spaces = Path::new("/spaces");
        let at = |rest: &str| spaces.join(rest);
        assert_eq!(kept(spaces, &at("Notes/Plan.md")), Kept::No);
        assert_eq!(kept(spaces, Path::new("/elsewhere/Plan.md")), Kept::No);
        assert_eq!(kept(spaces, &at(".orden/.work/Notes/Plan.md")), Kept::No);
        assert_eq!(kept(spaces, &at(".orden/Notes/Notes")), Kept::Space);
        assert_eq!(
            kept(spaces, &at(".orden/Notes/Notes/Lists/Plan.md")),
            Kept::Space
        );
        for inside in [
            ".orden",
            ".orden/Notes",
            ".orden/Notes/.entries/k1.md",
            ".orden/Notes/.index.0.json",
            ".orden/.backups/Notes 20261106 101010/Plan.md",
            ".orden/Notes/Work/Plan.md",
        ] {
            assert_eq!(kept(spaces, &at(inside)), Kept::Store, "{inside}");
        }
    }
}
