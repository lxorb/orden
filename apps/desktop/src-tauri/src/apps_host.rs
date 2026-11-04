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

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

#[cfg(target_os = "linux")]
mod display;
mod installed;

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

/// The holder's view, which the display is made to: CSS pixels at a ratio.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct View {
    pub width: f64,
    pub height: f64,
    pub dpr: f64,
}

/// Where the application stands, as the window hears it and says it on to the relay:
/// the wire's `state` frame (`@orden/online/apps`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Said {
    pub state: &'static str,
    pub code: Option<i32>,
}

/// One application running.
struct Running {
    /// The process, and its group.
    pid: u32,
    /// Whoever is told what happens to it: the window that asked last.
    events: Mutex<Option<Channel<Said>>>,
    /// Whether it was stopped, rather than ending by itself.
    stopping: AtomicBool,
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
/// and the programs the reader here said yes to.
#[derive(Default)]
pub struct Hosted {
    apps: Mutex<HashMap<String, Arc<Running>>>,
    allowed: Mutex<Option<HashSet<String>>>,
}

impl Hosted {
    fn apps(&self) -> MutexGuard<'_, HashMap<String, Arc<Running>>> {
        self.apps
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
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
/// `refused`, `isolation`, `display` or `failed`.
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
        running.tell(Said {
            state: "running",
            code: None,
        });
        return Ok(());
    }

    let (argv, cwd) = match &run {
        Run::Installed { id } => (installed::find(id).ok_or("missing")?.argv, None),
        Run::Path { path, args, cwd } => {
            if !installed::on_path(path) {
                return Err("missing".to_owned());
            }
            let mut argv = vec![path.clone()];
            argv.extend(args.iter().cloned());
            (argv, cwd.clone())
        }
    };
    if !cfg!(target_os = "linux") {
        return Err("isolation".to_owned());
    }
    if let Run::Path { path, args, cwd } = &run {
        if !allowed_here(webview.app_handle(), &hosted, path, args, cwd.as_deref()) {
            return Err("refused".to_owned());
        }
    }
    run_on_its_display(webview.app_handle().clone(), key, argv, cwd, view, events)
}

#[cfg(not(target_os = "linux"))]
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
        .env("DISPLAY", display.name())
        // Its own display and no other: a toolkit that would rather speak Wayland is
        // told there is none, or it would open on the reader's desktop.
        .env_remove("WAYLAND_DISPLAY")
        .env("XDG_SESSION_TYPE", "x11")
        .env("GDK_BACKEND", "x11")
        .env("QT_QPA_PLATFORM", "xcb")
        .env("SDL_VIDEODRIVER", "x11")
        .env("MOZ_ENABLE_WAYLAND", "0")
        .env("ELECTRON_OZONE_PLATFORM_HINT", "x11")
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
    });
    app.state::<Hosted>()
        .apps()
        .insert(key.clone(), running.clone());
    running.tell(Said {
        state: "running",
        code: None,
    });

    // The one thing that waits for it: when it ends, its display goes and the window is
    // told whether it was stopped or ended by itself.
    std::thread::spawn(move || {
        let status = child.wait().ok();
        drop(display);
        let hosted = app.state::<Hosted>();
        let mut apps = hosted.apps();
        if apps.get(&key).is_some_and(|one| Arc::ptr_eq(one, &running)) {
            apps.remove(&key);
        }
        drop(apps);
        let stopped = running.stopping.load(Ordering::SeqCst);
        running.tell(Said {
            state: if stopped { "stopped" } else { "exited" },
            code: if stopped {
                None
            } else {
                status.and_then(|one| one.code())
            },
        });
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
    running.tell(Said {
        state: "running",
        code: None,
    });
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

#[cfg(not(unix))]
fn signal(_pid: u32, _what: Signal) -> bool {
    false
}

/// Orden is quitting: nothing it started is left running.
pub fn end_all(app: &AppHandle) {
    let Some(hosted) = app.try_state::<Hosted>() else {
        return;
    };
    let all: Vec<Arc<Running>> = hosted.apps().drain().map(|(_, one)| one).collect();
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
