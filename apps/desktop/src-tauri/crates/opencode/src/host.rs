use orden_base::Held as _;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use orden_agents::family::{self, Family};
use serde::Serialize;
use serde_json::Value;

use crate::env::{env_of, Launch};
use crate::{http, shell};

const READY_WITHIN: Duration = Duration::from_secs(30);
const LOOK_EVERY: Duration = Duration::from_millis(100);
const IDLE_EVERY: Duration = Duration::from_millis(500);
pub struct Running {
    child: Child,
    family: Family,
    line: Line,
    pub launch: Launch,
}
#[derive(Clone)]
struct Line {
    port: u16,
    password: String,
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
        shell::prepare(&launch.dirs).map_err(|why| format!("OpenCode's folders: {why}"))?;
        let line = Line { port: free_port()?, password: orden_agents::grants::fresh_token()? };
        let mut command = Command::new(&launch.binary);
        command
            .args(["serve", "--hostname", "127.0.0.1", "--port", &line.port.to_string()])
            .current_dir(&launch.dirs.root)
            .envs(env_of(&launch, &line.password, |var| std::env::var(var).ok()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let (child, family) = family::spawn(&mut command)
            .map_err(|why| format!("OpenCode would not start: {why}"))?;
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
fn when_idle() {
    loop {
        let line = ENGINE.held().running.as_ref().map(|one| one.line.clone());
        if !line.is_some_and(|line| line.busy()) {
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
        std::thread::sleep(Duration::from_secs(5));
        assert!(!dirs.own_config().join("node_modules").exists());
        assert!(!dirs.own_config().join("package.json").exists());
        let port = running.port();
        running.stop();
        std::thread::sleep(Duration::from_millis(500));
        assert!(http::get(port, "/global/health", None).is_err());
        let _ = std::fs::remove_dir_all(dirs.own_config());
    }
}
