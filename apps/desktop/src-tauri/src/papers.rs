//! The words taken out of a PDF, kept so that they are only taken out once.
//!
//! A PDF's words are not text on disk: getting at them is the window's own pdf.js,
//! a worker and a page at a time. So the window takes them down as they are read
//! and hands them here, and a paper somebody opened last week answers a search
//! today without being opened again.
//!
//! They live in the app's own config folder rather than beside the PDF, which is
//! the rule the version history follows for the same reason: a PDF's folder belongs
//! to the person who put the PDF there, and a cache is the app's business. Each
//! paper gets a folder named after a hash of its path - `folder_key` in `paths`,
//! the same one history uses - holding the words and the path they came from, so
//! that the store can be listed by paper without every record in it being read.
//!
//! What is in a record belongs to the window, which is the only thing that reads
//! it: here it is text, judged only by its size and by where it may be written. The
//! window keys it by the hash of the file's bytes and drops it when that changes;
//! see pdf/text-cache.ts.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::paths::{cannot, folder_key, is_pdf, write_atomically};

/// How much of one paper's words may be kept. A thousand pages of a dense book,
/// and a ceiling so that a window asking a cache to hold more than a cache should
/// is refused rather than obeyed. The window holds itself to the same number; this
/// is the one that protects the disk.
const LIMIT: u64 = 4 * 1024 * 1024;

/// What the store holds for one paper: which paper, and how much.
#[derive(Serialize)]
pub struct PaperFile {
    /// The PDF's path, as the window spells it.
    path: String,
    /// How many bytes its words come to.
    size: u64,
}

/// The folder every paper's words live under.
fn papers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("could not find the settings folder: {error}"))?
        .join("papers"))
}

/// One paper's folder. The path is judged first: a store of what is inside PDFs
/// holds nothing else, so a window that names something that is not one is refused
/// rather than answered.
fn paper_dir(app: &AppHandle, pdf: &str) -> Result<PathBuf, String> {
    if !is_pdf(Path::new(pdf)) {
        return Err(format!("{pdf} is not a PDF"));
    }

    Ok(papers_dir(app)?.join(folder_key(pdf)))
}

/// Where the words are, and where the paper they came from is named. Two files
/// rather than one, so that listing the store reads a path per paper instead of
/// megabytes of words; `origin.txt` is the same trick history.rs plays.
fn pages_file(dir: &Path) -> PathBuf {
    dir.join("pages.json")
}

fn origin_file(dir: &Path) -> PathBuf {
    dir.join("origin.txt")
}

/// What was taken down for one paper, or nothing at all. A record larger than a
/// record may be is nothing rather than an error: the paper is read again, and the
/// next write is what clears it.
fn read_pages(dir: &Path) -> String {
    match fs::metadata(pages_file(dir)) {
        Err(_) => String::new(),
        Ok(meta) if meta.len() > LIMIT => String::new(),
        // Gone between the two calls is another window sweeping the store, which is
        // a paper to read again rather than anything to report.
        Ok(_) => fs::read_to_string(pages_file(dir)).unwrap_or_default(),
    }
}

/// Writes one paper's words down, whole, the way a note is written: a crash mid
/// write leaves what was there rather than half of what is new.
///
/// Nothing to keep takes the folder with it, so a paper whose words were dropped
/// leaves no folder behind.
fn write_pages(dir: &Path, content: &str) -> Result<(), String> {
    if content.is_empty() {
        // Gone already is what was asked for, so none of this is an error.
        let _ = fs::remove_file(pages_file(dir));
        let _ = fs::remove_file(origin_file(dir));
        let _ = fs::remove_dir(dir);
        return Ok(());
    }

    if content.len() > usize::try_from(LIMIT).unwrap_or(usize::MAX) {
        return Err(format!("{} would keep too much", dir.display()));
    }

    fs::create_dir_all(dir).map_err(|error| cannot("create", dir, &error))?;
    write_atomically(&pages_file(dir), content.as_bytes())
}

/// Which papers the store holds words for, and how many bytes each comes to.
///
/// A record whose origin cannot be read is left out: a folder nobody can name a
/// paper for is a folder nobody can ask about, and the window's own sweep is what
/// clears it.
fn listed(root: &Path) -> Vec<PaperFile> {
    let Ok(entries) = fs::read_dir(root) else {
        // Nothing has ever been kept, so there is nothing to list.
        return Vec::new();
    };

    let mut found = Vec::new();

    for dir in entries.flatten().map(|entry| entry.path()) {
        let Ok(path) = fs::read_to_string(origin_file(&dir)) else {
            continue;
        };

        let size = fs::metadata(pages_file(&dir)).map_or(0, |meta| meta.len());
        if size == 0 {
            continue;
        }

        found.push(PaperFile { path, size });
    }

    found
}

/// The words taken out of a PDF, or nothing where none have been. A paper nobody
/// has read is the ordinary case rather than a failure.
#[tauri::command]
pub fn read_paper_text(app: AppHandle, path: String) -> Result<String, String> {
    Ok(read_pages(&paper_dir(&app, &path)?))
}

/// One paper's words written down, or taken away again when the window sends
/// nothing: a paper that has been deleted, renamed or written over has no words
/// worth keeping.
#[tauri::command]
pub fn write_paper_text(app: AppHandle, path: String, content: String) -> Result<(), String> {
    let dir = paper_dir(&app, &path)?;
    write_pages(&dir, &content)?;

    if !content.is_empty() {
        // The paper's own path, so the store can be listed by paper. Not worth
        // failing the write over; the listing simply passes over a record that
        // cannot say which paper it is.
        let _ = fs::write(origin_file(&dir), &path);
    }

    Ok(())
}

/// Every paper the store holds words for.
#[tauri::command]
pub fn list_paper_texts(app: AppHandle) -> Result<Vec<PaperFile>, String> {
    Ok(listed(&papers_dir(&app)?))
}

#[cfg(test)]
mod tests {
    // A test module is its own scope: what it touches is named here rather than
    // borrowed from the module above.
    use super::{listed, origin_file, pages_file, read_pages, write_pages, LIMIT};
    use crate::paths::folder_key;
    use std::fs;
    use std::path::Path;

    #[test]
    fn a_paper_keeps_its_words_and_its_name_in_one_folder() {
        let dir = Path::new("papers").join(folder_key("/Notes/paper.pdf"));

        assert_eq!(pages_file(&dir).file_name().expect("a name"), "pages.json");
        assert_eq!(origin_file(&dir).file_name().expect("a name"), "origin.txt");
        // The folder is a hash rather than the path, so nothing in the store says
        // where anybody keeps their papers.
        assert!(!dir.to_string_lossy().contains("paper.pdf"));
    }

    #[test]
    fn a_paper_nobody_has_read_reads_as_nothing() {
        let dir = tempfile::tempdir().expect("a temp folder");

        assert_eq!(read_pages(&dir.path().join("none")), String::new());
    }

    #[test]
    fn what_is_written_is_what_is_read_back() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("one");
        let words = r#"{"path":"/Notes/paper.pdf","pages":[[1,"ink"]]}"#;

        write_pages(&paper, words).expect("the write");
        assert_eq!(read_pages(&paper), words);
    }

    #[test]
    fn nothing_left_to_keep_takes_the_folder_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("one");

        write_pages(&paper, "{}").expect("the write");
        fs::write(origin_file(&paper), "/Notes/paper.pdf").expect("the origin");

        write_pages(&paper, "").expect("the clearing");
        assert!(!paper.exists());
        // And clearing one that has gone already is not a failure.
        assert_eq!(write_pages(&paper, ""), Ok(()));
    }

    /// The writer is held to the reader's ceiling. Without that, a window could
    /// write words that come back as nothing for ever after.
    #[test]
    fn words_too_many_to_read_back_are_refused_on_the_way_in() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("one");
        let too_much = "x".repeat(usize::try_from(LIMIT).unwrap_or(usize::MAX) + 1);

        assert!(write_pages(&paper, &too_much).is_err());
        assert_eq!(read_pages(&paper), String::new());
    }

    #[test]
    fn the_store_lists_a_paper_by_the_path_it_came_from() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let one = dir.path().join(folder_key("/Notes/paper.pdf"));
        let two = dir.path().join(folder_key("/Notes/other.pdf"));

        write_pages(&one, "{\"pages\":[]}").expect("the write");
        fs::write(origin_file(&one), "/Notes/paper.pdf").expect("the origin");
        // A record that cannot say which paper it is, which is a half written one.
        write_pages(&two, "{}").expect("the second write");

        let found = listed(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "/Notes/paper.pdf");
        assert_eq!(found[0].size, 12);
    }
}
