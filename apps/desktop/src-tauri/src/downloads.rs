use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewBuilder};

use crate::paths::is_reserved;

const MOVED: &str = "orden://web-download";

const DOWNLOADS_DIR: &str = "ORDEN_DOWNLOADS_DIR";

const LONGEST_NAME: usize = 180;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Going,
    Done,
    Failed,
    Cancelled,
}

impl Download {
    fn writing(&self) -> bool {
        self.state == State::Going || (self.state == State::Cancelled && !self.ended)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Download {
    id: u64,
    tab: String,
    url: String,
    name: String,
    state: State,
    received: u64,
    total: Option<u64>,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    ended: bool,
}

#[derive(Default)]
pub struct Downloads {
    held: Mutex<Vec<Download>>,
    lingering: Mutex<HashSet<String>>,
}

impl Downloads {
    fn busy(&self, tab: &str) -> bool {
        self.held.lock().is_ok_and(|held| {
            held.iter()
                .any(|one| one.tab == tab && one.state == State::Going)
        })
    }

    fn start(&self, tab: &str, url: &str, suggested: &Path, folder: &Path) -> Option<Download> {
        let name = clean_name(suggested.file_name().unwrap_or_default());
        let mut held = self.held.lock().ok()?;

        let path = free_path(folder, &name, |one| {
            on_disk(one)
                || held
                    .iter()
                    .any(|other| other.writing() && same_path(&other.path, one))
        });

        let made = Download {
            id: held.last().map_or(1, |last| last.id + 1),
            tab: tab.to_string(),
            url: url.to_string(),
            name: path
                .file_name()
                .map_or_else(|| name.clone(), |one| one.to_string_lossy().into_owned()),
            state: State::Going,
            received: 0,
            total: None,
            path,
            ended: false,
        };

        held.push(made.clone());
        Some(made)
    }

    fn finish(&self, url: &str, path: Option<&Path>, success: bool) -> Option<Download> {
        let mut held = self.held.lock().ok()?;
        let one = held.iter_mut().find(|one| {
            one.writing()
                && match path {
                    Some(path) => same_path(&one.path, path),
                    None => one.url == url,
                }
        })?;

        if one.state == State::Cancelled {
            one.ended = true;
            if success {
                let _ = std::fs::remove_file(&one.path);
            }
            return None;
        }

        one.state = if success { State::Done } else { State::Failed };
        if success {
            one.received = one.total.unwrap_or(one.received);
        }
        Some(one.clone())
    }

    fn moved(&self, path: &Path, received: u64, total: Option<u64>) -> Option<Download> {
        let mut held = self.held.lock().ok()?;
        let one = held
            .iter_mut()
            .find(|one| one.state == State::Going && same_path(&one.path, path))?;

        one.received = received;
        one.total = total.or(one.total);
        Some(one.clone())
    }

    fn going_from(&self, url: &str, taken: &[u64]) -> Option<(u64, PathBuf)> {
        self.held.lock().ok().and_then(|held| {
            held.iter()
                .find(|one| one.state == State::Going && one.url == url && !taken.contains(&one.id))
                .map(|one| (one.id, one.path.clone()))
        })
    }

    fn going_to(&self, id: u64) -> Option<PathBuf> {
        self.held.lock().ok().and_then(|held| {
            held.iter()
                .find(|one| one.id == id && one.state == State::Going)
                .map(|one| one.path.clone())
        })
    }

    fn cancelled(&self, id: u64) -> Option<Download> {
        let mut held = self.held.lock().ok()?;
        let one = held
            .iter_mut()
            .find(|one| one.id == id && one.state == State::Going)?;

        one.state = State::Cancelled;
        Some(one.clone())
    }

    fn saved(&self, id: u64) -> Result<PathBuf, String> {
        self.held
            .lock()
            .ok()
            .and_then(|held| {
                held.iter()
                    .find(|one| one.id == id && one.state == State::Done)
                    .map(|one| one.path.clone())
            })
            .ok_or_else(|| "that download is not in the folder".to_string())
    }
}

fn held(app: &AppHandle) -> tauri::State<'_, Downloads> {
    if app.try_state::<Downloads>().is_none() {
        app.manage(Downloads::default());
    }
    app.state::<Downloads>()
}

fn same_path(one: &Path, other: &Path) -> bool {
    one.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&other.as_os_str().to_string_lossy())
}

fn is_format(one: char) -> bool {
    matches!(one,
        '\u{00AD}'
        | '\u{0600}'..='\u{0605}'
        | '\u{061C}'
        | '\u{06DD}'
        | '\u{070F}'
        | '\u{0890}'..='\u{0891}'
        | '\u{08E2}'
        | '\u{180E}'
        | '\u{200B}'
        | '\u{200E}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}'
        | '\u{FFF9}'..='\u{FFFB}'
        | '\u{110BD}'
        | '\u{110CD}'
        | '\u{13430}'..='\u{1343F}'
        | '\u{1BCA0}'..='\u{1BCA3}'
        | '\u{1D173}'..='\u{1D17A}'
        | '\u{E0001}'
        | '\u{E0020}'..='\u{E007F}'
    )
}

fn is_blank(one: char) -> bool {
    matches!(one,
        '\u{00A0}'
        | '\u{115F}'..='\u{1160}'
        | '\u{1680}'
        | '\u{17B4}'..='\u{17B5}'
        | '\u{2000}'..='\u{200A}'
        | '\u{202F}'
        | '\u{205F}'
        | '\u{2800}'
        | '\u{3000}'
        | '\u{3164}'
        | '\u{FFA0}'
    )
}

pub(crate) fn plain_name(said: &str) -> String {
    said.chars()
        .filter(|one| !is_format(*one))
        .map(|one| {
            if one.is_control() || is_blank(one) {
                ' '
            } else {
                one
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn spelled_out(said: &str) -> String {
    let mut out = String::with_capacity(said.len());
    for one in said.chars() {
        if (one.is_control() && one != ' ') || is_format(one) {
            out.extend(one.escape_unicode());
        } else {
            out.push(one);
        }
    }
    out
}

pub(crate) fn clean_name(suggested: &OsStr) -> String {
    let replaced: String = suggested
        .to_string_lossy()
        .chars()
        .map(|one| {
            if one.is_control()
                || is_format(one)
                || is_blank(one)
                || matches!(one, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                one
            }
        })
        .collect();
    let mut was_space = false;
    let replaced: String = replaced
        .chars()
        .filter(|one| {
            let again = was_space && *one == ' ';
            was_space = *one == ' ';
            !again
        })
        .collect();

    let trimmed = replaced
        .trim()
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' ']);
    let name = if trimmed.is_empty() {
        "download"
    } else {
        trimmed
    };

    let (stem, ext) = split_extension(name);
    let stem = if is_reserved(stem) {
        format!("_{stem}")
    } else {
        stem.to_string()
    };

    let room = LONGEST_NAME.saturating_sub(ext.chars().count()).max(1);
    if stem.chars().count() <= room {
        return format!("{stem}{ext}");
    }
    let cut: String = stem.chars().take(room).collect();
    format!("{}{ext}", cut.trim_end_matches(['.', ' ']))
}

fn split_extension(name: &str) -> (&str, &str) {
    let Some(dot) = name.rfind('.').filter(|&at| at > 0) else {
        return (name, "");
    };

    let (stem, ext) = name.split_at(dot);
    let compressed = [".gz", ".bz2", ".xz", ".z", ".zst"]
        .iter()
        .any(|one| ext.eq_ignore_ascii_case(one));

    if compressed {
        if let Some(inner) = stem.rfind('.').filter(|&at| at > 0) {
            if stem[inner..].eq_ignore_ascii_case(".tar") {
                return name.split_at(inner);
            }
        }
    }

    (stem, ext)
}

pub(crate) fn on_disk(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

pub(crate) fn free_path(folder: &Path, name: &str, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let first = folder.join(name);
    if !taken(&first) {
        return first;
    }

    let (stem, ext) = split_extension(name);
    (1..=u32::MAX)
        .map(|count| folder.join(format!("{stem} ({count}){ext}")))
        .find(|one| !taken(one))
        .unwrap_or(first)
}

pub(crate) fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(named) = crate::paths::folder_named(std::env::var_os(DOWNLOADS_DIR).as_deref()) {
        return Ok(named);
    }

    app.path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("could not find the downloads folder: {error}"))
}

pub fn saving<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    tab: &str,
    window: &str,
) -> WebviewBuilder<R> {
    let app = app.clone();
    let tab = tab.to_string();
    let window = window.to_string();
    builder.on_download(move |_view, event| heard(&app, &tab, &window, event))
}

fn heard(app: &AppHandle, tab: &str, window: &str, event: DownloadEvent<'_>) -> bool {
    let downloads = held(app);
    let said = match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(folder) = folder(app) else {
                return true;
            };
            let _ = std::fs::create_dir_all(&folder);

            let made = downloads.start(tab, url.as_str(), destination, &folder);
            if let Some(made) = &made {
                destination.clone_from(&made.path);
            }
            made
        }
        DownloadEvent::Finished { url, path, success } => {
            let ended = downloads.finish(url.as_str(), path.as_deref(), success);
            if let Some(one) = &ended {
                let _ = settle(app, &one.tab);
            }
            ended
        }
        _ => None,
    };

    if let Some(one) = said {
        let _ = app.emit_to(window, MOVED, one);
    }
    true
}

pub fn linger(app: &AppHandle, tab: &str) -> bool {
    let downloads = held(app);
    if !downloads.busy(tab) {
        return false;
    }

    if let Ok(mut lingering) = downloads.lingering.lock() {
        lingering.insert(tab.to_string());
    }
    true
}

pub fn revive(app: &AppHandle, tab: &str) -> bool {
    held(app)
        .lingering
        .lock()
        .is_ok_and(|mut lingering| lingering.remove(tab))
}

fn settle(app: &AppHandle, tab: &str) -> bool {
    let downloads = held(app);
    if downloads.busy(tab) || !revive(app, tab) {
        return false;
    }

    let closing = app.clone();
    let tab = tab.to_string();
    let _ = app.run_on_main_thread(move || crate::web_tabs::close_page(&closing, &tab));
    true
}

pub fn listen(platform: &tauri::webview::PlatformWebview, app: AppHandle, window: String) {
    progress::listen(platform, app, window);
}

#[tauri::command]
pub fn web_downloads(app: AppHandle) -> Vec<Download> {
    held(&app)
        .held
        .lock()
        .map(|held| held.clone())
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn web_download_open(app: AppHandle, id: u64) -> Result<(), String> {
    let path = held(&app).saved(id)?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|error| format!("that file could not be opened: {error}"))
}

#[tauri::command(async)]
pub fn web_download_saved(app: AppHandle, id: u64) -> Result<String, String> {
    Ok(held(&app).saved(id)?.display().to_string())
}

#[tauri::command(async)]
pub fn web_download_cancel(webview: tauri::Webview, id: u64) {
    let app = webview.app_handle();
    let Some(stopped) = held(app).cancelled(id) else {
        return;
    };

    let _ = app.run_on_main_thread(move || progress::cancel(id));
    let _ = settle(app, &stopped.tab);
    let _ = app.emit_to(webview.window().label(), MOVED, stopped);
}

mod progress {
    use std::sync::{LazyLock, Mutex, OnceLock, PoisonError};

    use serde_json::{json, Value};
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter as _, Manager as _, Webview};

    use super::{held, MOVED};

    struct Begun {
        guid: String,
        url: String,
        view: String,
        id: Option<u64>,
    }

    static BEGUN: LazyLock<Mutex<Vec<Begun>>> = LazyLock::new(Mutex::default);
    static APP: OnceLock<AppHandle> = OnceLock::new();

    pub fn listen(_webview: &PlatformWebview, _app: AppHandle, _window: String) {}

    fn matched(begun: &mut [Begun], at: usize) -> Option<u64> {
        if let Some(id) = begun[at].id {
            return Some(id);
        }
        let app = APP.get()?;
        let taken: Vec<u64> = begun.iter().filter_map(|one| one.id).collect();
        let (id, _) = held(app).going_from(&begun[at].url, &taken)?;
        begun[at].id = Some(id);
        Some(id)
    }

    pub fn follow(view: &Webview, app: &AppHandle, window: &str) {
        let _ = APP.set(app.clone());
        let (app, window, label) = (app.clone(), window.to_string(), view.label().to_string());
        let _ = crate::engine::devtools::hear(view, move |method, session, params| {
            if session.is_some() {
                return;
            }
            match method {
                "Page.downloadWillBegin" => {
                    let (Some(guid), Some(url)) = (text(params, "guid"), text(params, "url"))
                    else {
                        return;
                    };
                    BEGUN
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .push(Begun {
                            guid,
                            url,
                            view: label.clone(),
                            id: None,
                        });
                }
                "Page.downloadProgress" => moved(&app, &window, params),
                _ => {}
            }
        });
    }

    fn text(params: &Value, name: &str) -> Option<String> {
        params.get(name)?.as_str().map(str::to_string)
    }

    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "byte counts the engine says as whole numbers"
    )]
    fn bytes(params: &Value, name: &str) -> Option<u64> {
        params
            .get(name)?
            .as_f64()
            .filter(|one| *one >= 0.0)
            .map(|one| one as u64)
    }

    fn moved(app: &AppHandle, window: &str, params: &Value) {
        let Some(guid) = text(params, "guid") else {
            return;
        };
        let mut begun = BEGUN.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(at) = begun.iter().position(|one| one.guid == guid) else {
            return;
        };
        let state = text(params, "state");
        if state.as_deref() != Some("inProgress") {
            let broke = (state.as_deref() != Some("completed"))
                .then(|| matched(&mut begun, at).zip(Some(begun[at].url.clone())))
                .flatten();
            begun.retain(|one| one.guid != guid);
            drop(begun);
            if let Some((id, url)) = broke {
                broke_off(app, window, id, &url);
            }
            return;
        }
        let Some(id) = matched(&mut begun, at) else {
            return;
        };
        drop(begun);
        let downloads = held(app);
        let Some(path) = downloads.going_to(id) else {
            return;
        };
        let total = bytes(params, "totalBytes").filter(|one| *one > 0);
        if let Some(one) =
            downloads.moved(&path, bytes(params, "receivedBytes").unwrap_or(0), total)
        {
            let _ = app.emit_to(window, MOVED, one);
        }
    }

    fn broke_off(app: &AppHandle, window: &str, id: u64, url: &str) {
        let downloads = held(app);
        let Some(path) = downloads.going_to(id) else {
            return;
        };
        if let Some(one) = downloads.finish(url, Some(&path), false) {
            let _ = super::settle(app, &one.tab);
            let _ = app.emit_to(window, MOVED, one);
        }
    }

    pub fn cancel(id: u64) {
        let Some(app) = APP.get() else {
            return;
        };
        let mut begun = BEGUN.lock().unwrap_or_else(PoisonError::into_inner);
        let found = (0..begun.len())
            .find(|&at| begun[at].id == Some(id))
            .or_else(|| {
                let url = held(app).held.lock().ok().and_then(|list| {
                    list.iter()
                        .find(|one| one.id == id)
                        .map(|one| one.url.clone())
                })?;
                (0..begun.len()).find(|&at| begun[at].id.is_none() && begun[at].url == url)
            });
        let Some(at) = found else {
            return;
        };
        let (guid, view) = (begun[at].guid.clone(), begun[at].view.clone());
        begun.retain(|one| one.guid != guid);
        drop(begun);
        if let Some(view) = app.get_webview(&view) {
            crate::engine::devtools::tell(
                &view,
                None,
                vec![("Browser.cancelDownload", json!({ "guid": guid }))],
            );
        }
    }
}

pub fn follow(view: &tauri::Webview, app: &AppHandle, window: &str) {
    progress::follow(view, app, window);
}

#[cfg(test)]
mod tests {
    use super::{
        clean_name, free_path, plain_name, spelled_out, split_extension, Downloads, State,
    };
    use std::collections::HashSet;
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    fn name(said: &str) -> String {
        clean_name(OsStr::new(said))
    }

    #[test]
    fn a_server_name_is_kept_as_it_is() {
        assert_eq!(name("Lecture 3 - Sorting.pdf"), "Lecture 3 - Sorting.pdf");
        assert_eq!(name("Übung (1).zip"), "Übung (1).zip");
    }

    #[test]
    fn a_name_is_never_a_path() {
        assert_eq!(name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(name(r"..\..\Windows\win.ini"), r"_.._Windows_win.ini");
        assert_eq!(name("a/b.pdf"), "a_b.pdf");
    }

    #[test]
    fn what_a_file_system_refuses_is_replaced() {
        assert_eq!(name("what: a \"title\"?.pdf"), "what_ a _title__.pdf");
        assert_eq!(name("tab\there.txt"), "tab_here.txt");
        assert_eq!(name("report.pdf. . "), "report.pdf");
        assert_eq!(name(".hidden"), "hidden");
    }

    #[test]
    fn what_changes_how_a_name_reads_is_replaced() {
        assert_eq!(name("invoice\u{202E}fdp.exe"), "invoice_fdp.exe");
        assert_eq!(name("a\u{2066}b\u{2069}.pdf"), "a_b_.pdf");
        assert_eq!(
            plain_name(" Claude\u{202E}edoC\u{2066}\u{200B} x\u{3164}\ty\u{7}"),
            "ClaudeedoC x y"
        );
        assert_eq!(
            spelled_out("sh -c \"curl x|sh #\u{202E}\nolleh\" می\u{200C}خواهم"),
            "sh -c \"curl x|sh #\\u{202e}\\u{a}olleh\" می\u{200C}خواهم"
        );
        assert_eq!(name("a\u{200B}b\u{FEFF}.pdf"), "a_b_.pdf");
        assert_eq!(name("a\u{061C}b\u{E0041}.pdf"), "a_b_.pdf");
        assert_eq!(name("می\u{200C}خواهم.pdf"), "می\u{200C}خواهم.pdf");
        assert_eq!(name("👩\u{200D}💻.pdf"), "👩\u{200D}💻.pdf");
    }

    #[test]
    fn a_run_of_nothing_cannot_hide_the_extension() {
        for blank in [
            '\u{3164}', '\u{115F}', '\u{1160}', '\u{FFA0}', '\u{2800}', '\u{2003}', '\u{3000}',
            '\u{00A0}',
        ] {
            let said = format!("invoice.pdf{}.exe", blank.to_string().repeat(150));
            assert!(!name(&said).contains(blank), "{blank:?}");
        }
        assert_eq!(
            name(&format!("invoice.pdf{}.exe", " ".repeat(150))),
            "invoice.pdf .exe"
        );
        assert_eq!(name("Lecture  3.pdf"), "Lecture 3.pdf");
    }

    #[test]
    fn a_device_name_is_not_a_file_name() {
        assert_eq!(name("CON.pdf"), "_CON.pdf");
        assert_eq!(name("nul"), "_nul");
        assert_eq!(name("com1.tar.gz"), "_com1.tar.gz");
        assert_eq!(name("COM¹.pdf"), "_COM¹.pdf");
        assert_eq!(name("CONSOLE.pdf"), "CONSOLE.pdf");
    }

    #[test]
    fn nothing_left_is_download() {
        assert_eq!(name(""), "download");
        assert_eq!(name(" . "), "download");
    }

    #[test]
    fn a_long_name_keeps_its_extension() {
        let long = format!("{}.pdf", "a".repeat(400));
        let kept = name(&long);
        assert!(Path::new(&kept)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")));
        assert_eq!(kept.chars().count(), super::LONGEST_NAME);
    }

    #[test]
    fn an_extension_is_the_last_one_except_for_a_compressed_archive() {
        assert_eq!(split_extension("report.pdf"), ("report", ".pdf"));
        assert_eq!(split_extension("v1.2.notes.txt"), ("v1.2.notes", ".txt"));
        assert_eq!(split_extension("backup.tar.gz"), ("backup", ".tar.gz"));
        assert_eq!(split_extension("backup.TAR.XZ"), ("backup", ".TAR.XZ"));
        assert_eq!(split_extension("data.gz"), ("data", ".gz"));
        assert_eq!(split_extension("README"), ("README", ""));
        assert_eq!(split_extension(".profile"), (".profile", ""));
    }

    fn folder() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Downloads")
        } else {
            PathBuf::from("/Downloads")
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_leads_nowhere_is_a_name_taken() {
        let dir = tempfile::tempdir().expect("a folder");
        let link = dir.path().join("report.pdf");
        std::os::unix::fs::symlink(dir.path().join("gone"), &link).expect("a link");
        assert!(super::on_disk(&link));
        assert_eq!(
            free_path(dir.path(), "report.pdf", super::on_disk),
            dir.path().join("report (1).pdf")
        );
    }

    #[test]
    fn a_name_already_there_is_numbered_the_way_chrome_numbers_it() {
        let there: HashSet<PathBuf> = ["report.pdf", "report (1).pdf", "backup.tar.gz"]
            .iter()
            .map(|one| folder().join(one))
            .collect();
        let taken = |one: &Path| there.contains(one);

        assert_eq!(
            free_path(&folder(), "slides.pdf", taken),
            folder().join("slides.pdf")
        );
        assert_eq!(
            free_path(&folder(), "report.pdf", taken),
            folder().join("report (2).pdf")
        );
        assert_eq!(
            free_path(&folder(), "backup.tar.gz", taken),
            folder().join("backup (1).tar.gz")
        );
    }

    fn tmp() -> PathBuf {
        std::env::temp_dir().join("orden-downloads-test-that-does-not-exist")
    }

    #[test]
    fn two_downloads_of_one_name_at_once_get_two_files() {
        let downloads = Downloads::default();
        let one = downloads
            .start(
                "a",
                "https://x.example/f",
                Path::new("C:/elsewhere/Report.pdf"),
                &tmp(),
            )
            .expect("the first");
        let two = downloads
            .start(
                "a",
                "https://x.example/f",
                Path::new("C:/elsewhere/report.pdf"),
                &tmp(),
            )
            .expect("the second");

        assert_eq!(one.name, "Report.pdf");
        assert_eq!(two.name, "report (1).pdf");
        assert_eq!(two.id, one.id + 1);
        assert_eq!(one.path, tmp().join("Report.pdf"));
    }

    #[test]
    fn a_download_is_followed_from_start_to_end() {
        let downloads = Downloads::default();
        let made = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("started");
        assert_eq!(made.state, State::Going);
        assert!(downloads.saved(made.id).is_err());

        let moved = downloads.moved(&made.path, 10, Some(40)).expect("moving");
        assert_eq!((moved.received, moved.total), (10, Some(40)));

        let done = downloads
            .finish("https://x.example/f", Some(&made.path), true)
            .expect("done");
        assert_eq!(done.state, State::Done);
        assert_eq!(done.received, 40);
        assert_eq!(downloads.saved(made.id).expect("saved"), made.path);

        let again = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("again");
        assert_eq!(again.name, "f.pdf");
    }

    #[test]
    fn an_engine_that_names_no_path_is_matched_by_address() {
        let downloads = Downloads::default();
        let one = downloads
            .start("a", "https://x.example/one", Path::new("one.pdf"), &tmp())
            .expect("one");
        let two = downloads
            .start("a", "https://x.example/two", Path::new("two.pdf"), &tmp())
            .expect("two");

        let ended = downloads
            .finish("https://x.example/two", None, false)
            .expect("ended");
        assert_eq!(ended.id, two.id);
        assert_eq!(ended.state, State::Failed);
        assert!(downloads.saved(one.id).is_err());
    }

    #[test]
    fn a_download_that_knows_only_its_address_is_matched_oldest_first() {
        let downloads = Downloads::default();
        let one = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("one");
        let two = downloads
            .start("a", "https://x.example/f", Path::new("f.pdf"), &tmp())
            .expect("two");

        assert_eq!(
            downloads.going_from("https://x.example/f", &[]),
            Some((one.id, one.path.clone()))
        );
        assert_eq!(
            downloads.going_from("https://x.example/f", &[one.id]),
            Some((two.id, two.path.clone()))
        );
        assert!(downloads
            .going_from("https://x.example/f", &[one.id, two.id])
            .is_none());
        assert!(downloads.going_from("https://x.example/g", &[]).is_none());

        assert_eq!(downloads.going_to(one.id), Some(one.path.clone()));
        downloads.cancelled(one.id);
        assert!(downloads.going_to(one.id).is_none());
        assert_eq!(
            downloads
                .going_from("https://x.example/f", &[])
                .map(|(id, _)| id),
            Some(two.id)
        );
    }

    #[test]
    fn a_stopped_download_keeps_its_name_until_the_engine_lets_go() {
        let downloads = Downloads::default();
        let first = downloads
            .start("a", "https://x.example/r", Path::new("report.pdf"), &tmp())
            .expect("first");
        downloads.cancelled(first.id).expect("stopped");
        let second = downloads
            .start("a", "https://x.example/r", Path::new("report.pdf"), &tmp())
            .expect("second");
        assert_eq!(second.name, "report (1).pdf");

        assert!(downloads
            .finish("https://x.example/r", Some(&first.path), true)
            .is_none());
        let done = downloads
            .finish("https://x.example/r", Some(&second.path), true)
            .expect("the second ended");
        assert_eq!(done.id, second.id);
        assert_eq!(done.state, State::Done);

        let third = downloads
            .start("a", "https://x.example/r", Path::new("report.pdf"), &tmp())
            .expect("third");
        assert_eq!(third.name, "report.pdf");
    }
}
