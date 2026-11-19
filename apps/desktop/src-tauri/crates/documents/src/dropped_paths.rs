use orden_base::Held as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use orden_base::paths::{folded, inside, is_pdf};

const READABLE: Duration = Duration::from_secs(15 * 60);
const MOST_READABLE: usize = 256;
static READ: Mutex<Vec<(Instant, PathBuf)>> = Mutex::new(Vec::new());
fn guarded<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.held()
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
fn seen_where_dropped(app: &AppHandle, paths: &[PathBuf]) {
    use tauri::Manager as _;

    let Some(explored) = app.try_state::<orden_explorer::explorer::reach::Explored>() else {
        return;
    };
    for path in paths {
        explored.saw(path);
    }
}
pub fn dropped(app: &AppHandle, paths: &[PathBuf]) {
    let_dropped_be_read(paths, Instant::now());
    seen_where_dropped(app, paths);
    let pdfs: Vec<PathBuf> = paths.iter().filter(|one| is_pdf(one)).cloned().collect();
    crate::handed_pdfs::admit_handed(app, pdfs);
}
