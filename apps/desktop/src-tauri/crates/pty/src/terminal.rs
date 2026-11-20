pub mod history;
pub mod hold;
pub mod picture;
pub mod process;
pub mod remote;
mod session;
pub mod shells;
mod ssh_config;
mod tmux;
mod wire;

use orden_base::Held as _;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, Webview};

use session::{Fresh, Out, Place, Session};

#[derive(Default)]
struct Terminals {
    sessions: Mutex<HashMap<String, Held>>,
    closing: AtomicBool,
    loads: Mutex<HashMap<String, u64>>,
    tick: AtomicU64,
}
struct Held {
    owner: String,
    session: Arc<Session>,
    remote: bool,
    kept: bool,
}
pub fn ends(kept: bool, killing: bool) -> bool {
    killing || !kept
}
fn release(held: &Held, killing: bool) {
    if ends(held.kept, killing) {
        held.session.end();
    } else {
        held.session.detach();
    }
}
#[derive(Serialize)]
pub struct Spawned {
    pid: Option<u32>,
    fresh: bool,
}
impl Terminals {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Held>> {
        self.sessions.held()
    }
    fn held(&self, owner: &str, id: &str) -> Result<(Arc<Session>, bool), String> {
        match self.lock().get(id) {
            Some(held) if held.owner == owner => Ok((Arc::clone(&held.session), held.remote)),
            _ => Err(format!("no terminal {id}")),
        }
    }
    fn with<T>(
        &self,
        owner: &str,
        id: &str,
        with: impl FnOnce(&Session) -> T,
    ) -> Result<T, String> {
        let (session, _) = self.held(owner, id)?;
        Ok(with(&session))
    }
    fn stamp(&self) -> u64 {
        self.tick.load(Ordering::SeqCst)
    }
    fn ended_since(&self, owner: &str, stamp: u64) -> bool {
        self.loads.held().get(owner).is_some_and(|ended| *ended > stamp)
    }
    fn end_where(&self, owner: Option<&str>, kill: bool) {
        if let Some(owner) = owner {
            let ended = self.tick.fetch_add(1, Ordering::SeqCst) + 1;
            self.loads.held().insert(owner.to_owned(), ended);
        }
        let ending: Vec<Held> = {
            let mut sessions = self.lock();
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, held)| owner.is_none_or(|owner| held.owner == owner))
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };
        if ending.is_empty() {
            return;
        }
        std::thread::spawn(move || {
            for held in &ending {
                release(held, kill);
            }
        });
    }
}
pub fn managed(builder: tauri::Builder<orden_base::Engine>) -> tauri::Builder<orden_base::Engine> {
    builder.manage(Terminals::default())
}
pub fn page_started(webview: &Webview) {
    if let Some(terminals) = webview.try_state::<Terminals>() {
        terminals.end_where(Some(webview.label()), false);
    }
}
pub fn window_gone(app: &AppHandle, label: &str, kill: bool) {
    if let Some(terminals) = app.try_state::<Terminals>() {
        terminals.end_where(Some(label), kill);
    }
}
pub fn end_all(app: &AppHandle) {
    let Some(terminals) = app.try_state::<Terminals>() else {
        return;
    };
    let ending: Vec<Held> = {
        let mut sessions = terminals.lock();
        terminals.closing.store(true, Ordering::SeqCst);
        sessions.drain().map(|(_, held)| held).collect()
    };
    for held in &ending {
        release(held, false);
    }
}
fn place(webview: &Webview) -> Result<Place, String> {
    let data = orden_base::paths::data_dir(webview.app_handle())?;
    let program = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(Place {
        folder: data.join("terminal-held"),
        starter: hold::Starter { program, args: vec![hold::MODE.to_owned()] },
    })
}
fn owner(webview: &Webview) -> Result<String, String> {
    orden_base::labels::own_window(webview)
}
fn usable(id: &str) -> Result<(), String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(())
    } else {
        Err("not a terminal name".to_owned())
    }
}
#[tauri::command]
pub async fn terminal_shells(webview: Webview) -> Result<Vec<shells::Offered>, String> {
    orden_base::lane::off_the_runtime(move || -> Result<Vec<shells::Offered>, String> {
        owner(&webview)?;
        Ok(shells::detected().iter().map(shells::Shell::offered).collect())
    })
    .await
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn pty_spawn(
    webview: Webview,
    id: String,
    shell: String,
    folder: Option<String>,
    cols: u16,
    rows: u16,
    key: Option<String>,
    plain: Option<bool>,
    name: Option<String>,
    kept: Option<bool>,
    output: Channel<InvokeResponseBody>,
) -> Result<Spawned, String> {
    let stamp = webview.state::<Terminals>().stamp();
    orden_base::lane::off_the_runtime(move || -> Result<Spawned, String> {
        let owner = owner(&webview)?;
        usable(&id)?;
        let key = key.filter(|one| usable(one).is_ok()).unwrap_or_else(|| id.clone());
        let terminals = webview.state::<Terminals>();
        if terminals.lock().contains_key(&id) {
            return Err(format!("terminal {id} is already running"));
        }
        let host = remote::host_id(&shell);
        let remote = host.is_some();
        let place = place(&webview)?;
        let label = hold::Label {
            shell: shell.clone(),
            name: name.filter(|one| !one.trim().is_empty()),
            folder: folder.clone(),
        };
        let (session, started) = Session::open(&place, &key, cols, rows, || match host {
            Some(host) => remote::connect(&webview, host, &key, plain.unwrap_or(false), label),
            None => Ok(Fresh {
                launch: match tmux::name_of(&shell) {
                    Some(name) => tmux::launch(name, dirs::home_dir())?,
                    None => shells::find(&shell)
                        .ok_or_else(|| format!("no shell {shell} here"))?
                        .launch(folder.as_deref(), &shells::ThisMachine),
                },
                farewell: Vec::new(),
                label,
            }),
        })?;
        let pid = session.pid();
        let fresh = session.fresh();
        let session = Arc::new(session);
        if !kept_alone(&terminals, &id, owner, stamp, &session, remote, kept.unwrap_or(true)) {
            if fresh {
                session.end();
            } else {
                session.detach();
            }
            started.run(Box::new(|_| {}), |_| {});
            return Err(format!("terminal {id} is already running"));
        }
        let app = webview.app_handle().clone();
        started.run(
            Box::new(move |out| {
                let _ = match out {
                    Out::Bytes(bytes) => output.send(InvokeResponseBody::Raw(bytes)),
                    Out::Screen(bytes, cols, rows) => output.send(InvokeResponseBody::Json(
                        serde_json::json!({
                            "screen": String::from_utf8_lossy(&bytes),
                            "cols": cols,
                            "rows": rows,
                        })
                        .to_string(),
                    )),
                    Out::Writer(writer) => output.send(InvokeResponseBody::Json(
                        serde_json::json!({ "writer": writer }).to_string(),
                    )),
                    Out::Exit(exit) => {
                        output.send(InvokeResponseBody::Json(format!("{{\"exit\":{exit}}}")))
                    }
                };
            }),
            move |mine| {
                let Some(terminals) = app.try_state::<Terminals>() else {
                    return;
                };
                let gone = {
                    let mut sessions = terminals.lock();
                    let this = sessions.get(&id).is_some_and(|held| mine(&held.session));
                    if this {
                        sessions.remove(&id)
                    } else {
                        None
                    }
                };
                drop(gone);
            },
        );
        Ok(Spawned { pid, fresh })
    })
    .await
}
#[derive(Serialize)]
pub struct Shown {
    #[serde(flatten)]
    listed: session::Listed,
    program: Option<String>,
    open: bool,
}
#[tauri::command]
pub async fn terminal_sessions(webview: Webview) -> Result<Vec<Shown>, String> {
    orden_base::lane::off_the_runtime(move || -> Result<Vec<Shown>, String> {
        let owner = owner(&webview)?;
        let place = place(&webview)?;
        let here: Vec<String> = webview
            .state::<Terminals>()
            .lock()
            .values()
            .filter(|held| held.owner == owner)
            .map(|held| held.session.key().to_owned())
            .collect();
        Ok(session::listed(&place)
            .into_iter()
            .map(|listed| {
                let program = if remote::host_id(&listed.label.shell).is_some() {
                    None
                } else {
                    process::program(listed.shell)
                };
                let open = here.contains(&listed.key);
                Shown { listed, program, open }
            })
            .collect())
    })
    .await
}
#[tauri::command]
pub async fn terminal_tmux(webview: Webview) -> Result<Vec<tmux::Found>, String> {
    orden_base::lane::off_the_runtime(move || -> Result<Vec<tmux::Found>, String> {
        owner(&webview)?;
        Ok(tmux::listed())
    })
    .await
}
#[tauri::command]
pub async fn pty_name(webview: Webview, key: String, name: String) -> Result<(), String> {
    orden_base::lane::off_the_runtime(move || -> Result<(), String> {
        owner(&webview)?;
        usable(&key)?;
        session::told(&place(&webview)?, &key, wire::NAME, name.as_bytes())
    })
    .await
}
#[tauri::command]
pub async fn pty_end(webview: Webview, key: String) -> Result<(), String> {
    orden_base::lane::off_the_runtime(move || -> Result<(), String> {
        owner(&webview)?;
        usable(&key)?;
        session::told(&place(&webview)?, &key, wire::END, &[])
    })
    .await
}
#[tauri::command]
pub async fn pty_held(webview: Webview, key: String) -> Result<bool, String> {
    orden_base::lane::off_the_runtime(move || -> Result<bool, String> {
        owner(&webview)?;
        usable(&key)?;
        Ok(session::held(&place(&webview)?, &key))
    })
    .await
}
fn kept_alone(
    terminals: &Terminals,
    id: &str,
    owner: String,
    stamp: u64,
    session: &Arc<Session>,
    remote: bool,
    kept: bool,
) -> bool {
    let mut sessions = terminals.lock();
    if terminals.closing.load(Ordering::SeqCst)
        || sessions.contains_key(id)
        || terminals.ended_since(&owner, stamp)
    {
        return false;
    }
    sessions.insert(id.to_owned(), Held { owner, session: Arc::clone(session), remote, kept });
    true
}
#[tauri::command]
pub fn pty_write(webview: Webview, id: String, data: String, binary: bool) -> Result<(), String> {
    let owner = owner(&webview)?;
    let bytes = if binary {
        data.chars().map(|one| u8::try_from(u32::from(one)).unwrap_or(b'?')).collect()
    } else {
        data.into_bytes()
    };
    webview.state::<Terminals>().with(&owner, &id, |session| session.write(bytes))
}
#[tauri::command(async)]
pub fn pty_resize(webview: Webview, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, |session| session.resize(cols, rows))
}
#[tauri::command]
pub fn pty_seen(webview: Webview, id: String, bytes: usize) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, |session| session.seen(bytes))
}
#[tauri::command(async)]
pub fn pty_busy(webview: Webview, id: String) -> Result<bool, String> {
    let owner = owner(&webview)?;
    let (session, remote) = webview.state::<Terminals>().held(&owner, &id)?;
    Ok(remote || session.busy())
}
#[tauri::command(async)]
pub fn pty_program(webview: Webview, id: String) -> Result<Option<String>, String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, Session::program)
}
#[tauri::command(async)]
pub fn pty_ssh(webview: Webview, id: String) -> Result<Option<remote::Destination>, String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, Session::ssh)
}
#[tauri::command(async)]
pub fn pty_folder(webview: Webview, id: String) -> Result<Option<String>, String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, Session::folder)
}
#[tauri::command(async)]
pub fn pty_usage(webview: Webview, id: String) -> Result<Option<orden_base::usage::Usage>, String> {
    let owner = owner(&webview)?;
    let pid = webview.state::<Terminals>().with(&owner, &id, Session::shell)?;
    Ok(pid.and_then(|pid| {
        orden_base::usage::sample(&format!("pty:{id}"), orden_base::usage::Whose::Tree(pid))
    }))
}
fn let_go(webview: &Webview, id: &str) -> Result<Option<Held>, String> {
    let owner = owner(webview)?;
    let terminals = webview.state::<Terminals>();
    let mut sessions = terminals.lock();
    Ok(match sessions.get(id) {
        Some(held) if held.owner == owner => sessions.remove(id),
        _ => None,
    })
}
#[tauri::command]
pub fn pty_kill(webview: Webview, id: String) -> Result<(), String> {
    if let Some(held) = let_go(&webview, &id)? {
        std::thread::spawn(move || held.session.end());
    }
    Ok(())
}
#[tauri::command]
pub fn pty_detach(webview: Webview, id: String) -> Result<(), String> {
    if let Some(held) = let_go(&webview, &id)? {
        release(&held, false);
    }
    Ok(())
}
#[tauri::command]
pub fn pty_take(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, Session::take)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_name_is_a_key_and_nothing_else() {
        assert!(usable("a1b2-c3_d4").is_ok());
        for bad in ["", "../x", "a b", "a;b", &"x".repeat(81)] {
            assert!(usable(bad).is_err(), "{bad:?} was taken");
        }
    }
    fn idle_shell() -> Session {
        static FOLDER: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let (program, args) = if cfg!(windows) {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
            (std::path::PathBuf::from(root).join(r"System32\cmd.exe"), vec!["/q".to_owned()])
        } else {
            (std::path::PathBuf::from("/bin/sh"), Vec::new())
        };
        let launch =
            shells::Launch { program, args, folder: Some(std::env::temp_dir()), env: Vec::new() };
        let place = Place {
            folder: FOLDER
                .get_or_init(|| tempfile::tempdir().expect("a folder"))
                .path()
                .to_path_buf(),
            starter: hold::tests::starter(),
        };
        let key = format!("idle{}", NEXT.fetch_add(1, Ordering::SeqCst));
        let (session, started) = Session::open(&place, &key, 80, 24, || {
            Ok(Fresh { launch, farewell: Vec::new(), label: hold::Label::default() })
        })
        .expect("a shell");
        started.run(Box::new(|_| {}), |_| {});
        session
    }
    #[test]
    fn a_second_shell_under_a_name_in_use_never_takes_the_first_ones_place() {
        let terminals = Terminals::default();
        let first = Arc::new(idle_shell());
        let second = Arc::new(idle_shell());
        assert!(kept_alone(&terminals, "t1", "main".to_owned(), 0, &first, false, true));
        assert!(!kept_alone(&terminals, "t1", "main".to_owned(), 0, &second, false, true));
        let (held, _) = terminals.held("main", "t1").expect("held");
        assert!(Arc::ptr_eq(&held, &first));
        terminals.closing.store(true, Ordering::SeqCst);
        assert!(!kept_alone(&terminals, "t2", "main".to_owned(), 0, &second, false, true));
        first.end();
        second.end();
    }
    #[test]
    fn a_shell_started_for_a_page_since_reloaded_is_never_kept() {
        let terminals = Terminals::default();
        let stamp = terminals.stamp();
        terminals.end_where(Some("main"), true);
        let late = Arc::new(idle_shell());
        assert!(!kept_alone(&terminals, "t1", "main".to_owned(), stamp, &late, false, true));
        assert!(terminals.held("main", "t1").is_err());
        let other = Arc::new(idle_shell());
        assert!(kept_alone(&terminals, "t2", "other".to_owned(), stamp, &other, false, true));
        let fresh = Arc::new(idle_shell());
        assert!(kept_alone(
            &terminals,
            "t1",
            "main".to_owned(),
            terminals.stamp(),
            &fresh,
            false,
            true
        ));
        late.end();
        other.end();
        fresh.end();
    }
    #[test]
    fn a_session_is_used_with_the_list_of_terminals_let_go() {
        let terminals = Terminals::default();
        terminals.lock().insert(
            "t1".to_owned(),
            Held {
                owner: "main".to_owned(),
                session: Arc::new(idle_shell()),
                remote: true,
                kept: true,
            },
        );
        let free = terminals.with("main", "t1", |_| terminals.sessions.try_lock().is_ok());
        assert_eq!(free, Ok(true));
        let (session, remote) = terminals.held("main", "t1").expect("held");
        assert!(remote);
        assert!(!session.busy());
        assert!(terminals.held("other", "t1").is_err());
        session.end();
    }
}
