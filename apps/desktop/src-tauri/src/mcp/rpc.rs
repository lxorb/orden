use std::io::{BufRead, Write};
use std::sync::Mutex;

use serde_json::{json, Value};

pub const NOT_JSON: i64 = -32700;
pub const NOT_A_REQUEST: i64 = -32600;
pub const NO_SUCH_METHOD: i64 = -32601;
pub const BAD_PARAMS: i64 = -32602;

#[derive(Debug, PartialEq)]
pub enum Message {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    Answer,
}

#[derive(Debug, PartialEq)]
pub struct Unreadable {
    pub id: Value,
    pub code: i64,
    pub message: &'static str,
}

pub fn read(line: &str) -> Result<Message, Unreadable> {
    let refused = |id: Value, code, message| Unreadable { id, code, message };
    let value: Value =
        serde_json::from_str(line).map_err(|_| refused(Value::Null, NOT_JSON, "not JSON"))?;
    if value.is_array() {
        return Err(refused(
            Value::Null,
            NOT_A_REQUEST,
            "batches are not answered",
        ));
    }
    let Some(fields) = value.as_object() else {
        return Err(refused(Value::Null, NOT_A_REQUEST, "not a request"));
    };
    let id = fields.get("id").cloned();
    let params = fields
        .get("params")
        .filter(|one| one.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    match (fields.get("method").and_then(Value::as_str), id) {
        (Some(method), Some(id)) if id.is_string() || id.is_number() => Ok(Message::Request {
            id,
            method: method.to_owned(),
            params,
        }),
        (Some(_), Some(id)) => Err(refused(id, NOT_A_REQUEST, "an id is a string or a number")),
        (Some(method), None) => Ok(Message::Notification {
            method: method.to_owned(),
            params,
        }),
        (None, Some(_)) if fields.contains_key("result") || fields.contains_key("error") => {
            Ok(Message::Answer)
        }
        (None, id) => Err(refused(
            id.unwrap_or(Value::Null),
            NOT_A_REQUEST,
            "say which method",
        )),
    }
}

pub fn next_line(input: &mut impl BufRead) -> Option<String> {
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match input.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&bytes);
        let line = line.trim_end_matches(['\n', '\r']);
        if !line.trim().is_empty() {
            return Some(line.to_owned());
        }
    }
}

pub fn answer(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn failure(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

pub fn notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

pub struct Out<W: Write + Send>(Mutex<W>);

impl<W: Write + Send> Out<W> {
    pub fn new(to: W) -> Self {
        Out(Mutex::new(to))
    }

    pub fn send(&self, message: &Value) {
        let mut line = message.to_string();
        line.push('\n');
        let mut to = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = to.write_all(line.as_bytes()).and_then(|()| to.flush());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_a_notification_and_an_answer_are_told_apart() {
        assert_eq!(
            read(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
            Ok(Message::Request {
                id: json!(1),
                method: "tools/list".into(),
                params: json!({}),
            })
        );
        assert_eq!(
            read(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
            Ok(Message::Notification {
                method: "notifications/initialized".into(),
                params: json!({}),
            })
        );
        assert_eq!(
            read(r#"{"jsonrpc":"2.0","id":"a","result":{}}"#),
            Ok(Message::Answer)
        );
    }

    #[test]
    fn what_is_not_a_request_is_said_with_the_id_it_had() {
        assert_eq!(read("hello").map_err(|one| one.code), Err(NOT_JSON));
        assert_eq!(read("[]").map_err(|one| one.code), Err(NOT_A_REQUEST));
        let refused = read(r#"{"id":7}"#).expect_err("no method");
        assert_eq!((refused.id, refused.code), (json!(7), NOT_A_REQUEST));
        let refused = read(r#"{"id":{},"method":"ping"}"#).expect_err("an object id");
        assert_eq!(refused.code, NOT_A_REQUEST);
    }

    #[test]
    fn params_that_are_not_an_object_are_read_as_none() {
        let Ok(Message::Request { params, .. }) = read(r#"{"id":1,"method":"ping","params":3}"#)
        else {
            panic!("a request");
        };
        assert_eq!(params, json!({}));
    }

    #[test]
    fn lines_are_read_to_the_end_of_input_past_blank_ones() {
        let mut input = std::io::Cursor::new(b"\r\n{\"a\":1}\r\n\n{\"b\":2}".to_vec());
        assert_eq!(next_line(&mut input).as_deref(), Some("{\"a\":1}"));
        assert_eq!(next_line(&mut input).as_deref(), Some("{\"b\":2}"));
        assert_eq!(next_line(&mut input), None);
    }

    #[test]
    fn a_message_is_exactly_one_line() {
        let out = Out::new(Vec::new());
        out.send(&answer(&json!(1), json!({ "text": "two\nlines" })));
        out.send(&notification("notifications/tools/list_changed", json!({})));
        let written = String::from_utf8(out.0.into_inner().expect("lock")).expect("utf-8");
        let lines: Vec<&str> = written.lines().collect();
        assert_eq!(lines.len(), 2);
        for line in lines {
            serde_json::from_str::<Value>(line).expect("each line is a message");
        }
    }
}
