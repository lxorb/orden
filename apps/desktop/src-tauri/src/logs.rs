//! The app's own log: one file in the app's log folder, one line per message,
//! written by the window rather than from here. This module owns the file, its
//! size and the shape of a line.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::paths::{cannot, made};

/// Anything past this and the file is rolled over, so a loop cannot fill a disk.
const MAX_BYTES: u64 = 1024 * 1024;

/// How much of one message is kept. A stack trace is welcome; a whole document
/// pasted into a log line is not.
const MAX_MESSAGE: usize = 2000;

/// How much of the level and the timestamp is kept. Both come from the window and
/// both belong in one column.
const MAX_FIELD: usize = 40;

/// Where the log file is, so the window can offer to open it.
///
/// The folder is made if it is not there yet, so this waits for the disk.
#[tauri::command(async)]
pub fn log_dir(app: AppHandle) -> Result<String, String> {
    Ok(log_file(&app)?.to_string_lossy().to_string())
}

/// Appends one line. `at` comes from the caller so the timestamp matches the
/// clock the message was written by.
#[tauri::command]
pub fn write_log(app: AppHandle, level: String, message: String, at: String) -> Result<(), String> {
    let path = log_file(&app)?;

    // One previous file is kept, which is enough to span a crash and a restart.
    if fs::metadata(&path).map_or(0, |one| one.len()) > MAX_BYTES {
        let _ = fs::rename(&path, path.with_extension("log.1"));
    }

    // Every field is folded onto one line, the timestamp included: a newline in
    // any of them would otherwise pass itself off as a second entry.
    let line = format!(
        "{} {:<5} {}\n",
        one_line(&at, MAX_FIELD),
        one_line(&level.to_uppercase(), MAX_FIELD),
        one_line(&message, MAX_MESSAGE)
    );

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| cannot("write", &path, &error))?;

    file.write_all(line.as_bytes())
        .map_err(|error| cannot("write", &path, &error))
}

/// The log as it stands. A log folder that cannot even be found, or a file that
/// cannot be read, reads as empty: the window asking has nothing better to show
/// either way, and a log is not worth an error of its own.
#[tauri::command(async)]
pub fn read_log(app: AppHandle) -> String {
    log_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
}

/// The log file, in a folder that exists by the time this returns.
fn log_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("could not find the log folder: {error}"))?;

    made(&dir)?;
    Ok(dir.join("nib.log"))
}

/// A log line is one line, so a stack trace cannot pass itself off as several
/// separate entries.
fn one_line(message: &str, limit: usize) -> String {
    message
        .replace(['\r', '\n'], " ⏎ ")
        .chars()
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{one_line, MAX_MESSAGE};

    #[test]
    fn folds_a_message_onto_one_line() {
        assert_eq!(one_line("a\nb\r\nc", MAX_MESSAGE), "a ⏎ b ⏎  ⏎ c");
        assert_eq!(one_line("plain", MAX_MESSAGE), "plain");
    }

    #[test]
    fn caps_how_long_a_line_can_get() {
        assert_eq!(
            one_line(&"x".repeat(5000), MAX_MESSAGE).chars().count(),
            MAX_MESSAGE
        );
    }

    #[test]
    fn a_timestamp_cannot_forge_a_second_entry() {
        assert_eq!(
            one_line("2026-01-01\nINFO  something else", 40),
            "2026-01-01 ⏎ INFO  something else"
        );
    }
}
