use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::paths::{folded, inside, is_pdf};

const FRESH: Duration = Duration::from_secs(30);

const READABLE: Duration = Duration::from_secs(15 * 60);

const MOST_READABLE: usize = 256;

static DROPPED: Mutex<Option<(Instant, Vec<PathBuf>)>> = Mutex::new(None);

static READ: Mutex<Vec<(Instant, PathBuf)>> = Mutex::new(Vec::new());

fn guarded<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(PoisonError::into_inner)
}

fn same_dropped(one: &Path, other: &Path) -> bool {
    inside(one, other) && inside(other, one)
}

fn let_dropped_be_read(paths: &[PathBuf], now: Instant) {
    let mut read = guarded(&READ);
    read.retain(|(at, one)| {
        now.saturating_duration_since(*at) < READABLE
            && !paths.iter().any(|new| same_dropped(one, new))
    });
    read.extend(paths.iter().map(|one| (now, folded(one))));
    let over = read.len().saturating_sub(MOST_READABLE);
    read.drain(..over);
}

fn readable_dropped_at(path: &str, now: Instant) -> Option<PathBuf> {
    let path = folded(Path::new(path));
    guarded(&READ)
        .iter()
        .any(|(at, one)| now.saturating_duration_since(*at) < READABLE && same_dropped(one, &path))
        .then_some(path)
}

pub fn dropped_readable(path: &str) -> Option<PathBuf> {
    readable_dropped_at(path, Instant::now())
}

fn taken_dropped(now: Instant) -> Vec<PathBuf> {
    let dropped = guarded(&DROPPED).take();
    dropped
        .filter(|(at, _)| now.saturating_duration_since(*at) < FRESH)
        .map(|(_, paths)| paths)
        .unwrap_or_default()
}

fn seen_where_dropped(app: &AppHandle, paths: &[PathBuf]) {
    use tauri::Manager as _;

    let Some(explored) = app.try_state::<crate::explorer::reach::Explored>() else {
        return;
    };
    for path in paths {
        explored.saw(path);
    }
}

fn handed_as_pdfs(app: &AppHandle, paths: &[PathBuf]) {
    let pdfs: Vec<PathBuf> = paths
        .iter()
        .filter(|one| is_pdf(one) && one.is_file())
        .cloned()
        .collect();
    crate::handed_pdfs::admit_handed(app, pdfs);
}

pub fn dropped(app: &AppHandle, paths: &[PathBuf]) {
    let_dropped_be_read(paths, Instant::now());
    seen_where_dropped(app, paths);
    let pdfs: Vec<PathBuf> = paths.iter().filter(|one| is_pdf(one)).cloned().collect();
    crate::handed_pdfs::admit_handed(app, pdfs);
}

#[tauri::command(async)]
pub fn dropped_paths(app: AppHandle) -> Vec<String> {
    let paths = taken_dropped(Instant::now());
    seen_where_dropped(&app, &paths);
    handed_as_pdfs(&app, &paths);
    paths
        .into_iter()
        .map(|one| one.to_string_lossy().into_owned())
        .collect()
}

pub fn first_window(app: &AppHandle) {
    use tauri::Manager as _;

    if let Some(window) = app.get_webview_window("main") {
        hear(window.as_ref());
    }
}

pub fn hear(_webview: &tauri::Webview) {}
