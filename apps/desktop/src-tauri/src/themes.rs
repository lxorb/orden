//! Looks the reader can install: a folder of `.css` files beside the app's own
//! config, plus the two files that are always there - `custom.css`, applied on
//! top of whichever theme is active, and `snippets.json`. Dropping a file into
//! that folder is all it takes to install a theme, which is the contract Typora
//! uses.

use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::paths::{cannot, folded, inside};

/// What `custom.css` says when it is first made.
const CUSTOM_CSS: &str = "/* Loaded after the active theme. Anything here wins. */\n";

/// What `snippets.json` says when it is first made.
const SNIPPETS: &str = "{\n  \"todo\": \"- [ ] \",\n  \"note\": \"> [!NOTE]\\n> \"\n}\n";

/// One installed theme.
#[derive(Serialize)]
pub struct ThemeFile {
    id: String,
    name: String,
    path: String,
}

/// Where themes live, so the window can offer to open the folder.
#[tauri::command]
pub fn theme_dir(app: AppHandle) -> Result<String, String> {
    Ok(themes_root(&app)?.to_string_lossy().to_string())
}

/// Every theme file in that folder, by name.
#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<ThemeFile>, String> {
    let dir = themes_root(&app)?;
    let mut themes = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|error| cannot("read", &dir, &error))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_css(&path) {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(OsStr::to_str)
            .unwrap_or("theme")
            .to_string();

        themes.push(ThemeFile {
            id: format!("file:{stem}"),
            name: humanise(&stem),
            path: path.to_string_lossy().to_string(),
        });
    }

    themes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(themes)
}

/// Reads one theme. Only the settings folder is readable this way: a theme is a
/// stylesheet the app applies to itself, so it may not be any file on the disk.
#[tauri::command]
pub fn read_theme(app: AppHandle, path: String) -> Result<String, String> {
    let target = folded(Path::new(&path));
    if !inside(&config_dir(&app)?, &target) {
        return Err(format!("{path} is not one of Nib's own stylesheets"));
    }

    fs::read_to_string(&target).map_err(|error| cannot("read", &target, &error))
}

/// Where `custom.css` is, making it first if this is the first time it is asked
/// for, so the window has something to open either way.
#[tauri::command]
pub fn custom_css_path(app: AppHandle) -> Result<String, String> {
    let path = custom_css_file(&app)?;
    if !path.exists() {
        fs::write(&path, CUSTOM_CSS).map_err(|error| cannot("create", &path, &error))?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// The reader's own additions to whichever theme is active, or nothing at all.
#[tauri::command]
pub fn read_custom_css(app: AppHandle) -> String {
    custom_css_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
}

/// Where `snippets.json` is, making it first if it is not there. Abbreviations the
/// editor offers while typing, stored as plain JSON so they can be edited in Nib
/// itself.
#[tauri::command]
pub fn snippets_path(app: AppHandle) -> Result<String, String> {
    let path = snippets_file(&app)?;
    if !path.exists() {
        fs::write(&path, SNIPPETS).map_err(|error| cannot("create", &path, &error))?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// The snippets as they stand, or an empty set if the file is not readable. The
/// editor works without them, so this is not worth an error.
#[tauri::command]
pub fn read_snippets(app: AppHandle) -> String {
    snippets_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_else(|| "{}".into())
}

/// The app's own settings folder.
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("could not find the settings folder: {error}"))
}

/// The themes folder, made if it is not there yet.
fn themes_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("themes");
    fs::create_dir_all(&dir).map_err(|error| cannot("create", &dir, &error))?;
    Ok(dir)
}

/// `custom.css` sits beside the themes folder rather than in it, so it is not
/// offered as a theme of its own.
fn custom_css_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("custom.css"))
}

/// `snippets.json`, beside `custom.css`.
fn snippets_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("snippets.json"))
}

/// Whether a file is a stylesheet, in whichever case the extension is written.
fn is_css(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("css"))
}

/// `night-owl` becomes `Night owl`, matching how Typora labels theme files.
fn humanise(stem: &str) -> String {
    let spaced = stem.replace(['-', '_'], " ");
    let mut letters = spaced.chars();

    match letters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + letters.as_str(),
        None => spaced,
    }
}

#[cfg(test)]
mod tests {
    use super::{humanise, is_css};
    use std::path::Path;

    #[test]
    fn labels_a_theme_the_way_typora_does() {
        assert_eq!(humanise("night-owl"), "Night owl");
        assert_eq!(humanise("solarized_light"), "Solarized light");
        assert_eq!(humanise("github"), "Github");
        assert_eq!(humanise(""), "");
    }

    #[test]
    fn a_name_that_starts_with_something_other_than_a_letter_survives() {
        assert_eq!(humanise("2026-theme"), "2026 theme");
        assert_eq!(humanise("über-thema"), "Über thema");
    }

    #[test]
    fn a_stylesheet_is_one_in_any_case() {
        assert!(is_css(Path::new("a/b.css")));
        assert!(is_css(Path::new("a/b.CSS")));
        assert!(!is_css(Path::new("a/b.scss")));
        assert!(!is_css(Path::new("a/b")));
    }
}
