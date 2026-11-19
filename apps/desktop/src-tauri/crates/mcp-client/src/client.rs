use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::rpc::{Answer, Peer, Wire};
use crate::types::{Secrets, Transport};

pub const PROTOCOL: &str = "2025-06-18";
pub(crate) const STARTING: Duration = Duration::from_secs(60);
const ENDING: Duration = Duration::from_secs(3);
const LISTING: Duration = Duration::from_secs(30);
const MOST_PAGES: usize = 100;
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Heard {
    ToolsChanged,
    Ended(String),
}
pub struct Client {
    peer: Arc<Peer>,
    wire: Box<dyn Wire>,
    protocol: String,
}
pub(crate) fn hello() -> Value {
    json!({
        "protocolVersion": PROTOCOL,
        "capabilities": {},
        "clientInfo": { "name": "Orden", "version": env!("CARGO_PKG_VERSION") }
    })
}
pub(crate) fn waited(
    peer: &Peer,
    id: u64,
    heard: &Answer,
    method: &str,
    patience: Duration,
) -> Result<Value, String> {
    match heard.recv_timeout(patience) {
        Ok(answer) => answer,
        Err(RecvTimeoutError::Timeout) => {
            peer.forget(id);
            Err(late(method, patience))
        }
        Err(RecvTimeoutError::Disconnected) => Err(peer.why()),
    }
}
fn late(method: &str, patience: Duration) -> String {
    format!("{method} had no answer within {} s", patience.as_secs())
}
fn asked(
    peer: &Peer,
    wire: &dyn Wire,
    method: &str,
    params: Value,
    patience: Duration,
) -> Result<Value, String> {
    let (id, message, heard) = peer.ask(method, params)?;
    if let Err(why) = wire.send(message) {
        let ended = heard.recv_timeout(ENDING);
        peer.forget(id);
        return Err(ended.ok().and_then(Result::err).unwrap_or(why));
    }
    match heard.recv_timeout(patience) {
        Ok(answer) => answer,
        Err(RecvTimeoutError::Timeout) => {
            peer.forget(id);
            let _ = wire.send(json!({
                "jsonrpc": "2.0",
                "method": "notifications/cancelled",
                "params": { "requestId": id, "reason": "timed out" }
            }));
            Err(late(method, patience))
        }
        Err(RecvTimeoutError::Disconnected) => Err(peer.why()),
    }
}
impl Client {
    pub fn connect(
        transport: &Transport,
        secrets: &Secrets,
        events: impl Fn(Heard) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let peer = Peer::new(Box::new(events));
        let (wire, answer) = match transport {
            Transport::Stdio { command, args, cwd, .. } => {
                let wire = crate::stdio::spawn(command, args, cwd.as_deref(), &secrets.env, &peer)?;
                let answer = asked(&peer, &*wire, "initialize", hello(), STARTING);
                (wire, answer)
            }
            Transport::Http { url, .. } => match crate::http::open(url, &secrets.headers, &peer) {
                Ok((wire, answer)) => (wire, Ok(answer)),
                Err(why) => {
                    peer.close();
                    return Err(why);
                }
            },
        };
        let mut client = Self { peer, wire, protocol: String::new() };
        let answer = answer?;
        answer
            .get("protocolVersion")
            .and_then(Value::as_str)
            .ok_or("the server did not say which MCP version it speaks")?
            .clone_into(&mut client.protocol);
        client.wire.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
        Ok(client)
    }
    pub fn protocol(&self) -> &str {
        &self.protocol
    }
    pub fn request(
        &self,
        method: &str,
        params: Value,
        patience: Duration,
    ) -> Result<Value, String> {
        asked(&self.peer, &*self.wire, method, params, patience)
    }
    pub fn tools(&self) -> Result<Vec<Value>, String> {
        let mut all = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MOST_PAGES {
            let params =
                cursor.take().map_or_else(|| json!({}), |cursor| json!({ "cursor": cursor }));
            let page = self.request("tools/list", params, LISTING)?;
            all.extend(page.get("tools").and_then(Value::as_array).cloned().unwrap_or_default());
            match page.get("nextCursor").and_then(Value::as_str) {
                Some(next) if !next.is_empty() => cursor = Some(next.to_owned()),
                _ => break,
            }
        }
        Ok(all)
    }
    pub fn call(&self, tool: &str, args: Value, patience: Duration) -> Result<Value, String> {
        let args = if args.is_null() { json!({}) } else { args };
        self.request("tools/call", json!({ "name": tool, "arguments": args }), patience)
    }
    pub fn end(&self) {
        self.peer.close();
        self.wire.end();
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.end();
    }
}
