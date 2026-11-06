use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{cannot, config_dir, folded, inside, made, write_atomically};

const CUSTOM_CSS: &str = "/* Loaded after the active theme. Anything here wins. */\n";

const SCRATCHPAD: &str = "";

const SNIPPETS: &str = "{\n  \"todo\": \"- [ ] \",\n  \"note\": \"> [!NOTE]\\n> \"\n}\n";

const MOST_BYTES: usize = 64 * 1024;

fn is_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 39
        && id.starts_with(|first: char| first.is_ascii_lowercase() || first.is_ascii_digit())
        && id
            .chars()
            .all(|one| one.is_ascii_lowercase() || one.is_ascii_digit() || one == '-')
}

#[derive(Serialize)]
pub struct ThemeFile {
    id: String,
    name: String,
    path: String,
}

#[tauri::command(async)]
pub fn theme_dir(app: AppHandle) -> Result<String, String> {
    Ok(themes_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn read_theme(app: AppHandle, path: String) -> Result<String, String> {
    let target = folded(Path::new(&path));
    if !is_a_theme(&themes_root(&app)?, &target) {
        return Err(format!("{path} is not one of Orden's own stylesheets"));
    }

    fs::read_to_string(&target).map_err(|error| cannot("read", &target, &error))
}

fn is_a_theme(dir: &Path, target: &Path) -> bool {
    let directly_inside = target
        .parent()
        .is_some_and(|parent| inside(dir, parent) && inside(parent, dir));

    directly_inside && is_css(target)
}

#[tauri::command(async)]
pub fn write_theme(app: AppHandle, id: String, css: String) -> Result<String, String> {
    if !is_id(&id) {
        return Err(format!("{id} is not a theme id"));
    }

    if css.len() > MOST_BYTES {
        return Err("that stylesheet is larger than a theme".into());
    }

    let target = themes_root(&app)?.join(format!("{id}.css"));
    write_atomically(&target, css.as_bytes())?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn custom_css_path(app: AppHandle) -> Result<String, String> {
    let path = custom_css_file(&app)?;
    seed(&path, CUSTOM_CSS)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn read_custom_css(app: AppHandle) -> String {
    custom_css_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn snippets_path(app: AppHandle) -> Result<String, String> {
    let path = snippets_file(&app)?;
    seed(&path, SNIPPETS)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn scratchpad_path(app: AppHandle) -> Result<String, String> {
    let path = settings_dir(&app)?.join(SCRATCHPAD_FILE);
    seed(&path, SCRATCHPAD)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn read_snippets(app: AppHandle) -> String {
    snippets_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_else(|| "{}".into())
}

pub(crate) const SETTINGS_FILE: &str = "settings.json";

#[derive(Serialize)]
pub struct SettingsFile {
    path: String,
    text: String,
}

#[tauri::command(async)]
pub fn read_settings_file(app: AppHandle) -> Result<Option<SettingsFile>, String> {
    declared(&config_dir(&app)?.join(SETTINGS_FILE))
}

fn declared(path: &Path) -> Result<Option<SettingsFile>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(SettingsFile {
            path: path.to_string_lossy().to_string(),
            text,
        })),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(cannot("read", path, &error)),
    }
}

fn seed(path: &Path, content: &str) -> Result<(), String> {
    seeded(path, content, |file, bytes| {
        file.write_all(bytes)?;
        file.sync_all()
    })
}

fn seeded(
    path: &Path,
    content: &str,
    write: impl FnOnce(&mut fs::File, &[u8]) -> io::Result<()>,
) -> Result<(), String> {
    let mut file = match fs::File::create_new(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(cannot("create", path, &error)),
    };

    write(&mut file, content.as_bytes()).map_err(|error| {
        drop(file);
        let _ = fs::remove_file(path);
        cannot("write", path, &error)
    })
}

fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;
    made(&dir)?;
    Ok(dir)
}

fn themes_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = settings_dir(app)?.join("themes");
    made(&dir)?;
    Ok(dir)
}

const CUSTOM_CSS_FILE: &str = "custom.css";

const SNIPPETS_FILE: &str = "snippets.json";

const SCRATCHPAD_FILE: &str = "Scratchpad.md";

fn custom_css_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(CUSTOM_CSS_FILE))
}

fn snippets_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(SNIPPETS_FILE))
}

pub fn own_files(app: &AppHandle) -> Vec<PathBuf> {
    config_dir(app)
        .map(|dir| {
            vec![
                dir.join(CUSTOM_CSS_FILE),
                dir.join(SNIPPETS_FILE),
                dir.join(SCRATCHPAD_FILE),
            ]
        })
        .unwrap_or_default()
}

fn is_css(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("css"))
}

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
    use super::{
        declared, humanise, is_a_theme, is_css, is_id, seed, seeded, SCRATCHPAD, SNIPPETS,
    };
    use std::io::{self, Write as _};
    use std::path::{Path, PathBuf};

    #[test]
    fn a_starter_that_could_not_be_written_is_written_the_next_time() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("snippets.json");

        let failed = seeded(&path, SNIPPETS, |file, bytes| {
            file.write_all(&bytes[..3])?;
            Err(io::Error::other("the disk is full"))
        });
        assert!(failed.is_err());
        assert!(!path.exists(), "half a starter was left behind");

        seed(&path, SNIPPETS).expect("the starter");
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), SNIPPETS);
    }

    #[test]
    fn the_settings_file_is_read_as_it_is_and_never_made() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("settings.json");

        assert!(declared(&path).expect("no file is no error").is_none());
        assert!(!path.exists(), "the file was made");

        std::fs::write(&path, "{ not json").expect("the file");
        let file = declared(&path).expect("read").expect("a file");
        assert_eq!(file.text, "{ not json");
        assert_eq!(file.path, path.to_string_lossy());

        std::fs::create_dir(dir.path().join("folder.json")).expect("a folder");
        let error = declared(&dir.path().join("folder.json"))
            .err()
            .expect("an error");
        assert!(error.contains("folder.json"), "{error}");
    }

    #[test]
    fn a_starter_is_never_written_over_anything() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("custom.css");
        std::fs::write(&path, "").expect("a file somebody emptied");

        seed(&path, "/* a starter */").expect("nothing to do");
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "");
    }

    #[test]
    fn the_scratchpad_starts_empty_and_keeps_what_is_jotted() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("Scratchpad.md");

        seed(&path, SCRATCHPAD).expect("the scratchpad");
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "");

        std::fs::write(&path, "a number to call").expect("a jot");
        seed(&path, SCRATCHPAD).expect("nothing to do");
        assert_eq!(
            std::fs::read_to_string(&path).expect("the file"),
            "a number to call"
        );
    }

    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn only_a_stylesheet_in_the_themes_folder_is_a_theme() {
        let settings = path(&["AppData", "ch.emilvinu.nib"]);
        let themes = settings.join("themes");

        assert!(is_a_theme(&themes, &themes.join("warm-paper.css")));
        assert!(is_a_theme(&themes, &themes.join("Night Owl.CSS")));

        assert!(!is_a_theme(&themes, &settings.join("custom.css")));
        assert!(!is_a_theme(
            &themes,
            &settings
                .join("history")
                .join("0123456789abcdef")
                .join("1.css")
        ));
        assert!(!is_a_theme(&themes, &themes.join("deep").join("a.css")));
        assert!(!is_a_theme(&themes, &themes.join("snippets.json")));
        assert!(!is_a_theme(&themes, &themes.join("origin.txt")));
        assert!(!is_a_theme(&themes, &themes));
    }

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
