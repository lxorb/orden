use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FORMER: &str = "Nib";
#[cfg_attr(not(any(mobile, test)), allow(dead_code))]
const NOW: &str = "Orden";
fn documents(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("could not find the documents folder: {error}"))
}
#[cfg_attr(not(desktop), allow(dead_code))]
pub(crate) fn former_documents(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(documents(app)?.join(FORMER))
}
#[cfg(mobile)]
pub(crate) fn spaces(app: &AppHandle) -> Result<PathBuf, String> {
    static DECIDED: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    if let Some(known) = DECIDED.get() {
        return Ok(known.clone());
    }
    let chosen = chosen(&documents(app)?, Path::is_dir);
    Ok(DECIDED.get_or_init(|| chosen).clone())
}
#[cfg_attr(not(any(mobile, test)), allow(dead_code))]
fn chosen(documents: &Path, there: impl Fn(&Path) -> bool) -> PathBuf {
    let former = documents.join(FORMER);
    if there(&former) {
        former
    } else {
        documents.join(NOW)
    }
}
#[cfg(test)]
mod tests {
    use super::{chosen, FORMER, NOW};
    use std::fs;

    #[test]
    fn a_new_install_keeps_its_spaces_under_the_new_name() {
        let dir = tempfile::tempdir().expect("a folder");
        assert_eq!(chosen(dir.path(), std::path::Path::is_dir), dir.path().join(NOW));
        assert!(!dir.path().join(NOW).exists() && !dir.path().join(FORMER).exists());
    }
    #[test]
    fn spaces_kept_under_the_former_name_stay_where_they_are_and_stay_in_use() {
        let dir = tempfile::tempdir().expect("a folder");
        let former = dir.path().join(FORMER);
        fs::create_dir_all(former.join("Work")).expect("a space");
        fs::write(former.join("Work").join("Plan.md"), "# Plan\n").expect("a note");
        assert_eq!(chosen(dir.path(), std::path::Path::is_dir), former);
        fs::create_dir(dir.path().join(NOW)).expect("the new folder");
        assert_eq!(chosen(dir.path(), std::path::Path::is_dir), former);
        assert_eq!(
            fs::read_to_string(former.join("Work").join("Plan.md")).expect("kept"),
            "# Plan\n"
        );
    }
    #[test]
    fn a_file_under_the_former_name_is_no_spaces_folder() {
        let dir = tempfile::tempdir().expect("a folder");
        fs::write(dir.path().join(FORMER), "a file").expect("a file");
        assert_eq!(chosen(dir.path(), std::path::Path::is_dir), dir.path().join(NOW));
    }
}
