//! The host of an application (issue 1063, step 3; docs/apps.md): this computer running
//! one of the reader's applications for a tab on another, on a display of its own.
//!
//! The window is the host's other half: it keeps the relay's socket, hears Start, Stop
//! and Restart from the device holding the application, and asks here
//! (`lib/apps/host.svelte.ts`). What is here is what runs.
//!
//! **What may run.** An application file is synced, so its words come from whichever of
//! the reader's devices wrote it, and this computer does not take a command line from it:
//!
//! - an installed application is started by the id this module found (`installed.rs`)
//!   and the command its own entry holds, as a terminal's shell is by the id
//!   `terminal/shells.rs` found;
//! - a program by its path runs only once the reader at this computer has said yes to
//!   that exact program, those arguments and that folder, in a dialog of the system's
//!   own that no page can answer, and the yes is kept for next time (`allowed.json` in
//!   the app's local data);
//! - and only the app's own document windows may ask, as for a terminal.
//!
//! **Nowhere but its own display.** On Linux an application runs on an Xvfb of its own
//! (`display.rs`), never the reader's desktop, so nothing it draws or does lands on
//! their screen or takes their mouse. Windows and macOS have no such display yet (step
//! 8), so there nothing is started at all and the tab says so (`isolation`).
//!
//! **What outlives what.** An application keeps running when the device viewing it
//! leaves and when this window reloads - the window asks again, and hears where it
//! stands - and stops when it is stopped, when its file goes, and when Orden quits, with
//! everything it started: it runs in a process group of its own, which is what is ended.
//!
//! **Its picture** goes to the device holding it, peer to peer (`stream.rs`, step 4),
//! once that device offers to take it; the offer and the answer come and go through the
//! window and the relay (`apps_signal`).
//!
//! **Its size is the holder's tab's** (step 5): the window hands on the holder's view
//! whenever it changes - the tab resized, moved to another monitor, taken over by
//! another device - and the display is made that size and ratio (`apps_view`), its
//! windows fitted to it (`wm.rs`), and its picture read at that refresh rate.
//!
//! **Its sound and its clipboard** (step 6): it plays into a sink of its own, never out
//! of this computer's speakers, which goes to the holder with its picture (`audio.rs`);
//! and text goes between its clipboard and the holder's while the holder shares it
//! (`clipboard.rs`).

#![cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]

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
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod encoder;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod events;
#[cfg(target_os = "linux")]
mod input;
mod installed;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod stream;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod stun;
#[cfg(target_os = "linux")]
mod wm;

// Windows' desktop of its own stands where Linux's display does, with the same faces.
#[cfg(target_os = "windows")]
use desk::{audio, capture, clipboard, input};

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

const REFUSED: &str = "only the app's own windows may host an application";

/// What the window asks to run: an installed application by its id, or a program by
/// its path, with its arguments and the folder it starts in.
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

/// The holder's view, which the display is made to: CSS pixels at a ratio, and the
/// refresh rate its picture is read at.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct View {
    pub width: f64,
    pub height: f64,
    pub dpr: f64,
    #[serde(default = "sixty")]
    pub hz: f64,
}

/// The refresh rate of a view that says none.
fn sixty() -> f64 {
    60.0
}

/// The display an application draws on, as its picture is read from it: its name, and
/// the holder's refresh rate as it is now. Its size is the display's own.
#[derive(Clone, Debug)]
pub struct Screen {
    pub display: String,
    pub hz: f64,
}

/// Where the application stands, as the window hears it and says it on to the relay:
/// the wire's `state` frame (`@orden/online/apps`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Said {
    pub state: &'static str,
    pub code: Option<i32>,
    /// Why it ended as it did, where that can be told: `handed`, an application that
    /// handed itself to a copy already running on the reader's desktop at once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<&'static str>,
}

impl Said {
    const RUNNING: Said = Said {
        state: "running",
        code: None,
        why: None,
    };

    /// It ended: stopped, or by itself with its code.
    fn ended(stopped: bool, code: Option<i32>) -> Said {
        Said {
            state: if stopped { "stopped" } else { "exited" },
            code: if stopped { None } else { code },
            why: None,
        }
    }
}

/// One application running.
struct Running {
    /// The process, and its group.
    pid: u32,
    /// Whoever is told what happens to it: the window that asked last.
    events: Mutex<Option<Channel<Said>>>,
    /// Whether it was stopped, rather than ending by itself.
    stopping: AtomicBool,
    /// Its display, as its picture is read.
    screen: Arc<Mutex<Screen>>,
    /// The display itself, made the holder's size; gone once the application is.
    #[cfg(target_os = "linux")]
    display: Mutex<Option<display::Display>>,
    /// Its sink on the sound server, where there is one; gone with it too.
    #[cfg(target_os = "linux")]
    sink: Mutex<Option<audio::Sink>>,
    /// Its desktop of its own, made the holder's size; gone once the application is.
    #[cfg(target_os = "windows")]
    desktop: Mutex<Option<desk::Desktop>>,
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

/// Every application this computer runs, by the key the window gave it (its file's id),
/// the programs the reader here said yes to, and the picture of each that a device is
/// taking.
#[derive(Default)]
pub struct Hosted {
    apps: Mutex<HashMap<String, Arc<Running>>>,
    allowed: Mutex<Option<HashSet<String>>>,
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    peers: Mutex<HashMap<String, stream::Peer>>,
}

impl Hosted {
    fn apps(&self) -> MutexGuard<'_, HashMap<String, Arc<Running>>> {
        self.apps
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    fn peers(&self) -> MutexGuard<'_, HashMap<String, stream::Peer>> {
        self.peers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Ends the picture of one application, if a device was taking it.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    fn end_peer(&self, key: &str) {
        let gone = self.peers().remove(key);
        drop(gone);
    }
}

/// The window this call came from, when it is one of ours; see terminal.rs.
fn owner(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err(REFUSED.to_owned())
    }
}

/// A key the window may give: an id's letters, digits, `-` and `_`.
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

/// What this computer has installed, for New application's chooser and its catalogue.
#[tauri::command(async)]
pub fn apps_installed(webview: Webview) -> Result<Vec<installed::Listed>, String> {
    owner(&webview)?;
    Ok(installed::installed())
}

/// Starts it, or - already running - tells this window where it stands. Errs with the
/// wire's reason it did not start (`NotStarted` in `@orden/online/apps`): `missing`,
/// `packaged`, `refused`, `isolation`, `display` or `failed`.
#[tauri::command(async)]
pub fn apps_start(
    webview: Webview,
    key: String,
    run: Run,
    view: View,
    events: Channel<Said>,
) -> Result<(), String> {
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
            // A Store application is started by Windows itself, on the reader's desktop
            // and no other.
            if entry.packaged {
                return Err("packaged".to_owned());
            }
            (entry.argv, entry.cwd)
        }
        Run::Path { path, args, cwd } => {
            if !installed::on_path(path) {
                return Err("missing".to_owned());
            }
            let mut argv = vec![path.clone()];
            argv.extend(args.iter().cloned());
            (argv, cwd.clone())
        }
    };
    if !cfg!(any(target_os = "linux", target_os = "windows")) {
        return Err("isolation".to_owned());
    }
    if let Run::Path { path, args, cwd } = &run {
        if !allowed_here(webview.app_handle(), &hosted, path, args, cwd.as_deref()) {
            return Err("refused".to_owned());
        }
    }
    run_on_its_display(webview.app_handle().clone(), key, argv, cwd, view, events)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
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

/// The size a desktop of its own is made, for a view in CSS pixels at a ratio: device
/// pixels, even, as encoders want them.
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

/// How soon an application that ended without a window is taken to have handed itself to
/// a copy already running on the reader's desktop.
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

    // As on Linux: when everything it started has ended, its desktop goes and the window
    // is told how it ended.
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
    // Which encoders work here is found by trying each, which takes a moment: begun now,
    // it is known by the time a viewer asks for the picture.
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
        // Its own display and no other: a toolkit that would rather speak Wayland is
        // told there is none, or it would open on the reader's desktop.
        .env_remove("WAYLAND_DISPLAY")
        .env("XDG_SESSION_TYPE", "x11")
        .env("GDK_BACKEND", "x11")
        .env("QT_QPA_PLATFORM", "xcb")
        .env("SDL_VIDEODRIVER", "x11")
        .env("MOZ_ENABLE_WAYLAND", "0")
        .env("ELECTRON_OZONE_PLATFORM_HINT", "x11")
        // Its sound into a sink of its own, or nowhere: never this computer's speakers.
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

    // The one thing that waits for it: when it ends, its display goes and the window is
    // told whether it was stopped or ended by itself.
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

/// Hears where it stands, if it is running: the window that reloaded asks again. Starts
/// nothing; answers whether it runs.
#[tauri::command(async)]
pub fn apps_watch(webview: Webview, key: String, events: Channel<Said>) -> Result<bool, String> {
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
}

/// Stops it, with everything it started; the window hears `stopped` once it has gone.
#[tauri::command(async)]
pub fn apps_stop(webview: Webview, key: String) -> Result<(), String> {
    owner(&webview)?;
    usable(&key)?;
    let running = webview.state::<Hosted>().apps().get(&key).cloned();
    if let Some(running) = running {
        end(&running, std::time::Duration::from_secs(3));
    }
    Ok(())
}

/// The holder's view, as it changes: the display made its size and ratio, and its
/// picture read at its refresh rate. Nothing running, nothing happens; the next start is
/// made at the view the window has kept.
#[tauri::command(async)]
pub fn apps_view(webview: Webview, key: String, view: View) -> Result<(), String> {
    owner(&webview)?;
    usable(&key)?;
    let running = webview.state::<Hosted>().apps().get(&key).cloned();
    if let Some(running) = running {
        view_here(&running, view);
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
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

/// What the device holding it says of its picture, `data` of its `signal` frame
/// (`stream.rs`): an offer is answered, a candidate taken, a goodbye ends it. Answers
/// what to send back, if anything: the answer, or why there is no picture.
#[tauri::command(async)]
pub fn apps_signal(webview: Webview, key: String, data: String) -> Result<Option<String>, String> {
    owner(&webview)?;
    usable(&key)?;
    Ok(signal_here(&webview.state::<Hosted>(), &key, &data))
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn signal_here(_hosted: &Hosted, _key: &str, data: &str) -> Option<String> {
    // Nothing runs here yet (`isolation`), so there is no picture to offer.
    data.contains("\"offer\"")
        .then(|| serde_json::json!({ "cannot": "stopped" }).to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn signal_here(hosted: &Hosted, key: &str, data: &str) -> Option<String> {
    use stream::FromViewer;

    match serde_json::from_str::<FromViewer>(data).ok()? {
        FromViewer::Offer { offer } => {
            // A new offer is a new picture: whatever was sent before ends first.
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

/// What of an application goes to the holder besides its picture: its clipboard and its
/// sink's monitor, on Linux.
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

/// On Windows, neither: both are the reader's own at the host.
#[cfg(target_os = "windows")]
fn shared_of(_running: &Running) -> (Option<Arc<clipboard::Clipboard>>, Option<String>) {
    (None, None)
}

/// Asks its group to end, and makes it after `grace`.
fn end(running: &Arc<Running>, grace: std::time::Duration) {
    running.stopping.store(true, Ordering::SeqCst);
    let pid = running.pid;
    signal(pid, Signal::End);
    let making = move || {
        std::thread::sleep(grace);
        if signal(pid, Signal::Ask) {
            signal(pid, Signal::Kill);
        }
    };
    if grace.is_zero() {
        making();
    } else {
        std::thread::spawn(making);
    }
}

/// What is said to an application's process group.
#[derive(Clone, Copy)]
enum Signal {
    /// Whether it is still there.
    Ask,
    /// Asked to end.
    End,
    /// Made to.
    Kill,
}

/// Says it to the group the application leads; answers whether the group was there.
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
    // SAFETY: a negated id names the process group; the call touches no memory of ours.
    unsafe { libc::kill(-group, number) == 0 }
}

/// Says it to everything the application started on its desktop: whether any of it is
/// still there, its windows asked to close, or its job ended.
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

/// Orden is quitting: nothing it started is left running.
pub fn end_all(app: &AppHandle) {
    let Some(hosted) = app.try_state::<Hosted>() else {
        return;
    };
    let all: Vec<Arc<Running>> = hosted.apps().drain().map(|(_, one)| one).collect();
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    hosted.peers().clear();
    if all.is_empty() {
        return;
    }
    for running in &all {
        end(running, std::time::Duration::ZERO);
    }
}

/// The programs the reader here said yes to, kept in the app's local data.
fn allowed_file(app: &AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("apps")
            .join("allowed.json"),
    )
}

/// What one program, with its arguments and folder, is remembered as.
fn allowed_key(path: &str, args: &[String], cwd: Option<&str>) -> String {
    serde_json::json!([path, args, cwd]).to_string()
}

/// Whether the reader at this computer lets this program run: said yes before, or says
/// so now, in a dialog of the system's own.
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

/// A program and its arguments as a reader reads a command line: quoted where a word
/// has a space or a quote in it.
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

#[cfg(test)]
mod tests {
    use super::*;

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
