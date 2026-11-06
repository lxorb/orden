use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{cannot, highlights_of, in_spaces, is_pdf, write_in_place};

const LIMIT: u64 = 8 * 1024 * 1024;

fn sidecar_of(pdf: &Path) -> Result<PathBuf, String> {
    if !is_pdf(pdf) {
        return Err(format!("{} is not a PDF", pdf.display()));
    }

    Ok(highlights_of(pdf))
}

fn read_sidecar(target: &Path) -> Result<String, String> {
    match fs::metadata(target) {
        Err(_) => return Ok(String::new()),
        Ok(meta) if meta.len() > LIMIT => {
            return Err(format!("{} holds too much", target.display()))
        }
        Ok(_) => {}
    }

    fs::read_to_string(target).or_else(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(String::new())
        } else {
            Err(cannot("read", target, &error))
        }
    })
}

fn write_sidecar(target: &Path, content: &str) -> Result<(), String> {
    if content.len() > usize::try_from(LIMIT).unwrap_or(usize::MAX) {
        return Err(format!("{} would hold too much", target.display()));
    }

    if content.is_empty() {
        return match fs::remove_file(target) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(cannot("delete", target, &error))
            }
            _ => Ok(()),
        };
    }

    write_in_place(target, content.as_bytes())
}

#[tauri::command(async)]
pub fn read_highlights(app: AppHandle, path: String) -> Result<String, String> {
    read_sidecar(&sidecar_of(&in_spaces(&app, &path)?)?)
}

#[tauri::command(async)]
pub fn write_highlights(app: AppHandle, path: String, content: String) -> Result<(), String> {
    write_sidecar(&sidecar_of(&in_spaces(&app, &path)?)?, &content)
}

#[cfg(test)]
mod tests {
    use super::{read_sidecar, sidecar_of, write_sidecar, LIMIT};
    use std::path::Path;

    #[test]
    fn the_sidecar_of_a_pdf_is_named_after_it() {
        assert_eq!(
            sidecar_of(Path::new("Notes/paper.pdf")),
            Ok(Path::new("Notes/paper.pdf.highlights.json").to_path_buf())
        );
    }

    #[test]
    fn nothing_that_is_not_a_pdf_has_one() {
        assert!(sidecar_of(Path::new("Notes/Idea.md")).is_err());
        assert!(sidecar_of(Path::new("Notes/shot.png")).is_err());
        assert!(sidecar_of(Path::new("Notes/paper.pdf.highlights.json")).is_err());
    }

    #[test]
    fn a_pdf_nobody_has_marked_reads_as_nothing() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        assert_eq!(read_sidecar(&target), Ok(String::new()));
    }

    #[test]
    fn what_is_written_is_what_is_read_back() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");
        let marks = r#"{"version":1,"highlights":[{"page":3,"text":"Bücher"}]}"#;

        write_sidecar(&target, marks).expect("the write");
        assert_eq!(read_sidecar(&target), Ok(marks.to_string()));

        let left: Vec<String> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, vec!["paper.pdf.highlights.json".to_string()]);
    }

    #[test]
    fn the_last_highlight_removed_takes_the_sidecar_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        write_sidecar(&target, "{}").expect("the write");
        write_sidecar(&target, "").expect("the clearing");

        assert!(!target.exists());
        assert_eq!(write_sidecar(&target, ""), Ok(()));
    }

    #[test]
    fn marks_too_large_to_read_back_are_refused_on_the_way_in() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        let too_much = "x".repeat(usize::try_from(LIMIT).unwrap_or(usize::MAX) + 1);
        assert!(write_sidecar(&target, &too_much).is_err());
        assert!(!target.exists(), "and nothing was written");

        write_sidecar(&target, "{}").expect("the write");
        assert_eq!(read_sidecar(&target), Ok("{}".to_string()));
    }

    #[test]
    fn a_sidecar_too_large_to_be_one_is_refused() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = sidecar_of(&dir.path().join("paper.pdf")).expect("a sidecar path");

        let big = vec![b'x'; usize::try_from(LIMIT).unwrap_or(usize::MAX) + 1];
        std::fs::write(&target, big).expect("something far too big");

        assert!(read_sidecar(&target).is_err());
    }
}
