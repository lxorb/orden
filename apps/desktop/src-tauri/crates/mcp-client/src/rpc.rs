use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use orden_base::Held as _;
use serde_json::{json, Value};

use crate::client::Heard;

pub(crate) type Events = Box<dyn Fn(Heard) + Send + Sync>;
pub(crate) type Answer = mpsc::Receiver<Result<Value, String>>;
pub(crate) trait Wire: Send + Sync {
    fn send(&self, message: Value) -> Result<(), String>;
    fn end(&self);
}
pub(crate) struct Peer {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    ended: Mutex<Option<String>>,
    quiet: AtomicBool,
    events: Events,
}
impl Peer {
    pub fn new(events: Events) -> Arc<Self> {
        Arc::new(Self {
            next: AtomicU64::new(1),
            waiting: Mutex::new(HashMap::new()),
            ended: Mutex::new(None),
            quiet: AtomicBool::new(false),
            events,
        })
    }
    pub fn ask(&self, method: &str, params: Value) -> Result<(u64, Value, Answer), String> {
        if let Some(why) = self.ended.held().clone() {
            return Err(why);
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (answer, heard) = mpsc::channel();
        self.waiting.held().insert(id, answer);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        Ok((id, message, heard))
    }
    pub fn forget(&self, id: u64) {
        self.waiting.held().remove(&id);
    }
    pub fn answered(&self, id: u64, answer: Result<Value, String>) {
        if let Some(waiting) = self.waiting.held().remove(&id) {
            let _ = waiting.send(answer);
        }
    }
    pub fn is_ended(&self) -> bool {
        self.ended.held().is_some()
    }
    pub fn why(&self) -> String {
        self.ended.held().clone().unwrap_or_else(|| "the server stopped answering".to_owned())
    }
    pub fn heard(&self, message: Value) -> Vec<Value> {
        match message {
            Value::Array(all) => all.into_iter().flat_map(|one| self.heard(one)).collect(),
            Value::Object(_) => self.heard_one(&message).into_iter().collect(),
            _ => Vec::new(),
        }
    }
    fn heard_one(&self, message: &Value) -> Option<Value> {
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            let Some(id) = message.get("id") else {
                if method == "notifications/tools/list_changed"
                    && !self.quiet.load(Ordering::SeqCst)
                {
                    (self.events)(Heard::ToolsChanged);
                }
                return None;
            };
            return Some(match method {
                "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
                "roots/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "roots": [] } }),
                _ => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Orden does not offer {method}") }
                }),
            });
        }
        let id = message.get("id").and_then(Value::as_u64)?;
        let answer = match (message.get("result"), message.get("error")) {
            (Some(result), _) => Ok(result.clone()),
            (None, Some(error)) => Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("the server answered with an error")
                .to_owned()),
            (None, None) => return None,
        };
        self.answered(id, answer);
        None
    }
    pub fn end(&self, why: &str) {
        {
            let mut ended = self.ended.held();
            if ended.is_some() {
                return;
            }
            *ended = Some(why.to_owned());
        }
        let waiting: Vec<_> = self.waiting.held().drain().collect();
        for (_, one) in waiting {
            let _ = one.send(Err(why.to_owned()));
        }
        if !self.quiet.load(Ordering::SeqCst) {
            (self.events)(Heard::Ended(why.to_owned()));
        }
    }
    pub fn close(&self) {
        self.quiet.store(true, Ordering::SeqCst);
        self.end("the server was stopped");
    }
}
