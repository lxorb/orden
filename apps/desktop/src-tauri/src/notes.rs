//! A note is a file. This module owns the five things the window can ask of
//! one: read it, write it back, rename or move it, delete it, and make the
//! folder it is going to live in. Whether a path is allowed at all is decided by
//! `paths`, not here.

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
    let target = chosen(&path)?;
    let parent = target
        .parent()
        .ok_or_else(|| format!("{path} has no folder to write into"))?;

    fs::create_dir_all(parent).map_err(|error| cannot("create", parent, &error))?;
    write_atomically(&target, content.as_bytes())
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
