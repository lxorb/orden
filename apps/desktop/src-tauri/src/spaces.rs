//! Spaces live in one folder the app owns, so nobody is ever asked where to put
//! a note. Each space is a directory inside it, named after the space.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Names Windows refuses whatever the extension.
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Long enough for any real name, short enough to stay well inside the path
/// limits once the space folder and a note name are added.
const MAX_NAME: usize = 64;

#[derive(Serialize)]
pub struct Space {
    name: String,
    path: String,
}

/// `Documents/Nib`, so notes sit where a person would look for them rather than
/// buried in application data. Falls back to the home folder.
pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;

    let dir = base.join("Nib");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn spaces_root(app: AppHandle) -> Result<String, String> {
    Ok(root(&app)?.to_string_lossy().to_string())
}

/// Every space on disk, alphabetical. The folder is the source of truth, so a
/// space copied in by hand simply appears.
#[tauri::command]
pub fn list_spaces(app: AppHandle) -> Result<Vec<Space>, String> {
    let dir = root(&app)?;
    let mut spaces = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
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

/// Creates a space and returns where it landed. The folder name is derived from
/// what was typed, and made unique if that name is taken.
#[tauri::command]
pub fn create_space(app: AppHandle, name: String) -> Result<Space, String> {
    let dir = root(&app)?;
    let wanted = folder_name(&name).ok_or("that name cannot be used for a folder")?;

    let mut candidate = wanted.clone();
    let mut counter = 2;
    while dir.join(&candidate).exists() {
        candidate = format!("{wanted} {counter}");
        counter += 1;
    }

    let path = dir.join(&candidate);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    Ok(Space {
        name: candidate,
        path: path.to_string_lossy().to_string(),
    })
}

/// Renames a space by renaming its folder.
#[tauri::command]
pub fn rename_space(app: AppHandle, from: String, name: String) -> Result<Space, String> {
    let dir = root(&app)?;
    let wanted = folder_name(&name).ok_or("that name cannot be used for a folder")?;
    let target = dir.join(&wanted);

    let source = PathBuf::from(&from);
    if source == target {
        return Ok(Space {
            name: wanted,
            path: target.to_string_lossy().to_string(),
        });
    }

    if target.exists() {
        return Err("a space with that name already exists".into());
    }

    fs::rename(&source, &target).map_err(|e| e.to_string())?;

    Ok(Space {
        name: wanted,
        path: target.to_string_lossy().to_string(),
    })
}

/// Deletes a space and every note in it. Refuses anything outside the spaces
/// folder, so a mistyped path cannot take a different directory with it.
#[tauri::command]
pub fn delete_space(app: AppHandle, path: String) -> Result<(), String> {
    let dir = root(&app)?;
    let target = PathBuf::from(&path);

    let inside = target
        .parent()
        .map(|parent| parent == dir.as_path())
        .unwrap_or(false);

    if !inside || !target.is_dir() {
        return Err("that is not a space".into());
    }

    fs::remove_dir_all(&target).map_err(|e| e.to_string())
}

/// Turns what someone typed into a folder name every platform accepts, or None
/// when nothing usable is left.
pub fn folder_name(input: &str) -> Option<String> {
    let cleaned: String = input
        .chars()
        // `<>:"/\|?*` are illegal on Windows; control characters everywhere.
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();

    // Collapse the runs the replacement above can leave behind.
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    // A trailing dot or space is dropped silently by Windows, so a name that
    // ends in one would not be the name that was asked for.
    let trimmed = collapsed.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        return None;
    }

    let capped: String = trimmed.chars().take(MAX_NAME).collect();
    let capped = capped
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if capped.is_empty() {
        return None;
    }

    // A reserved name is fine with something appended, which is less surprising
    // than refusing it.
    let stem = capped.split('.').next().unwrap_or(&capped).to_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Some(format!("{capped} space"));
    }

    Some(capped)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn works_around_the_reserved_names() {
        assert_eq!(folder_name("CON"), Some("CON space".into()));
        assert_eq!(folder_name("nul"), Some("nul space".into()));
        assert_eq!(folder_name("COM1"), Some("COM1 space".into()));
        // Only the exact names are reserved.
        assert_eq!(folder_name("Console"), Some("Console".into()));
    }

    #[test]
    fn caps_the_length() {
        let long = "x".repeat(200);
        assert_eq!(folder_name(&long).unwrap().chars().count(), MAX_NAME);
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
