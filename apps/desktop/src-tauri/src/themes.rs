//! Looks the reader can install: a folder of `.css` files beside the app's own
//! config, plus the two files that are always there - `custom.css`, applied on
//! top of whichever theme is active, and `snippets.json`. Dropping a file into
//! that folder is all it takes to install a theme, which is the contract Typora
//! uses.

use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::paths::{cannot, folded, inside};

/// What `custom.css` says when it is first made.
const CUSTOM_CSS: &str = "/* Loaded after the active theme. Anything here wins. */\n";

/// What `snippets.json` says when it is first made.
const SNIPPETS: &str = "{\n  \"todo\": \"- [ ] \",\n  \"note\": \"> [!NOTE]\\n> \"\n}\n";

/// The most a theme may be. The store refuses a bigger one before it is offered;
/// this is the same limit on the side that writes the file, with room for the
/// line the store stamps on the front.
const MOST_BYTES: usize = 64 * 1024;

/// Whether a string may name a theme file. Lower-case letters, digits and
/// hyphens, starting with one of the first two, which is also the shape the
/// registry gives its folders. Anything else, `..` and a separator included,
/// is not an id - which is what keeps an id from becoming a path.
fn is_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 39
        && id.starts_with(|first: char| first.is_ascii_lowercase() || first.is_ascii_digit())
        && id
            .chars()
            .all(|one| one.is_ascii_lowercase() || one.is_ascii_digit() || one == '-')
}

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

/// Installs a theme from the store, replacing whatever was under that id.
///
/// The stylesheet has already been read down to what a theme may be by the time
/// it arrives here; what this adds is that the id can only ever name a file in
/// the themes folder. Written to a neighbour and renamed over the target, so a
/// theme being updated is either the old one or the new one and never half of
/// each - a half-written stylesheet is what the window would be showing.
#[tauri::command]
pub fn write_theme(app: AppHandle, id: String, css: String) -> Result<String, String> {
    if !is_id(&id) {
        return Err(format!("{id} is not a theme id"));
    }

    if css.len() > MOST_BYTES {
        return Err("that stylesheet is larger than a theme".into());
    }

    let dir = themes_root(&app)?;
    let target = dir.join(format!("{id}.css"));
    let part = dir.join(format!("{id}.css.part"));

    fs::write(&part, css).map_err(|error| cannot("write", &part, &error))?;
    fs::rename(&part, &target).map_err(|error| cannot("write", &target, &error))?;

    Ok(target.to_string_lossy().to_string())
}

/// Takes an installed theme away. A theme that is already gone is not an error:
/// the folder ends up the way the caller asked for either way.
#[tauri::command]
pub fn remove_theme(app: AppHandle, id: String) -> Result<(), String> {
    if !is_id(&id) {
        return Err(format!("{id} is not a theme id"));
    }

    let path = themes_root(&app)?.join(format!("{id}.css"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cannot("remove", &path, &error)),
    }
}

/// Where `custom.css` is, making it first if this is the first time it is asked
/// for, so the window has something to open either way.
#[tauri::command]
pub fn custom_css_path(app: AppHandle) -> Result<String, String> {
    let path = custom_css_file(&app)?;
    seed(&path, CUSTOM_CSS)?;
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
    seed(&path, SNIPPETS)?;
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

/// Writes a starter file, unless it is already there. Asking the filesystem to
/// create it rather than looking first and then writing: two windows starting at
/// the same moment would both find it missing, and the second would write its
/// default over whatever the first had already put there.
fn seed(path: &Path, content: &str) -> Result<(), String> {
    match fs::File::create_new(path) {
        Ok(mut file) => file
            .write_all(content.as_bytes())
            .map_err(|error| cannot("write", path, &error)),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(cannot("create", path, &error)),
    }
}

/// The app's own settings folder, made if it is not there yet: on a fresh install
/// nothing has written to it, and the two files below have to land somewhere.
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("could not find the settings folder: {error}"))?;

    fs::create_dir_all(&dir).map_err(|error| cannot("create", &dir, &error))?;
    Ok(dir)
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
    use super::{humanise, is_css, is_id};
    use std::path::Path;

    #[test]
    fn an_id_names_a_file_and_never_a_path() {
        assert!(is_id("warm-paper"));
        assert!(is_id("2026"));
        assert!(!is_id(""));
        assert!(!is_id("-leading"));
        assert!(!is_id(".."));
        assert!(!is_id("a/b"));
        assert!(!is_id("a\\b"));
        assert!(!is_id("../etc/passwd"));
        assert!(!is_id("Warm-Paper"));
        assert!(!is_id("warm paper"));
        assert!(!is_id("thema.css"));
        assert!(!is_id(&"a".repeat(40)));
    }

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
