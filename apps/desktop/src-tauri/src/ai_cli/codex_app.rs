use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};

use super::args::{codex_thread, with_thread, Effort, Mode, Tool};
use super::run::{self, Ended, Heard, Running};
use super::say::{GoalSay, Image, Message, Say};

pub type Output = Arc<dyn Fn(Message) + Send + Sync>;

struct Route {
    output: Output,
    thread: Option<String>,
    turn: Option<String>,
    model: Option<String>,
    effort: Option<&'static str>,
    fast: bool,
    queued: Vec<Say>,
}

enum Waiter {
    Init,
    Started(String),
    Reply(String, &'static str),
    Crate(mpsc::Sender<Result<Value, String>>),
    Nobody,
}

#[derive(Default)]
struct State {
    next: u64,
    ready: bool,
    backlog: Vec<String>,
    waiting: HashMap<u64, Waiter>,
    routes: HashMap<String, Route>,
    threads: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct From<'a> {
    pub fork_of: Option<&'a str>,
    pub thread: Option<&'a str>,
    pub without: &'a [String],
}

pub struct Host {
    running: Running,
    state: Arc<Mutex<State>>,
    ended: Arc<AtomicBool>,
    orden: PathBuf,
    folder: PathBuf,
}

fn locked(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Host {
    pub fn start(
        command: Command,
        idle: Duration,
        orden: PathBuf,
        folder: PathBuf,
    ) -> io::Result<Self> {
        let state: Arc<Mutex<State>> = Arc::default();
        let ended = Arc::new(AtomicBool::new(false));
        let writer: Arc<Mutex<Option<Running>>> = Arc::default();

        let heard_state = Arc::clone(&state);
        let heard_ended = Arc::clone(&ended);
        let heard_writer = Arc::clone(&writer);
        let running = run::open(command, idle, move |heard| {
            let writer = heard_writer
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            match heard {
                Heard::Line(line) => {
                    if let Some(writer) = writer {
                        heard_line(&heard_state, &writer, &line);
                    }
                }
                Heard::End(ended) => {
                    heard_ended.store(true, Ordering::SeqCst);
                    ending(&heard_state, &ended);
                }
            }
        })?;
        *writer.lock().unwrap_or_else(PoisonError::into_inner) = Some(running.clone());

        let host = Self {
            running,
            state,
            ended,
            orden,
            folder,
        };
        let introduce = {
            let mut state = locked(&host.state);
            state.waiting.insert(0, Waiter::Init);
            state.next = 1;
            request_line(
                0,
                "initialize",
                &json!({
                    "clientInfo": {
                        "name": "orden",
                        "title": "Orden",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": { "experimentalApi": true },
                }),
            )
        };
        host.running.write_line(&introduce)?;
        Ok(host)
    }

    pub fn alive(&self) -> bool {
        !self.ended.load(Ordering::SeqCst)
    }

    pub fn stop(&self) {
        self.running.stop();
    }

    pub fn open(
        &self,
        id: &str,
        output: Output,
        mode: Option<Mode>,
        model: Option<&str>,
        effort: Option<Effort>,
        from: From<'_>,
    ) -> Result<(), String> {
        let effort = effort.map(|one| one.word(Tool::Codex)).transpose()?;
        let mut state = locked(&self.state);
        if state.routes.contains_key(id) {
            return Err(format!("{id} is already open"));
        }
        let mut params = codex_thread(mode, model, from.without, &self.orden, &self.folder);
        if let (Some(thread), Some(_)) = (from.thread, mode) {
            with_thread(&mut params, thread);
        }
        let method = if let Some(from) = from.fork_of {
            let thread = state
                .routes
                .get(from)
                .and_then(|route| route.thread.clone())
                .ok_or_else(|| format!("{from} has no thread to copy"))?;
            params["threadId"] = json!(thread);
            "thread/fork"
        } else {
            "thread/start"
        };
        state.routes.insert(
            id.to_owned(),
            Route {
                output,
                thread: None,
                turn: None,
                model: model.map(str::to_owned),
                effort,
                fast: false,
                queued: Vec::new(),
            },
        );
        send(
            &mut state,
            &self.running,
            method,
            &params,
            Waiter::Started(id.to_owned()),
        )
    }

    pub fn say(&self, id: &str, say: Say) -> Result<(), String> {
        let mut state = locked(&self.state);
        let route = state
            .routes
            .get_mut(id)
            .ok_or_else(|| format!("{id} is not open"))?;
        if route.thread.is_none() {
            route.queued.push(say);
            return Ok(());
        }
        say_now(&mut state, &self.running, id, say)
    }

    pub fn close(&self, id: &str) {
        let mut state = locked(&self.state);
        let Some(route) = state.routes.remove(id) else {
            return;
        };
        if let Some(thread) = &route.thread {
            state.threads.remove(thread);
            let _ = send(
                &mut state,
                &self.running,
                "thread/unsubscribe",
                &json!({ "threadId": thread }),
                Waiter::Nobody,
            );
        }
        drop(state);
        (route.output)(Message::End(Ended {
            stopped: true,
            ..Ended::default()
        }));
    }

    pub fn models(&self, patience: Duration) -> Result<Value, String> {
        self.ask("model/list", &json!({ "includeHidden": false }), patience)
    }

    pub fn limits(&self, patience: Duration) -> Result<Value, String> {
        self.ask("account/rateLimits/read", &Value::Null, patience)
    }

    fn ask(&self, method: &str, params: &Value, patience: Duration) -> Result<Value, String> {
        let (sent, answer) = mpsc::channel();
        {
            let mut state = locked(&self.state);
            send(
                &mut state,
                &self.running,
                method,
                params,
                Waiter::Crate(sent),
            )?;
        }
        answer
            .recv_timeout(patience)
            .map_err(|_| "Codex did not answer".to_owned())?
    }
}

fn request_line(id: u64, method: &str, params: &Value) -> String {
    json!({ "id": id, "method": method, "params": params }).to_string()
}

fn send(
    state: &mut State,
    running: &Running,
    method: &str,
    params: &Value,
    waiter: Waiter,
) -> Result<(), String> {
    let id = state.next;
    state.next += 1;
    state.waiting.insert(id, waiter);
    let line = request_line(id, method, params);
    if !state.ready {
        state.backlog.push(line);
        return Ok(());
    }
    running.write_line(&line).map_err(|error| {
        state.waiting.remove(&id);
        format!("Codex is not listening: {error}")
    })
}

fn input(text: &str, images: &[Image]) -> Value {
    let mut items: Vec<Value> = images
        .iter()
        .map(|image| {
            json!({ "type": "image", "url": format!("data:{};base64,{}", image.mime, image.data) })
        })
        .collect();
    items.push(json!({ "type": "text", "text": text, "text_elements": [] }));
    Value::Array(items)
}

fn say_now(state: &mut State, running: &Running, id: &str, say: Say) -> Result<(), String> {
    let route = state
        .routes
        .get_mut(id)
        .ok_or_else(|| format!("{id} is not open"))?;
    let thread = route.thread.clone().unwrap_or_default();
    let reply = |to| Waiter::Reply(id.to_owned(), to);
    let (method, params, waiter) = match say {
        Say::Turn { text, images } => {
            let mut params = json!({
                "threadId": thread,
                "input": input(&text, &images),
                "summary": "auto",
            });
            if let Some(model) = &route.model {
                params["model"] = json!(model);
            }
            if let Some(effort) = route.effort {
                params["effort"] = json!(effort);
            }
            if route.fast {
                params["serviceTier"] = json!("priority");
            }
            ("turn/start", params, reply("turn"))
        }
        Say::Steer { text } => {
            let turn = route.turn.clone().ok_or("no turn is running")?;
            let params = json!({
                "threadId": thread,
                "input": input(&text, &[]),
                "expectedTurnId": turn,
            });
            ("turn/steer", params, reply("steer"))
        }
        Say::Interrupt => {
            let Some(turn) = route.turn.clone() else {
                return Ok(());
            };
            let params = json!({ "threadId": thread, "turnId": turn });
            ("turn/interrupt", params, Waiter::Nobody)
        }
        Say::Model { model } => {
            route.model = Some(model);
            return Ok(());
        }
        Say::Effort { effort } => {
            route.effort = effort.map(|one| one.word(Tool::Codex)).transpose()?;
            return Ok(());
        }
        Say::Fast { on } => {
            route.fast = on;
            return Ok(());
        }
        Say::Compact { .. } => (
            "thread/compact/start",
            json!({ "threadId": thread }),
            reply("compact"),
        ),
        Say::Context => return Err("Codex says how full its window is after each turn".into()),
        Say::Goal { goal } => {
            let (method, params) = match goal {
                GoalSay::Set { objective, budget } => (
                    "thread/goal/set",
                    json!({
                        "threadId": thread,
                        "objective": objective,
                        "status": "active",
                        "tokenBudget": budget,
                    }),
                ),
                GoalSay::Pause => (
                    "thread/goal/set",
                    json!({ "threadId": thread, "status": "paused" }),
                ),
                GoalSay::Resume => (
                    "thread/goal/set",
                    json!({ "threadId": thread, "status": "active" }),
                ),
                GoalSay::Clear => ("thread/goal/clear", json!({ "threadId": thread })),
                GoalSay::Get => ("thread/goal/get", json!({ "threadId": thread })),
            };
            (method, params, reply("goal"))
        }
    };
    send(state, running, method, &params, waiter)
}

fn heard_line(state: &Mutex<State>, running: &Running, line: &str) {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let method = message["method"].as_str();
    let id = message["id"]
        .as_u64()
        .or_else(|| message["id"].is_string().then_some(u64::MAX));
    let mut state = locked(state);
    match (method, id) {
        (Some(method), Some(_)) => {
            let _ = running.write_line(&refusal(&message["id"], method));
            route_line(&state, &message["params"], line);
        }
        (None, Some(id)) => answered(&mut state, running, id, &message),
        (Some(method), None) => {
            let params = &message["params"];
            if let Some(orden) = orden_of(&state, params) {
                if let Some(route) = state.routes.get_mut(&orden) {
                    match method {
                        "turn/started" => {
                            route.turn = params["turn"]["id"].as_str().map(str::to_owned);
                        }
                        "turn/completed" => route.turn = None,
                        _ => {}
                    }
                }
            }
            route_line(&state, params, line);
        }
        (None, None) => {}
    }
}

fn orden_of(state: &State, params: &Value) -> Option<String> {
    let thread = params["threadId"].as_str()?;
    state.threads.get(thread).cloned()
}

fn route_line(state: &State, params: &Value, line: &str) {
    let message = || Message::Line {
        line: line.to_owned(),
    };
    if params["threadId"].is_string() {
        if let Some(route) = orden_of(state, params).and_then(|orden| state.routes.get(&orden)) {
            (route.output)(message());
        }
    } else {
        for route in state.routes.values() {
            (route.output)(message());
        }
    }
}

fn answered(state: &mut State, running: &Running, id: u64, message: &Value) {
    let Some(waiter) = state.waiting.remove(&id) else {
        return;
    };
    let error = message.get("error").map(|error| {
        error["message"]
            .as_str()
            .unwrap_or("Codex refused")
            .to_owned()
    });
    let result = message.get("result").cloned().unwrap_or(Value::Null);
    match waiter {
        Waiter::Init => {
            state.ready = true;
            let _ = running.write_line(&json!({ "method": "initialized" }).to_string());
            for line in std::mem::take(&mut state.backlog) {
                let _ = running.write_line(&line);
            }
        }
        Waiter::Started(orden) => started(state, running, &orden, result, error),
        Waiter::Reply(orden, to) => {
            if let Some(route) = state.routes.get_mut(&orden) {
                if to == "turn" && error.is_none() {
                    route.turn = result["turn"]["id"].as_str().map(str::to_owned);
                }
                (route.output)(Message::Reply {
                    to: to.to_owned(),
                    result,
                    error,
                });
            }
        }
        Waiter::Crate(sent) => {
            let _ = sent.send(error.map_or(Ok(result), Err));
        }
        Waiter::Nobody => {}
    }
}

fn started(
    state: &mut State,
    running: &Running,
    orden: &str,
    result: Value,
    error: Option<String>,
) {
    let thread = result["thread"]["id"].as_str().map(str::to_owned);
    let Some(thread) = thread.filter(|_| error.is_none()) else {
        if let Some(route) = state.routes.remove(orden) {
            (route.output)(Message::End(Ended {
                err: error.unwrap_or_else(|| "Codex did not start the thread".to_owned()),
                ..Ended::default()
            }));
        }
        return;
    };
    state.threads.insert(thread.clone(), orden.to_owned());
    let Some(route) = state.routes.get_mut(orden) else {
        return;
    };
    route.thread = Some(thread);
    let queued = std::mem::take(&mut route.queued);
    (route.output)(Message::Reply {
        to: "thread".to_owned(),
        result,
        error: None,
    });
    for say in queued {
        if let Err(error) = say_now(state, running, orden, say) {
            if let Some(route) = state.routes.get(orden) {
                (route.output)(Message::Reply {
                    to: "said".to_owned(),
                    result: Value::Null,
                    error: Some(error),
                });
            }
        }
    }
}

fn refusal(id: &Value, method: &str) -> String {
    let result = match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            json!({ "decision": "decline" })
        }
        "applyPatchApproval" | "execCommandApproval" => json!({ "decision": "denied" }),
        "mcpServer/elicitation/request" => {
            json!({ "action": "decline", "content": null, "_meta": null })
        }
        "item/tool/requestUserInput" => json!({ "answers": {} }),
        _ => {
            return json!({
                "id": id,
                "error": { "code": -32601, "message": "not answered by Orden" },
            })
            .to_string()
        }
    };
    json!({ "id": id, "result": result }).to_string()
}

fn ending(state: &Mutex<State>, ended: &Ended) {
    let mut state = locked(state);
    for (_, waiter) in state.waiting.drain() {
        if let Waiter::Crate(sent) = waiter {
            let _ = sent.send(Err("Codex ended".to_owned()));
        }
    }
    state.threads.clear();
    for (_, route) in state.routes.drain() {
        (route.output)(Message::End(ended.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_request_of_the_server_s_is_answered_no() {
        let id = json!(7);
        for (method, field, no) in [
            (
                "item/commandExecution/requestApproval",
                "decision",
                "decline",
            ),
            ("item/fileChange/requestApproval", "decision", "decline"),
            ("execCommandApproval", "decision", "denied"),
            ("mcpServer/elicitation/request", "action", "decline"),
        ] {
            let answer: Value = serde_json::from_str(&refusal(&id, method)).expect("JSON");
            assert_eq!(answer["id"], 7);
            assert_eq!(answer["result"][field], no, "{method}");
        }
        for method in [
            "account/chatgptAuthTokens/refresh",
            "item/tool/call",
            "attestation/generate",
        ] {
            let answer: Value = serde_json::from_str(&refusal(&id, method)).expect("JSON");
            assert!(answer["error"]["message"].is_string(), "{method}");
            assert!(answer.get("result").is_none());
        }
    }

    #[test]
    fn a_message_is_text_after_its_pictures() {
        let items = input(
            "look",
            &[Image {
                mime: "image/png".into(),
                data: "iVBO".into(),
            }],
        );
        assert_eq!(items[0]["url"], "data:image/png;base64,iVBO");
        assert_eq!(items[1]["type"], "text");
        assert_eq!(items[1]["text"], "look");
    }
}
