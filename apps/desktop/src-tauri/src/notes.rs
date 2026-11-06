use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::fs;
use std::io::Read as _;
use std::path::Path;
use tauri::AppHandle;

#[cfg(any(target_os = "macos", test))]
pub mod icloud;

use crate::carry::{copy_whole, move_whole};
use crate::clock;
use crate::paths::{
    at_most, at_most_stamped, cannot, chosen, copy_held, drop_held, in_spaces, is_pdf, made,
    move_held, move_paper, named_for_every_machine, openable, paper_in_the_way, spaces_dir,
    write_in_place,
};

pub const MOST_NOTE_BYTES: u64 = 64 * 1024 * 1024;

pub const TOO_LARGE: &str = "that note is too large";

#[tauri::command(async)]
pub fn read_note(app: AppHandle, path: String) -> Result<String, String> {
    let target = openable(&app, &path)?;
    #[cfg(target_os = "macos")]
    icloud::fetched(&app, &target)?;
    words_of(&target)
}

pub fn words_of(target: &Path) -> Result<String, String> {
    let bytes = at_most(target, MOST_NOTE_BYTES)?.ok_or(TOO_LARGE)?;
    String::from_utf8(bytes)
        .map(unmarked)
        .map_err(|error| cannot("read", target, &error))
}

const MARK: char = '\u{feff}';

fn unmarked(words: String) -> String {
    match words.strip_prefix(MARK) {
        Some(rest) => rest.to_owned(),
        None => words,
    }
}

pub fn words_stamped(target: &Path) -> Result<(String, fs::Metadata), String> {
    let (bytes, meta) = at_most_stamped(target, MOST_NOTE_BYTES)?.ok_or(TOO_LARGE)?;
    let words = String::from_utf8(bytes).map_err(|error| cannot("read", target, &error))?;
    Ok((unmarked(words), meta))
}

#[tauri::command(async)]
pub fn write_note(
    app: AppHandle,
    path: String,
    content: String,
    arrived: Option<bool>,
) -> Result<(), String> {
    let target = chosen(&app, &path)?;
    if !may_arrive(arrived) && !target.exists() && target.starts_with(spaces_dir(&app)?) {
        named_for_every_machine(&target)?;
    }
    note_written(&target, &path, &content)
}

fn note_written(target: &Path, shown: &str, content: &str) -> Result<(), String> {
    let body = as_written(target, content);
    write_file(target, shown, body.as_bytes())
}

fn as_written(target: &Path, content: &str) -> String {
    let body = if crlf(target) {
        content.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        content.to_owned()
    };

    if marked(target) && !body.starts_with(MARK) {
        format!("{MARK}{body}")
    } else {
        body
    }
}

fn marked(target: &Path) -> bool {
    let Ok(mut file) = fs::File::open(target) else {
        return false;
    };
    let mut head = [0_u8; 3];
    file.read_exact(&mut head).is_ok() && head == [0xEF, 0xBB, 0xBF]
}

fn crlf(target: &Path) -> bool {
    let Ok(file) = fs::File::open(target) else {
        return false;
    };

    let mut head = [0_u8; HEAD];
    let Ok(read) = (&file).take(HEAD as u64).read(&mut head) else {
        return false;
    };

    head[..read]
        .iter()
        .position(|byte| *byte == b'\n')
        .is_some_and(|at| at > 0 && head[at - 1] == b'\r')
}

const HEAD: usize = 8192;

#[tauri::command(async)]
pub fn write_bytes(app: AppHandle, path: String, base64: String) -> Result<(), String> {
    bytes_written(&chosen(&app, &path)?, &path, &base64)
}

fn bytes_written(target: &Path, shown: &str, base64: &str) -> Result<(), String> {
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|error| format!("{shown} was handed something that is not base64: {error}"))?;

    write_file(target, shown, &bytes)
}

fn write_file(target: &Path, shown: &str, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{shown} has no folder to write into"))?;

    made(parent)?;
    write_in_place(target, bytes)
}

#[tauri::command(async)]
pub fn delete_note(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_file(&target).map_err(|error| cannot("delete", &target, &error))?;

    drop_held(&target);
    Ok(())
}

#[tauri::command(async)]
pub fn rename_note(
    app: AppHandle,
    from: String,
    to: String,
    hold: Option<bool>,
    alone: Option<bool>,
    arrived: Option<bool>,
) -> Result<(), String> {
    let source = in_spaces(&app, &from)?;
    let target = in_spaces(&app, &to)?;
    renamed_as(
        &source,
        &target,
        hold == Some(true),
        alone == Some(true),
        may_arrive(arrived),
    )
}

#[cfg(test)]
fn renamed(source: &Path, target: &Path, hold: bool, alone: bool) -> Result<(), String> {
    renamed_as(source, target, hold, alone, false)
}

fn renamed_as(
    source: &Path,
    target: &Path,
    hold: bool,
    alone: bool,
    arrived: bool,
) -> Result<(), String> {
    let respelling = respelled(source, target, same_entry);
    if !arrived && source.file_name() != target.file_name() {
        named_for_every_machine(target)?;
    }

    let holding = hold && is_pdf(target) && source.parent() == target.parent();
    if let Some(there) = paper_in_the_way(source, target, same_entry).filter(|_| !holding) {
        return Err(format!("{} is already there", there.display()));
    }

    move_entry(source, target, respelling)?;

    if alone {
        move_paper(source, target);
    } else {
        move_held(source, target);
    }
    Ok(())
}

pub(crate) fn respelled(source: &Path, target: &Path, same: impl Fn(&Path, &Path) -> bool) -> bool {
    source != target && source.parent() == target.parent() && same(source, target)
}

#[cfg(unix)]
pub(crate) fn same_entry(one: &Path, other: &Path) -> bool {
    use std::os::unix::fs::MetadataExt as _;

    match (fs::symlink_metadata(one), fs::symlink_metadata(other)) {
        (Ok(one), Ok(other)) => {
            one.dev() == other.dev()
                && one.ino() == other.ino()
                && (one.is_dir() || one.nlink() == 1)
        }
        _ => false,
    }
}

#[cfg(not(unix))]
pub(crate) fn same_entry(one: &Path, other: &Path) -> bool {
    match (fs::canonicalize(one), fs::canonicalize(other)) {
        (Ok(one), Ok(other)) => one == other,
        _ => false,
    }
}

pub(crate) fn move_entry(source: &Path, target: &Path, respelling: bool) -> Result<(), String> {
    if respelling {
        return respell(source, target);
    }

    if target.exists() {
        return Err("something already lives there".into());
    }

    if let Some(parent) = target.parent() {
        made(parent)?;
    }

    move_whole(source, target, "rename")
}

fn respell(source: &Path, target: &Path) -> Result<(), String> {
    let step = stepping_name(source)
        .ok_or_else(|| format!("{} has no name to rename", source.display()))?;
    if fs::symlink_metadata(&step).is_ok() {
        return Err("something already lives there".into());
    }

    fs::rename(source, &step).map_err(|error| cannot("rename", source, &error))?;

    fs::rename(&step, target).map_err(|error| {
        let _ = fs::rename(&step, source);
        cannot("rename", source, &error)
    })
}

fn stepping_name(source: &Path) -> Option<std::path::PathBuf> {
    let mut name = std::ffi::OsString::from(".");
    name.push(source.file_name()?);
    name.push(".nib-renaming");
    Some(source.with_file_name(name))
}

#[tauri::command(async)]
pub fn copy_path(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = in_spaces(&app, &from)?;
    let target = in_spaces(&app, &to)?;
    copied(&source, &target)
}

fn copied(source: &Path, target: &Path) -> Result<(), String> {
    named_for_every_machine(target)?;

    if target.starts_with(source) {
        return Err(format!("{} cannot be copied into itself", source.display()));
    }

    if let Some(there) = paper_in_the_way(source, target, same_entry) {
        return Err(format!("{} is already there", there.display()));
    }

    if let Some(parent) = target.parent() {
        made(parent)?;
    }

    copy_whole(source, target)?;

    copy_held(source, target);
    Ok(())
}

#[tauri::command(async)]
pub fn create_folder(app: AppHandle, path: String, arrived: Option<bool>) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    if may_arrive(arrived) {
        return made(&target);
    }
    folder_made(&target)
}

fn folder_made(target: &Path) -> Result<(), String> {
    for folder in target.ancestors().take_while(|folder| !folder.exists()) {
        named_for_every_machine(folder)?;
    }
    made(target)
}

#[tauri::command(async)]
pub fn delete_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_dir_all(&target).map_err(|error| cannot("delete", &target, &error))
}

#[tauri::command(async)]
pub fn remove_empty_folder(app: AppHandle, path: String) -> Result<(), String> {
    let target = in_spaces(&app, &path)?;
    fs::remove_dir(&target).map_err(|error| cannot("delete", &target, &error))
}

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Stamp {
    pub modified: u64,
    pub len: u64,
}

#[tauri::command(async)]
pub fn file_stamp(app: AppHandle, path: String) -> Result<Option<Stamp>, String> {
    Ok(stamp_of(&openable(&app, &path)?))
}

fn may_arrive(arrived: Option<bool>) -> bool {
    arrived == Some(true) && !cfg!(windows)
}

#[tauri::command(async)]
pub fn file_there(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(there_or_unsure(&openable(&app, &path)?))
}

fn there_or_unsure(target: &Path) -> bool {
    match fs::symlink_metadata(target) {
        Ok(_) => true,
        Err(error) => !crate::space_watch::says_gone(&error),
    }
}

#[tauri::command(async)]
pub fn note_evicted(app: AppHandle, path: String) -> Result<bool, String> {
    let target = openable(&app, &path)?;
    #[cfg(target_os = "macos")]
    return Ok(icloud::evicted(&target));
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Ok(false)
    }
}

#[tauri::command(async)]
pub fn path_taken(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(taken(&chosen(&app, &path)?))
}

fn taken(target: &Path) -> bool {
    fs::symlink_metadata(target).is_ok()
}

#[must_use]
pub fn stamp_of(target: &Path) -> Option<Stamp> {
    let data = fs::metadata(target).ok()?;
    if !data.is_file() {
        return None;
    }

    Some(Stamp {
        modified: clock::of(data.modified().ok()),
        len: data.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::{copied, folder_made, move_entry, renamed, respelled, Stamp};
    use base64::Engine;
    use std::fs;
    use std::path::Path;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff];

    fn path(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().to_string()
    }

    fn write_bytes(path: String, base64: String) -> Result<(), String> {
        super::bytes_written(Path::new(&path), &path, &base64)
    }

    fn write_note(path: String, content: String) -> Result<(), String> {
        super::note_written(Path::new(&path), &path, &content)
    }

    #[test]
    fn a_name_windows_keeps_lands_when_it_arrived_and_not_when_it_is_new() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let from = dir.path().join("plain.md");
        fs::write(&from, "words").expect("the file");
        let to = dir.path().join("Con.md");

        assert!(super::renamed(&from, &to, false, false).is_err());
        assert!(!super::may_arrive(None));
        if cfg!(windows) {
            assert!(!super::may_arrive(Some(true)));
        } else {
            assert!(super::may_arrive(Some(true)));
            super::renamed_as(&from, &to, false, false, true).expect("it arrived under that name");
            assert!(to.exists());
        }
    }

    #[test]
    fn a_path_nobody_could_look_at_is_not_gone() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let file = dir.path().join("note.md");
        assert!(!super::there_or_unsure(&file));
        fs::write(&file, b"words").expect("the file");
        assert!(super::there_or_unsure(&file));
        assert!(
            !super::there_or_unsure(&file.join("under.md")),
            "a file where a folder was is gone too"
        );
        assert!(
            !super::there_or_unsure(&dir.path().join("x".repeat(300))),
            "a name no disk holds is nothing there"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let shut = dir.path().join("shut");
            fs::create_dir(&shut).expect("a folder");
            fs::set_permissions(&shut, fs::Permissions::from_mode(0o000)).expect("locked");
            if fs::read_dir(&shut).is_err() {
                assert!(super::there_or_unsure(&shut.join("note.md")));
            }
            fs::set_permissions(&shut, fs::Permissions::from_mode(0o755)).expect("opened");
        }
    }

    fn file_stamp(path: &str) -> Option<Stamp> {
        super::stamp_of(Path::new(path))
    }

    #[test]
    fn a_name_is_taken_by_a_file_or_a_folder_and_free_otherwise() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::write(dir.path().join("image.png"), PNG).expect("the picture");
        fs::create_dir(dir.path().join("assets")).expect("the folder");

        assert!(super::taken(&dir.path().join("image.png")));
        assert!(super::taken(&dir.path().join("assets")));
        assert!(!super::taken(&dir.path().join("image 2.png")));
    }

    #[test]
    fn copies_a_file_byte_for_byte() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("picture.png");
        fs::write(&source, PNG).expect("the picture");

        copied(&source, &dir.path().join("Copies/picture.png")).expect("the copy");
        assert_eq!(
            fs::read(dir.path().join("Copies/picture.png")).expect("the copy back"),
            PNG
        );
        assert_eq!(fs::read(&source).expect("the original"), PNG);
    }

    #[test]
    fn copies_a_folder_with_what_the_list_leaves_out() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Trip");
        fs::create_dir_all(source.join("assets")).expect("the folders");
        fs::write(source.join("Trip.md"), "# Trip").expect("the note");
        fs::write(source.join("assets/map.png"), PNG).expect("the picture");
        fs::write(source.join(".hidden"), "kept").expect("the dotted file");

        let target = dir.path().join("Trip copy");
        copied(&source, &target).expect("the copy");

        assert_eq!(
            fs::read_to_string(target.join("Trip.md")).expect("note"),
            "# Trip"
        );
        assert_eq!(
            fs::read(target.join("assets/map.png")).expect("picture"),
            PNG
        );
        assert_eq!(
            fs::read_to_string(target.join(".hidden")).expect("dotted"),
            "kept"
        );
    }

    #[test]
    fn copies_a_papers_highlights_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("paper.pdf");
        fs::write(&source, b"%PDF").expect("the paper");
        fs::write(dir.path().join("paper.pdf.highlights.json"), "[]").expect("highlights");

        copied(&source, &dir.path().join("paper copy.pdf")).expect("the copy");
        assert!(dir.path().join("paper copy.pdf.highlights.json").exists());
    }

    #[test]
    fn a_page_note_copied_never_takes_a_pdf_already_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::create_dir_all(dir.path().join("A")).expect("A");
        fs::create_dir_all(dir.path().join("B")).expect("B");
        let source = dir.path().join("A/Report.pages");
        fs::write(&source, "{}").expect("the page note");
        fs::write(dir.path().join("A/Report.pages.pdf"), b"%PDF ours").expect("its paper");
        let theirs = dir.path().join("B/Report.pages.pdf");
        fs::write(&theirs, b"%PDF theirs").expect("somebody's PDF");

        let error = copied(&source, &dir.path().join("B/Report.pages"))
            .expect_err("a name whose paper is taken to be refused");
        assert!(error.contains("already there"), "{error}");
        assert!(!dir.path().join("B/Report.pages").exists());
        assert_eq!(fs::read(&theirs).expect("theirs"), b"%PDF theirs");
    }

    #[test]
    fn a_pdf_copied_never_becomes_a_page_notes_paper() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::create_dir_all(dir.path().join("A")).expect("A");
        fs::create_dir_all(dir.path().join("B")).expect("B");
        let source = dir.path().join("A/Report.pages.pdf");
        fs::write(&source, b"%PDF mine").expect("somebody's PDF");
        fs::write(dir.path().join("B/Report.pages"), "{}").expect("a page note");

        let error = copied(&source, &dir.path().join("B/Report.pages.pdf"))
            .expect_err("a PDF a page note would hold to be refused");
        assert!(error.contains("already there"), "{error}");
        assert!(!dir.path().join("B/Report.pages.pdf").exists());
    }

    #[test]
    fn a_pdf_copied_beside_a_page_note_of_its_name_is_refused() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Old.pdf");
        fs::write(&source, b"%PDF old").expect("a PDF");
        fs::write(dir.path().join("Report.pages"), "{}").expect("a page note");

        let error = copied(&source, &dir.path().join("Report.pages.pdf"))
            .expect_err("a PDF a page note would hold to be refused");
        assert!(error.contains("already there"), "{error}");
        assert!(!dir.path().join("Report.pages.pdf").exists());
    }

    #[test]
    fn never_writes_over_anything() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::write(dir.path().join("a.md"), "a").expect("a");
        fs::write(dir.path().join("b.md"), "b").expect("b");

        let error = copied(&dir.path().join("a.md"), &dir.path().join("b.md"))
            .expect_err("a taken name to be refused");
        assert!(error.contains("already lives there"), "{error}");
        assert_eq!(fs::read_to_string(dir.path().join("b.md")).expect("b"), "b");
    }

    #[test]
    fn a_copy_that_cannot_finish_leaves_nothing_behind() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Trip");
        fs::create_dir_all(source.join("assets")).expect("the folders");
        fs::write(source.join("Trip.md"), "# Trip").expect("a note");
        fs::write(source.join("assets/map.png"), PNG).expect("a picture");
        let held = source.join("assets/scan.png");
        fs::write(&held, PNG).expect("a picture nobody may read");
        let Some(_held) = crate::carry::unreadable(&held) else {
            return;
        };

        let target = dir.path().join("Trip copy");
        assert!(copied(&source, &target).is_err());
        assert!(!target.exists(), "half a folder was left behind");
        assert_eq!(
            fs::read(source.join("assets/map.png")).expect("the original"),
            PNG
        );
    }

    #[test]
    fn refuses_a_folder_into_itself() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Trip");
        fs::create_dir_all(&source).expect("the folder");

        let error = copied(&source, &source.join("Trip")).expect_err("a copy into itself");
        assert!(error.contains("into itself"), "{error}");
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
        let error = write_bytes("/".to_string(), super::BASE64.encode(PNG))
            .expect_err("a root that is not a file");
        assert!(error.contains("has no folder to write into"), "{error}");
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
            .filter(|name| name.ends_with(".nib.tmp"))
            .collect();

        assert!(left.is_empty(), "{left:?}");
    }

    #[test]
    fn every_save_is_the_same_file() {
        use std::io::{Read as _, Seek as _};

        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "Hackathon List.md");
        write_note(target.clone(), "# Hackathon List\n".to_string()).expect("the first save");

        let mut held = fs::File::open(&target).expect("a reader holding the note");
        let mut text = "# Hackathon List\n".to_string();
        for line in ["- one", "- two that is longer", "- 3"] {
            text.push_str(line);
            text.push('\n');
            write_note(target.clone(), text.clone()).expect("a save");
        }
        write_note(target.clone(), "short\n".to_string()).expect("a save that shrinks it");

        let mut through = String::new();
        held.rewind().expect("back to the start");
        held.read_to_string(&mut through).expect("the held file");
        assert_eq!(through, "short\n", "the held file is no longer the note");

        let left: Vec<String> = fs::read_dir(dir.path())
            .expect("the folder")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, ["Hackathon List.md"]);
    }

    #[test]
    fn replaces_what_was_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "picture.png");

        write_bytes(target.clone(), super::BASE64.encode(b"old")).expect("the first write");
        write_bytes(target.clone(), super::BASE64.encode(PNG)).expect("the second write");
        assert_eq!(fs::read(&target).expect("the file back"), PNG);
    }

    #[test]
    fn keeps_the_line_endings_a_file_already_had() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "windows.md");

        fs::write(&target, b"one\r\ntwo\r\n").expect("the file to start out with CRLF");
        write_note(target.clone(), "one\ntwo!\n".to_string()).expect("the write to land");

        assert_eq!(
            fs::read(&target).expect("the file back"),
            b"one\r\ntwo!\r\n"
        );
    }

    #[test]
    fn reads_a_note_past_its_mark_and_writes_the_mark_back() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "notepad.md");

        fs::write(&target, b"\xEF\xBB\xBF# Title\r\nwords\r\n").expect("a marked file");
        let read = super::words_of(std::path::Path::new(&target)).expect("the words");
        assert_eq!(read, "# Title\r\nwords\r\n");
        assert_eq!(
            super::words_stamped(std::path::Path::new(&target))
                .expect("the words")
                .0,
            "# Title\r\nwords\r\n"
        );

        write_note(target.clone(), "# Title\nwords!\n".to_string()).expect("the write to land");
        assert_eq!(
            fs::read(&target).expect("the file back"),
            b"\xEF\xBB\xBF# Title\r\nwords!\r\n"
        );
    }

    #[test]
    fn gives_a_file_with_no_mark_none() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "plain.md");

        write_note(target.clone(), "one\n".to_string()).expect("a new note");
        write_note(target.clone(), "two\n".to_string()).expect("a second write");
        assert_eq!(fs::read(&target).expect("the file back"), b"two\n");
        fs::write(&target, b"\xEF\xBB").expect("a file too short for one");
        write_note(target.clone(), "three\n".to_string()).expect("a third write");
        assert_eq!(fs::read(&target).expect("the file back"), b"three\n");
    }

    #[test]
    fn leaves_a_file_written_with_newlines_alone() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "unix.md");

        fs::write(&target, b"one\ntwo\n").expect("the file to start out with LF");
        write_note(target.clone(), "one\ntwo!\n".to_string()).expect("the write to land");

        assert_eq!(fs::read(&target).expect("the file back"), b"one\ntwo!\n");
    }

    #[test]
    fn writes_a_new_file_with_newlines() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "fresh.md");

        write_note(target.clone(), "one\ntwo\n".to_string()).expect("the write to land");
        assert_eq!(fs::read(&target).expect("the file back"), b"one\ntwo\n");
    }

    #[test]
    fn never_doubles_a_carriage_return() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "mixed.md");

        fs::write(&target, b"one\r\n").expect("the file to start out with CRLF");
        write_note(target.clone(), "one\r\ntwo\n".to_string()).expect("the write to land");

        assert_eq!(fs::read(&target).expect("the file back"), b"one\r\ntwo\r\n");
    }

    #[test]
    fn reads_only_the_head_of_a_file_to_answer() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "long.md");

        let mut body = "x".repeat(super::HEAD * 2).into_bytes();
        body.extend_from_slice(b"\r\nafter\r\n");
        fs::write(&target, &body).expect("a long first line");

        assert!(!super::crlf(std::path::Path::new(&target)));
    }

    #[test]
    fn stamps_a_file_and_says_nothing_of_one_that_is_not_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = path(&dir, "watched.md");

        assert!(file_stamp(&target).is_none());

        fs::write(&target, b"words").expect("the file");
        let stamp = file_stamp(&target).expect("a file that is there");

        assert_eq!(stamp.len, 5);
        assert!(stamp.modified > 0);
    }

    #[test]
    fn does_not_stamp_a_folder() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let inside = path(&dir, "folder");
        fs::create_dir(&inside).expect("the folder");

        assert!(file_stamp(&inside).is_none());
    }

    #[test]
    fn a_respelling_is_a_name_beside_itself_that_reaches_the_same_entry() {
        fn asks<'a>(from: &'a str, to: &'a str) -> (&'a Path, &'a Path) {
            (Path::new(from), Path::new(to))
        }

        let same = |_: &Path, _: &Path| true;
        let other = |_: &Path, _: &Path| false;

        let (from, to) = asks("/s/idea.md", "/s/Idea.md");
        assert!(respelled(from, to, same));
        assert!(!respelled(from, to, other));

        let (from, to) = asks("/s/idea.md", "/s/in/Idea.md");
        assert!(!respelled(from, to, same));
        let (from, to) = asks("/s/idea.md", "/s/idea.md");
        assert!(!respelled(from, to, same));
    }

    #[test]
    fn respells_a_note_through_a_name_of_its_own() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("idea.md"), dir.path().join("Idea.md"));
        fs::write(&from, "words").expect("the note");

        move_entry(&from, &to, true).expect("the respelling");

        assert_eq!(fs::read_to_string(&to).expect("the note, renamed"), "words");
        let left: Vec<_> = fs::read_dir(dir.path()).expect("the folder").collect();
        assert_eq!(left.len(), 1, "nothing but the note is left behind");
    }

    #[test]
    fn respells_a_folder_with_everything_in_it() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("work"), dir.path().join("Work"));
        fs::create_dir(&from).expect("the folder");
        fs::write(from.join("plan.md"), "plan").expect("a note inside");

        move_entry(&from, &to, true).expect("the respelling");

        assert_eq!(
            fs::read_to_string(to.join("plan.md")).expect("the note"),
            "plan"
        );
    }

    #[test]
    fn refuses_to_move_onto_another_note() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (from, to) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&from, "a").expect("one note");
        fs::write(&to, "b").expect("another");

        assert!(move_entry(&from, &to, false).is_err());
        assert_eq!(fs::read_to_string(&to).expect("the other note"), "b");
    }

    #[cfg(unix)]
    #[test]
    fn a_hard_link_is_not_the_same_entry() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        let (one, other) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&one, "a").expect("the note");
        fs::hard_link(&one, &other).expect("a second link");

        assert!(!same_entry(&one, &other));
        assert!(same_entry(dir.path(), dir.path()));
    }

    #[cfg(unix)]
    fn ignores_case(dir: &tempfile::TempDir) -> bool {
        let probe = dir.path().join("case-probe");
        fs::write(&probe, "").expect("the probe");
        let answer = dir.path().join("CASE-PROBE").exists();
        fs::remove_file(&probe).expect("the probe, gone");
        answer
    }

    #[cfg(unix)]
    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("the folder")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[cfg(unix)]
    #[test]
    fn a_capital_is_changed_on_a_disk_that_ignores_case() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        if !ignores_case(&dir) {
            return;
        }
        let (from, to) = (dir.path().join("idea.md"), dir.path().join("Idea.md"));
        fs::write(&from, "words").expect("the note");

        assert!(respelled(&from, &to, same_entry));
        move_entry(&from, &to, true).expect("the rename");

        assert_eq!(names(dir.path()), ["Idea.md"]);
        assert_eq!(fs::read_to_string(&to).expect("the note"), "words");
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_changes_its_capital_with_its_notes_in_it() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        if !ignores_case(&dir) {
            return;
        }
        let (from, to) = (dir.path().join("work"), dir.path().join("Work"));
        fs::create_dir(&from).expect("the folder");
        fs::write(from.join("plan.md"), "plan").expect("a note in it");

        assert!(respelled(&from, &to, same_entry));
        move_entry(&from, &to, true).expect("the rename");

        assert_eq!(names(dir.path()), ["Work"]);
        assert_eq!(
            fs::read_to_string(to.join("plan.md")).expect("the note"),
            "plan"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_name_composed_another_way_is_the_same_note() {
        use super::same_entry;

        let dir = tempfile::tempdir().expect("a temp dir");
        if !ignores_case(&dir) {
            return;
        }
        let decomposed = dir.path().join("U\u{308}bersicht.md");
        let composed = dir.path().join("\u{dc}bersicht.md");
        fs::write(&decomposed, "overview").expect("the note");

        assert!(respelled(&decomposed, &composed, same_entry));
        move_entry(&decomposed, &composed, true).expect("the rename");

        assert_eq!(names(dir.path()).len(), 1);
        assert_eq!(fs::read_to_string(&composed).expect("the note"), "overview");
    }

    #[test]
    fn a_pdf_moved_alone_keeps_the_highlights_that_came_ahead_of_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let was = dir.path().join("A.pdf");
        let now = dir.path().join("B.pdf");
        fs::write(&was, "%PDF").expect("the PDF");
        fs::write(dir.path().join("B.pdf.highlights.json"), "{}").expect("its highlights");

        super::renamed(&was, &now, false, true).expect("the move");

        assert!(now.exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("B.pdf.highlights.json")).expect("highlights"),
            "{}"
        );
    }

    #[test]
    fn a_file_moved_alone_takes_only_what_sync_does_not_carry() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let pdf = dir.path().join("A.pdf");
        fs::write(&pdf, "%PDF").expect("the PDF");
        fs::write(dir.path().join("A.pdf.highlights.json"), "{}").expect("its highlights");
        let note = dir.path().join("Lecture.pages");
        fs::write(&note, "{}").expect("the page note");
        fs::write(dir.path().join("Lecture.pages.pdf"), "%PDF").expect("its paper");
        fs::write(dir.path().join("Lecture.pages.pdf.highlights.json"), "{}")
            .expect("the paper's highlights");

        super::renamed(&pdf, &dir.path().join("B.pdf"), false, true).expect("the PDF");
        super::renamed(&note, &dir.path().join("Week.pages"), false, true).expect("the note");

        assert!(dir.path().join("A.pdf.highlights.json").exists());
        assert!(!dir.path().join("B.pdf.highlights.json").exists());
        assert!(!dir.path().join("Lecture.pages.pdf").exists());
        assert!(dir.path().join("Week.pages.pdf").exists());
        assert!(dir
            .path()
            .join("Lecture.pages.pdf.highlights.json")
            .exists());
        assert!(!dir.path().join("Week.pages.pdf.highlights.json").exists());
    }

    #[test]
    fn a_file_moved_by_hand_takes_what_it_holds() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let pdf = dir.path().join("A.pdf");
        fs::write(&pdf, "%PDF").expect("the PDF");
        fs::write(dir.path().join("A.pdf.highlights.json"), "{}").expect("its highlights");

        super::renamed(&pdf, &dir.path().join("B.pdf"), false, false).expect("the move");

        assert!(!dir.path().join("A.pdf.highlights.json").exists());
        assert!(dir.path().join("B.pdf.highlights.json").exists());
    }

    #[test]
    fn a_page_note_is_refused_over_a_pdf_of_its_paper_name_however_it_moves() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let was = dir.path().join("X.pages");
        fs::write(&was, "{}").expect("the page note");
        fs::write(dir.path().join("Y.pages.pdf"), "%PDF").expect("somebody's own PDF");

        for alone in [false, true] {
            assert!(super::renamed(&was, &dir.path().join("Y.pages"), false, alone).is_err());
            assert!(was.exists());
        }
    }

    #[test]
    fn a_device_name_is_never_given_to_a_note_or_a_folder() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Plan.md");
        std::fs::write(&note, "words").expect("a note");

        for name in ["nul.md", "CON .md", "COM¹.md", "conin$.md"] {
            assert!(
                renamed(&note, &dir.path().join(name), false, false).is_err(),
                "{name}"
            );
            assert!(copied(&note, &dir.path().join(name)).is_err(), "{name}");
        }
        assert!(note.exists(), "left where it was");

        assert!(folder_made(&dir.path().join("Work/NUL/Notes")).is_err());
        assert!(!dir.path().join("Work").exists(), "nothing made on the way");
        folder_made(&dir.path().join("Work/Notes")).expect("an ordinary folder");

        let arrived = dir.path().join("aux.md");
        std::fs::write(&arrived, "kept").expect("a note from elsewhere");
        renamed(&arrived, &dir.path().join("Work/aux.md"), false, false).expect("moved");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Work/aux.md")).expect("there"),
            "kept"
        );
    }
}
