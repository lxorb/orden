//! A note is a file. This module owns the six things the window can ask of
//! one: read it, write it back as text, write it back as bytes, rename or move
//! it, delete it, and make the folder it is going to live in. Whether a path is
//! allowed at all is decided by `paths`, not here.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::fs;
use tauri::AppHandle;

use crate::paths::{
    cannot, chosen, drop_highlights, in_spaces, move_highlights, note_from_outside, outside_spaces,
    write_atomically,
};

/// Reads a note, whatever folder it is in. Opening a file from outside the
/// spaces folder is the deliberate exception the app is built around, and it is
/// also what makes the pictures beside that file readable.
#[tauri::command]
pub fn read_note(app: AppHandle, path: String) -> Result<String, String> {
    let target = chosen(&path)?;
    let body = fs::read_to_string(&target).map_err(|error| cannot("read", &target, &error))?;

    if outside_spaces(&app, &target) {
        note_from_outside(&app, &target);
    }

    Ok(body)
}

/// Writes a note atomically, so a crash mid-write can never truncate the note
/// that was already there. Missing folders are created, which is what lets sync
/// land a note at a path that is new on this machine.
///
/// Like `read_note` this takes any path the reader chose: a note in a space, a
/// file opened from elsewhere, or the file an export was pointed at.
#[tauri::command]
pub fn write_note(path: String, content: String) -> Result<(), String> {
    write_file(&path, content.as_bytes())
}

/// Writes bytes, under exactly the checks the text writer is held to: any path
/// the reader chose, the folders above it made, and the file written whole.
///
/// An export is bytes as often as it is text - a Word file, an `ePub`, a
/// picture, a `TextPack`, the pictures inside a `TextBundle` - none of those go
/// through `write_note` without being mangled by the string.
///
/// Base64 rather than an array of numbers: a two megabyte picture written out as
/// JSON digits is twenty megabytes of text for the bridge to parse, and one
/// export is a document plus every picture in it.
#[tauri::command]
pub fn write_bytes(path: String, base64: String) -> Result<(), String> {
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|error| format!("{path} was handed something that is not base64: {error}"))?;

    write_file(&path, &bytes)
}

/// What both writers do once they have the bytes: make the folder, then write
/// the file whole. Atomic, so a crash mid-write can never truncate the file that
/// was already there; and the missing folders are made, which is what lets sync
/// land a note at a path that is new on this machine.
fn write_file(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = chosen(path)?;
    let parent = target
        .parent()
        .ok_or_else(|| format!("{path} has no folder to write into"))?;

    fs::create_dir_all(parent).map_err(|error| cannot("create", parent, &error))?;
    write_atomically(&target, bytes)
}

/// Deletes a note outright. The window sends almost everything to the trash
/// instead; this is for the cases that are already a copy, such as a file sync
/// has just replaced.
#[tauri::command]
pub fn delete_note(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_file(&target).map_err(|error| cannot("delete", &target, &error))?;

    // A PDF's highlights are part of that PDF and have nothing left to describe.
    drop_highlights(&target);
    Ok(())
}

/// Renames a note, which is also how it is moved: the new path can name a folder
/// that does not exist yet.
#[tauri::command]
pub fn rename_note(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = in_spaces(&app, &from)?;
    let target = in_spaces(&app, &to)?;

    // Two notes cannot share a path, and a rename that would overwrite one is a
    // mistake rather than an instruction. The check races with whatever else is
    // writing to the folder, which is as close as either platform gets: both
    // renames replace the target without asking.
    if target.exists() {
        return Err("something already lives there".into());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| cannot("create", parent, &error))?;
    }

    fs::rename(&source, &target).map_err(|error| cannot("rename", &source, &error))?;

    // A PDF's highlights follow it, so a rename or a move keeps them.
    move_highlights(&source, &target);
    Ok(())
}

/// Makes a folder inside a space, and every folder above it.
#[tauri::command]
pub fn create_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::create_dir_all(&target).map_err(|error| cannot("create", &target, &error))
}

/// Removes a folder and everything under it.
#[tauri::command]
pub fn delete_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_dir_all(&target).map_err(|error| cannot("delete", &target, &error))
}

#[cfg(test)]
mod tests {
    use super::{write_bytes, write_note};
    use std::fs;

    /// The bytes of a two by one PNG, which is a picture rather than text and so
    /// cannot go through the text writer at all.
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff];

    fn path(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().to_string()
    }

    #[test]
    fn writes_bytes_untouched() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the write to land");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }

    #[test]
    fn makes_the_folders_it_needs() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "Exports/deep/picture.png");

        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the write to land");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }

    #[test]
    fn refuses_a_path_that_names_no_file() {
        // The same check the text writer is held to; see paths::chosen.
        let error = write_bytes("/".to_string(), super::BASE64.encode(PNG))
            .expect_err("a root that is not a file");
        assert!(error.contains("does not name a file"), "{error}");
    }

    #[test]
    fn refuses_something_that_is_not_base64() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        let error = write_bytes(target.clone(), "not base64!!".to_string())
            .expect_err("nonsense to be refused");
        assert!(error.contains("not base64"), "{error}");
        assert!(
            !std::path::Path::new(&target).exists(),
            "nothing was written"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().expect("a temp folder");
        write_note(path(&dir, "note.md"), "hello".to_string()).expect("the write to land");
        write_bytes(path(&dir, "picture.png"), super::BASE64.encode(PNG)).expect("the write");

        let left: Vec<String> = fs::read_dir(dir.path())
            .expect("the folder")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".nib-tmp"))
            .collect();

        assert!(left.is_empty(), "{left:?}");
    }

    #[test]
    fn replaces_what_was_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        write_bytes(target.clone(), super::BASE64.encode(b"old")).expect("the first write");
        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the second write");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }
}
