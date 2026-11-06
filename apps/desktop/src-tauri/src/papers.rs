use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{config_dir, is_pdf, kept_folder, made, write_atomically, ORIGIN};

const LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct PaperFile {
    path: String,
    size: u64,
}

fn papers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("papers"))
}

fn paper_dir(app: &AppHandle, pdf: &str) -> Result<PathBuf, String> {
    if !is_pdf(Path::new(pdf)) {
        return Err(format!("{pdf} is not a PDF"));
    }

    Ok(kept_folder(&papers_dir(app)?, pdf))
}

fn pages_file(dir: &Path) -> PathBuf {
    dir.join("pages.json")
}

fn origin_file(dir: &Path) -> PathBuf {
    dir.join(ORIGIN)
}

fn read_pages(dir: &Path) -> String {
    match fs::metadata(pages_file(dir)) {
        Err(_) => String::new(),
        Ok(meta) if meta.len() > LIMIT => String::new(),
        Ok(_) => fs::read_to_string(pages_file(dir)).unwrap_or_default(),
    }
}

fn write_pages(dir: &Path, content: &str) -> Result<(), String> {
    if content.is_empty() {
        let _ = fs::remove_file(pages_file(dir));
        let _ = fs::remove_file(origin_file(dir));
        let _ = fs::remove_dir(dir);
        return Ok(());
    }

    if content.len() > usize::try_from(LIMIT).unwrap_or(usize::MAX) {
        return Err(format!("{} would keep too much", dir.display()));
    }

    made(dir)?;
    write_atomically(&pages_file(dir), content.as_bytes())
}

fn listed(root: &Path) -> Vec<PaperFile> {
    let Ok(entries) = fs::read_dir(root) else {
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

#[tauri::command(async)]
pub fn read_paper_text(app: AppHandle, path: String) -> Result<String, String> {
    Ok(read_pages(&paper_dir(&app, &path)?))
}

#[tauri::command(async)]
pub fn write_paper_text(app: AppHandle, path: String, content: String) -> Result<(), String> {
    let dir = paper_dir(&app, &path)?;
    write_pages(&dir, &content)?;

    if !content.is_empty() {
        let _ = fs::write(origin_file(&dir), &path);
    }

    Ok(())
}

#[tauri::command(async)]
pub fn list_paper_texts(app: AppHandle) -> Result<Vec<PaperFile>, String> {
    Ok(listed(&papers_dir(&app)?))
}

#[cfg(test)]
mod tests {
    use super::{listed, origin_file, pages_file, read_pages, write_pages, LIMIT};
    use crate::paths::folder_key;
    use std::fs;
    use std::path::Path;

    #[test]
    fn a_paper_keeps_its_words_and_its_name_in_one_folder() {
        let dir = Path::new("papers").join(folder_key("/Notes/paper.pdf"));

        assert_eq!(pages_file(&dir).file_name().expect("a name"), "pages.json");
        assert_eq!(origin_file(&dir).file_name().expect("a name"), "origin.txt");
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
        assert_eq!(write_pages(&paper, ""), Ok(()));
    }

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
        write_pages(&two, "{}").expect("the second write");

        let found = listed(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "/Notes/paper.pdf");
        assert_eq!(found[0].size, 12);
    }
}
