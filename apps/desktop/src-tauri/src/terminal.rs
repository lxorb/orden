pub mod history;
pub mod picture;
pub(crate) mod process;
pub mod remote;
mod session;
pub mod shells;
mod ssh_config;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Webview};

use session::{Out, Session};

#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<String, Held>>,
}

struct Held {
    owner: String,
    session: Arc<Session>,
    remote: bool,
}

#[derive(Serialize)]
pub struct Spawned {
    pid: Option<u32>,
}

const REFUSED: &str = "not a window of this app";

impl Terminals {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Held>> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
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

    fn end_where(&self, owner: Option<&str>) {
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
            for held in ending {
                held.session.end();
            }
        });
    }
}

pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder
        .manage(Terminals::default())
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                if let Some(terminals) = webview.try_state::<Terminals>() {
                    terminals.end_where(Some(webview.label()));
                }
            }
        })
}

pub fn window_gone(app: &AppHandle, label: &str) {
    if let Some(terminals) = app.try_state::<Terminals>() {
        terminals.end_where(Some(label));
    }
}

pub fn end_all(app: &AppHandle) {
    let Some(terminals) = app.try_state::<Terminals>() else {
        return;
    };
    let ending: Vec<Held> = terminals.lock().drain().map(|(_, held)| held).collect();
    for held in ending {
        held.session.end();
    }
}

fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err(REFUSED.to_owned())
    }
}

fn usable(id: &str) -> Result<(), String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(())
    } else {
        Err("not a terminal name".to_owned())
    }
}

#[tauri::command]
pub async fn terminal_shells(webview: Webview) -> Result<Vec<shells::Offered>, String> {
    crate::lane::off_the_runtime(move || -> Result<Vec<shells::Offered>, String> {
        owner(&webview)?;
        Ok(shells::detected()
            .iter()
            .map(shells::Shell::offered)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn pty_spawn(
    webview: Webview,
    id: String,
    shell: String,
    folder: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<Spawned, String> {
    crate::lane::off_the_runtime(move || -> Result<Spawned, String> {
        let owner = owner(&webview)?;
        usable(&id)?;
        let terminals = webview.state::<Terminals>();
        if terminals.lock().contains_key(&id) {
            return Err(format!("terminal {id} is already running"));
        }

        let host = remote::host_id(&shell);
        let remote = host.is_some();
        let launch = match host {
            Some(host) => remote::connect(&webview, host)?,
            None => shells::find(&shell)
                .ok_or_else(|| format!("no shell {shell} here"))?
                .launch(folder.as_deref(), &shells::ThisMachine),
        };
        let (session, started) = session::Session::open(&launch, cols, rows)?;
        let pid = session.pid();

        terminals.lock().insert(
            id.clone(),
            Held {
                owner,
                session: Arc::new(session),
                remote,
            },
        );

        let app = webview.app_handle().clone();
        started.run(
            Box::new(move |out| {
                let _ = match out {
                    Out::Bytes(bytes) => output.send(InvokeResponseBody::Raw(bytes)),
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

        Ok(Spawned { pid })
    })
    .await
}

#[tauri::command]
pub fn pty_write(webview: Webview, id: String, data: String, binary: bool) -> Result<(), String> {
    let owner = owner(&webview)?;
    let bytes = if binary {
        data.chars()
            .map(|one| u8::try_from(u32::from(one)).unwrap_or(b'?'))
            .collect()
    } else {
        data.into_bytes()
    };
    webview
        .state::<Terminals>()
        .with(&owner, &id, |session| session.write(bytes))
}

#[tauri::command(async)]
pub fn pty_resize(webview: Webview, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, |session| session.resize(cols, rows))?
}

#[tauri::command]
pub fn pty_seen(webview: Webview, id: String, bytes: usize) -> Result<(), String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, |session| session.seen(bytes))
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
    webview
        .state::<Terminals>()
        .with(&owner, &id, Session::program)
}

#[tauri::command(async)]
pub fn pty_ssh(webview: Webview, id: String) -> Result<Option<remote::Destination>, String> {
    let owner = owner(&webview)?;
    webview.state::<Terminals>().with(&owner, &id, Session::ssh)
}

#[tauri::command(async)]
pub fn pty_folder(webview: Webview, id: String) -> Result<Option<String>, String> {
    let owner = owner(&webview)?;
    webview
        .state::<Terminals>()
        .with(&owner, &id, Session::folder)
}

#[tauri::command(async)]
pub fn pty_usage(webview: Webview, id: String) -> Result<Option<crate::usage::Usage>, String> {
    let owner = owner(&webview)?;
    let pid = webview
        .state::<Terminals>()
        .with(&owner, &id, Session::shell)?;
    Ok(pid
        .and_then(|pid| crate::usage::sample(&format!("pty:{id}"), crate::usage::Whose::Tree(pid))))
}

#[tauri::command]
pub fn pty_kill(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let terminals = webview.state::<Terminals>();
    let held = {
        let mut sessions = terminals.lock();
        match sessions.get(&id) {
            Some(held) if held.owner == owner => sessions.remove(&id),
            _ => None,
        }
    };

    if let Some(held) = held {
        std::thread::spawn(move || held.session.end());
    }
    Ok(())
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
        let (program, args) = if cfg!(windows) {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
            (
                std::path::PathBuf::from(root).join(r"System32\cmd.exe"),
                vec!["/q".to_owned()],
            )
        } else {
            (std::path::PathBuf::from("/bin/sh"), Vec::new())
        };
        let launch = shells::Launch {
            program,
            args,
            folder: Some(std::env::temp_dir()),
            env: Vec::new(),
        };
        let (session, started) = Session::open(&launch, 80, 24).expect("a shell");
        started.run(Box::new(|_| {}), |_| {});
        session
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
