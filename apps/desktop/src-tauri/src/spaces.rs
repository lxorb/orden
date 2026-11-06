use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use tauri::AppHandle;

use crate::notes::{move_entry, respelled, same_entry};
use crate::paths::{self, a_space, cannot, is_reserved};

const MAX_NAME: usize = 64;

const MAX_TRIES: usize = 500;

#[derive(Serialize)]
pub struct Space {
    name: String,
    path: String,
}

#[tauri::command(async)]
pub fn spaces_root(app: AppHandle) -> Result<String, String> {
    Ok(paths::spaces_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn list_spaces(app: AppHandle) -> Result<Vec<Space>, String> {
    let dir = paths::spaces_root(&app)?;
    let mut spaces = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|error| cannot("read", &dir, &error))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() && !name.starts_with('.') {
            spaces.push(Space {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    spaces.sort_by_key(|space| space.name.to_lowercase());
    Ok(spaces)
}

#[tauri::command(async)]
pub fn create_space(app: AppHandle, name: String) -> Result<Space, String> {
    let dir = paths::spaces_root(&app)?;
    let wanted = folder_name(&name).ok_or("that name cannot be used for a folder")?;

    let mut candidate = wanted.clone();
    for counter in 2..=MAX_TRIES {
        let path = dir.join(&candidate);

        match fs::create_dir(&path) {
            Ok(()) => return Ok(space_at(&path)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                candidate = format!("{wanted} {counter}");
            }
            Err(error) => return Err(cannot("create", &path, &error)),
        }
    }

    Err(format!("there are already too many spaces called {wanted}"))
}

#[tauri::command(async)]
pub fn rename_space(app: AppHandle, from: String, name: String) -> Result<Space, String> {
    let source = a_space(&app, &from)?;
    let wanted = folder_name(&name).ok_or("that name cannot be used for a folder")?;
    let target = source.with_file_name(&wanted);

    rename_folder(&source, &target, same_entry)?;
    crate::trash::space_renamed(&app, &source, &target);
    Ok(space_at(&target))
}

fn rename_folder(
    source: &Path,
    target: &Path,
    same: impl Fn(&Path, &Path) -> bool,
) -> Result<(), String> {
    if source == target {
        return Ok(());
    }

    let respelling = respelled(source, target, same);
    if !respelling && target.exists() {
        return Err("a space with that name already exists".into());
    }

    move_entry(source, target, respelling)
}

#[tauri::command(async)]
pub fn delete_space(app: AppHandle, path: String) -> Result<(), String> {
    let target = a_space(&app, &path)?;
    if !target.is_dir() {
        return Err(format!("{path} is not a space"));
    }

    fs::remove_dir_all(&target).map_err(|error| cannot("delete", &target, &error))
}

fn space_at(path: &Path) -> Space {
    Space {
        name: path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().to_string(),
    }
}

fn folder_name(input: &str) -> Option<String> {
    let cleaned: String = input
        .chars()
        .map(|letter| {
            if letter.is_control() || r#"<>:"/\|?*"#.contains(letter) {
                ' '
            } else {
                letter
            }
        })
        .collect();

    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    let trimmed = collapsed.trim_matches(|letter: char| letter == '.' || letter.is_whitespace());
    if trimmed.is_empty() {
        return None;
    }

    let capped: String = trimmed.chars().take(MAX_NAME).collect();
    let capped = capped
        .trim_matches(|letter: char| letter == '.' || letter.is_whitespace())
        .to_string();
    if capped.is_empty() {
        return None;
    }

    if is_reserved(&capped) {
        return Some(format!("{capped} space"));
    }

    Some(capped)
}

#[cfg(test)]
mod tests {
    use super::{folder_name, rename_folder, MAX_NAME};
    use std::fs;

    #[test]
    fn respells_a_space_in_another_case() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("work"), dir.path().join("Work"));
        fs::create_dir(&from).expect("the space");
        fs::write(from.join("plan.md"), "plan").expect("a note in it");

        rename_folder(&from, &to, |_, _| true).expect("the respelling");

        let names: Vec<_> = fs::read_dir(dir.path())
            .expect("the spaces folder")
            .map(|one| one.expect("an entry").file_name())
            .collect();
        assert_eq!(names, vec!["Work"]);
        assert_eq!(
            fs::read_to_string(to.join("plan.md")).expect("the note"),
            "plan"
        );
    }

    #[test]
    fn refuses_a_name_another_space_has() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("work"), dir.path().join("home"));
        fs::create_dir(&from).expect("one space");
        fs::create_dir(&to).expect("another");

        assert!(rename_folder(&from, &to, |_, _| false).is_err());
        assert!(from.is_dir());
    }

    #[test]
    fn the_same_name_is_nothing_to_do() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let from = dir.path().join("work");
        fs::create_dir(&from).expect("the space");

        rename_folder(&from, &from, |_, _| true).expect("no change");
        assert!(from.is_dir());
    }

    #[test]
    fn keeps_an_ordinary_name() {
        assert_eq!(folder_name("Journal"), Some("Journal".into()));
        assert_eq!(
            folder_name("Work notes 2026"),
            Some("Work notes 2026".into())
        );
    }

    #[test]
    fn strips_characters_windows_refuses() {
        assert_eq!(folder_name("a/b\\c:d"), Some("a b c d".into()));
        assert_eq!(folder_name("what? yes!"), Some("what yes!".into()));
        assert_eq!(folder_name("a<b>c|d*e\"f"), Some("a b c d e f".into()));
    }

    #[test]
    fn drops_control_characters() {
        assert_eq!(folder_name("a\nb\tc"), Some("a b c".into()));
        assert_eq!(folder_name("a\u{0}b"), Some("a b".into()));
    }

    #[test]
    fn refuses_a_trailing_dot_or_space() {
        assert_eq!(folder_name("Notes."), Some("Notes".into()));
        assert_eq!(folder_name("  Notes  "), Some("Notes".into()));
        assert_eq!(folder_name("Notes..."), Some("Notes".into()));
    }

    #[test]
    fn refuses_a_name_with_nothing_left() {
        assert_eq!(folder_name(""), None);
        assert_eq!(folder_name("   "), None);
        assert_eq!(folder_name("///"), None);
        assert_eq!(folder_name("..."), None);
    }

    #[test]
    fn a_name_cannot_climb_out_of_the_spaces_folder() {
        assert_eq!(folder_name(".."), None);
        assert_eq!(folder_name("../../elsewhere"), Some("elsewhere".into()));
        assert_eq!(folder_name(r"..\elsewhere"), Some("elsewhere".into()));
    }

    #[test]
    fn works_around_the_reserved_names() {
        assert_eq!(folder_name("CON"), Some("CON space".into()));
        assert_eq!(folder_name("nul"), Some("nul space".into()));
        assert_eq!(folder_name("COM1"), Some("COM1 space".into()));
        assert_eq!(folder_name("Console"), Some("Console".into()));
    }

    #[test]
    fn caps_the_length() {
        let long = "x".repeat(200);
        assert_eq!(
            folder_name(&long).map(|name| name.chars().count()),
            Some(MAX_NAME)
        );
    }

    #[test]
    fn keeps_letters_other_languages_use() {
        assert_eq!(
            folder_name("Notizen über Bücher"),
            Some("Notizen über Bücher".into())
        );
        assert_eq!(folder_name("日本語"), Some("日本語".into()));
    }
}
