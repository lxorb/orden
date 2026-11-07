use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};

use super::args::{self, Caps, Mode};
use super::home::Home;
use super::run::{self, Heard, Running};
use super::say::{Message, Say};

pub type Output = Arc<dyn Fn(Message) + Send + Sync>;

pub type Base = Box<dyn Fn(&[String]) -> Command + Send + Sync>;

pub struct Launch {
    pub base: Base,
    pub folder: PathBuf,
    pub caps: Caps,
    pub token: Option<String>,
    pub thread: Option<String>,
    pub mode: Option<Mode>,
    pub without: Vec<String>,
}

#[derive(Default)]
struct Held {
    session: Mutex<Option<String>>,
    running: Mutex<Option<Running>>,
    ended: AtomicBool,
    starting: AtomicBool,
    hushed: AtomicBool,
}

fn lock<T>(held: &Mutex<T>) -> MutexGuard<'_, T> {
    held.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct Gemini {
    launch: Launch,
    files: PathBuf,
    model: Mutex<Option<String>>,
    idle: Duration,
    held: Arc<Held>,
    output: Output,
}

impl Gemini {
    pub fn start(
        launch: Launch,
        id: &str,
        model: Option<&str>,
        idle: Duration,
        orden: Option<&Path>,
        output: Output,
    ) -> Result<Self, String> {
        let files = launch.folder.join("gemini").join(id);
        crate::paths::made(&files)?;
        let mode = launch.mode.filter(|_| orden.is_some());
        let settings = args::gemini_settings(
            mode,
            &launch.without,
            orden.unwrap_or_else(|| Path::new("")),
        );
        std::fs::write(files.join("settings.json"), settings.to_string())
            .map_err(|error| error.to_string())?;
        std::fs::write(files.join("system.md"), args::session_system(launch.mode))
            .map_err(|error| error.to_string())?;
        Ok(Self {
            launch,
            files,
            model: Mutex::new(model.map(str::to_owned)),
            idle,
            held: Arc::default(),
            output,
        })
    }

    pub fn say(&self, say: Say) -> Result<(), String> {
        match say {
            Say::Turn { text, images } => {
                if !images.is_empty() {
                    return Err("Gemini CLI takes words only from Orden".into());
                }
                self.turn(&text)
            }
            Say::Interrupt => {
                let running = lock(&self.held.running);
                match running.as_ref() {
                    Some(running) => running.stop(),
                    None => self
                        .held
                        .hushed
                        .store(self.held.starting.load(Ordering::SeqCst), Ordering::SeqCst),
                }
                Ok(())
            }
            Say::Model { model } => {
                *lock(&self.model) = Some(model);
                Ok(())
            }
            Say::Effort { effort: None } => Ok(()),
            Say::Effort { .. } => Err("Gemini CLI has no effort to set".into()),
            Say::Steer { .. } => Err("Gemini CLI takes one message at a time".into()),
            Say::Fast { .. } => Err("Gemini CLI has no fast mode".into()),
            Say::Compact { .. } => Err("Gemini CLI compresses its history on its own".into()),
            Say::Context => Err("Gemini CLI says how much it used after each turn".into()),
            Say::Goal { .. } => Err("Gemini CLI keeps no goal".into()),
        }
    }

    fn turn(&self, text: &str) -> Result<(), String> {
        {
            let running = lock(&self.held.running);
            if self.held.ended.load(Ordering::SeqCst) {
                return Err("Gemini CLI has been closed".into());
            }
            if running.is_some() || self.held.starting.swap(true, Ordering::SeqCst) {
                return Err("Gemini CLI is still answering".into());
            }
            self.held.hushed.store(false, Ordering::SeqCst);
        }
        let started = self.started(text);
        let mut running = lock(&self.held.running);
        self.held.starting.store(false, Ordering::SeqCst);
        let (started, finished) = started?;
        if self.held.ended.load(Ordering::SeqCst) {
            drop(running);
            started.stop();
            return Err("Gemini CLI has been closed".into());
        }
        if !finished.load(Ordering::SeqCst) {
            if self.held.hushed.swap(false, Ordering::SeqCst) {
                started.stop();
            }
            *running = Some(started);
        }
        Ok(())
    }

    fn started(&self, text: &str) -> Result<(Running, Arc<AtomicBool>), String> {
        let session = lock(&self.held.session).clone();
        let model = lock(&self.model).clone();
        let command = self.command(model.as_deref(), session.as_deref())?;

        let held = Arc::clone(&self.held);
        let output = Arc::clone(&self.output);
        let answered = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let over = Arc::clone(&finished);
        let started = run::open(command, self.idle, move |heard| match heard {
            Heard::Line(line) => {
                if let Some(said) = said_in(&line) {
                    if said.ended {
                        answered.store(true, Ordering::SeqCst);
                    }
                    if let Some(id) = said.session {
                        *lock(&held.session) = Some(id);
                    }
                }
                output(Message::Line { line });
            }
            Heard::End(ended) => {
                over.store(true, Ordering::SeqCst);
                lock(&held.running).take();
                if ended.stopped || !answered.load(Ordering::SeqCst) {
                    output(Message::End(ended));
                }
            }
        })
        .map_err(|error| format!("gemini could not be started: {error}"))?;
        started
            .write_line(text)
            .map_err(|error| format!("Gemini CLI is not listening: {error}"))?;
        started.close_input();
        Ok((started, finished))
    }

    fn command(&self, model: Option<&str>, session: Option<&str>) -> Result<Command, String> {
        let launch = &self.launch;
        let mut command = (launch.base)(&args::gemini_turn(model, session, &launch.caps)?);
        command
            .env(args::GEMINI_SETTINGS_VAR, self.files.join("settings.json"))
            .env(args::GEMINI_SYSTEM_VAR, self.files.join("system.md"))
            .env(args::GEMINI_TRUST_VAR, "true");
        if let Some(token) = &launch.token {
            command.env(args::TOKEN_VAR, token);
            if let Some(thread) = &launch.thread {
                command.env(args::THREAD_VAR, thread);
            }
        }
        Ok(command)
    }

    pub fn stop(&self) {
        let mut running = lock(&self.held.running);
        self.held.ended.store(true, Ordering::SeqCst);
        if let Some(running) = running.take() {
            running.stop();
        }
        drop(running);
        let files = self.files.clone();
        std::thread::spawn(move || {
            let _ = std::fs::remove_dir_all(files);
        });
    }
}

struct Said {
    session: Option<String>,
    ended: bool,
}

fn said_in(line: &str) -> Option<Said> {
    let event: Value = serde_json::from_str(line).ok()?;
    let session = (event["type"] == "init")
        .then(|| event["session_id"].as_str().map(str::to_owned))
        .flatten();
    Some(Said {
        session,
        ended: event["type"] == "result",
    })
}

pub fn standing(home: Option<&Home>) -> Value {
    let root = home
        .map(|one| one.dir().to_path_buf())
        .or_else(|| std::env::var_os("GEMINI_CLI_HOME").map(PathBuf::from))
        .or_else(dirs::home_dir);
    let outside_key = home.is_none()
        && ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
            .iter()
            .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()));
    match root {
        Some(root) => standing_in(&root.join(".gemini"), outside_key),
        None => json!({ "signedIn": false }),
    }
}

pub fn standing_in(dir: &Path, outside_key: bool) -> Value {
    let read = |name: &str| -> Option<Value> {
        let text = std::fs::read_to_string(dir.join(name)).ok()?;
        serde_json::from_str(&text).ok()
    };
    let chosen = read("settings.json")
        .and_then(|one| {
            let picked = &one["security"]["auth"]["selectedType"];
            picked
                .as_str()
                .or_else(|| one["selectedAuthType"].as_str())
                .map(str::to_owned)
        })
        .unwrap_or_default();
    let keyed = outside_key
        || std::fs::read_to_string(dir.join(".env")).is_ok_and(|text| {
            text.lines()
                .any(|line| line.trim_start().starts_with("GEMINI_API_KEY="))
        });
    let google = dir.join("oauth_creds.json").is_file() || chosen == "oauth-personal";
    let method = if chosen == "vertex-ai" {
        Some("vertex")
    } else if chosen == "gemini-api-key" && keyed {
        Some("api-key")
    } else if google {
        Some("google")
    } else if keyed {
        Some("api-key")
    } else {
        None
    };
    let email = read("google_accounts.json")
        .and_then(|one| one["active"].as_str().map(str::to_owned))
        .filter(|_| method == Some("google"));
    json!({ "signedIn": method.is_some(), "method": method, "email": email })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orden-gemini-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        dir
    }

    #[test]
    fn signed_in_with_google_names_the_account() {
        let dir = dir("google");
        std::fs::write(dir.join("oauth_creds.json"), "{}").expect("creds");
        std::fs::write(
            dir.join("google_accounts.json"),
            r#"{"active":"heron@example.com","old":[]}"#,
        )
        .expect("accounts");
        let said = standing_in(&dir, false);
        assert_eq!(said["signedIn"], true);
        assert_eq!(said["method"], "google");
        assert_eq!(said["email"], "heron@example.com");
    }

    #[test]
    fn a_key_in_its_env_file_or_outside_is_signed_in_by_key() {
        let dir = dir("key");
        assert_eq!(standing_in(&dir, false)["signedIn"], false);
        assert_eq!(standing_in(&dir, true)["method"], "api-key");
        std::fs::write(dir.join(".env"), "GEMINI_API_KEY=abc\n").expect("env");
        std::fs::write(
            dir.join("settings.json"),
            r#"{"security":{"auth":{"selectedType":"gemini-api-key"}}}"#,
        )
        .expect("settings");
        let said = standing_in(&dir, false);
        assert_eq!(said["method"], "api-key");
        assert!(said["email"].is_null());
    }

    #[test]
    fn the_session_and_the_end_are_read_from_its_lines() {
        let init =
            said_in(r#"{"type":"init","session_id":"5a7c-91","model":"auto"}"#).expect("init");
        assert_eq!(init.session.as_deref(), Some("5a7c-91"));
        assert!(!init.ended);
        assert!(said_in(r#"{"type":"result","status":"success"}"#).is_some_and(|one| one.ended));
        assert!(said_in("not json").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_turn_said_after_it_was_closed_starts_nothing() {
        let started = Arc::new(AtomicBool::new(false));
        let heard = Arc::clone(&started);
        let launch = Launch {
            base: Box::new(|_: &[String]| {
                let mut command = Command::new("sh");
                command.args(["-c", "cat"]);
                command
            }),
            folder: dir("closed"),
            caps: Caps::from_help("--output-format"),
            token: None,
            thread: None,
            mode: None,
            without: Vec::new(),
        };
        let output: Output = Arc::new(move |_| heard.store(true, Ordering::SeqCst));
        let gemini = Gemini::start(launch, "one", None, Duration::from_secs(30), None, output)
            .expect("started");
        gemini.stop();
        let said = gemini.say(Say::Turn {
            text: "hello".into(),
            images: Vec::new(),
        });
        assert!(said.is_err_and(|why| why.contains("closed")));
        assert!(lock(&gemini.held.running).is_none());
        std::thread::sleep(Duration::from_millis(200));
        assert!(!started.load(Ordering::SeqCst));
    }

    #[cfg(unix)]
    #[test]
    fn stopping_waits_for_no_turn_that_is_still_starting() {
        let (entered, starting) = std::sync::mpsc::channel();
        let (go, gate) = std::sync::mpsc::channel::<()>();
        let gate = Mutex::new(gate);
        let launch = Launch {
            base: Box::new(move |_: &[String]| {
                let _ = entered.send(());
                let _ = lock(&gate).recv_timeout(Duration::from_secs(5));
                let mut command = Command::new("sh");
                command.args(["-c", "cat"]);
                command
            }),
            folder: dir("starting"),
            caps: Caps::from_help("--output-format"),
            token: None,
            thread: None,
            mode: None,
            without: Vec::new(),
        };
        let output: Output = Arc::new(|_| {});
        let gemini = Arc::new(
            Gemini::start(launch, "one", None, Duration::from_secs(30), None, output)
                .expect("started"),
        );
        let turning = Arc::clone(&gemini);
        let turn = std::thread::spawn(move || {
            turning.say(Say::Turn {
                text: "hello".into(),
                images: Vec::new(),
            })
        });
        starting
            .recv_timeout(Duration::from_secs(5))
            .expect("the turn starts");
        let asked = std::time::Instant::now();
        gemini.stop();
        assert!(
            asked.elapsed() < Duration::from_secs(2),
            "stopping waited for the turn to start"
        );
        go.send(()).expect("the turn goes on");
        let said = turn.join().expect("the turn");
        assert!(said.is_err_and(|why| why.contains("closed")));
        assert!(lock(&gemini.held.running).is_none());
    }
}
