use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{
    at_most, cannot, first_spot, folded, held_paper, in_spaces, inside, is_reserved, made,
    space_root, spaces_dir, taken,
};

const LIMIT: u64 = LIMIT_MB * 1024 * 1024;

const LIMIT_MB: u64 = 12;

const MAX_NAME: usize = 120;

pub(crate) const FILE_LIMIT: u64 = 192 * 1024 * 1024;

#[tauri::command(async)]
pub fn read_file(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let target = readable(&app, &path)?;
    #[cfg(target_os = "macos")]
    crate::notes::icloud::fetched(&app, &target)?;
    let Some(bytes) = at_most(&target, FILE_LIMIT)? else {
        return Err(format!("{path} is too large to open"));
    };

    Ok(tauri::ipc::Response::new(bytes))
}

fn readable(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let refused = match in_spaces(app, path) {
        Ok(target) => return Ok(target),
        Err(refused) => refused,
    };
    #[cfg(desktop)]
    if let Some(handed) = crate::handed_pdfs::handed_pdf(app, path) {
        return Ok(handed);
    }
    Err(refused)
}

#[tauri::command(async)]
pub fn read_asset(app: AppHandle, path: String) -> Result<String, String> {
    let target = in_spaces(&app, &path)?;
    let Some(bytes) = at_most(&target, LIMIT)? else {
        return Err(format!("{path} is larger than {LIMIT_MB} MB"));
    };

    Ok(format!(
        "data:{};base64,{}",
        mime_of(&target),
        encode(&bytes)
    ))
}

#[tauri::command(async)]
pub fn save_asset(
    app: AppHandle,
    note_path: String,
    folder: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let note = in_spaces(&app, &note_path)?;
    let note_folder = note
        .parent()
        .ok_or_else(|| format!("{note_path} has no folder"))?;

    let limit = space_root(&spaces_dir(&app)?, note_folder)
        .ok_or_else(|| format!("{note_path} is not in a space"))?;

    let relative = trimmed(&folder);
    let dir = asset_dir(note_folder, relative, &limit)?;
    made(&dir)?;

    let safe = safe_name(&name).ok_or("that picture has no name that can be written")?;
    let target = stored(&dir, &safe, &bytes)?;

    let file = target
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("could not name the picture")?;

    Ok(if relative.is_empty() {
        file.to_string()
    } else {
        format!("{relative}/{file}")
    })
}

fn stored(dir: &Path, safe: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let ours = |one: &Path| !held_paper(one) && fs::read(one).is_ok_and(|held| held == bytes);
    let target = first_spot(&dir.join(safe), true, |one| !taken(one, true) || ours(one));

    if !ours(&target) {
        fs::write(&target, bytes).map_err(|error| cannot("write", &target, &error))?;
    }
    Ok(target)
}

fn trimmed(folder: &str) -> &str {
    folder.trim_matches('/')
}

fn asset_dir(note_folder: &Path, folder: &str, limit: &Path) -> Result<PathBuf, String> {
    let asked = Path::new(folder);

    let from_the_root = asked
        .components()
        .any(|part| matches!(part, Component::Prefix(_) | Component::RootDir));
    if from_the_root {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    let hidden = asked.components().any(|part| match part {
        Component::Normal(name) => name.to_string_lossy().starts_with('.'),
        _ => false,
    });
    if hidden {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    let target = folded(&note_folder.join(asked));
    if !inside(limit, &target) {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    Ok(target)
}

pub(crate) fn safe_name(name: &str) -> Option<String> {
    let safe: String = name
        .chars()
        .take(MAX_NAME)
        .map(|letter| {
            if letter.is_alphanumeric() || letter == '.' || letter == '-' || letter == '_' {
                letter
            } else {
                '-'
            }
        })
        .collect();

    if safe.is_empty() || safe.chars().all(|letter| letter == '.') {
        return None;
    }

    Some(if is_reserved(&safe) {
        format!("_{safe}")
    } else {
        safe
    })
}

fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "weba" => "audio/webm",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "ogv" => "video/ogg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn encode(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::{asset_dir, encode, mime_of, safe_name, stored, trimmed, MAX_NAME};
    use std::path::{Path, PathBuf};

    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn an_attachment_never_pairs_with_a_page_note_or_its_paper() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Report.pages"), "{}").expect("a blank page note");
        std::fs::write(here.join("Lecture.pages.pdf"), b"%PDF mine").expect("a PDF");

        assert_eq!(
            stored(here, "Report.pages.pdf", b"%PDF dropped"),
            Ok(here.join("Report.pages 2.pdf"))
        );
        assert_eq!(
            stored(here, "Lecture.pages", b"iwork"),
            Ok(here.join("Lecture 2.pages"))
        );
        assert_eq!(
            std::fs::read(here.join("Lecture.pages.pdf")).expect("still there"),
            b"%PDF mine"
        );
        assert_eq!(stored(here, "a.png", b"png"), Ok(here.join("a.png")));
        assert_eq!(stored(here, "a.png", b"png"), Ok(here.join("a.png")));
    }

    #[test]
    fn an_attachment_stepped_aside_is_still_the_one_copy() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Report.pages"), "{}").expect("a blank page note");
        std::fs::write(here.join("X.pdf.highlights.json"), "[]").expect("leftovers");
        std::fs::write(here.join("Lecture.pages"), "{}").expect("a page note");
        std::fs::write(here.join("Lecture.pages.pdf"), b"%PDF paper").expect("its paper");

        for _ in 0..2 {
            assert_eq!(
                stored(here, "Report.pages.pdf", b"%PDF dropped"),
                Ok(here.join("Report.pages 2.pdf"))
            );
            assert_eq!(stored(here, "X.pdf", b"%PDF x"), Ok(here.join("X 2.pdf")));
        }
        assert_eq!(
            stored(here, "Lecture.pages.pdf", b"%PDF paper"),
            Ok(here.join("Lecture.pages 2.pdf"))
        );
    }

    #[test]
    fn an_attachment_never_takes_a_device_name() {
        assert_eq!(safe_name("CON.png").as_deref(), Some("_CON.png"));
        assert_eq!(safe_name("nul.pdf").as_deref(), Some("_nul.pdf"));
        assert_eq!(safe_name("Console.png").as_deref(), Some("Console.png"));
    }

    #[test]
    fn the_space_folder_is_reached_from_a_note_in_it() {
        let space = path(&["Nib", "Notes"]);

        assert_eq!(
            asset_dir(&space, "assets", &space),
            Ok(path(&["Nib", "Notes", "assets"]))
        );
        assert_eq!(
            asset_dir(&space.join("Work"), "../assets", &space),
            Ok(path(&["Nib", "Notes", "assets"]))
        );
        assert_eq!(
            asset_dir(&space.join("Work").join("2026"), "../../assets", &space),
            Ok(path(&["Nib", "Notes", "assets"]))
        );
    }

    #[test]
    fn no_folder_at_all_is_the_note_s_own() {
        let space = path(&["Nib", "Notes"]);
        let here = space.join("Work");

        assert_eq!(asset_dir(&here, "", &space), Ok(here.clone()));
    }

    #[test]
    fn a_folder_named_after_the_note_sits_beside_it() {
        let space = path(&["Nib", "Notes"]);

        assert_eq!(
            asset_dir(&space, "Read me", &space),
            Ok(path(&["Nib", "Notes", "Read me"]))
        );
    }

    #[test]
    fn a_folder_that_climbs_out_of_the_space_is_refused() {
        let space = path(&["Nib", "Notes"]);

        assert!(asset_dir(&space, "../assets", &space).is_err());
        assert!(asset_dir(&space, "../../elsewhere", &space).is_err());
        assert!(asset_dir(&space.join("Work"), "../../Other/assets", &space).is_err());
    }

    #[test]
    fn a_hidden_folder_is_refused() {
        let spaces = path(&["Documents", "Nib"]);

        assert!(asset_dir(&spaces, ".trash", &spaces).is_err());
        assert!(asset_dir(&spaces, ".trash/1700000000000-0", &spaces).is_err());
        assert!(asset_dir(&spaces, "assets/.hidden", &spaces).is_err());
        assert!(asset_dir(&spaces, ".git", &spaces).is_err());
        let inside_a_dot = path(&["home", "me", ".config", "notes"]);
        assert_eq!(
            asset_dir(&inside_a_dot, "assets", &inside_a_dot),
            Ok(inside_a_dot.join("assets"))
        );
    }

    #[test]
    fn a_folder_that_is_not_relative_is_refused() {
        let space = path(&["Nib", "Notes"]);

        assert!(asset_dir(&space, "/etc", &space).is_err());
        if cfg!(windows) {
            assert!(asset_dir(&space, r"C:\Windows", &space).is_err());
        }
    }

    #[test]
    fn a_note_outside_the_spaces_folder_reaches_its_own_folder_and_no_further() {
        let here = path(&["elsewhere", "notes"]);

        assert_eq!(asset_dir(&here, "assets", &here), Ok(here.join("assets")));
        assert!(asset_dir(&here, "../assets", &here).is_err());
    }

    #[test]
    fn the_folder_is_trimmed_to_what_the_markdown_says() {
        assert_eq!(trimmed("/assets/"), "assets");
        assert_eq!(trimmed(""), "");
        assert_eq!(trimmed("../assets"), "../assets");
    }

    #[test]
    fn encodes_the_rfc_4648_vectors() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn encodes_bytes_that_are_not_text() {
        assert_eq!(encode(&[0x00, 0xff, 0x80]), "AP+A");
        assert_eq!(encode(&[0xfb, 0xff]), "+/8=");
    }

    #[test]
    fn names_the_type_from_the_extension() {
        assert_eq!(mime_of(Path::new("a/b.PNG")), "image/png");
        assert_eq!(mime_of(Path::new("a/b.jpeg")), "image/jpeg");
        assert_eq!(mime_of(Path::new("a/b.svg")), "image/svg+xml");
        assert_eq!(mime_of(Path::new("a/b.xyz")), "application/octet-stream");
        assert_eq!(mime_of(Path::new("a/clip.MP3")), "audio/mpeg");
        assert_eq!(mime_of(Path::new("a/talk.m4a")), "audio/mp4");
        assert_eq!(mime_of(Path::new("a/demo.mp4")), "video/mp4");
        assert_eq!(mime_of(Path::new("a/demo.mov")), "video/quicktime");
        assert_eq!(mime_of(Path::new("a/x.ogg")), "audio/ogg");
        assert_eq!(mime_of(Path::new("a/x.ogv")), "video/ogg");
        assert_eq!(mime_of(Path::new("a/x.webm")), "video/webm");
        assert_eq!(mime_of(Path::new("a/x.weba")), "audio/webm");
        assert_eq!(
            mime_of(Path::new("noextension")),
            "application/octet-stream"
        );
    }

    #[test]
    fn keeps_a_plain_picture_name() {
        assert_eq!(safe_name("a1b2c3.png"), Some("a1b2c3.png".into()));
        assert_eq!(safe_name("my-image_2.jpeg"), Some("my-image_2.jpeg".into()));
    }

    #[test]
    fn a_picture_cannot_name_another_folder() {
        assert_eq!(
            safe_name("../../secret.png"),
            Some("..-..-secret.png".into())
        );
        assert_eq!(safe_name(r"..\secret.png"), Some("..-secret.png".into()));
        assert_eq!(
            safe_name("C:/Windows/x.png"),
            Some("C--Windows-x.png".into())
        );
    }

    #[test]
    fn refuses_a_name_that_is_only_dots() {
        assert_eq!(safe_name(""), None);
        assert_eq!(safe_name("."), None);
        assert_eq!(safe_name(".."), None);
    }

    #[test]
    fn caps_how_long_a_name_can_get() {
        let long = format!("{}.png", "x".repeat(400));
        assert_eq!(
            safe_name(&long).map(|name| name.chars().count()),
            Some(MAX_NAME)
        );
    }
}
