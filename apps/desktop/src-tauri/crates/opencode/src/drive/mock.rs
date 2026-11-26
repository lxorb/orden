use orden_base::Held as _;
use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

pub const TOKEN: &str = "drive-mcp-token";
pub const TOOLS: [&str; 4] = ["add_task", "read_note", "files", "run_agent"];
pub struct Asked {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}
impl Asked {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(one, _)| one.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}
fn read(stream: &TcpStream) -> Option<Asked> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut first = String::new();
    reader.read_line(&mut first).ok()?;
    let mut words = first.split_whitespace();
    let (method, path) = (words.next()?.to_owned(), words.next()?.to_owned());
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.trim_end().split_once(':') {
            headers.push((name.trim().to_owned(), value.trim().to_owned()));
        }
    }
    let mut asked = Asked { method, path, headers, body: Value::Null };
    let size = asked.header("content-length").and_then(|one| one.parse().ok()).unwrap_or(0);
    let mut body = vec![0; size];
    reader.read_exact(&mut body).ok()?;
    asked.body = serde_json::from_slice(&body).unwrap_or(Value::Null);
    Some(asked)
}
fn serve(answer: impl Fn(&Asked, &mut TcpStream) + Send + Sync + 'static) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let answer = Arc::new(answer);
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let answer = answer.clone();
            std::thread::spawn(move || {
                if let Some(asked) = read(&stream) {
                    answer(&asked, &mut stream);
                }
                let _ = stream.flush();
                let _ = stream.shutdown(Shutdown::Both);
            });
        }
    });
    port
}
fn reply(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}
pub struct Model {
    pub port: u16,
    pub asked: Arc<Mutex<Vec<Value>>>,
}
enum Said {
    Words(String),
    Tool(String, Value),
}
fn texts(message: &Value) -> String {
    match &message["content"] {
        Value::String(text) => text.clone(),
        Value::Array(parts) => {
            parts.iter().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("\n")
        }
        _ => String::new(),
    }
}
fn said_to(body: &Value) -> Said {
    let messages = body["messages"].as_array().cloned().unwrap_or_default();
    if messages.last().is_some_and(|last| last["role"] == "tool") {
        return Said::Words("Done.".to_owned());
    }
    let tools: Vec<&str> = body["tools"]
        .as_array()
        .map(|all| all.iter().filter_map(|one| one["function"]["name"].as_str()).collect())
        .unwrap_or_default();
    let asked =
        messages.iter().rev().find(|one| one["role"] == "user").map(texts).unwrap_or_default();
    for line in asked.lines() {
        let line = line.trim();
        let call = if let Some(command) = line.strip_prefix("bash: ") {
            Some(("bash", json!({ "command": command, "description": "Runs the asked command" })))
        } else if let Some(path) = line.strip_prefix("write: ") {
            Some(("write", json!({ "filePath": path, "content": "written\n" })))
        } else {
            line.strip_prefix("tool: ").map(|name| (name, json!({ "text": "Milk" })))
        };
        if let Some((name, input)) = call.filter(|(name, _)| tools.contains(name)) {
            return Said::Tool(name.to_owned(), input);
        }
    }
    Said::Words("All is well here.".to_owned())
}
fn streamed(stream: &mut TcpStream, said: Said) {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    let chunk = |delta: Value, finish: Value| {
        json!({ "id": "chatcmpl-drive", "object": "chat.completion.chunk", "created": 0, "model": "m",
            "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }] })
    };
    let mut chunks = vec![chunk(json!({ "role": "assistant", "content": "" }), Value::Null)];
    let finish = match said {
        Said::Words(words) => {
            let (head, tail) = words.split_at(words.len() / 2);
            chunks.push(chunk(json!({ "content": head }), Value::Null));
            chunks.push(chunk(json!({ "content": tail }), Value::Null));
            "stop"
        }
        Said::Tool(name, input) => {
            let id = format!("call_{}", CALLS.fetch_add(1, Ordering::Relaxed));
            chunks.push(chunk(
                json!({ "tool_calls": [{ "index": 0, "id": id, "type": "function",
                    "function": { "name": name, "arguments": input.to_string() } }] }),
                Value::Null,
            ));
            "tool_calls"
        }
    };
    let mut last = chunk(json!({}), json!(finish));
    last["usage"] = json!({ "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15 });
    chunks.push(last);
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
    );
    for one in chunks {
        let _ = write!(stream, "data: {one}\n\n");
        let _ = stream.flush();
    }
    let _ = write!(stream, "data: [DONE]\n\n");
}
pub fn model() -> Model {
    let asked = Arc::new(Mutex::new(Vec::new()));
    let kept = asked.clone();
    let port = serve(move |one, stream| {
        if one.path.ends_with("/chat/completions") {
            kept.held().push(one.body.clone());
            streamed(stream, said_to(&one.body));
        } else if one.path.ends_with("/models") {
            reply(stream, "200 OK", r#"{"object":"list","data":[{"id":"m","object":"model"}]}"#);
        } else {
            reply(stream, "404 Not Found", "{}");
        }
    });
    Model { port, asked }
}
type Heard = Arc<Mutex<Vec<(Option<String>, String)>>>;
pub struct Mcp {
    pub port: u16,
    pub heard: Heard,
}
fn answered(body: &Value) -> Option<Value> {
    let id = body.get("id")?.clone();
    let result = match body["method"].as_str().unwrap_or_default() {
        "initialize" => json!({
            "protocolVersion": body["params"]["protocolVersion"].as_str().unwrap_or("2025-03-26"),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "orden-drive", "version": "1.0.0" },
        }),
        "tools/list" => json!({ "tools": TOOLS.map(|name| json!({
            "name": name,
            "description": format!("Orden's {name}"),
            "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] },
        })) }),
        "tools/call" => json!({ "content": [{ "type": "text", "text": "Added Milk" }] }),
        "ping" => json!({}),
        _ => {
            return Some(json!({ "jsonrpc": "2.0", "id": id,
                "error": { "code": -32601, "message": "no such method" } }))
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}
pub fn mcp() -> Mcp {
    let heard = Arc::new(Mutex::new(Vec::new()));
    let kept = heard.clone();
    let port = serve(move |one, stream| {
        if one.method != "POST" || one.path != "/mcp" {
            reply(stream, "405 Method Not Allowed", "{}");
            return;
        }
        let mut method = one.body["method"].as_str().unwrap_or_default().to_owned();
        if let Some(tool) = one.body["params"]["name"].as_str().filter(|_| method == "tools/call") {
            method = format!("{method}:{tool}");
        }
        kept.held().push((one.header("authorization").map(str::to_owned), method));
        match answered(&one.body) {
            Some(answer) => reply(stream, "200 OK", &answer.to_string()),
            None => {
                let _ = write!(
                    stream,
                    "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
            }
        }
    });
    Mcp { port, heard }
}
