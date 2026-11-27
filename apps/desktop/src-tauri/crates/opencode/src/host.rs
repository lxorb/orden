use orden_base::Held as _;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use orden_agents::family::{self, Family};
use orden_ai::ai_agent;
use serde::Serialize;
use serde_json::Value;

use crate::env::{env_of, real_shell, Launch, MCP_TOKEN_VAR};
use crate::{http, shell};

const READY_WITHIN: Duration = Duration::from_secs(30);
const LOOK_EVERY: Duration = Duration::from_millis(100);
const IDLE_EVERY: Duration = Duration::from_millis(500);
pub struct Running {
    child: Child,
    family: Family,
    pub(crate) line: Line,
    pub launch: Launch,
}
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Line {
    pub(crate) port: u16,
    pub(crate) password: String,
    pub(crate) token: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Off,
    Starting,
    Ready,
    Restarting,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Status {
    pub state: State,
    pub port: Option<u16>,
}
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|why| why.to_string())?;
    listener.local_addr().map(|one| one.port()).map_err(|why| why.to_string())
}
impl Line {
    pub(crate) fn hidden(&self, text: &str) -> String {
        let mut text = text.replace(&self.password, "");
        if let Some(token) = self.token.as_deref().filter(|one| !one.is_empty()) {
            text = text.replace(token, "");
        }
        text
    }
    fn unlent(&self) {
        if let Some(token) = &self.token {
            ai_agent::unlend(token);
        }
    }
    fn asked(&self, path: &str) -> Option<http::Said> {
        http::get(self.port, path, Some(&self.password)).ok()
    }
    fn busy(&self) -> bool {
        self.asked("/session/status")
            .filter(|said| said.status == 200)
            .is_some_and(|said| busy_in(&said.body))
    }
}
impl Running {
    pub fn start(launch: Launch) -> Result<Running, String> {
        Running::start_with(launch, &[])
    }
    pub(crate) fn start_with(
        launch: Launch,
        outside: &[(&str, &std::path::Path)],
    ) -> Result<Running, String> {
        let user = |var: &str| std::env::var(var).ok();
        let real = real_shell(&user);
        shell::prepare(&launch.dirs, &real, launch.wrapper.as_deref())
            .map_err(|why| format!("OpenCode's folders: {why}"))?;
        let (port, password) = (free_port()?, orden_agents::grants::fresh_token()?);
        let token = match &launch.orden {
            Some(orden) => Some(ai_agent::lend_engine(orden.grant.clone(), orden.preset.mode())?),
            None => None,
        };
        let line = Line { port, password, token };
        let mut command = Command::new(&launch.binary);
        command
            .args(["serve", "--hostname", "127.0.0.1", "--port", &line.port.to_string()])
            .current_dir(&launch.dirs.root)
            .envs(env_of(&launch, &line.password, &real, user))
            .envs(outside.iter().copied())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(token) = &line.token {
            command.env(MCP_TOKEN_VAR, token);
        }
        let (child, family) = family::spawn(&mut command).map_err(|why| {
            line.unlent();
            format!("OpenCode would not start: {why}")
        })?;
        let mut running = Running { child, family, line, launch };
        match running.ready() {
            Ok(()) => Ok(running),
            Err(why) => {
                running.stop();
                Err(why)
            }
        }
    }
    fn ready(&mut self) -> Result<(), String> {
        let started = Instant::now();
        while started.elapsed() < READY_WITHIN {
            if let Ok(Some(ended)) = self.child.try_wait() {
                return Err(format!("OpenCode ended before it was ready: {ended}"));
            }
            if self.line.asked("/global/health").is_some_and(|said| said.status == 200) {
                return Ok(());
            }
            std::thread::sleep(LOOK_EVERY);
        }
        Err(format!("OpenCode was not ready within {} s", READY_WITHIN.as_secs()))
    }
    pub fn port(&self) -> u16 {
        self.line.port
    }
    pub fn busy(&self) -> bool {
        self.line.busy()
    }
    pub fn stop(self) {
        self.line.unlent();
        self.family.end();
        let mut child = self.child;
        let _ = child.kill();
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}
pub fn busy_in(body: &str) -> bool {
    let Ok(said) = serde_json::from_str::<Value>(body) else {
        return false;
    };
    said.as_object().is_some_and(|all| {
        all.values()
            .any(|one| one.get("type").and_then(Value::as_str).is_some_and(|kind| kind != "idle"))
    })
}
struct Engine {
    running: Option<Running>,
    waiting: Option<Launch>,
    starting: bool,
}
static ENGINE: Mutex<Engine> = Mutex::new(Engine { running: None, waiting: None, starting: false });
fn status_of(engine: &Engine) -> Status {
    let state = if engine.waiting.is_some() {
        State::Restarting
    } else if engine.starting {
        State::Starting
    } else if engine.running.is_some() {
        State::Ready
    } else {
        State::Off
    };
    Status { state, port: engine.running.as_ref().map(Running::port) }
}
pub fn status() -> Status {
    status_of(&ENGINE.held())
}
pub(crate) fn line() -> Option<Line> {
    ENGINE.held().running.as_ref().map(|one| one.line.clone())
}
fn begun(launch: Launch, before: Option<Running>) -> Result<(), String> {
    if let Some(before) = before {
        before.stop();
    }
    let started = Running::start(launch);
    let mut engine = ENGINE.held();
    engine.starting = false;
    engine.running = Some(started?);
    Ok(())
}
pub fn start(launch: Launch) -> Result<Status, String> {
    let before = {
        let mut engine = ENGINE.held();
        let same = engine.running.as_ref().is_some_and(|one| one.launch == launch);
        if engine.starting || same {
            return Ok(status_of(&engine));
        }
        engine.starting = true;
        engine.running.take()
    };
    begun(launch, before)?;
    Ok(status())
}
pub fn restart(launch: Launch) -> Status {
    let first = {
        let mut engine = ENGINE.held();
        let first = engine.waiting.is_none();
        engine.waiting = Some(launch);
        first
    };
    if first {
        std::thread::spawn(when_idle);
    }
    status()
}
pub fn move_to(binary: std::path::PathBuf) {
    let launch = ENGINE.held().running.as_ref().map(|one| one.launch.clone());
    if let Some(launch) = launch.filter(|one| one.binary != binary) {
        restart(Launch { binary, ..launch });
    }
}
fn when_idle() {
    loop {
        if !line().is_some_and(|line| line.busy()) {
            break;
        }
        std::thread::sleep(IDLE_EVERY);
    }
    let (launch, before) = {
        let mut engine = ENGINE.held();
        let Some(launch) = engine.waiting.take() else {
            return;
        };
        engine.starting = true;
        (launch, engine.running.take())
    };
    let _ = begun(launch, before);
}
pub fn stop_all() {
    let running = {
        let mut engine = ENGINE.held();
        engine.waiting = None;
        engine.running.take()
    };
    if let Some(running) = running {
        running.stop();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::Dirs;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn a_session_answering_or_retrying_holds_a_restart_back() {
        assert!(!busy_in("{}"));
        assert!(!busy_in(r#"{"ses_1":{"type":"idle"}}"#));
        assert!(busy_in(r#"{"ses_1":{"type":"idle"},"ses_2":{"type":"busy"}}"#));
        assert!(busy_in(r#"{"ses_1":{"type":"retry","attempt":2}}"#));
        assert!(!busy_in("nonsense"));
    }
    #[test]
    fn a_binary_that_is_not_there_starts_nothing() {
        let dir = tempfile::tempdir().expect("a folder");
        let launch = Launch {
            binary: dir.path().join("no-such-opencode"),
            dirs: Dirs { root: dir.path().join("opencode") },
            config: json!({}),
            auth: None,
            orden: None,
            wrapper: crate::drive::wrapper(),
        };
        assert!(Running::start(launch).is_err_and(|why| why.contains("would not start")));
    }
    #[test]
    fn the_real_server_starts_on_loopback_behind_its_password_and_stops() {
        let Some(binary) = std::env::var_os("ORDEN_OPENCODE_BIN") else {
            return;
        };
        let dir = tempfile::tempdir().expect("a folder");
        let dirs = Dirs { root: dir.path().join("opencode") };
        let launch = Launch {
            binary: binary.into(),
            dirs: dirs.clone(),
            config: json!({ "enabled_providers": [] }),
            auth: None,
            orden: None,
            wrapper: crate::drive::wrapper(),
        };
        let running = Running::start(launch).expect("ready");
        assert_eq!(
            http::get(running.port(), "/global/health", None).expect("answered").status,
            401
        );
        assert!(!running.busy());
        let config = running.line.asked("/config").expect("config");
        let config: Value = serde_json::from_str(&config.body).expect("json");
        assert_eq!(config["share"], "disabled");
        assert_eq!(config["autoupdate"], false);
        let paths = running.line.asked("/path").expect("paths");
        let paths: Value = serde_json::from_str(&paths.body).expect("json");
        assert_eq!(paths["home"].as_str().map(PathBuf::from), Some(dirs.home()), "{paths}");
        std::thread::sleep(Duration::from_secs(5));
        let installed: Vec<String> = walk_names(&dirs.own_config().join("node_modules"));
        assert!(installed.is_empty(), "OpenCode installed {installed:?}");
        let port = running.port();
        running.stop();
        std::thread::sleep(Duration::from_millis(500));
        assert!(http::get(port, "/global/health", None).is_err());
        let _ = std::fs::remove_dir_all(dirs.own_config());
    }
    fn walk_names(dir: &std::path::Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|one| one.file_name().to_string_lossy().into_owned())
            .collect()
    }
}
