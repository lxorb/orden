#![cfg_attr(
    not(any(target_os = "linux", target_os = "windows", target_os = "macos")),
    allow(dead_code)
)]

#[cfg(target_os = "linux")]
mod audio;
#[cfg(target_os = "linux")]
mod capture;
#[cfg(target_os = "linux")]
mod clipboard;
#[cfg(target_os = "windows")]
mod desk;
#[cfg(target_os = "linux")]
mod display;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
mod encoder;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
mod events;
#[cfg(target_os = "linux")]
mod input;
mod installed;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
mod stream;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
mod stun;
#[cfg(target_os = "linux")]
mod wm;

#[cfg(target_os = "windows")]
use desk::{audio, capture, clipboard, input};
#[cfg(target_os = "macos")]
use mac::{audio, capture, clipboard, input};

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

const REFUSED: &str = "only the app's own windows may host an application";

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Run {
    Installed {
        id: String,
    },
    Path {
        path: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct View {
    pub width: f64,
    pub height: f64,
    pub dpr: f64,
    #[serde(default = "sixty")]
    pub hz: f64,
}

fn sixty() -> f64 {
    60.0
}

#[derive(Clone, Debug)]
pub struct Screen {
    pub display: String,
    pub hz: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Said {
    pub state: &'static str,
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<&'static str>,
}

impl Said {
    const RUNNING: Said = Said {
        state: "running",
        code: None,
        why: None,
    };

    fn ended(stopped: bool, code: Option<i32>) -> Said {
        Said {
            state: if stopped { "stopped" } else { "exited" },
            code: if stopped { None } else { code },
            why: None,
        }
    }
}

struct Running {
    pid: u32,
    events: Mutex<Option<Channel<Said>>>,
    stopping: AtomicBool,
    screen: Arc<Mutex<Screen>>,
    #[cfg(target_os = "linux")]
    display: Mutex<Option<display::Display>>,
    #[cfg(target_os = "linux")]
    sink: Mutex<Option<audio::Sink>>,
    #[cfg(target_os = "windows")]
    desktop: Mutex<Option<desk::Desktop>>,
    #[cfg(target_os = "macos")]
    display: Mutex<Option<mac::display::Display>>,
    #[cfg(target_os = "macos")]
    placer: Mutex<Option<mac::windows::Placer>>,
    #[cfg(target_os = "macos")]
    clipboard: Arc<clipboard::Clipboard>,
}

impl Running {
    fn tell(&self, said: Said) {
        let events = self
            .events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(channel) = events.as_ref() {
            let _ = channel.send(said);
        }
    }
}

#[derive(Default)]
pub struct Hosted {
    apps: Mutex<HashMap<String, Arc<Running>>>,
    allowed: Mutex<Option<HashSet<String>>>,
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    peers: Mutex<HashMap<String, stream::Peer>>,
}

impl Hosted {
    fn apps(&self) -> MutexGuard<'_, HashMap<String, Arc<Running>>> {
        self.apps
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    fn peers(&self) -> MutexGuard<'_, HashMap<String, stream::Peer>> {
        self.peers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    fn end_peer(&self, key: &str) {
        let gone = self.peers().remove(key);
        drop(gone);
    }
}

fn owner(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err(REFUSED.to_owned())
    }
}

fn usable(key: &str) -> Result<(), String> {
    let fits = !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(())
    } else {
        Err("not an application's key".to_owned())
    }
}

#[tauri::command]
pub async fn apps_installed(webview: Webview) -> Result<Vec<installed::Listed>, String> {
    crate::lane::off_the_runtime(move || -> Result<Vec<installed::Listed>, String> {
        owner(&webview)?;
        Ok(installed::installed())
    })
    .await
}

#[tauri::command]
pub async fn apps_start(
    webview: Webview,
    key: String,
    run: Run,
    view: View,
    events: Channel<Said>,
) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        owner(&webview)?;
        usable(&key)?;
        let hosted = webview.state::<Hosted>();
        if let Some(running) = hosted.apps().get(&key).cloned() {
            *running
                .events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(events.clone());
            running.tell(Said::RUNNING);
            return Ok(());
        }

        let (argv, cwd) = match &run {
            Run::Installed { id } => {
                let entry = installed::find(id).ok_or("missing")?;
                if entry.packaged {
                    return Err("packaged".to_owned());
                }
                (entry.argv, entry.cwd)
            }
            Run::Path { path, args, cwd } => {
                let program = installed::program_of(path).ok_or("missing")?;
                let mut argv = vec![program];
                argv.extend(args.iter().cloned());
                (argv, cwd.clone())
            }
        };
        if !cfg!(any(
            target_os = "linux",
            target_os = "windows",
            target_os = "macos"
        )) {
            return Err("isolation".to_owned());
        }
        if let Run::Path { path, args, cwd } = &run {
            if !allowed_here(webview.app_handle(), &hosted, path, args, cwd.as_deref()) {
                return Err("refused".to_owned());
            }
        }
        run_on_its_display(webview.app_handle().clone(), key, argv, cwd, view, events)
    })
    .await
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn run_on_its_display(
    _app: AppHandle,
    _key: String,
    _argv: Vec<String>,
    _cwd: Option<String>,
    _view: View,
    _events: Channel<Said>,
) -> Result<(), String> {
    Err("isolation".to_owned())
}

#[cfg(target_os = "windows")]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to a screen's size first"
)]
fn desk_size(view: View) -> (u32, u32) {
    let side = |css: f64| ((css * view.dpr).round().clamp(64.0, 8192.0) as u32) & !1;
    (side(view.width), side(view.height))
}

#[cfg(target_os = "windows")]
const HANDED_WITHIN: std::time::Duration = std::time::Duration::from_secs(10);

#[cfg(target_os = "windows")]
fn run_on_its_display(
    app: AppHandle,
    key: String,
    argv: Vec<String>,
    cwd: Option<String>,
    view: View,
    events: Channel<Said>,
) -> Result<(), String> {
    if encoder::ffmpeg().is_some() {
        std::thread::spawn(|| encoder::working().len());
    }
    let (width, height) = desk_size(view);
    let desktop = desk::Desktop::start(width, height).map_err(|_| "failed")?;
    let folder = cwd
        .map(PathBuf::from)
        .filter(|one| one.is_dir())
        .or_else(|| {
            argv.first()
                .and_then(|program| std::path::Path::new(program).parent())
                .map(std::path::Path::to_path_buf)
        })
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("C:\\"));
    let program = desktop.run(&argv, &folder).map_err(|_| "failed")?;
    let began = std::time::Instant::now();
    let desk = desktop.desk();
    let running = Arc::new(Running {
        pid: program.pid(),
        events: Mutex::new(Some(events)),
        stopping: AtomicBool::new(false),
        screen: Arc::new(Mutex::new(Screen {
            display: desktop.name(),
            hz: view.hz,
        })),
        desktop: Mutex::new(Some(desktop)),
    });
    app.state::<Hosted>()
        .apps()
        .insert(key.clone(), running.clone());
    running.tell(Said::RUNNING);

    std::thread::spawn(move || {
        let code = program.wait();
        let handed = began.elapsed() < HANDED_WITHIN && !desk.shown.load(Ordering::SeqCst);
        drop(program);
        let desktop = running
            .desktop
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        drop(desktop);
        let hosted = app.state::<Hosted>();
        let mut apps = hosted.apps();
        let ours = apps.get(&key).is_some_and(|one| Arc::ptr_eq(one, &running));
        if ours {
            apps.remove(&key);
        }
        drop(apps);
        if ours {
            hosted.end_peer(&key);
        }
        let stopped = running.stopping.load(Ordering::SeqCst);
        let mut said = Said::ended(stopped, code);
        if handed && !stopped {
            said.why = Some("handed");
        }
        running.tell(said);
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn run_on_its_display(
    app: AppHandle,
    key: String,
    argv: Vec<String>,
    cwd: Option<String>,
    view: View,
    events: Channel<Said>,
) -> Result<(), String> {
    use mac::{access, display, windows};
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    if !display::available() {
        return Err("isolation".to_owned());
    }
    if !access::allowed() {
        return Err("permission".to_owned());
    }
    if encoder::ffmpeg().is_some() {
        std::thread::spawn(|| encoder::working().len());
    }
    let (width, height) = display::screen(view.width, view.height, view.dpr);
    let display = display::Display::start(width, height, view.dpr).map_err(|_| "failed")?;
    let folder = cwd
        .map(PathBuf::from)
        .filter(|one| one.is_dir())
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));
    let (program, rest) = argv.split_first().ok_or("missing")?;
    let mut child = Command::new(program)
        .args(rest)
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| "failed")?;
    let pid = child.id();
    let process = i32::try_from(pid).map_err(|_| "failed")?;
    let running = Arc::new(Running {
        pid,
        events: Mutex::new(Some(events)),
        stopping: AtomicBool::new(false),
        screen: Arc::new(Mutex::new(Screen {
            display: format!("{}/{pid}", display.id),
            hz: view.hz,
        })),
        placer: Mutex::new(Some(windows::Placer::start(process, display.id))),
        display: Mutex::new(Some(display)),
        clipboard: clipboard::Clipboard::open(process),
    });
    app.state::<Hosted>()
        .apps()
        .insert(key.clone(), running.clone());
    running.tell(Said::RUNNING);

    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        let placer = running
            .placer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        drop(placer);
        let display = running
            .display
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        drop(display);
        let hosted = app.state::<Hosted>();
        let mut apps = hosted.apps();
        let ours = apps.get(&key).is_some_and(|one| Arc::ptr_eq(one, &running));
        if ours {
            apps.remove(&key);
        }
        drop(apps);
        if ours {
            hosted.end_peer(&key);
        }
        let stopped = running.stopping.load(Ordering::SeqCst);
        running.tell(Said::ended(stopped, code));
    });
    Ok(())
}

#[cfg(target_os = "linux")]
fn run_on_its_display(
    app: AppHandle,
    key: String,
    argv: Vec<String>,
    cwd: Option<String>,
    view: View,
    events: Channel<Said>,
) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    if !display::available() {
        return Err("display".to_owned());
    }
    if encoder::ffmpeg().is_some() {
        std::thread::spawn(|| encoder::working().len());
    }
    let (width, height) = display::screen(view.width, view.height, view.dpr);
    let display = display::Display::start(width, height, view.dpr).map_err(|_| "failed")?;
    let name = display.name();
    let sink = audio::Sink::make(display.number);
    let folder = cwd
        .map(PathBuf::from)
        .filter(|one| one.is_dir())
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));
    let (program, rest) = argv.split_first().ok_or("missing")?;
    let mut child = Command::new(program)
        .args(rest)
        .current_dir(folder)
        .env("DISPLAY", &name)
        .env_remove("WAYLAND_DISPLAY")
        .env("XDG_SESSION_TYPE", "x11")
        .env("GDK_BACKEND", "x11")
        .env("QT_QPA_PLATFORM", "xcb")
        .env("SDL_VIDEODRIVER", "x11")
        .env("MOZ_ENABLE_WAYLAND", "0")
        .env("ELECTRON_OZONE_PLATFORM_HINT", "x11")
        .envs(audio::environment(sink.as_ref()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| "failed")?;

    let running = Arc::new(Running {
        pid: child.id(),
        events: Mutex::new(Some(events)),
        stopping: AtomicBool::new(false),
        screen: Arc::new(Mutex::new(Screen {
            display: name,
            hz: view.hz,
        })),
        display: Mutex::new(Some(display)),
        sink: Mutex::new(sink),
    });
    app.state::<Hosted>()
        .apps()
        .insert(key.clone(), running.clone());
    running.tell(Said::RUNNING);

    std::thread::spawn(move || {
        let status = child.wait().ok();
        let display = running
            .display
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        drop(display);
        let sink = running
            .sink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        drop(sink);
        let hosted = app.state::<Hosted>();
        let mut apps = hosted.apps();
        let ours = apps.get(&key).is_some_and(|one| Arc::ptr_eq(one, &running));
        if ours {
            apps.remove(&key);
        }
        drop(apps);
        if ours {
            hosted.end_peer(&key);
        }
        let stopped = running.stopping.load(Ordering::SeqCst);
        running.tell(Said::ended(stopped, status.and_then(|one| one.code())));
    });
    Ok(())
}

#[tauri::command]
pub async fn apps_watch(
    webview: Webview,
    key: String,
    events: Channel<Said>,
) -> Result<bool, String> {
    crate::lane::off_the_runtime(move || -> Result<bool, String> {
        owner(&webview)?;
        usable(&key)?;
        let Some(running) = webview.state::<Hosted>().apps().get(&key).cloned() else {
            return Ok(false);
        };
        *running
            .events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(events);
        running.tell(Said::RUNNING);
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn apps_stop(webview: Webview, key: String) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        owner(&webview)?;
        usable(&key)?;
        let running = webview.state::<Hosted>().apps().get(&key).cloned();
        if let Some(running) = running {
            end(&running, std::time::Duration::from_secs(3));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn apps_view(webview: Webview, key: String, view: View) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        owner(&webview)?;
        usable(&key)?;
        let running = webview.state::<Hosted>().apps().get(&key).cloned();
        if let Some(running) = running {
            view_here(&running, view);
        }
        Ok(())
    })
    .await
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn view_here(_running: &Running, _view: View) {}

#[cfg(target_os = "windows")]
fn view_here(running: &Running, view: View) {
    running
        .screen
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .hz = view.hz;
    let (width, height) = desk_size(view);
    let desktop = running
        .desktop
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(desktop) = desktop.as_ref() {
        desktop.fit(width, height);
    }
}

#[cfg(target_os = "macos")]
fn view_here(running: &Running, view: View) {
    running
        .screen
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .hz = view.hz;
    let (width, height) = mac::display::screen(view.width, view.height, view.dpr);
    let display = running
        .display
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(display) = display.as_ref() {
        display.fit(width, height, view.dpr);
    }
}

#[cfg(target_os = "linux")]
fn view_here(running: &Running, view: View) {
    running
        .screen
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .hz = view.hz;
    let (width, height) = display::screen(view.width, view.height, view.dpr);
    let display = running
        .display
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(display) = display.as_ref() {
        let _ = display.fit(width, height, view.dpr);
    }
}

#[tauri::command]
pub async fn apps_signal(
    webview: Webview,
    key: String,
    data: String,
) -> Result<Option<String>, String> {
    crate::lane::off_the_runtime(move || -> Result<Option<String>, String> {
        owner(&webview)?;
        usable(&key)?;
        Ok(signal_here(&webview.state::<Hosted>(), &key, &data))
    })
    .await
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn signal_here(_hosted: &Hosted, _key: &str, data: &str) -> Option<String> {
    data.contains("\"offer\"")
        .then(|| serde_json::json!({ "cannot": "stopped" }).to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
fn signal_here(hosted: &Hosted, key: &str, data: &str) -> Option<String> {
    use stream::FromViewer;

    match serde_json::from_str::<FromViewer>(data).ok()? {
        FromViewer::Offer { offer } => {
            hosted.end_peer(key);
            let Some(running) = hosted.apps().get(key).cloned() else {
                return Some(stream::cannot_text("stopped"));
            };
            let (clipboard, sound) = shared_of(&running);
            let source = stream::Source {
                screen: running.screen.clone(),
                clipboard,
                sound,
                group: Some(running.pid),
            };
            match stream::Peer::answer(source, &offer) {
                Ok((peer, answer)) => {
                    hosted.peers().insert(key.to_owned(), peer);
                    Some(stream::answer_text(&answer))
                }
                Err(why) => Some(stream::cannot_text(why.word())),
            }
        }
        FromViewer::Candidate { candidate } => {
            if let Some(peer) = hosted.peers().get(key) {
                peer.candidate(&candidate.candidate);
            }
            None
        }
        FromViewer::Bye { .. } => {
            hosted.end_peer(key);
            None
        }
    }
}

#[cfg(target_os = "linux")]
fn shared_of(running: &Running) -> (Option<Arc<clipboard::Clipboard>>, Option<String>) {
    let clipboard = running
        .display
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .and_then(display::Display::clipboard);
    let sound = running
        .sink
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .map(audio::Sink::monitor);
    (clipboard, sound)
}

#[cfg(target_os = "windows")]
fn shared_of(_running: &Running) -> (Option<Arc<clipboard::Clipboard>>, Option<String>) {
    (None, None)
}

#[cfg(target_os = "macos")]
fn shared_of(running: &Running) -> (Option<Arc<clipboard::Clipboard>>, Option<String>) {
    (Some(running.clipboard.clone()), None)
}

fn end(running: &Arc<Running>, grace: std::time::Duration) {
    running.stopping.store(true, Ordering::SeqCst);
    let pid = running.pid;
    signal(pid, Signal::End);
    let making = move || {
        if signal(pid, Signal::Ask) {
            signal(pid, Signal::Kill);
        }
    };
    if grace.is_zero() {
        making();
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(grace);
            making();
        });
    }
}

#[derive(Clone, Copy)]
enum Signal {
    Ask,
    End,
    Kill,
}

#[cfg(unix)]
#[allow(
    unsafe_code,
    reason = "kill(2) is the kernel's own call for a process group and has no safe wrapper"
)]
fn signal(pid: u32, what: Signal) -> bool {
    let Ok(group) = i32::try_from(pid) else {
        return false;
    };
    let number = match what {
        Signal::Ask => 0,
        Signal::End => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
    };
    unsafe { libc::kill(-group, number) == 0 }
}

#[cfg(windows)]
fn signal(pid: u32, what: Signal) -> bool {
    let alive = desk::alive(pid);
    match what {
        Signal::Ask => {}
        Signal::End => desk::close(pid),
        Signal::Kill => desk::kill(pid),
    }
    alive
}

#[cfg(not(any(unix, windows)))]
fn signal(_pid: u32, _what: Signal) -> bool {
    false
}

pub fn end_all(app: &AppHandle) {
    let Some(hosted) = app.try_state::<Hosted>() else {
        return;
    };
    let all: Vec<Arc<Running>> = hosted.apps().drain().map(|(_, one)| one).collect();
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    hosted.peers().clear();
    if all.is_empty() {
        return;
    }
    for running in &all {
        end(running, std::time::Duration::ZERO);
    }
    std::thread::spawn(move || drop(all));
}

fn allowed_file(app: &AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("apps")
            .join("allowed.json"),
    )
}

fn allowed_key(path: &str, args: &[String], cwd: Option<&str>) -> String {
    serde_json::json!([path, args, cwd]).to_string()
}

fn allowed_here(
    app: &AppHandle,
    hosted: &Hosted,
    path: &str,
    args: &[String],
    cwd: Option<&str>,
) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let key = allowed_key(path, args, cwd);
    {
        let mut kept = hosted
            .allowed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let known = kept.get_or_insert_with(|| {
            allowed_file(app)
                .and_then(|file| std::fs::read_to_string(file).ok())
                .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
                .map(|list| list.into_iter().collect())
                .unwrap_or_default()
        });
        if known.contains(&key) {
            return true;
        }
    }

    let line = shown_line(path, args);
    let yes = app
        .dialog()
        .message(format!(
            "An application file in your space asks this computer to run:\n\n{line}\n\nIt runs on a display of its own, for whichever of your devices holds it. Only allow a program you trust."
        ))
        .title("Run this program?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Run it".to_owned(),
            "Don't run".to_owned(),
        ))
        .blocking_show();
    if !yes {
        return false;
    }

    let mut kept = hosted
        .allowed
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let known = kept.get_or_insert_with(HashSet::new);
    known.insert(key);
    if let Some(file) = allowed_file(app) {
        let mut list: Vec<&String> = known.iter().collect();
        list.sort();
        if let Some(folder) = file.parent() {
            let _ = std::fs::create_dir_all(folder);
        }
        let _ = std::fs::write(file, serde_json::to_string(&list).unwrap_or_default());
    }
    true
}

fn shown_line(path: &str, args: &[String]) -> String {
    std::iter::once(path)
        .chain(args.iter().map(String::as_str))
        .map(|word| {
            if word.is_empty() || word.contains([' ', '"', '\'', '\t']) {
                format!("\"{}\"", word.replace('"', "\\\""))
            } else {
                word.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(all(test, any(target_os = "linux", target_os = "windows")))]
fn in_time(test: impl FnOnce() + Send + 'static) {
    within(std::time::Duration::from_secs(120), test);
}

#[cfg(all(
    test,
    any(target_os = "linux", target_os = "windows", target_os = "macos")
))]
fn within(limit: std::time::Duration, test: impl FnOnce() + Send + 'static) {
    let (done, finished) = std::sync::mpsc::channel();
    let running = std::thread::spawn(move || {
        test();
        let _ = done.send(());
    });
    if let Err(std::sync::mpsc::RecvTimeoutError::Timeout) = finished.recv_timeout(limit) {
        panic!("still running after {limit:?}");
    }
    if let Err(panic) = running.join() {
        std::panic::resume_unwind(panic);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    #[test]
    fn a_test_that_hangs_fails_once_its_time_is_up_and_one_that_panics_with_its_own_words() {
        let began = std::time::Instant::now();
        let hung = std::panic::catch_unwind(|| {
            within(std::time::Duration::from_millis(200), || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
            });
        });
        assert!(hung.is_err());
        assert!(began.elapsed() < std::time::Duration::from_secs(5));
        let failed = std::panic::catch_unwind(|| {
            within(std::time::Duration::from_secs(5), || {
                panic!("its own words")
            });
        })
        .unwrap_err();
        assert_eq!(failed.downcast_ref::<&str>(), Some(&"its own words"));
        within(std::time::Duration::from_secs(5), || {});
    }

    #[test]
    fn reads_what_the_window_asks_to_run() {
        let installed: Run =
            serde_json::from_str(r#"{"kind":"installed","id":"gimp.desktop","name":"GIMP"}"#)
                .unwrap();
        assert!(matches!(installed, Run::Installed { id } if id == "gimp.desktop"));
        let path: Run = serde_json::from_str(
            r#"{"kind":"path","path":"/usr/bin/xterm","args":["-e","top"],"cwd":null}"#,
        )
        .unwrap();
        assert!(
            matches!(path, Run::Path { path, args, cwd: None } if path == "/usr/bin/xterm" && args == ["-e", "top"])
        );
        assert!(serde_json::from_str::<Run>(r#"{"kind":"shell","line":"rm -rf ~"}"#).is_err());
    }

    #[test]
    fn remembers_a_program_by_its_path_its_arguments_and_its_folder() {
        let one = allowed_key("/usr/bin/xterm", &["-e".to_owned(), "top".to_owned()], None);
        assert_ne!(
            one,
            allowed_key(
                "/usr/bin/xterm",
                &["-e".to_owned(), "htop".to_owned()],
                None
            )
        );
        assert_ne!(
            one,
            allowed_key(
                "/usr/bin/xterm",
                &["-e".to_owned(), "top".to_owned()],
                Some("/tmp")
            )
        );
        assert_eq!(
            one,
            allowed_key("/usr/bin/xterm", &["-e".to_owned(), "top".to_owned()], None)
        );
    }

    #[test]
    fn shows_the_line_it_asks_about_as_it_would_be_typed() {
        assert_eq!(
            shown_line(
                "/opt/My App/run",
                &["--x".to_owned(), "say \"hi\"".to_owned()]
            ),
            r#""/opt/My App/run" --x "say \"hi\"""#
        );
    }

    #[test]
    fn takes_a_key_of_an_id_and_nothing_else() {
        assert!(usable("n_8f2c-01").is_ok());
        assert!(usable("../x").is_err());
        assert!(usable("").is_err());
    }
}
