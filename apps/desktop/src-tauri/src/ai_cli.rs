mod args;
mod codex_app;
mod enroll;
pub(crate) mod family;
mod gemini;
mod home;
pub(crate) mod program;
mod run;
mod say;
mod session;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

use crate::ai_agent::Builtin;
pub use args::Tool;
use args::{Effort, Mode, Shape};
use codex_app::Host;
use gemini::Gemini;
use home::Home;
use program::Program;
use run::{Heard, Running, Said};
use say::{Message, Say};
use session::Claude;

fn claude_code_offered() -> bool {
    !matches!(option_env!("NIB_CLAUDE_CODE"), Some("off" | "0" | "false"))
}

const ASKING: Duration = Duration::from_secs(300);

const IDLE: Duration = Duration::from_secs(600);

const TELLING: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct Asks {
    running: Mutex<HashMap<String, Held>>,
    sessions: Mutex<HashMap<String, Session>>,
    hosts: Mutex<HashMap<HostKey, Arc<Host>>>,
}

struct Held {
    owner: String,
    opening: u64,
    running: Option<Running>,
    stopped: bool,
}

impl Held {
    fn stop(&mut self) {
        self.stopped = true;
        if let Some(running) = &self.running {
            running.stop();
        }
    }
}

struct Session {
    owner: String,
    opening: u64,
    on: Arc<On>,
}

enum On {
    Claude(Claude),
    Codex(Arc<Host>),
    Gemini(Box<Gemini>),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct HostKey {
    owner: String,
    agent: Option<(String, Mode)>,
    home: Option<Home>,
}

impl On {
    fn end(&self, id: &str) {
        match self {
            Self::Claude(claude) => claude.stop(),
            Self::Codex(host) => host.close(id),
            Self::Gemini(gemini) => gemini.stop(),
        }
    }
}

fn lock<T>(held: &Mutex<T>) -> MutexGuard<'_, T> {
    held.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Asks {
    fn stop_where(&self, owner: Option<&str>) {
        let mine = |one: &str| owner.is_none_or(|owner| one == owner);
        for held in lock(&self.running).values_mut() {
            if mine(&held.owner) {
                held.stop();
            }
        }
        let sessions: Vec<Session> = {
            let mut sessions = lock(&self.sessions);
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, session)| mine(&session.owner))
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };
        for session in sessions {
            match &*session.on {
                On::Claude(claude) => claude.stop(),
                On::Gemini(gemini) => gemini.stop(),
                On::Codex(_) => {}
            }
        }
        let hosts: Vec<Arc<Host>> = {
            let mut hosts = lock(&self.hosts);
            let keys: Vec<HostKey> = hosts
                .keys()
                .filter(|key| mine(&key.owner))
                .cloned()
                .collect();
            keys.iter().filter_map(|key| hosts.remove(key)).collect()
        };
        for host in hosts {
            host.stop();
        }
    }
}

pub fn window_gone(app: &AppHandle, label: &str) {
    if let Some(asks) = app.try_state::<Asks>() {
        asks.stop_where(Some(label));
    }
}

pub fn end_all(app: &AppHandle) {
    if let Some(asks) = app.try_state::<Asks>() {
        asks.stop_where(None);
    }
}

fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("not a window of this app".to_owned())
    }
}

fn usable(id: &str) -> Result<(), String> {
    let fits = !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    fits.then_some(())
        .ok_or_else(|| "not a question's name".to_owned())
}

fn offered(tool: Tool) -> Result<(), String> {
    if tool == Tool::ClaudeCode && !claude_code_offered() {
        return Err("not in this build".to_owned());
    }
    Ok(())
}

fn command(
    program: &Program,
    args: &[impl AsRef<std::ffi::OsStr>],
    folder: &Path,
    home: Option<&Home>,
) -> Command {
    let mut command = Command::new(&program.exe);
    command
        .args(args)
        .current_dir(folder)
        .env("PATH", &program.path);
    if let Some(home) = home {
        home.apply(&mut command);
    }
    command
}

fn home_for(app: &AppHandle, tool: Tool, account: Option<&str>) -> Result<Option<Home>, String> {
    if let Some(id) = account {
        usable(id)?;
    }
    home::of(app, tool, account)
}

fn workroom(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("ai");
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder)
}

fn caps_of(program: &Program, folder: &Path) -> args::Caps {
    static KNOWN: OnceLock<Mutex<HashMap<PathBuf, args::Caps>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);
    if let Some(caps) = lock(known).get(&program.exe).cloned() {
        return caps;
    }

    let help = run::run_to_end(command(program, &args::HELP, folder, None), TELLING)
        .map(|said| format!("{}\n{}", said.out, said.ended.err))
        .unwrap_or_default();
    let caps = args::Caps::from_help(&help);
    lock(known).insert(program.exe.clone(), caps.clone());
    caps
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    program: String,
    home: Option<String>,
    #[serde(flatten)]
    said: Said,
}

#[tauri::command]
pub async fn ai_cli_status(
    webview: Webview,
    tool: Tool,
    account: Option<String>,
) -> Result<Option<Status>, String> {
    crate::lane::off_the_runtime(move || -> Result<Option<Status>, String> {
        owner(&webview)?;
        offered(tool)?;
        let Some(program) = program::find(tool) else {
            return Ok(None);
        };
        let home = home_for(webview.app_handle(), tool, account.as_deref())?;
        let folder = workroom(webview.app_handle())?;
        let mut said = run::run_to_end(
            command(&program, args::status(tool), &folder, home.as_ref()),
            TELLING,
        )
        .map_err(|error| error.to_string())?;
        if tool == Tool::Gemini && !said.ended.timed_out {
            said.out = gemini::standing(home.as_ref()).to_string();
        }
        Ok(Some(Status {
            program: program.exe.to_string_lossy().into_owned(),
            home: home.map(|one| one.dir().to_string_lossy().into_owned()),
            said,
        }))
    })
    .await
}

pub fn keep_enrolled(app: &AppHandle) {
    enroll::keep_enrolled(app);
}

#[tauri::command(async)]
pub fn ai_cli_enroll_read(webview: Webview) -> Result<enroll::Standing, String> {
    owner(&webview)?;
    Ok(enroll::standing(webview.app_handle()))
}

#[tauri::command(async)]
pub fn ai_cli_enroll_write(webview: Webview, on: bool) -> Result<(), String> {
    owner(&webview)?;
    enroll::turned(webview.app_handle(), on)
}

#[tauri::command]
pub async fn ai_cli_forget(webview: Webview, tool: Tool, account: String) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        owner(&webview)?;
        offered(tool)?;
        let Some(home) = home_for(webview.app_handle(), tool, Some(&account))? else {
            return Ok(());
        };
        if let Some(program) = program::find(tool).filter(|_| !args::logout(tool).is_empty()) {
            let folder = workroom(webview.app_handle())?;
            let _ = run::run_to_end(
                command(&program, args::logout(tool), &folder, Some(&home)),
                TELLING,
            );
        }
        home::removed(&home)
    })
    .await
}

fn sent(output: &Channel<Value>, message: Message) {
    if let Ok(value) = serde_json::to_value(message) {
        let _ = output.send(value);
    }
}

#[tauri::command]
pub async fn ai_cli_ask(
    webview: Webview,
    id: String,
    tool: Tool,
    model: Option<String>,
    account: Option<String>,
    prompt: String,
    output: Channel<Value>,
) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let owner = owner(&webview)?;
        usable(&id)?;
        offered(tool)?;
        if tool != Tool::ClaudeCode {
            return Err("asked through a session".to_owned());
        }
        let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
        let app = webview.app_handle().clone();
        let home = home_for(&app, tool, account.as_deref())?;
        let folder = workroom(&app)?;
        let model = model.filter(|one| !one.trim().is_empty());
        let args = args::ask(model.as_deref(), &caps_of(&program, &folder))?;

        let asks = webview.state::<Asks>();
        let opening = next_opening();
        {
            let mut running = lock(&asks.running);
            if running.contains_key(&id) {
                return Err(format!("{id} is already being asked"));
            }
            running.insert(
                id.clone(),
                Held {
                    owner,
                    opening,
                    running: None,
                    stopped: false,
                },
            );
        }

        let name = id.clone();
        let started = run::start(
            command(&program, &args, &folder, home.as_ref()),
            prompt.into_bytes(),
            ASKING,
            move |heard| {
                let message = match heard {
                    Heard::Line(line) => Message::Line { line },
                    Heard::End(ended) => {
                        if let Some(asks) = app.try_state::<Asks>() {
                            let mut running = lock(&asks.running);
                            if running.get(&name).is_some_and(|one| one.opening == opening) {
                                running.remove(&name);
                            }
                        }
                        Message::End(ended)
                    }
                };
                sent(&output, message);
            },
        );

        let mut running = lock(&asks.running);
        let mine = running.get(&id).is_some_and(|one| one.opening == opening);
        let started = match started {
            Ok(started) => started,
            Err(error) => {
                if mine {
                    running.remove(&id);
                }
                return Err(format!("{} could not be started: {error}", tool.command()));
            }
        };
        if let Some(held) = running.get_mut(&id).filter(|_| mine) {
            if held.stopped {
                started.stop();
            }
            held.running = Some(started);
        }
        Ok(())
    })
    .await
}

#[tauri::command(async)]
pub fn ai_cli_stop(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    if let Some(held) = lock(&webview.state::<Asks>().running).get_mut(&id) {
        if held.owner == owner {
            held.stop();
        }
    }
    Ok(())
}

fn next_opening() -> u64 {
    static OPENINGS: AtomicU64 = AtomicU64::new(1);
    OPENINGS.fetch_add(1, Ordering::SeqCst)
}

fn session_output(
    app: &AppHandle,
    id: &str,
    opening: u64,
    output: Channel<Value>,
    ended: &Arc<AtomicBool>,
) -> codex_app::Output {
    let app = app.clone();
    let id = id.to_owned();
    let ended = Arc::clone(ended);
    Arc::new(move |message: Message| {
        if matches!(message, Message::End(_)) {
            ended.store(true, Ordering::SeqCst);
            let app = app.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                if let Some(asks) = app.try_state::<Asks>() {
                    let mut sessions = lock(&asks.sessions);
                    if sessions.get(&id).is_some_and(|one| one.opening == opening) {
                        sessions.remove(&id);
                    }
                }
            });
        }
        sent(&output, message);
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opening {
    tool: Tool,
    agent: Builtin,
    #[serde(default)]
    mode: Option<Mode>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    effort: Option<Effort>,
    #[serde(default)]
    fork_of: Option<String>,
    #[serde(default)]
    account: Option<String>,
    #[serde(default)]
    thread: Option<String>,
    #[serde(default)]
    without: Vec<String>,
}

#[tauri::command]
pub async fn ai_cli_open(
    webview: Webview,
    id: String,
    opening: Opening,
    output: Channel<Value>,
) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let owner = owner(&webview)?;
        usable(&id)?;
        offered(opening.tool)?;
        if let Some(thread) = &opening.thread {
            usable(thread)?;
        }
        let tool = opening.tool;
        let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
        let app = webview.app_handle().clone();
        let folder = workroom(&app)?;
        let model = opening
            .model
            .as_deref()
            .filter(|one| !one.trim().is_empty());
        let model = args::checked_model(model)?;
        let token = opening
            .mode
            .map(|mode| crate::ai_agent::lend(&app, &opening.agent, mode))
            .transpose()?;
        let home = home_for(&app, tool, opening.account.as_deref())?;

        let claude = match tool {
            Tool::ClaudeCode => Some(claude_command(
                &program,
                &folder,
                &opening,
                model,
                token.as_deref(),
                home.as_ref(),
            )?),
            Tool::Codex | Tool::Gemini => None,
        };

        let asks = webview.state::<Asks>();
        if lock(&asks.sessions).contains_key(&id) {
            return Err(format!("{id} is already open"));
        }
        let number = next_opening();
        let ended = Arc::new(AtomicBool::new(false));
        let output = session_output(&app, &id, number, output, &ended);

        let on = match (tool, claude) {
            (Tool::ClaudeCode, Some(command)) => {
                let output = Arc::clone(&output);
                let claude = Claude::start(command, IDLE, move |message| output(message))
                    .map_err(|error| format!("{} could not be started: {error}", tool.command()))?;
                On::Claude(claude)
            }
            (Tool::ClaudeCode, None) => return Err("missing".to_owned()),
            (Tool::Codex, _) => {
                let key = HostKey {
                    owner: owner.clone(),
                    agent: opening.mode.map(|mode| (opening.agent.id.clone(), mode)),
                    home: home.clone(),
                };
                let host = host_for(&asks, key, &program, &folder, token.as_deref())?;
                let from = codex_app::From {
                    fork_of: opening.fork_of.as_deref(),
                    thread: opening.thread.as_deref(),
                    without: &opening.without,
                };
                host.open(&id, output, opening.mode, model, opening.effort, from)?;
                On::Codex(host)
            }
            (Tool::Gemini, _) => {
                if opening.effort.is_some() {
                    return Err("Gemini CLI has no effort to set".to_owned());
                }
                let nib = match opening.mode {
                    Some(_) => Some(crate::mcp::program::program()?),
                    None => None,
                };
                let caps = caps_of(&program, &folder);
                let room = folder.clone();
                let launch = gemini::Launch {
                    base: Box::new(move |args: &[String]| {
                        command(&program, args, &room, home.as_ref())
                    }),
                    folder,
                    caps,
                    token,
                    thread: opening.thread.clone(),
                    mode: opening.mode,
                    without: opening.without.clone(),
                };
                let gemini = Gemini::start(launch, &id, model, IDLE, nib.as_deref(), output)?;
                On::Gemini(Box::new(gemini))
            }
        };
        let session = Session {
            owner,
            opening: number,
            on: Arc::new(on),
        };
        kept(&asks, id, session, &ended)
    })
    .await
}

fn kept(asks: &Asks, id: String, session: Session, ended: &AtomicBool) -> Result<(), String> {
    let mut sessions = lock(&asks.sessions);
    if sessions.contains_key(&id) {
        drop(sessions);
        session.on.end(&id);
        return Err(format!("{id} is already open"));
    }
    sessions.insert(id.clone(), session);
    if ended.load(Ordering::SeqCst) {
        sessions.remove(&id);
    }
    Ok(())
}

fn claude_command(
    program: &Program,
    folder: &Path,
    opening: &Opening,
    model: Option<&str>,
    token: Option<&str>,
    home: Option<&Home>,
) -> Result<Command, String> {
    let caps = caps_of(program, folder);
    let config = folder.join("nib-mcp.json");
    if opening.mode.is_some() {
        let nib = crate::mcp::program::program()?;
        std::fs::write(&config, args::mcp_config(&nib).to_string())
            .map_err(|error| error.to_string())?;
    }
    let shape = Shape {
        mode: opening.mode,
        model,
        effort: opening.effort,
        without: &opening.without,
    };
    let mut command = command(
        program,
        &args::claude_session(shape, &caps, &config)?,
        folder,
        home,
    );
    command.envs(args::CLAUDE_SESSION_ENV);
    if let Some(token) = token {
        command.env(args::TOKEN_VAR, token);
        if let Some(thread) = &opening.thread {
            command.env(args::THREAD_VAR, thread);
        }
    }
    Ok(command)
}

fn host_for(
    asks: &Asks,
    key: HostKey,
    program: &Program,
    folder: &Path,
    token: Option<&str>,
) -> Result<Arc<Host>, String> {
    let alive = |hosts: &HashMap<HostKey, Arc<Host>>| {
        hosts.get(&key).filter(|host| host.alive()).map(Arc::clone)
    };
    if let Some(host) = alive(&lock(&asks.hosts)) {
        return Ok(host);
    }
    let mut command = command(program, &args::codex_server(), folder, key.home.as_ref());
    if let Some(token) = token {
        command.env(args::TOKEN_VAR, token);
    }
    let nib = crate::mcp::program::program()?;
    let host = Host::start(command, IDLE, nib, folder.to_path_buf())
        .map_err(|error| format!("codex could not be started: {error}"))?;
    let host = Arc::new(host);
    let mut hosts = lock(&asks.hosts);
    if let Some(other) = alive(&hosts) {
        drop(hosts);
        host.stop();
        return Ok(other);
    }
    hosts.insert(key, Arc::clone(&host));
    Ok(host)
}

#[tauri::command(async)]
pub fn ai_cli_say(webview: Webview, id: String, say: Value) -> Result<(), String> {
    let owner = owner(&webview)?;
    let say = serde_json::from_value::<Say>(say)
        .map_err(|error| error.to_string())?
        .checked()?;
    let asks = webview.state::<Asks>();
    let on = lock(&asks.sessions)
        .get(&id)
        .filter(|one| one.owner == owner)
        .map(|one| Arc::clone(&one.on))
        .ok_or_else(|| format!("{id} is not open"))?;
    match &*on {
        On::Claude(claude) => claude.say(&say),
        On::Codex(host) => host.say(&id, say),
        On::Gemini(gemini) => gemini.say(say),
    }
}

#[tauri::command(async)]
pub fn ai_cli_close(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let asks = webview.state::<Asks>();
    let session = {
        let mut sessions = lock(&asks.sessions);
        if sessions.get(&id).is_none_or(|one| one.owner != owner) {
            return Ok(());
        }
        sessions.remove(&id)
    };
    if let Some(session) = session {
        session.on.end(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_cli_models(
    webview: Webview,
    tool: Tool,
    account: Option<String>,
) -> Result<Value, String> {
    crate::lane::off_the_runtime(move || -> Result<Value, String> {
        let owner = owner(&webview)?;
        offered(tool)?;
        let program = program::find(tool).ok_or_else(|| "missing".to_owned())?;
        let home = home_for(webview.app_handle(), tool, account.as_deref())?;
        let folder = workroom(webview.app_handle())?;
        match tool {
            Tool::ClaudeCode => {
                let caps = caps_of(&program, &folder);
                let claude = Claude::start(
                    command(
                        &program,
                        &args::claude_listing(&caps),
                        &folder,
                        home.as_ref(),
                    ),
                    TELLING,
                    |_| {},
                )
                .map_err(|error| error.to_string())?;
                let listed = claude.ask(serde_json::json!({ "subtype": "list_models" }), TELLING);
                claude.close_input();
                listed
            }
            Tool::Codex => {
                let asks = webview.state::<Asks>();
                let key = HostKey {
                    owner,
                    agent: None,
                    home,
                };
                host_for(&asks, key, &program, &folder, None)?.models(TELLING)
            }
            Tool::Gemini => Err("Gemini CLI names its models by alias".to_owned()),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::run::{run_to_end, start, Ended, Heard};
    use super::say::GoalSay;
    use super::*;
    use std::sync::mpsc::{self, Receiver};
    use std::time::Instant;

    fn fake_script() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .map(|folder| folder.join("scripts").join("fake-ai-cli.mjs"))
            .find(|script| script.is_file())
            .expect("scripts/fake-ai-cli.mjs above the crate")
    }

    fn node() -> bool {
        Command::new("node").arg("--version").output().is_ok()
    }

    fn fake(tool: Tool, mode: &str, args: &[impl AsRef<std::ffi::OsStr>]) -> Command {
        let mut command = Command::new("node");
        command
            .arg(fake_script())
            .arg(tool.command())
            .args(args)
            .env("FAKE_AI_CLI_MODE", mode)
            .env_remove(args::TOKEN_VAR);
        command
    }

    fn heard_all(command: Command, input: &str, timeout: Duration) -> (Vec<String>, Ended) {
        let (sent, heard) = mpsc::channel();
        start(command, input.as_bytes().to_vec(), timeout, move |one| {
            let _ = sent.send(one);
        })
        .expect("started");
        let mut lines = Vec::new();
        for one in heard {
            match one {
                Heard::Line(line) => lines.push(line),
                Heard::End(ended) => return (lines, ended),
            }
        }
        panic!("no end was heard");
    }

    #[test]
    fn a_second_account_signs_in_and_out_in_a_home_of_its_own() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        crate::ai_accounts::write(
            dir.path(),
            r#"{"accounts":[{"id":"claude-code-2","kind":"claude-code","name":"","model":"","own":true}]}"#,
            "",
        )
        .expect("accounts");
        let home = home::under(dir.path(), Tool::ClaudeCode, Some("claude-code-2"))
            .expect("read")
            .expect("a home");

        let mut asked = fake(Tool::ClaudeCode, "answer", args::status(Tool::ClaudeCode));
        asked.env("ANTHROPIC_API_KEY", "from-the-shell");
        home.apply(&mut asked);
        let said = run_to_end(asked, TELLING).expect("status");
        assert!(
            said.out.contains("reader+claude-code-2@example.com"),
            "{}",
            said.out
        );
        assert!(said.out.contains("\"claude.ai\""), "{}", said.out);

        let mut out = fake(Tool::ClaudeCode, "answer", args::logout(Tool::ClaudeCode));
        home.apply(&mut out);
        run_to_end(out, TELLING).expect("logout");
        assert!(home.dir().join("signed-out").exists());
        home::removed(&home).expect("removed");
        assert!(!home.dir().exists());
    }

    fn fake_program(dir: &Path, tool: Tool) -> Program {
        let name = tool.command();
        #[cfg(windows)]
        let (exe, text) = (
            dir.join(format!("{name}.cmd")),
            format!(
                "@node \"{}\" {name} %*
",
                fake_script().display()
            ),
        );
        #[cfg(not(windows))]
        let (exe, text) = (
            dir.join(name),
            format!(
                "#!/bin/sh
exec node '{}' {name} \"$@\"
",
                fake_script().display()
            ),
        );
        std::fs::write(&exe, text).expect("the shim");
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755))
                .expect("runnable");
        }
        Program {
            exe,
            path: std::env::var_os("PATH").unwrap_or_default(),
        }
    }

    #[test]
    fn nib_connects_itself_to_an_agent_once_and_lets_go_only_of_its_own() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let home = dir.path().join("home");
        for one in [".claude", ".codex"] {
            std::fs::create_dir_all(home.join(one)).expect("a home");
        }
        let nib = dir.path().join("nib.exe");
        for (tool, kept) in [
            (Tool::ClaudeCode, home.join(".claude").join("fake-mcp.json")),
            (Tool::Codex, home.join(".codex").join("fake-mcp.json")),
        ] {
            let program = fake_program(dir.path(), tool);
            let servers = || -> Value {
                std::fs::read_to_string(&kept)
                    .ok()
                    .and_then(|text| serde_json::from_str(&text).ok())
                    .unwrap_or_else(|| serde_json::json!({}))
            };
            let ours = || serde_json::json!([nib.to_string_lossy(), "mcp"]);
            let elsewhere = || serde_json::json!(["C:/elsewhere/nib.exe", "mcp"]);
            let start = |with: Value| std::fs::write(&kept, with.to_string()).expect("kept");

            std::fs::remove_file(&kept).ok();
            enroll::enroll(&program, tool, dir.path(), &nib, Some(&home));
            enroll::enroll(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(
                servers(),
                serde_json::json!({ "orden": ours() }),
                "{tool:?}"
            );
            enroll::unenroll(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(servers(), serde_json::json!({}), "{tool:?}");

            let theirs = serde_json::json!({ "orden": elsewhere() });
            start(theirs.clone());
            enroll::enroll(&program, tool, dir.path(), &nib, Some(&home));
            enroll::unenroll(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(servers(), theirs, "{tool:?}");

            for enrolling in [true, false] {
                start(serde_json::json!({ "nib": ours() }));
                for _ in 0..2 {
                    if enrolling {
                        enroll::enroll(&program, tool, dir.path(), &nib, Some(&home));
                    } else {
                        enroll::carry_over(&program, tool, dir.path(), &nib, Some(&home));
                    }
                }
                assert_eq!(
                    servers(),
                    serde_json::json!({ "orden": ours() }),
                    "{tool:?}"
                );
            }

            start(serde_json::json!({ "nib": ours(), "orden": ours() }));
            enroll::carry_over(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(
                servers(),
                serde_json::json!({ "orden": ours() }),
                "{tool:?}"
            );

            start(serde_json::json!({ "nib": elsewhere() }));
            enroll::carry_over(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(
                servers(),
                serde_json::json!({ "nib": elsewhere() }),
                "{tool:?}"
            );
            enroll::enroll(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(
                servers(),
                serde_json::json!({ "nib": elsewhere(), "orden": ours() }),
                "{tool:?}"
            );

            let kept_both = serde_json::json!({ "nib": ours(), "orden": elsewhere() });
            start(kept_both.clone());
            enroll::enroll(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(servers(), kept_both, "{tool:?}");

            start(serde_json::json!({ "nib": ours(), "orden": elsewhere() }));
            enroll::unenroll(&program, tool, dir.path(), &nib, Some(&home));
            assert_eq!(
                servers(),
                serde_json::json!({ "orden": elsewhere() }),
                "{tool:?}"
            );
            std::fs::remove_file(&kept).ok();
        }
    }

    fn full_caps() -> args::Caps {
        let said =
            run_to_end(fake(Tool::ClaudeCode, "answer", &["--help"]), TELLING).expect("help");
        args::Caps::from_help(&said.out)
    }

    #[test]
    fn claude_code_answers_line_by_line_with_the_question_on_stdin() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let args = args::ask(None, &full_caps()).expect("args");
        let (lines, ended) = heard_all(
            fake(Tool::ClaudeCode, "answer", &args),
            "the rules\n\nwhat is a heron",
            TELLING,
        );

        assert_eq!(ended.code, Some(0), "{}", ended.err);
        assert!(!ended.stopped && !ended.timed_out);
        assert!(lines[0].contains("\"subtype\":\"init\""));
        assert!(lines
            .iter()
            .any(|line| line.contains("content_block_delta")));
        assert!(lines
            .last()
            .is_some_and(|line| line.contains("what is a heron")));
    }

    #[test]
    fn a_question_without_the_policy_flags_is_refused_by_the_stand_in() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let (_, ended) = heard_all(fake(Tool::ClaudeCode, "answer", &["-p"]), "hi", TELLING);
        assert_eq!(ended.code, Some(2));
        assert!(ended.err.contains("asked with tools"));
    }

    fn alive(pid: u32) -> bool {
        #[cfg(windows)]
        {
            let listed = Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .expect("tasklist");
            String::from_utf8_lossy(&listed.stdout).contains(&pid.to_string())
        }
        #[cfg(unix)]
        {
            Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .is_ok_and(|status| status.success())
        }
    }

    fn pids_in(file: &Path) -> Vec<u32> {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            if let Ok(text) = std::fs::read_to_string(file) {
                let pids: Vec<u32> = text
                    .split_whitespace()
                    .filter_map(|one| one.parse().ok())
                    .collect();
                if pids.len() == 2 {
                    return pids;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("the stand-in never said who it started");
    }

    fn gone_soon(pid: u32) -> bool {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(10) {
            if !alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn a_stop_ends_the_program_and_everything_it_started() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let args = args::ask(None, &args::Caps::default()).expect("args");
        let mut command = fake(Tool::ClaudeCode, "hang", &args);
        command.env("FAKE_AI_CLI_PIDS", &pids);

        let (sent, heard) = mpsc::channel();
        let running = start(command, b"hold on".to_vec(), TELLING, move |one| {
            let _ = sent.send(one);
        })
        .expect("started");

        let family = pids_in(&pids);
        assert!(family.iter().all(|&pid| alive(pid)));
        running.stop();

        let ended = heard
            .iter()
            .find_map(|one| match one {
                Heard::End(ended) => Some(ended),
                Heard::Line(_) => None,
            })
            .expect("an end");
        assert!(ended.stopped);
        for pid in family {
            assert!(gone_soon(pid), "{pid} outlived the stop");
        }
    }

    #[test]
    fn a_run_past_its_time_is_ended_with_its_family() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let args = args::ask(None, &args::Caps::default()).expect("args");
        let mut command = fake(Tool::ClaudeCode, "hang", &args);
        command.env("FAKE_AI_CLI_PIDS", &pids);

        let (_, ended) = heard_all(command, "hold on", Duration::from_secs(3));
        assert!(ended.timed_out);
        assert!(!ended.stopped);
        for pid in pids_in(&pids) {
            assert!(gone_soon(pid), "{pid} outlived the timeout");
        }
    }

    #[test]
    fn the_status_question_is_answered_whole() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let claude = run_to_end(
            fake(Tool::ClaudeCode, "answer", args::status(Tool::ClaudeCode)),
            TELLING,
        )
        .expect("status");
        assert_eq!(claude.ended.code, Some(0));
        assert!(claude.out.contains("\"loggedIn\": true"));

        let codex = run_to_end(
            fake(Tool::Codex, "signed-out", args::status(Tool::Codex)),
            TELLING,
        )
        .expect("status");
        assert_eq!(codex.ended.code, Some(1));
        assert!(codex.ended.err.contains("Not logged in"));
    }

    fn until(
        heard: &Receiver<Message>,
        patience: Duration,
        mut matches: impl FnMut(&Message) -> bool,
    ) -> Vec<Message> {
        let started = Instant::now();
        let mut seen = Vec::new();
        while let Some(left) = patience.checked_sub(started.elapsed()) {
            let Ok(message) = heard.recv_timeout(left) else {
                break;
            };
            let done = matches(&message);
            seen.push(message);
            if done {
                return seen;
            }
        }
        panic!("not heard in time; heard {seen:#?}");
    }

    fn line_has(message: &Message, words: &str) -> bool {
        matches!(message, Message::Line { line } if line.contains(words))
    }

    fn reply_to(message: &Message, to: &str) -> bool {
        matches!(message, Message::Reply { to: said, .. } if said == to)
    }

    fn result_of<'a>(messages: &'a [Message], to: &str) -> &'a Value {
        messages
            .iter()
            .find_map(|one| match one {
                Message::Reply {
                    to: said, result, ..
                } if said == to => Some(result),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no reply to {to} in {messages:#?}"))
    }

    fn turn(text: &str) -> Say {
        Say::Turn {
            text: text.to_owned(),
            images: Vec::new(),
        }
    }

    fn claude_session(mode: &str, shape: Shape, folder: &Path) -> (Claude, Receiver<Message>) {
        let config = folder.join("nib-mcp.json");
        std::fs::write(&config, args::mcp_config(Path::new("nib.exe")).to_string())
            .expect("config");
        let args = args::claude_session(shape, &full_caps(), &config).expect("args");
        let mut command = fake(Tool::ClaudeCode, mode, &args);
        command.envs(args::CLAUDE_SESSION_ENV);
        if shape.mode.is_some() {
            command.env(args::TOKEN_VAR, "abc123");
        }
        let (sent, heard) = mpsc::channel();
        let claude = Claude::start(command, IDLE, move |message| {
            let _ = sent.send(message);
        })
        .expect("started");
        (claude, heard)
    }

    #[test]
    fn a_claude_code_session_answers_turn_after_turn_and_is_told_what_to_use() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let shape = Shape {
            mode: Some(Mode::Plan),
            model: Some("opus"),
            effort: Some(Effort::High),
            without: &[],
        };
        let (claude, heard) = claude_session("answer", shape, dir.path());

        claude.say(&turn("what is a heron")).expect("said");
        let first = until(&heard, TELLING, |one| line_has(one, "\"type\":\"result\""));
        let init = first
            .iter()
            .find(|one| line_has(one, "\"subtype\":\"init\""))
            .expect("init");
        for told in [
            "\"mcp_servers\":[{\"name\":\"orden\",\"status\":\"connected\"}]",
            "\"token\":true",
            "mcp__orden__read_note",
            "\"model\":\"opus\"",
            "\"effort\":\"high\"",
        ] {
            assert!(line_has(init, told), "{told} not in {init:?}");
        }
        assert!(!line_has(init, "mcp__orden__edit_note"));
        assert!(first
            .iter()
            .any(|one| line_has(one, "You asked: what is a heron")));

        claude.say(&Say::Context).expect("said");
        let context = until(&heard, TELLING, |one| reply_to(one, "context"));
        assert_eq!(result_of(&context, "context")["maxTokens"], 200_000);

        claude
            .say(&Say::Model {
                model: "sonnet".into(),
            })
            .expect("said");
        until(&heard, TELLING, |one| reply_to(one, "model"));
        claude
            .say(&Say::Effort {
                effort: Some(Effort::Max),
            })
            .expect("said");
        claude
            .say(&turn("/clear and then a second one"))
            .expect("said");
        let second = until(&heard, TELLING, |one| {
            line_has(one, "\"type\":\"result\"") && !line_has(one, "effort")
        });
        assert!(second.iter().any(|one| line_has(one, "effort set to max")));
        assert!(second
            .iter()
            .any(|one| line_has(one, "You asked: /clear and then a second one")));
        assert!(second
            .iter()
            .any(|one| line_has(one, "\"model\":\"sonnet\"")));

        claude.stop();
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.stopped));
    }

    #[test]
    fn a_session_stopped_mid_turn_is_interrupted_and_keeps_its_words() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let (claude, heard) = claude_session("slow", Shape::default(), dir.path());
        claude.say(&turn("a long answer please")).expect("said");
        until(&heard, TELLING, |one| line_has(one, "text_delta"));
        claude.say(&Say::Interrupt).expect("said");
        let rest = until(&heard, TELLING, |one| line_has(one, "\"type\":\"result\""));
        assert!(rest
            .iter()
            .any(|one| line_has(one, "error_during_execution")));
        claude.close_input();
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.code == Some(0)));
    }

    #[test]
    fn a_session_nobody_talks_to_is_ended_with_its_family() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let config = dir.path().join("nib-mcp.json");
        let args = args::claude_session(Shape::default(), &full_caps(), &config).expect("args");
        let mut command = fake(Tool::ClaudeCode, "hang", &args);
        command.env("FAKE_AI_CLI_PIDS", &pids);
        let (sent, heard) = mpsc::channel();
        let claude = Claude::start(command, Duration::from_secs(2), move |message| {
            let _ = sent.send(message);
        })
        .expect("started");
        claude.say(&turn("hold on")).expect("said");
        let family = pids_in(&pids);
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(
            matches!(end.last(), Some(Message::End(ended)) if ended.timed_out && !ended.stopped)
        );
        for pid in family {
            assert!(gone_soon(pid), "{pid} outlived the idle end");
        }
    }

    fn codex_host(mode: &str, token: bool, folder: &Path) -> Host {
        let mut command = fake(Tool::Codex, mode, &args::codex_server());
        if token {
            command.env(args::TOKEN_VAR, "abc123");
        }
        Host::start(
            command,
            IDLE,
            PathBuf::from("nib.exe"),
            folder.to_path_buf(),
        )
        .expect("started")
    }

    fn route() -> (codex_app::Output, Receiver<Message>) {
        let (sent, heard) = mpsc::channel();
        let sent = Mutex::new(sent);
        let output: codex_app::Output = Arc::new(move |message| {
            let _ = lock(&sent).send(message);
        });
        (output, heard)
    }

    #[test]
    fn codex_threads_share_the_app_server_and_stream_their_turns() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("answer", true, dir.path());
        let (one, first) = route();
        let (two, second) = route();
        host.open(
            "one",
            one,
            Some(Mode::Plan),
            Some("gpt-fake"),
            Some(Effort::Xhigh),
            codex_app::From {
                fork_of: None,
                thread: Some("nib-thread-1"),
                without: &[],
            },
        )
        .expect("opened");
        host.open(
            "two",
            two,
            Some(Mode::Full),
            None,
            None,
            codex_app::From::default(),
        )
        .expect("opened");

        host.say("one", turn("what is a heron")).expect("said");
        let heard = until(&first, TELLING, |one| line_has(one, "turn/completed"));
        let told = &result_of(&heard, "thread")["told"];
        assert!(told["enabled_tools"]
            .as_array()
            .is_some_and(|tools| tools.contains(&serde_json::json!("read_note"))));
        let asked = &result_of(&heard, "turn")["told"];
        assert_eq!(asked["model"], "gpt-fake");
        assert_eq!(asked["effort"], "xhigh");
        assert!(heard
            .iter()
            .any(|one| line_has(one, "item/agentMessage/delta")));
        assert!(heard
            .iter()
            .any(|one| line_has(one, "thread/tokenUsage/updated")));
        assert!(heard
            .iter()
            .any(|one| line_has(one, "You asked: what is a heron")));

        let others: Vec<Message> = second.try_iter().collect();
        assert!(others.iter().all(|one| !line_has(one, "agentMessage")));

        host.say(
            "one",
            Say::Goal {
                goal: GoalSay::Set {
                    objective: "file the inbox".into(),
                    budget: Some(1000),
                },
            },
        )
        .expect("said");
        until(&first, TELLING, |one| reply_to(one, "goal"));
        host.say(
            "one",
            Say::Compact {
                focus: String::new(),
            },
        )
        .expect("said");
        until(&first, TELLING, |one| reply_to(one, "compact"));

        let models = host.models(TELLING).expect("models");
        assert!(models["data"][0]["supportedReasoningEfforts"].is_array());

        host.close("one");
        let end = until(&first, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.stopped));
        assert!(host.say("one", Say::Interrupt).is_err());
        assert!(host.alive());
        host.stop();
        until(&second, TELLING, |one| matches!(one, Message::End(_)));
    }

    #[test]
    fn codex_is_steered_and_stopped_mid_turn() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("slow", false, dir.path());
        let (output, heard) = route();
        host.open("t", output, None, None, None, codex_app::From::default())
            .expect("opened");
        host.say("t", turn("a long answer")).expect("said");
        until(&heard, TELLING, |one| {
            line_has(one, "item/agentMessage/delta")
        });
        host.say(
            "t",
            Say::Steer {
                text: "shorter".into(),
            },
        )
        .expect("steered");
        until(&heard, TELLING, |one| reply_to(one, "steer"));
        host.say("t", Say::Interrupt).expect("stopped");
        let rest = until(&heard, TELLING, |one| line_has(one, "turn/completed"));
        assert!(rest.iter().any(|one| line_has(one, "\"interrupted\"")));
        host.stop();
    }

    #[test]
    fn codex_s_requests_for_approval_are_declined() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("approval", false, dir.path());
        let (output, heard) = route();
        host.open("t", output, None, None, None, codex_app::From::default())
            .expect("opened");
        host.say("t", turn("run something")).expect("said");
        let heard = until(&heard, TELLING, |one| line_has(one, "turn/completed"));
        assert!(heard.iter().any(|one| line_has(one, "requestApproval")));
        assert!(heard.iter().any(|one| line_has(one, "answered decline")));
        host.stop();
    }

    #[test]
    fn a_thread_with_tools_on_a_host_with_no_token_is_refused_by_the_stand_in() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let host = codex_host("answer", false, dir.path());
        let (output, heard) = route();
        host.open(
            "t",
            output,
            Some(Mode::Full),
            None,
            None,
            codex_app::From::default(),
        )
        .expect("opened");
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.err.contains("token")));
        host.stop();
    }

    #[test]
    fn nothing_on_the_command_line_comes_from_the_window_but_what_it_names() {
        let caps = args::Caps::from_help(
            "--input-format --effort --restricted --permission-mode --permission-prompts \
             --no-session-persistence --safe-mode",
        );
        let config = PathBuf::from("ai").join("nib-mcp.json");
        let one = Shape {
            mode: Some(Mode::Full),
            model: Some("opus"),
            effort: Some(Effort::Low),
            without: &[],
        };
        let two = Shape {
            model: Some("sonnet[1m]"),
            effort: Some(Effort::Max),
            ..one
        };
        let first = args::claude_session(one, &caps, &config).expect("one");
        let second = args::claude_session(two, &caps, &config).expect("two");
        assert_eq!(first.len(), second.len());
        let differ: Vec<(&str, &str)> = first
            .iter()
            .zip(&second)
            .filter(|(a, b)| a != b)
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        assert_eq!(differ, [("opus", "sonnet[1m]"), ("low", "max")]);
        assert!(args::codex_server()
            .iter()
            .all(|arg| arg == "app-server" || arg == "-c" || arg.contains('=')));
    }

    #[cfg(windows)]
    #[test]
    fn every_argument_survives_an_npm_shim() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let shim = |name: &str, tool: &str| {
            let shim = dir.path().join(name);
            std::fs::write(
                &shim,
                format!("@node \"{}\" {tool} %*\r\n", fake_script().display()),
            )
            .expect("the shim");
            Program {
                exe: shim,
                path: std::env::var_os("PATH").unwrap_or_default(),
            }
        };

        let program = shim("claude.cmd", "claude");
        let args = args::ask(Some("opus"), &args::Caps::default()).expect("args");
        let (lines, ended) = heard_all(
            command(&program, &args, dir.path(), None),
            "through cmd",
            TELLING,
        );
        assert_eq!(ended.code, Some(0), "{}", ended.err);
        assert!(lines[0].contains("opus[1m]"));

        let program = shim("codex.cmd", "codex");
        let mut command = command(&program, &args::codex_server(), dir.path(), None);
        command.env("FAKE_AI_CLI_MODE", "answer");
        let host = Host::start(
            command,
            IDLE,
            PathBuf::from("nib.exe"),
            dir.path().to_path_buf(),
        )
        .expect("started");
        assert!(host.models(TELLING).is_ok());
        host.stop();
    }

    #[test]
    #[ignore = "asks the real Claude Code on this machine, which spends a little of a plan"]
    fn real_claude_says_ok() {
        let Some(program) = program::find(Tool::ClaudeCode) else {
            eprintln!("no Claude Code here; skipped");
            return;
        };
        let dir = tempfile::tempdir().expect("a folder");
        let status = run_to_end(
            command(&program, args::status(Tool::ClaudeCode), dir.path(), None),
            TELLING,
        )
        .expect("status");
        if !status.out.contains("\"loggedIn\": true") {
            eprintln!("Claude Code is not signed in; skipped");
            return;
        }
        let caps = caps_of(&program, dir.path());
        let args = args::ask(None, &caps).expect("args");
        let (lines, ended) =
            heard_all(command(&program, &args, dir.path(), None), "say ok", ASKING);
        eprintln!("{} lines, ended {ended:?}", lines.len());
        assert_eq!(ended.code, Some(0), "{}", ended.err);
        let result = lines
            .iter()
            .find(|line| line.contains("\"type\":\"result\""))
            .expect("a result");
        assert!(result.contains("\"is_error\":false"), "{result}");
        assert!(result.to_lowercase().contains("ok"), "{result}");
        let init = lines
            .iter()
            .find(|line| line.contains("\"subtype\":\"init\""))
            .expect("init");
        assert!(init.contains("\"tools\":[]"), "{init}");
        assert!(init.contains("\"mcp_servers\":[]"), "{init}");

        let shape = Shape {
            model: Some("haiku"),
            effort: Some(Effort::Low),
            ..Shape::default()
        };
        let config = dir.path().join("nib-mcp.json");
        let args = args::claude_session(shape, &caps, &config).expect("args");
        let mut session = command(&program, &args, dir.path(), None);
        session.envs(args::CLAUDE_SESSION_ENV);
        let (sent, heard) = mpsc::channel();
        let claude = Claude::start(session, IDLE, move |message| {
            let _ = sent.send(message);
        })
        .expect("started");
        for _ in 0..2 {
            claude.say(&turn("say ok")).expect("said");
            let said = until(&heard, ASKING, |one| line_has(one, "\"type\":\"result\""));
            assert!(
                said.iter().any(|one| line_has(one, "\"is_error\":false")),
                "{said:#?}"
            );
            assert!(said.iter().any(|one| line_has(one, "\"tools\":[]")));
        }
        claude.say(&Say::Context).expect("said");
        let context = until(&heard, ASKING, |one| reply_to(one, "context"));
        assert!(result_of(&context, "context")["maxTokens"].is_number());
        let models = claude.ask(serde_json::json!({ "subtype": "list_models" }), TELLING);
        assert!(models.is_ok_and(|models| models["models"].is_array()));
        claude.stop();
    }

    fn gemini_session(
        mode: &'static str,
        folder: &Path,
        tools: Option<Mode>,
    ) -> (Gemini, Receiver<Message>) {
        let (output, heard) = route();
        let caps = args::Caps::from_help("--output-format --skip-trust --resume --model");
        let launch = gemini::Launch {
            base: Box::new(move |args: &[String]| fake(Tool::Gemini, mode, args)),
            folder: folder.to_path_buf(),
            caps,
            token: tools.map(|_| "abc123".to_owned()),
            thread: Some("nib-thread-1".to_owned()),
            mode: tools,
            without: Vec::new(),
        };
        let nib = tools.map(|_| PathBuf::from("nib.exe"));
        let gemini =
            Gemini::start(launch, "g-1", None, IDLE, nib.as_deref(), output).expect("started");
        (gemini, heard)
    }

    fn lines_until_result(heard: &Receiver<Message>) -> Vec<String> {
        until(heard, TELLING, |one| {
            matches!(one, Message::End(_))
                || matches!(one, Message::Line { line } if line.contains("\"result\""))
        })
        .into_iter()
        .map(|one| match one {
            Message::Line { line } => line,
            other => panic!("not a line: {other:?}"),
        })
        .collect()
    }

    #[test]
    fn a_gemini_session_resumes_its_session_turn_by_turn_and_lends_orden() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let (gemini, heard) = gemini_session("answer", dir.path(), Some(Mode::Full));
        gemini.say(turn("what is a heron")).expect("said");
        let first = lines_until_result(&heard).join("\n");
        assert!(first.contains("fake-session-1"), "{first}");
        assert!(first.contains("mcp_orden_read_note"), "{first}");
        assert!(first.contains("set:abc123"), "{first}");
        assert!(first.contains(r#""content":" what is a heron""#), "{first}");

        let mut said = Err(String::new());
        for _ in 0..100 {
            said = gemini.say(turn("and a stork"));
            if said.is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        said.expect("said again");
        let second = lines_until_result(&heard).join("\n");
        assert!(second.contains(r#""content":"again""#), "{second}");
        assert!(second.contains("fake-session-1"), "{second}");
        assert!(heard.recv_timeout(Duration::from_millis(500)).is_err());

        let pictured = Say::Turn {
            text: "this".to_owned(),
            images: vec![say::Image {
                mime: "image/png".to_owned(),
                data: "iVBORw0KGgo=".to_owned(),
            }],
        };
        assert!(gemini.say(pictured).is_err());
        assert!(gemini.say(Say::Fast { on: true }).is_err());
        assert!(gemini.say(Say::Effort { effort: None }).is_ok());
        let at = Instant::now();
        gemini.stop();
        assert!(at.elapsed() < Duration::from_millis(500));
        let files = dir.path().join("gemini").join("g-1");
        while files.exists() && at.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!files.exists());
    }

    #[test]
    fn a_gemini_turn_that_dies_unanswered_ends_the_session_with_its_words() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let (gemini, heard) = gemini_session("crash", dir.path(), None);
        gemini.say(turn("hello")).expect("said");
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(
            matches!(end.last(), Some(Message::End(ended)) if ended.code == Some(1) && ended.err.contains("boom"))
        );

        let (signed_out, heard) = gemini_session("signed-out", dir.path(), None);
        signed_out.say(turn("hello")).expect("said");
        let lines = lines_until_result(&heard).join("\n");
        assert!(lines.contains("Auth method"), "{lines}");
        assert!(heard.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn an_interrupted_gemini_turn_ends_stopped() {
        if !node() {
            eprintln!("no node here; skipped");
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let pids = dir.path().join("pids");
        let (output, heard) = route();
        let watched = pids.clone();
        let launch = gemini::Launch {
            base: Box::new(move |args: &[String]| {
                let mut command = fake(Tool::Gemini, "hang", args);
                command.env("FAKE_AI_CLI_PIDS", &watched);
                command
            }),
            folder: dir.path().to_path_buf(),
            caps: args::Caps::from_help("--output-format"),
            token: None,
            thread: None,
            mode: None,
            without: Vec::new(),
        };
        let gemini = Gemini::start(launch, "g-2", None, IDLE, None, output).expect("started");
        gemini.say(turn("hold on")).expect("said");
        let family = pids_in(&pids);
        assert!(gemini.say(turn("again")).is_err());
        gemini.say(Say::Interrupt).expect("interrupted");
        let end = until(&heard, TELLING, |one| matches!(one, Message::End(_)));
        assert!(matches!(end.last(), Some(Message::End(ended)) if ended.stopped));
        for pid in family {
            assert!(gone_soon(pid), "{pid} outlived the interrupt");
        }
    }
}
