//! Everything that goes through pandoc: reading a Word or ODT file in as
//! markdown, and writing a note out as one of the formats pandoc knows. Typora
//! shells out for the same jobs, and the formats are pandoc's rather than ours.
//!
//! Nothing here assumes pandoc is installed. `has_pandoc` is what the window asks
//! before it offers any of it.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// What a document is read in as: plain markdown plus the few extensions the
/// editor itself understands, so nothing comes back that cannot be shown.
const READ_AS: &str =
    "markdown_strict+pipe_tables+backtick_code_blocks+strikeout+task_lists+tex_math_dollars";

/// What a note is written out from, which is what the editor writes.
const WRITE_FROM: &str = "markdown+tex_math_dollars+pipe_tables+task_lists+footnotes+strikeout";

/// Keeps a console window from flashing up on Windows.
// `mut` is only used by the Windows branch below; elsewhere it is dead.
#[cfg_attr(not(windows), allow(unused_mut))]
fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    command
}

/// Whether pandoc is on this machine, which is what decides the export list.
#[tauri::command]
pub fn has_pandoc() -> bool {
    command("pandoc")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// Converts a document into markdown with pandoc. The format comes from the
/// file's extension, which is what pandoc infers from anyway.
///
/// Pictures inside the document are written out beside it rather than into
/// whichever folder the app happens to have been started in, which for an app
/// launched from its own shortcut is a folder nobody would think to look in.
#[tauri::command]
pub fn import_document(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    let beside = source
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{path} is not in a folder Nib can write to"))?;

    let result = command("pandoc")
        .current_dir(&beside)
        .args([
            "--to",
            READ_AS,
            "--wrap",
            "none",
            "--extract-media",
            ".",
            &path,
        ])
        .output()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    if result.status.success() {
        return String::from_utf8(result.stdout)
            .map_err(|error| format!("pandoc returned something that is not text: {error}"));
    }

    Err(complaint(&result.stderr, "pandoc could not read that file"))
}

/// Converts markdown with pandoc, the same way Typora does. The source is piped
/// in rather than written to a temp file, so nothing is left behind.
#[tauri::command]
pub fn run_pandoc(source: String, output: String, format: String) -> Result<(), String> {
    let mut child = command("pandoc")
        .args([
            "--from",
            WRITE_FROM,
            "--to",
            &format,
            "--standalone",
            "--output",
            &output,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    let mut sink = child.stdin.take().ok_or("could not write to pandoc")?;

    // On its own thread, because pandoc writes as it reads: a long note plus a
    // pandoc with plenty to say would otherwise be two programs each waiting for
    // the other to take what it has written.
    let writer = std::thread::spawn(move || sink.write_all(source.as_bytes()));

    let result = child
        .wait_with_output()
        .map_err(|error| format!("pandoc did not finish: {error}"))?;
    let written = writer
        .join()
        .map_err(|_| "the thread feeding pandoc stopped".to_string())?;

    if result.status.success() {
        // Pandoc is happy, so it read what it needed; a write that failed at the
        // very end is still worth saying out loud.
        return written.map_err(|error| format!("could not send the note to pandoc: {error}"));
    }

    Err(complaint(&result.stderr, "pandoc failed"))
}

/// What pandoc said, or a sentence of our own when it said nothing.
fn complaint(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr);

    if message.trim().is_empty() {
        fallback.to_string()
    } else {
        message.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::complaint;

    #[test]
    fn repeats_what_pandoc_said() {
        assert_eq!(
            complaint(b"  no such format\n", "fallback"),
            "no such format"
        );
    }

    #[test]
    fn says_something_when_pandoc_said_nothing() {
        assert_eq!(complaint(b"", "pandoc failed"), "pandoc failed");
        assert_eq!(complaint(b"   \n", "pandoc failed"), "pandoc failed");
    }

    #[test]
    fn survives_output_that_is_not_utf8() {
        assert_eq!(complaint(&[0xff, b'a'], "pandoc failed"), "\u{fffd}a");
    }
}
