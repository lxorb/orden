//! The Mac's App Intents (swift/AddTask.swift): what Shortcuts calls into nib with. The
//! intent runs in the app's own process, started in the background where nib is not
//! running, so this answers without a window or a page: the task goes straight onto the
//! disk, and a space open in a window sees the note change like any other.
//!
//! **Which note** is the inbox of the space in front, which the page says whenever that
//! changes (`rememberInbox` in apps/desktop/src/lib/rows/inbox.ts) and this keeps in a
//! file, since the crate cannot read local storage and the app may not be open when a
//! task comes. Where nothing was said, or it is not in the spaces folder any more, the
//! inbox is `Inbox.md` in the first space on disk, alphabetical, the way the space list
//! orders them. Made where it is not there yet.
//!
//! **Whether to offer it** is the signature's call: the system lists an app's App
//! Intents in Shortcuts only when a developer team signed it, so Settings shows the
//! Shortcuts row only then (`offered`).

use std::ffi::{c_char, CStr};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use security_framework::os::macos::code_signing::{Flags, SecCode, SecRequirement};
use tauri::AppHandle;

use crate::paths::{
    config_dir, folder_named, in_spaces, inside, made, write_atomically, SPACES_DIR, TRASH,
};

/// The inbox of a space that says nothing else.
const INBOX: &str = "Inbox.md";

/// The file in the settings folder that holds the inbox of the space in front.
const FRONT: &str = "inbox.txt";

/// Whether the system offers nib's actions: an ad-hoc build (a probe, a build from
/// source) has no team, and Shortcuts lists nothing of it. Asked once, since a running
/// app's signature does not change under it.
pub fn offered() -> bool {
    static OFFERED: OnceLock<bool> = OnceLock::new();
    *OFFERED.get_or_init(signed_by_a_team)
}

/// True when the running code's certificate comes from Apple, which is what a team's
/// Apple Development or Developer ID certificate is and an ad-hoc signature is not.
fn signed_by_a_team() -> bool {
    let Ok(requirement) = "anchor apple generic".parse::<SecRequirement>() else {
        return false;
    };
    SecCode::for_self(Flags::NONE)
        .and_then(|code| code.check_validity(Flags::NONE, &requirement))
        .is_ok()
}

/// Keeps the inbox of the space in front, a note inside the spaces folder.
pub fn remember(app: &AppHandle, path: &str) -> Result<(), String> {
    let inbox = in_spaces(app, path)?;
    if inbox.extension().is_none_or(|one| one != "md") {
        return Err(format!("{path} is not a note"));
    }
    let dir = config_dir(app)?;
    made(&dir)?;
    write_atomically(&dir.join(FRONT), inbox.to_string_lossy().as_bytes())
}

/// Called by `AddTaskIntent.perform`: appends `- [ ] <text>` to the inbox. Answers 0
/// when the task is written, 1 when it is not.
///
/// Unsafe, excepted by name: the Swift side hands a C string, which is read here and
/// nowhere else, for as long as the call lasts.
#[allow(unsafe_code)]
#[no_mangle]
pub extern "C" fn nib_add_to_inbox(text: *const c_char) -> i32 {
    if text.is_null() {
        return 1;
    }
    // SAFETY: not null, and Swift's `withCString` keeps it valid and terminated for
    // the whole call.
    let text = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let front = crate::mcp::home::config_dir()
        .and_then(|dir| fs::read_to_string(dir.join(FRONT)).ok())
        .map(|said| PathBuf::from(said.trim()));
    match spaces_dir().and_then(|spaces| add_to_inbox(&spaces, front.as_deref(), &text)) {
        Ok(_) => 0,
        Err(error) => {
            eprintln!("siri: no task added: {error}");
            1
        }
    }
}

/// Writes the task into the inbox; answers the note it went to.
fn add_to_inbox(spaces: &Path, front: Option<&Path>, text: &str) -> Result<PathBuf, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("no words".to_owned());
    }
    let inbox = inbox_in(spaces, front)?;
    let before = match fs::read_to_string(&inbox) {
        Ok(before) => before,
        Err(error) if error.kind() == ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("could not read {}: {error}", inbox.display())),
    };
    fs::write(&inbox, appended(&before, &format!("- [ ] {text}")))
        .map_err(|error| format!("could not write {}: {error}", inbox.display()))?;
    Ok(inbox)
}

/// The inbox the page named, while it is still in a space under `spaces` and its folder
/// is there; else the first space's `Inbox.md`.
fn inbox_in(spaces: &Path, front: Option<&Path>) -> Result<PathBuf, String> {
    let named = front.filter(|path| {
        inside(spaces, path)
            && !inside(&spaces.join(TRASH), path)
            && path
                .parent()
                .is_some_and(|folder| folder != spaces && folder.is_dir())
    });
    match named {
        Some(path) => Ok(path.to_path_buf()),
        None => Ok(default_space(spaces)?.join(INBOX)),
    }
}

/// The folder every space lives in: `NIB_SPACES_DIR`, else `Documents/Nib`.
fn spaces_dir() -> Result<PathBuf, String> {
    if let Some(named) = folder_named(std::env::var_os(SPACES_DIR).as_deref()) {
        return Ok(named);
    }
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .map(|base| base.join("Nib"))
        .ok_or_else(|| "no documents folder".to_owned())
}

/// The first space, alphabetical, as the space list orders them.
fn default_space(spaces: &Path) -> Result<PathBuf, String> {
    let entries = fs::read_dir(spaces)
        .map_err(|error| format!("could not read {}: {error}", spaces.display()))?;
    entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .min_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase())
        .map(|entry| entry.path())
        .ok_or_else(|| format!("no space in {}", spaces.display()))
}

/// The note with the line at its end, the way quick add places a task that names no
/// heading (`placeIn` in packages/bases/src/agent/entry.ts): under a list that ends the
/// note, else after a blank line.
fn appended(note: &str, line: &str) -> String {
    let eol = if note.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = note
        .split('\n')
        .map(|one| one.trim_end_matches('\r'))
        .collect();
    let Some(last) = lines.iter().rposition(|one| !one.trim().is_empty()) else {
        return format!("{line}{eol}");
    };
    let kept: usize = lines[..=last].iter().map(|one| one.len()).sum::<usize>() + last * eol.len();
    let gap = if ends_in_list(&lines[..=last]) {
        eol.to_owned()
    } else {
        eol.repeat(2)
    };
    format!("{}{gap}{line}{}", &note[..kept], &note[kept..])
}

/// True when the last words of the note belong to a list item.
fn ends_in_list(lines: &[&str]) -> bool {
    for line in lines.iter().rev() {
        if line.trim().is_empty() {
            return false;
        }
        if is_item(line) {
            return true;
        }
        // An indented line is a description or a sub-item; the item is above.
        if !line.starts_with([' ', '\t']) {
            return false;
        }
    }
    false
}

fn is_item(line: &str) -> bool {
    let rest = line.strip_prefix(['-', '*', '+']).or_else(|| {
        let digits = line.trim_start_matches(|c: char| c.is_ascii_digit());
        (digits.len() < line.len())
            .then_some(digits)?
            .strip_prefix(['.', ')'])
    });
    rest.is_some_and(|rest| rest.starts_with([' ', '\t']))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_task_lands_at_the_end_of_the_inbox() {
        assert_eq!(appended("", "- [ ] a"), "- [ ] a\n");
        assert_eq!(appended("- [ ] a\n", "- [ ] b"), "- [ ] a\n- [ ] b\n");
        assert_eq!(appended("# Inbox\n", "- [ ] b"), "# Inbox\n\n- [ ] b\n");
        assert_eq!(
            appended("1. a\n  more\n\n", "- [ ] b"),
            "1. a\n  more\n- [ ] b\n\n"
        );
        assert_eq!(appended("- [ ] a\r\n", "- [ ] b"), "- [ ] a\r\n- [ ] b\r\n");
    }

    #[test]
    fn the_default_space_is_the_first_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        for name in [".trash", "Work", "notes"] {
            fs::create_dir(dir.path().join(name)).unwrap();
        }
        assert_eq!(default_space(dir.path()).unwrap(), dir.path().join("notes"));
    }

    #[test]
    fn a_task_is_written_as_an_open_item() {
        let dir = tempfile::tempdir().unwrap();
        let space = dir.path().join("Notes");
        fs::create_dir(&space).unwrap();
        fs::write(space.join(INBOX), "# Inbox\n").unwrap();

        let inbox = add_to_inbox(dir.path(), None, "  buy\n milk ").unwrap();
        assert_eq!(inbox, space.join(INBOX));
        assert_eq!(
            fs::read_to_string(&inbox).unwrap(),
            "# Inbox\n\n- [ ] buy milk\n"
        );
    }

    #[test]
    fn a_missing_inbox_is_made() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("Notes")).unwrap();
        let inbox = add_to_inbox(dir.path(), None, "milk").unwrap();
        assert_eq!(fs::read_to_string(inbox).unwrap(), "- [ ] milk\n");
    }

    #[test]
    fn the_task_goes_to_the_inbox_of_the_space_in_front() {
        let dir = tempfile::tempdir().unwrap();
        let work = dir.path().join("Work").join("Lists");
        fs::create_dir_all(&work).unwrap();
        fs::create_dir(dir.path().join("Notes")).unwrap();
        let front = work.join("Todo.md");

        let inbox = add_to_inbox(dir.path(), Some(&front), "milk").unwrap();
        assert_eq!(inbox, front);
        assert_eq!(fs::read_to_string(front).unwrap(), "- [ ] milk\n");
    }

    #[test]
    fn an_inbox_that_is_gone_falls_back_to_the_first_space() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(TRASH).join("Old")).unwrap();
        fs::create_dir(dir.path().join("Notes")).unwrap();
        let first = dir.path().join("Notes").join(INBOX);
        let outside = tempfile::tempdir().unwrap();

        for front in [
            outside.path().join("Work").join(INBOX),
            dir.path().join(TRASH).join("Old").join(INBOX),
            dir.path().join("Gone").join(INBOX),
            dir.path().join(INBOX),
        ] {
            assert_eq!(inbox_in(dir.path(), Some(&front)).unwrap(), first);
        }
    }

    #[test]
    fn an_ad_hoc_build_is_not_offered_the_shortcuts() {
        // The test binary is signed the way a build from source is: ad hoc, by the linker.
        assert!(!signed_by_a_team());
    }

    #[test]
    fn nothing_is_written_without_words_or_a_space() {
        let dir = tempfile::tempdir().unwrap();
        assert!(add_to_inbox(dir.path(), None, "milk").is_err());
        fs::create_dir(dir.path().join("Notes")).unwrap();
        assert!(add_to_inbox(dir.path(), None, " \n ").is_err());
        assert!(!dir.path().join("Notes").join(INBOX).exists());
    }
}
