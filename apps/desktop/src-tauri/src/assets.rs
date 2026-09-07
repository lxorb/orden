//! The pictures a note points at. This module owns copying one in beside the
//! note, and handing one back as a `data:` URI for an export that has to carry
//! its own pictures. Everything here stays inside the folder the note is in.

use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{beside_a_note, cannot, folded, free_spot, inside, space_root, spaces_root};

/// Bigger than any picture belongs in a document, and small enough that turning
/// it into text cannot exhaust the memory of the window asking.
const LIMIT: u64 = 12 * 1024 * 1024;

/// How long a picture's file name may be, so the whole path stays inside the
/// limits Windows puts on one.
const MAX_NAME: usize = 120;

/// A picture as a `data:` URI, so an exported page carries its own pictures.
/// Refuses anything large enough to bloat the file past usefulness.
#[tauri::command]
pub fn read_asset(app: AppHandle, path: String) -> Result<String, String> {
    let target = beside_a_note(&app, &path)?;
    let file = fs::File::open(&target).map_err(|error| cannot("read", &target, &error))?;

    // Asked of the open file rather than of the path, so the answer is about the
    // very bytes that are read below.
    let size = file
        .metadata()
        .map_err(|error| cannot("read", &target, &error))?
        .len();
    if size > LIMIT {
        return Err(format!("{path} is larger than 12 MB"));
    }

    let mut bytes = Vec::new();
    // Capped again on the way in: a file that grows after the question was asked
    // still cannot answer with more than it was allowed.
    file.take(LIMIT)
        .read_to_end(&mut bytes)
        .map_err(|error| cannot("read", &target, &error))?;

    Ok(format!(
        "data:{};base64,{}",
        mime_of(&target),
        encode(&bytes)
    ))
}

/// Copies a pasted or dropped picture into the folder the window asked for and
/// returns the relative path to write into the markdown, so the note stays
/// portable.
///
/// `folder` is relative to the note's own folder, empty for the folder itself.
/// The window decides which of them it is - the space's assets folder, beside the
/// note, a folder named after it - and this decides whether the result is still
/// somewhere a note of this space may write.
#[tauri::command]
pub fn save_asset(
    app: AppHandle,
    note_path: String,
    folder: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let note = beside_a_note(&app, &note_path)?;
    let note_folder = note
        .parent()
        .ok_or_else(|| format!("{note_path} has no folder"))?;

    // How far a picture may be put from the note: anywhere in the space, or, for
    // a note opened from elsewhere on the disk, its own folder and no further.
    let limit = spaces_root(&app)
        .ok()
        .and_then(|spaces| space_root(&spaces, note_folder))
        .unwrap_or_else(|| note_folder.to_path_buf());

    let relative = trimmed(&folder);
    let dir = asset_dir(note_folder, relative, &limit)?;
    fs::create_dir_all(&dir).map_err(|error| cannot("create", &dir, &error))?;

    let safe = safe_name(&name).ok_or("that picture has no name that can be written")?;
    let mut target = dir.join(&safe);

    match fs::read(&target) {
        // The caller names the file after a hash of its contents, so a name that
        // is already taken usually holds this very picture. Pasting the same one
        // twice should cost nothing.
        Ok(held) if held == bytes => {}
        // The same name over a different picture would take the first one away,
        // so both are kept.
        Ok(_) => {
            target = free_spot(&target, true);
            fs::write(&target, &bytes).map_err(|error| cannot("write", &target, &error))?;
        }
        Err(_) => fs::write(&target, &bytes).map_err(|error| cannot("write", &target, &error))?,
    }

    let file = target
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("could not name the picture")?;

    // What goes into the note: forward slashes and the folder the window asked
    // for, so the link reads the same on every platform and resolves from the
    // note's own folder.
    Ok(if relative.is_empty() {
        file.to_string()
    } else {
        format!("{relative}/{file}")
    })
}

/// The folder as the markdown will spell it: no leading or trailing slashes, and
/// slashes rather than whatever the window sent.
fn trimmed(folder: &str) -> &str {
    folder.trim_matches('/')
}

/// Where a picture from a note in `note_folder` goes, given the folder relative
/// to it that the window asked for.
///
/// Refused when the folder is not relative, or when joining it on lands outside
/// `limit`: `../assets` reaches the space's own folder from a note one level
/// down, and `../../..` reaches another space, which is not this note's to write
/// in. Nothing is read from disk, so this is a decision about paths alone.
fn asset_dir(note_folder: &Path, folder: &str, limit: &Path) -> Result<PathBuf, String> {
    let asked = Path::new(folder);

    // An absolute path handed to `join` replaces what it is joined to, so it
    // would leave the note's folder behind entirely.
    let from_the_root = asked
        .components()
        .any(|part| matches!(part, Component::Prefix(_) | Component::RootDir));
    if from_the_root {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    let target = folded(&note_folder.join(asked));
    if !inside(limit, &target) {
        return Err(format!("{folder} is not a folder inside the space"));
    }

    Ok(target)
}

/// The name a picture may be written under: what the caller asked for, with
/// anything that could name another folder replaced by a dash. A name that is
/// nothing but dots is refused, because `.` and `..` are folders and not files.
fn safe_name(name: &str) -> Option<String> {
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

    Some(safe)
}

/// What kind of picture this is, going by the extension, which is all a `data:`
/// URI needs to be told.
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
        _ => "application/octet-stream",
    }
}

/// Base64, by hand. A dependency for forty lines that never change is a
/// dependency to keep up to date for no reason.
fn encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        // A short chunk is padded with zeroes and then trimmed back to the
        // number of characters those bytes are worth.
        let block = [
            chunk.first().copied().unwrap_or(0),
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];

        let sextets = [
            block[0] >> 2,
            ((block[0] & 0b11) << 4) | (block[1] >> 4),
            ((block[1] & 0b1111) << 2) | (block[2] >> 6),
            block[2] & 0b0011_1111,
        ];

        for (index, sextet) in sextets.iter().enumerate() {
            // The tail is filled out to a whole quantum with `=`.
            if index <= chunk.len() {
                out.push(char::from(ALPHABET[usize::from(*sextet)]));
            } else {
                out.push('=');
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::{asset_dir, encode, mime_of, safe_name, trimmed, MAX_NAME};
    use std::path::{Path, PathBuf};

    /// Written the way the platform writes them, so the assertions read the same
    /// on a runner as they do on a laptop.
    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
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
        // Another space is inside the spaces folder and still none of this
        // note's business.
        assert!(asset_dir(&space.join("Work"), "../../Other/assets", &space).is_err());
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
