use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use crate::lane::lane;
use crate::paths::{self, cannot, made};

const MAX_BYTES: u64 = 1024 * 1024;

const MAX_MESSAGE: usize = 2000;

const MAX_FIELD: usize = 40;

pub const FILE: &str = "orden.log";

const FORMER: &str = "nib.log";

#[tauri::command(async)]
pub fn log_dir(app: AppHandle) -> Result<String, String> {
    Ok(log_file(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_log(app: AppHandle, level: String, message: String, at: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("could not find the log folder: {error}"))?;

    writer()
        .send((dir.join(FILE), line(&level, &message, &at)))
        .map_err(|_| "the log has stopped being written".to_owned())
}

pub fn say(app: &AppHandle, level: &str, message: &str) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = writer().send((
        dir.join(FILE),
        line(level, message, &crate::clock::iso(crate::clock::now())),
    ));
}

fn line(level: &str, message: &str, at: &str) -> String {
    format!(
        "{} {:<5} {}\n",
        one_line(at, MAX_FIELD),
        one_line(&level.to_uppercase(), MAX_FIELD),
        one_line(message, MAX_MESSAGE)
    )
}

fn writer() -> &'static Sender<(PathBuf, String)> {
    static WRITER: OnceLock<Sender<(PathBuf, String)>> = OnceLock::new();

    WRITER.get_or_init(|| lane(written))
}

fn written((path, line): (PathBuf, String)) {
    if let Err(error) = append(&path, &line) {
        eprintln!("{error}");
    }
}

fn append(path: &Path, line: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        made(dir)?;
    }

    carried(path);

    if fs::metadata(path).map_or(0, |one| one.len()) > MAX_BYTES {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| cannot("write", path, &error))?;

    file.write_all(line.as_bytes())
        .map_err(|error| cannot("write", path, &error))
}

fn carried(path: &Path) {
    let former = path.with_file_name(FORMER);
    if path.file_name() == Some(FILE.as_ref()) && !path.exists() && former.is_file() {
        let _ = fs::rename(former, path);
    }
}

#[tauri::command(async)]
pub fn read_log(app: AppHandle) -> String {
    log_file(&app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
}

fn log_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::log_dir(app)?.join(FILE))
}

fn one_line(message: &str, limit: usize) -> String {
    message
        .replace(['\r', '\n'], " ⏎ ")
        .chars()
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{append, line, one_line, writer, FILE, FORMER, MAX_BYTES, MAX_MESSAGE};

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

    #[test]
    fn a_line_is_the_time_the_level_and_the_message() {
        assert_eq!(line("warn", "a\nb", "12:00"), "12:00 WARN  a ⏎ b\n");
    }

    #[test]
    fn lines_land_in_the_order_they_were_written() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("logs").join(FILE);

        for index in 0..200 {
            writer()
                .send((path.clone(), line("info", &format!("line {index}"), "t")))
                .expect("the log's thread");
        }

        let started = std::time::Instant::now();
        while !std::fs::read_to_string(&path).is_ok_and(|text| text.contains("line 199")) {
            assert!(started.elapsed().as_secs() < 10, "the lines never landed");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        let text = std::fs::read_to_string(&path).expect("the log");
        let numbers: Vec<usize> = text
            .lines()
            .filter_map(|one| one.rsplit(' ').next()?.parse().ok())
            .collect();
        assert_eq!(numbers, (0..200).collect::<Vec<_>>());
    }

    #[test]
    fn the_log_kept_under_the_former_name_goes_on_under_the_new_one() {
        let dir = tempfile::tempdir().expect("a temp folder");
        std::fs::write(dir.path().join(FORMER), "before\n").expect("the former log");

        append(&dir.path().join(FILE), "after\n").expect("the line");

        assert!(!dir.path().join(FORMER).exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join(FILE)).expect("the log"),
            "before\nafter\n"
        );
    }

    #[test]
    fn a_full_log_rolls_over() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join(FILE);
        let full = usize::try_from(MAX_BYTES).expect("a size") + 1;
        std::fs::write(&path, "x".repeat(full)).expect("a full log");

        append(&path, "fresh\n").expect("the line");

        assert_eq!(std::fs::read_to_string(&path).expect("the log"), "fresh\n");
        assert_eq!(
            std::fs::metadata(path.with_extension("log.1"))
                .expect("the rolled log")
                .len(),
            MAX_BYTES + 1
        );
    }
}
