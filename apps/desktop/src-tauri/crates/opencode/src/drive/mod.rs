mod mock;
mod schema;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use crate::env::{env_of, Dirs, Launch};
use crate::host::Running;
use crate::preset::{self, Preset};
use crate::proxy::{call_on, Answer};
use crate::{feed, http};

const BINARY_VAR: &str = "ORDEN_OPENCODE_BIN";
const WRITE_VAR: &str = "ORDEN_OPENCODE_SNAPSHOT";
const WITHIN: Duration = Duration::from_secs(60);
const GROWS_AT_MOST: f64 = 12.0;
const EVENTS: [&str; 10] = [
    "server.connected",
    "session.created",
    "session.updated",
    "session.status",
    "session.idle",
    "message.updated",
    "message.part.updated",
    "message.part.delta",
    "permission.asked",
    "permission.replied",
];
const PARTS: [&str; 4] = ["text", "tool", "step-start", "step-finish"];
const STATES: [&str; 2] = ["completed", "error"];
const ROLES: [&str; 2] = ["user", "assistant"];
fn binary() -> Option<PathBuf> {
    std::env::var_os(BINARY_VAR).filter(|one| !one.is_empty()).map(PathBuf::from)
}
fn real(path: &Path) -> PathBuf {
    let full = std::fs::canonicalize(path).expect("a real folder");
    let text = full.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(plain) if !plain.starts_with("UNC") => PathBuf::from(plain),
        _ => full,
    }
}
pub(crate) fn wrapper() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let here = std::env::current_exe().expect("the test's own path");
    let built =
        here.ancestors().map(|folder| folder.join("orden-shell.exe")).find(|one| one.is_file());
    assert!(
        built.is_some(),
        "run cargo test -p orden-opencode, not --lib, so orden-shell.exe is built"
    );
    built
}
fn snapshot_file(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("drive").join(name)
}
fn writing() -> bool {
    std::env::var(WRITE_VAR).is_ok_and(|one| one == "write")
}
fn config(model: u16, mcp: u16, preset: Preset) -> Value {
    json!({
        "enabled_providers": ["mock"],
        "provider": { "mock": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "Mock",
            "options": { "baseURL": format!("http://127.0.0.1:{model}/v1"), "apiKey": "none" },
            "models": { "m": { "name": "Mock", "tool_call": true } },
        } },
        "model": "mock/m",
        "small_model": "mock/m",
        "permission": preset::permission(preset),
        "agent": { "plan": { "permission": preset::plan() } },
        "mcp": { "orden": {
            "type": "remote",
            "url": format!("http://127.0.0.1:{mcp}/mcp"),
            "headers": { "Authorization": format!("Bearer {}", mock::TOKEN) },
            "oauth": false,
            "timeout": 10000,
        } },
    })
}
struct Drive {
    running: Option<Running>,
    root: PathBuf,
    _dir: tempfile::TempDir,
    events: Receiver<Value>,
    heard: Vec<Value>,
    stop: Arc<AtomicBool>,
    follower: Option<JoinHandle<()>>,
    mcp: mock::Mcp,
    model: mock::Model,
}
impl Drive {
    fn start(preset: Preset) -> Option<Drive> {
        let binary = binary()?;
        let (model, mcp) = (mock::model(), mock::mcp());
        let dir = tempfile::tempdir().expect("a folder");
        let root = real(dir.path()).join("opencode");
        let launch = Launch {
            binary,
            dirs: Dirs { root: root.clone() },
            config: config(model.port, mcp.port, preset),
            auth: None,
            orden: None,
            wrapper: wrapper(),
        };
        let running = Running::start(launch).expect("ready");
        let stop = Arc::new(AtomicBool::new(false));
        let (told, events) = mpsc::channel();
        let follower = {
            let (stop, line) = (stop.clone(), running.line.clone());
            std::thread::spawn(move || {
                feed::follow(&stop, || Some(line.clone()), |event| told.send(event).is_ok());
            })
        };
        let mut drive = Drive {
            running: Some(running),
            root,
            _dir: dir,
            events,
            heard: Vec::new(),
            stop,
            follower: Some(follower),
            mcp,
            model,
        };
        drive.until(0, |one| one["type"] == "server.connected");
        Some(drive)
    }
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Answer {
        let running = self.running.as_ref().expect("running");
        let answer = call_on(&running.line, method, path, body).expect("answered");
        assert!(answer.status < 300, "{method} {path}: {} {}", answer.status, answer.body);
        answer
    }
    fn mark(&self) -> usize {
        self.heard.len()
    }
    fn until(&mut self, from: usize, what: impl Fn(&Value) -> bool) -> Value {
        if let Some(found) = self.heard[from.min(self.heard.len())..].iter().find(|one| what(one)) {
            return found.clone();
        }
        let started = Instant::now();
        loop {
            let left = WITHIN.saturating_sub(started.elapsed());
            let event = self.events.recv_timeout(left).unwrap_or_else(|_| {
                let types: Vec<&Value> = self.heard.iter().map(|one| &one["type"]).collect();
                panic!(
                    "no such event within {} s; heard {types:?}; tools said {}",
                    WITHIN.as_secs(),
                    tools_said(&self.heard[from.min(self.heard.len())..])
                )
            });
            self.heard.push(event.clone());
            if what(&event) {
                return event;
            }
        }
    }
    fn session(&self) -> String {
        let made = self.call("POST", "/session", Some(&json!({})));
        made.body["id"].as_str().expect("a session id").to_owned()
    }
    fn prompt(&self, session: &str, agent: Option<&str>, words: &str) {
        let mut body = json!({ "parts": [{ "type": "text", "text": words }] });
        if let Some(agent) = agent {
            body["agent"] = json!(agent);
        }
        self.call("POST", &format!("/session/{session}/prompt_async"), Some(&body));
    }
    fn asked(&mut self, from: usize, session: &str) -> Value {
        self.until(from, |one| {
            one["type"] == "permission.asked" && one["properties"]["sessionID"] == session
        })
    }
    fn reply(&self, asked: &Value, reply: &str, message: Option<&str>) {
        let id = asked["properties"]["id"].as_str().expect("an id");
        let mut body = json!({ "reply": reply });
        if let Some(message) = message {
            body["message"] = json!(message);
        }
        self.call("POST", &format!("/permission/{id}/reply"), Some(&body));
    }
    fn idle(&mut self, from: usize, session: &str) {
        self.until(from, |one| {
            one["type"] == "session.idle" && one["properties"]["sessionID"] == session
        });
    }
    fn calls(&self) -> usize {
        self.mcp.heard.lock().expect("heard").len()
    }
    fn called(&self, tool: &str, since: usize) -> bool {
        let call = format!("tools/call:{tool}");
        self.mcp.heard.lock().expect("heard")[since..].iter().any(|(_, method)| *method == call)
    }
    fn asked_none(&self, from: usize, session: &str) -> bool {
        !self.heard[from..].iter().any(|one| {
            one["type"] == "permission.asked" && one["properties"]["sessionID"] == session
        })
    }
    fn runs_unasked(&mut self, tool: &str) {
        let session = self.session();
        let since = self.calls();
        let from = self.mark();
        self.prompt(&session, None, &format!("tool: orden_{tool}"));
        self.idle(from, &session);
        assert!(self.asked_none(from, &session), "orden_{tool} asked");
        assert!(
            self.called(tool, since),
            "orden_{tool} did not reach Orden; tools said {}",
            tools_said(&self.heard[from..])
        );
        let answered = self.heard[from..].iter().any(|one| {
            let part = &one["properties"]["part"];
            part["tool"] == format!("orden_{tool}")
                && part["state"]["status"] == "completed"
                && part["state"]["output"].as_str().is_some_and(|out| out.contains("Added Milk"))
        });
        assert!(answered, "orden_{tool}'s answer did not come back");
    }
    fn asks_first(&mut self, tool: &str) {
        let session = self.session();
        let since = self.calls();
        let from = self.mark();
        self.prompt(&session, None, &format!("tool: orden_{tool}"));
        let asked = self.asked(from, &session);
        assert_eq!(asked["properties"]["permission"], format!("orden_{tool}"));
        let from = self.mark();
        self.reply(&asked, "reject", None);
        self.idle(from, &session);
        assert!(!self.called(tool, since), "a refused orden_{tool} reached Orden");
    }
    fn never_reaches(&mut self, tool: &str, agent: Option<&str>) {
        let session = self.session();
        let since = self.calls();
        let from = self.mark();
        self.prompt(&session, agent, &format!("tool: orden_{tool}"));
        self.idle(from, &session);
        assert!(self.asked_none(from, &session), "orden_{tool} asked instead of being refused");
        assert!(!self.called(tool, since), "orden_{tool} reached Orden");
    }
    fn plan_stays_read_only(&mut self) {
        self.never_reaches("add_task", Some("plan"));
        let session = self.session();
        let target = self.root.join("planned.txt");
        let from = self.mark();
        self.prompt(&session, Some("plan"), &format!("write: {}", target.display()));
        self.idle(from, &session);
        assert!(!target.exists(), "the Plan agent wrote a file");
        assert!(
            !self.heard[from..].iter().any(|one| one["type"] == "permission.asked"
                && one["properties"]["sessionID"] == session.as_str()),
            "the Plan agent asked to edit instead of being refused"
        );
        let messages = self.call("GET", &format!("/session/{session}/message"), None).body;
        let first = messages.as_array().and_then(|all| all.first()).expect("a message");
        assert_eq!(first["info"]["role"], "user");
        assert_eq!(first["info"]["agent"], "plan");
        let place = target.display().to_string();
        let offered = self.model.asked.lock().expect("asked").iter().any(|body| {
            body["messages"].to_string().contains(&place)
                && body["tools"]
                    .as_array()
                    .is_some_and(|all| all.iter().any(|tool| tool["function"]["name"] == "write"))
        });
        let refused = self.heard[from..].iter().any(|one| {
            let part = &one["properties"]["part"];
            part["tool"] == "write" && part["state"]["status"] == "error"
        });
        assert!(!offered || refused, "the Plan agent's write was neither withheld nor refused");
    }
}
impl Drop for Drive {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(follower) = self.follower.take() {
            let _ = follower.join();
        }
        if let Some(running) = self.running.take() {
            let config = running.launch.dirs.own_config();
            running.stop();
            std::thread::sleep(Duration::from_millis(500));
            let _ = std::fs::remove_dir_all(config);
        }
    }
}
fn tools_said(heard: &[Value]) -> String {
    let said: Vec<String> = heard
        .iter()
        .map(|one| &one["properties"]["part"])
        .filter(|part| part["type"] == "tool")
        .map(|part| {
            let state = &part["state"];
            let words = state["output"].as_str().or(state["error"].as_str()).unwrap_or_default();
            let words: String = words.chars().take(400).collect();
            format!("{} {} {words}", part["tool"], state["status"])
        })
        .collect();
    said.join(" | ")
}
fn walked(path: &Path, into: &mut BTreeMap<PathBuf, Option<SystemTime>>) {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return;
    };
    into.insert(path.to_owned(), meta.modified().ok());
    if meta.is_dir() {
        for one in std::fs::read_dir(path).into_iter().flatten().flatten() {
            walked(&one.path(), into);
        }
    }
}
fn users_opencode() -> BTreeMap<PathBuf, Option<SystemTime>> {
    let mut all = BTreeMap::new();
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return all;
    };
    let home = PathBuf::from(home);
    for part in [
        ".opencode",
        ".config/opencode",
        ".local/share/opencode",
        ".local/state/opencode",
        ".cache/opencode",
    ] {
        walked(&home.join(part), &mut all);
    }
    all
}
fn keys(value: &Value) -> BTreeSet<String> {
    value.as_object().map(|all| all.keys().cloned().collect()).unwrap_or_default()
}
fn shapes(heard: &[Value]) -> Value {
    let mut kinds: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> = BTreeMap::new();
    let mut seen = |kind: &str, name: &str, value: &Value| {
        let found = keys(value);
        kinds
            .entry(kind.to_owned())
            .or_default()
            .entry(name.to_owned())
            .and_modify(|kept| kept.retain(|one| found.contains(one)))
            .or_insert(found);
    };
    for one in heard {
        let kind = one["type"].as_str().unwrap_or_default();
        if EVENTS.contains(&kind) {
            seen("events", kind, &one["properties"]);
        }
        let part = &one["properties"]["part"];
        if kind == "message.part.updated"
            && PARTS.contains(&part["type"].as_str().unwrap_or_default())
        {
            seen("parts", part["type"].as_str().unwrap_or_default(), part);
            let status = part["state"]["status"].as_str().unwrap_or_default();
            if part["type"] == "tool" && STATES.contains(&status) {
                seen("states", status, &part["state"]);
            }
        }
        let info = &one["properties"]["info"];
        if kind == "message.updated" && ROLES.contains(&info["role"].as_str().unwrap_or_default()) {
            seen("messages", info["role"].as_str().unwrap_or_default(), info);
        }
    }
    json!(kinds)
}
fn shapes_missing(was: &Value, now: &Value) -> Vec<String> {
    let mut missing = Vec::new();
    for (kind, names) in was.as_object().into_iter().flatten() {
        for (name, fields) in names.as_object().into_iter().flatten() {
            let found: BTreeSet<&str> = now[kind][name]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            if now[kind].get(name).is_none() {
                missing.push(format!("{kind} {name} never came"));
                continue;
            }
            for field in fields.as_array().into_iter().flatten().filter_map(Value::as_str) {
                if !found.contains(field) {
                    missing.push(format!("{kind} {name} lacks {field}"));
                }
            }
        }
    }
    missing
}
fn compared(
    name: &str,
    now: &Value,
    text: String,
    missing: impl Fn(&Value, &Value) -> Vec<String>,
) {
    let file = snapshot_file(name);
    if writing() {
        std::fs::write(&file, text).expect("snapshot written");
        return;
    }
    let was: Value =
        serde_json::from_str(&std::fs::read_to_string(&file).expect("snapshot")).expect("json");
    let broken = missing(&was, now);
    assert!(broken.is_empty(), "OpenCode no longer matches {name}:\n{}", broken.join("\n"));
}
#[test]
fn the_snapshots_cover_every_route_and_event_orden_uses() {
    let read = |name: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(snapshot_file(name)).expect("snapshot"))
            .expect("json")
    };
    let routes = read("schema.json");
    for (method, route) in schema::used() {
        assert!(routes["routes"].get(format!("{method} {route}")).is_some(), "{method} {route}");
    }
    let events = read("events.json");
    for kind in EVENTS {
        assert!(events["events"].get(kind).is_some(), "{kind}");
    }
    for kind in PARTS {
        assert!(events["parts"].get(kind).is_some(), "{kind}");
    }
}
#[test]
fn the_engine_s_schema_still_covers_every_route_orden_uses() {
    let Some(binary) = binary() else {
        return;
    };
    let dir = tempfile::tempdir().expect("a folder");
    let dirs = Dirs { root: dir.path().join("opencode") };
    let launch = Launch {
        binary,
        dirs: dirs.clone(),
        config: json!({ "enabled_providers": [] }),
        auth: None,
        orden: None,
        wrapper: wrapper(),
    };
    let running = Running::start(launch).expect("ready");
    let doc = http::request(
        running.line.port,
        ("GET", "/doc"),
        None,
        Some(&running.line.password),
        WITHIN,
    )
    .expect("doc");
    running.stop();
    std::thread::sleep(Duration::from_millis(500));
    let _ = std::fs::remove_dir_all(dirs.own_config());
    assert_eq!(doc.status, 200);
    let now = schema::taken(&serde_json::from_str(&doc.body).expect("json"));
    compared("schema.json", &now, schema::written(&now), schema::broken);
}
#[test]
fn under_approve_the_engine_asks_runs_refuses_and_reports_as_orden_relies_on() {
    let before = users_opencode();
    let Some(mut drive) = Drive::start(Preset::Approve) else {
        return;
    };
    let config = drive.call("GET", "/config", None).body;
    assert_eq!(config["model"], "mock/m");
    assert_eq!(config["share"], "disabled");
    assert_eq!(config["autoupdate"], false);
    assert_eq!(config["permission"]["orden_add_task"], "ask");
    assert_eq!(config["permission"]["orden_read_note"], "allow");
    assert_eq!(config["permission"]["orden_run_agent"], "deny");
    assert_eq!(config["agent"]["plan"]["permission"]["orden_add_task"], "deny");
    assert_eq!(config["permission"]["bash"]["*"], "ask");
    assert_eq!(config["agent"]["plan"]["permission"]["edit"]["*"], "deny");
    assert_eq!(config["mcp"]["orden"]["type"], "remote");
    let mcp = drive.call("GET", "/mcp", None).body;
    assert_eq!(mcp["orden"]["status"], "connected", "{mcp}");
    let work = drive.root.join("work");
    std::fs::create_dir_all(&work).expect("work");
    let (gone, kept) = (work.join("gone.txt"), work.join("kept.txt"));
    std::fs::write(&gone, "x").expect("gone");
    std::fs::write(&kept, "x").expect("kept");
    let session = drive.session();
    let from = drive.mark();
    drive.prompt(&session, None, "bash: rm work/gone.txt");
    let asked = drive.asked(from, &session);
    assert_eq!(asked["properties"]["permission"], "bash");
    assert!(asked["properties"]["tool"]["callID"].is_string(), "{asked}");
    let pending = drive.call("GET", "/permission", None).body;
    assert!(pending
        .as_array()
        .is_some_and(|all| all.iter().any(|one| one["id"] == asked["properties"]["id"])));
    let from = drive.mark();
    drive.reply(&asked, "once", None);
    drive.until(from, |one| one["type"] == "permission.replied");
    drive.idle(from, &session);
    assert!(
        !gone.exists(),
        "a command allowed once did not run; tools said {}",
        tools_said(&drive.heard[from..])
    );
    let from = drive.mark();
    drive.prompt(&session, None, "bash: rm work/kept.txt");
    let asked = drive.asked(from, &session);
    let from = drive.mark();
    drive.reply(&asked, "reject", Some("not now"));
    drive.idle(from, &session);
    assert!(kept.exists(), "a refused command ran");
    let refused = drive.heard[from..].iter().any(|one| {
        let part = &one["properties"]["part"];
        part["type"] == "tool"
            && part["state"]["status"] == "error"
            && part["state"]["error"].as_str().is_some_and(|why| why.contains("not now"))
    });
    assert!(refused, "the refusal did not reach the tool with its message");
    let from = drive.mark();
    let since = drive.calls();
    drive.prompt(&session, None, "tool: orden_add_task");
    let asked = drive.asked(from, &session);
    assert_eq!(asked["properties"]["permission"], "orden_add_task");
    let from = drive.mark();
    drive.reply(&asked, "once", None);
    drive.idle(from, &session);
    assert!(drive.called("add_task", since), "a tool allowed once did not reach Orden");
    drive.runs_unasked("read_note");
    drive.never_reaches("run_agent", None);
    {
        let heard = drive.mcp.heard.lock().expect("heard");
        assert!(heard.iter().any(|(_, method)| method == "tools/list"), "{heard:?}");
        let bearer = format!("Bearer {}", mock::TOKEN);
        assert!(
            heard.iter().all(|(said, _)| said.as_deref() == Some(bearer.as_str())),
            "{heard:?}"
        );
    }
    drive.plan_stays_read_only();
    let now = shapes(&drive.heard);
    let text = format!("{}\n", serde_json::to_string_pretty(&now).expect("json"));
    compared("events.json", &now, text, shapes_missing);
    drop(drive);
    assert_eq!(users_opencode(), before, "the engine wrote into the reader's own OpenCode folders");
}
#[test]
fn auto_asks_only_the_risky_tools_full_none_and_plan_stays_read_only_under_both() {
    for preset in [Preset::Auto, Preset::Full] {
        let Some(mut drive) = Drive::start(preset) else {
            return;
        };
        drive.plan_stays_read_only();
        drive.runs_unasked("add_task");
        drive.never_reaches("run_agent", None);
        if preset == Preset::Auto {
            drive.asks_first("files");
        } else {
            drive.runs_unasked("files");
        }
    }
}
#[test]
fn the_engine_is_ready_within_a_few_times_what_reading_its_config_takes() {
    let Some(binary) = binary() else {
        return;
    };
    let dir = tempfile::tempdir().expect("a folder");
    let dirs = Dirs { root: dir.path().join("opencode") };
    let launch = Launch {
        binary: binary.clone(),
        dirs: dirs.clone(),
        config: json!({ "enabled_providers": [] }),
        auth: None,
        orden: None,
        wrapper: wrapper(),
    };
    let ready = || {
        let started = Instant::now();
        let running = Running::start(launch.clone()).expect("ready");
        let spent = started.elapsed();
        running.stop();
        std::thread::sleep(Duration::from_millis(500));
        spent
    };
    let read = || {
        let started = Instant::now();
        let done = std::process::Command::new(&binary)
            .args(["debug", "config"])
            .current_dir(&dirs.root)
            .envs(env_of(&launch, "unused", Path::new("/bin/sh"), |_| None))
            .output()
            .expect("ran");
        assert!(done.status.success(), "{}", String::from_utf8_lossy(&done.stderr));
        started.elapsed()
    };
    ready();
    read();
    let least = |measure: &dyn Fn() -> Duration| (0..3).map(|_| measure()).min().expect("measured");
    let (read, ready) = (least(&read), least(&ready));
    let _ = std::fs::remove_dir_all(dirs.own_config());
    let ratio = ready.as_secs_f64() / read.as_secs_f64().max(0.05);
    assert!(
        ratio < GROWS_AT_MOST,
        "ready in {ready:?}, {ratio:.1} times reading its config ({read:?})"
    );
}
