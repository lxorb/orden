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

#[cfg_attr(
    not(any(
        all(target_os = "macos", not(feature = "cef")),
        all(windows, not(feature = "cef"))
    )),
    allow(dead_code)
)]
pub(crate) fn kept_dropped(paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let now = Instant::now();
    let_dropped_be_read(&paths, now);
    *guarded(&DROPPED) = Some((now, paths));
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

#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub fn arm() {
    wry::hear_dropped_paths(kept_dropped);
}

pub fn first_window(app: &AppHandle) {
    use tauri::Manager as _;

    if let Some(window) = app.get_webview_window("main") {
        hear(window.as_ref());
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the paths of the files a page hands over are WebView2's own, read through its COM interfaces"
)]
pub fn hear(webview: &tauri::Webview) {
    use webview2_com::WebMessageReceivedEventHandler;

    let _ = webview.with_webview(|platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                kept_dropped(paths_handed_over(&args));
            }
            Ok(())
        }));
        let mut token = 0_i64;
        let _ = core.add_WebMessageReceived(&handler, &raw mut token);
    });
}

#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn hear(_webview: &tauri::Webview) {}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the message and its files are read through WebView2's COM interfaces"
)]
unsafe fn paths_handed_over(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs,
) -> Vec<PathBuf> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use windows_core::{Interface as _, PWSTR};

    unsafe {
        let mut said = PWSTR::null();
        if args.TryGetWebMessageAsString(&raw mut said).is_err()
            || webview2_com::take_pwstr(said) != "orden-dropped-paths"
        {
            return Vec::new();
        }
        let Ok(objects) = args
            .cast::<ICoreWebView2WebMessageReceivedEventArgs2>()
            .and_then(|two| two.AdditionalObjects())
        else {
            return Vec::new();
        };
        let mut count = 0_u32;
        if objects.Count(&raw mut count).is_err() {
            return Vec::new();
        }
        (0..count)
            .filter_map(|at| {
                let file = objects
                    .GetValueAtIndex(at)
                    .ok()?
                    .cast::<ICoreWebView2File>()
                    .ok()?;
                let mut path = PWSTR::null();
                file.Path(&raw mut path).ok()?;
                let path = webview2_com::take_pwstr(path);
                (!path.is_empty()).then(|| PathBuf::from(path))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_was_dropped_is_taken_once_while_fresh_and_read_for_a_while() {
        let far = std::env::temp_dir().join("orden-dropped").join("away.pdf");
        let said = far.to_string_lossy().into_owned();
        assert_eq!(dropped_readable(&said), None);

        kept_dropped(vec![far.clone()]);
        let now = Instant::now();
        assert_eq!(taken_dropped(now), vec![far.clone()]);
        assert!(taken_dropped(now).is_empty());
        assert_eq!(dropped_readable(&said), Some(folded(&far)));
        assert_eq!(
            readable_dropped_at(&said, now + READABLE + Duration::from_secs(1)),
            None
        );

        kept_dropped(vec![far.with_file_name("old.pdf")]);
        assert!(taken_dropped(now + FRESH + Duration::from_secs(1)).is_empty());

        kept_dropped(Vec::new());
        assert!(taken_dropped(Instant::now()).is_empty());
        assert_eq!(
            dropped_readable(&far.with_file_name("other.pdf").to_string_lossy()),
            None
        );
    }
}
