//! The pictures a note points at. This module owns copying one in beside the
//! note, and handing one back as a `data:` URI for an export that has to carry
//! its own pictures. Everything here stays inside the folder the note is in.

use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::AppHandle;

use crate::paths::{beside_a_note, cannot, free_spot};

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

/// Copies a pasted or dropped picture next to the note and returns the relative
/// path to write into the markdown, so the note stays portable.
#[tauri::command]
pub fn save_asset(
    app: AppHandle,
    note_path: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let note = beside_a_note(&app, &note_path)?;
    let dir = note
        .parent()
        .ok_or_else(|| format!("{note_path} has no folder"))?
        .join("assets");
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

    Ok(format!("assets/{file}"))
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
    use super::{encode, mime_of, safe_name, MAX_NAME};
    use std::path::Path;

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
