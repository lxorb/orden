use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::host::{self, Line};
use crate::http;

const WITHIN: Duration = Duration::from_secs(300);
pub const ROUTES: [(&str, &str); 28] = [
    ("GET", "/global/health"),
    ("GET", "/agent"),
    ("GET", "/config"),
    ("GET", "/provider"),
    ("GET", "/provider/auth"),
    ("POST", "/provider/{id}/oauth/authorize"),
    ("POST", "/provider/{id}/oauth/callback"),
    ("GET", "/mcp"),
    ("POST", "/mcp/{name}/connect"),
    ("GET", "/session"),
    ("POST", "/session"),
    ("GET", "/session/{id}"),
    ("PATCH", "/session/{id}"),
    ("DELETE", "/session/{id}"),
    ("GET", "/session/{id}/message"),
    ("POST", "/session/{id}/prompt_async"),
    ("POST", "/session/{id}/abort"),
    ("GET", "/session/status"),
    ("GET", "/session/{id}/diff"),
    ("GET", "/session/{id}/todo"),
    ("POST", "/session/{id}/revert"),
    ("POST", "/session/{id}/unrevert"),
    ("POST", "/session/{id}/summarize"),
    ("GET", "/permission"),
    ("POST", "/permission/{id}/reply"),
    ("GET", "/question"),
    ("POST", "/question/{id}/reply"),
    ("POST", "/question/{id}/reject"),
];
#[derive(Debug, PartialEq, Serialize)]
pub struct Answer {
    pub status: u16,
    pub body: Value,
}
fn safe(word: &str) -> bool {
    (1..=128).contains(&word.len())
        && word.bytes().all(|one| one.is_ascii_alphanumeric() || one == b'_' || one == b'-')
}
pub fn allowed(method: &str, path: &str) -> bool {
    let Some(asked) = path.strip_prefix('/') else {
        return false;
    };
    let asked: Vec<&str> = asked.split('/').collect();
    ROUTES.iter().any(|(open, route)| {
        let route: Vec<&str> = route[1..].split('/').collect();
        *open == method
            && route.len() == asked.len()
            && route.iter().zip(&asked).all(|(part, word)| {
                if part.starts_with('{') {
                    safe(word)
                } else {
                    part == word
                }
            })
    })
}
pub(crate) fn hidden(text: &str, password: &str) -> String {
    if password.is_empty() {
        text.to_owned()
    } else {
        text.replace(password, "")
    }
}
fn body_of(text: &str) -> Value {
    if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_owned()))
    }
}
pub(crate) fn call_on(
    line: &Line,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Answer, String> {
    if !allowed(method, path) {
        return Err(format!("{method} {path} is not open to the app"));
    }
    if body.is_some() && matches!(method, "GET" | "DELETE") {
        return Err(format!("{method} {path} takes no body"));
    }
    let body = body.map(Value::to_string);
    let said =
        http::request(line.port, (method, path), body.as_deref(), Some(&line.password), WITHIN)
            .map_err(|why| format!("OpenCode did not answer: {why}"))?;
    Ok(Answer { status: said.status, body: body_of(&hidden(&said.body, &line.password)) })
}
pub fn call(method: &str, path: &str, body: Option<&Value>) -> Result<Answer, String> {
    if !allowed(method, path) {
        return Err(format!("{method} {path} is not open to the app"));
    }
    let line = host::line().ok_or("OpenCode is not running")?;
    call_on(&line, method, path, body)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead as _, BufReader, Read as _, Write as _};
    use std::net::TcpListener;

    #[test]
    fn every_listed_route_is_open_and_nothing_else_is() {
        let open = [
            ("GET", "/global/health"),
            ("GET", "/config"),
            ("GET", "/provider/auth"),
            ("POST", "/provider/github-copilot/oauth/authorize"),
            ("POST", "/provider/openai/oauth/callback"),
            ("POST", "/mcp/orden/connect"),
            ("GET", "/session"),
            ("POST", "/session"),
            ("GET", "/session/ses_4Fz9a"),
            ("PATCH", "/session/ses_4Fz9a"),
            ("DELETE", "/session/ses_4Fz9a"),
            ("GET", "/session/ses_1/message"),
            ("POST", "/session/ses_1/prompt_async"),
            ("POST", "/session/ses_1/abort"),
            ("GET", "/session/status"),
            ("GET", "/session/ses_1/diff"),
            ("GET", "/session/ses_1/todo"),
            ("POST", "/session/ses_1/revert"),
            ("POST", "/session/ses_1/unrevert"),
            ("POST", "/session/ses_1/summarize"),
            ("GET", "/permission"),
            ("POST", "/permission/per_1/reply"),
            ("GET", "/question"),
            ("POST", "/question/que_1/reply"),
            ("POST", "/question/que_1/reject"),
        ];
        for (method, path) in open {
            assert!(allowed(method, path), "{method} {path}");
        }
        let long = format!("/session/{}", "a".repeat(129));
        let refused = [
            ("PATCH", "/config"),
            ("POST", "/config"),
            ("POST", "/global/upgrade"),
            ("GET", "/global/upgrade"),
            ("POST", "/global/dispose"),
            ("GET", "/event"),
            ("GET", "/global/event"),
            ("GET", "/doc"),
            ("GET", "/api/session"),
            ("POST", "/api/session/ses_1/prompt"),
            ("GET", "/file/content"),
            ("POST", "/session/ses_1/shell"),
            ("POST", "/session/ses_1/command"),
            ("POST", "/session/ses_1/message"),
            ("PUT", "/auth/openai"),
            ("get", "/session"),
            ("Get", "/session"),
            ("GET ", "/session"),
            ("GET", "/Session"),
            ("GET", "/SESSION/ses_1"),
            ("GET", "/session/"),
            ("GET", "/session//message"),
            ("GET", "//session"),
            ("GET", "session"),
            ("GET", ""),
            ("GET", "/"),
            ("GET", "/session?directory=/etc"),
            ("GET", "/session/ses_1/message?limit=1"),
            ("GET", "/session#x"),
            ("GET", "/session/.."),
            ("GET", "/session/../config"),
            ("PATCH", "/session/../config"),
            ("GET", "/session/./ses_1"),
            ("GET", "/session/ses%2F..%2Fconfig"),
            ("GET", "/session/ses%2f1"),
            ("GET", "/session%2Fstatus"),
            ("POST", "/mcp/a%2Fb/connect"),
            ("POST", "/mcp/a.b/connect"),
            ("GET", "/session/ses 1"),
            ("GET", "/session/ses_1\r\nX-Evil: 1"),
            ("GET", "/session/ses_1\n"),
            ("GET", "/session/ses\u{e9}"),
            ("GET", "http://127.0.0.1:4096/session"),
            ("GET", "http://evil.example/session"),
            ("GET", "/session/status/extra"),
            ("GET", "/global/health/"),
            ("GET", long.as_str()),
            ("DELETE", "/session"),
            ("GET", "/session/ses_1/prompt_async"),
            ("POST", "/permission/per_1/reply/x"),
            ("POST", "/question/que_1/approve"),
        ];
        for (method, path) in refused {
            assert!(!allowed(method, path), "{method} {path:?}");
        }
        assert!(call("PATCH", "/config", None).is_err_and(|why| why.contains("not open")));
    }
    fn serve(answer: &'static [u8]) -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let heard = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut asked = Vec::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if let Some(size) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = size.trim().parse().unwrap_or(0);
                }
                asked.extend_from_slice(line.as_bytes());
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).expect("body");
            asked.extend_from_slice(&body);
            let mut stream = stream;
            let _ = stream.write_all(answer);
            asked
        });
        (port, heard)
    }
    #[test]
    fn an_open_call_carries_its_body_and_its_answer_never_carries_the_password() {
        let (port, heard) = serve(
            b"HTTP/1.1 200 OK\r\ncontent-length: 40\r\n\r\n{\"id\":\"ses_1\",\"echo\":\"secret-pw-123456\"}",
        );
        let line = Line { port, password: "secret-pw-123456".to_owned() };
        let body = serde_json::json!({ "title": "Notes" });
        let answer = call_on(&line, "PATCH", "/session/ses_1", Some(&body)).expect("answered");
        assert_eq!(answer.status, 200);
        assert_eq!(answer.body["id"], "ses_1");
        assert!(!serde_json::to_string(&answer).expect("json").contains("secret-pw"));
        let asked = String::from_utf8(heard.join().expect("heard")).expect("utf8");
        assert!(asked.starts_with("PATCH /session/ses_1 HTTP/1.1\r\n"), "{asked}");
        assert!(asked.contains("Content-Type: application/json\r\n"), "{asked}");
        assert!(asked.ends_with("\r\n\r\n{\"title\":\"Notes\"}"), "{asked}");
        assert!(asked.contains("Authorization: Basic "), "{asked}");
        let (port, heard) = serve(b"HTTP/1.1 204 No Content\r\ncontent-length: 0\r\n\r\n");
        let line = Line { port, password: "pw".to_owned() };
        let answer = call_on(&line, "POST", "/session/ses_1/abort", None).expect("answered");
        assert_eq!(answer, Answer { status: 204, body: Value::Null });
        let asked = String::from_utf8(heard.join().expect("heard")).expect("utf8");
        assert!(asked.contains("Content-Length: 0\r\n"), "{asked}");
        assert!(call_on(&line, "GET", "/session", Some(&body)).is_err());
        assert!(call_on(&line, "GET", "/session/../config", None).is_err());
        assert_eq!(body_of("plain words"), Value::String("plain words".to_owned()));
    }
    #[test]
    fn the_real_server_answers_through_the_proxy_and_its_events_never_carry_the_password() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{mpsc, Arc};
        let Some(binary) = std::env::var_os("ORDEN_OPENCODE_BIN") else {
            return;
        };
        let dir = tempfile::tempdir().expect("a folder");
        let dirs = crate::env::Dirs { root: dir.path().join("opencode") };
        let launch = crate::env::Launch {
            binary: binary.into(),
            dirs: dirs.clone(),
            config: serde_json::json!({ "enabled_providers": [] }),
            auth: None,
        };
        let running = host::Running::start(launch).expect("ready");
        let line = running.line.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let (told, events) = mpsc::channel::<Value>();
        let followed = {
            let (stop, line) = (stop.clone(), line.clone());
            std::thread::spawn(move || {
                crate::feed::follow(&stop, || Some(line.clone()), |event| told.send(event).is_ok());
            })
        };
        let first = events.recv_timeout(Duration::from_secs(20)).expect("connected");
        assert_eq!(first["type"], "server.connected");
        let mut answers = Vec::new();
        for (method, path) in [
            ("GET", "/global/health"),
            ("GET", "/agent"),
            ("GET", "/config"),
            ("GET", "/provider"),
            ("GET", "/provider/auth"),
            ("GET", "/mcp"),
            ("GET", "/session"),
            ("GET", "/session/status"),
            ("GET", "/permission"),
            ("GET", "/question"),
        ] {
            let answer = call_on(&line, method, path, None).expect("answered");
            assert_eq!(answer.status, 200, "{method} {path}: {:?}", answer.body);
            answers.push(answer);
        }
        assert!(answers[1]
            .body
            .as_array()
            .is_some_and(|all| all.iter().any(|one| one["name"] == "build")));
        let made = call_on(&line, "POST", "/session", Some(&serde_json::json!({}))).expect("made");
        assert_eq!(made.status, 200, "{:?}", made.body);
        let id = made.body["id"].as_str().expect("an id").to_owned();
        let renamed = serde_json::json!({ "title": "Proxy" });
        for (method, path, body) in [
            ("GET", format!("/session/{id}"), None),
            ("PATCH", format!("/session/{id}"), Some(&renamed)),
            ("GET", format!("/session/{id}/message"), None),
            ("GET", format!("/session/{id}/diff"), None),
            ("GET", format!("/session/{id}/todo"), None),
        ] {
            let answer = call_on(&line, method, &path, body).expect("answered");
            assert_eq!(answer.status, 200, "{method} {path}: {:?}", answer.body);
            answers.push(answer);
        }
        assert_eq!(answers.last().map(|one| one.status), Some(200));
        let mut heard = vec![first];
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while !heard.iter().any(|one| one["type"] == "session.updated") {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            heard.push(events.recv_timeout(left).expect("session.updated"));
        }
        let gone = call_on(&line, "DELETE", &format!("/session/{id}"), None).expect("deleted");
        assert_eq!(gone.status, 200, "{:?}", gone.body);
        assert!(call_on(&line, "PATCH", "/config", Some(&serde_json::json!({}))).is_err());
        assert!(call_on(&line, "POST", "/global/upgrade", None).is_err());
        stop.store(true, Ordering::Relaxed);
        followed.join().expect("followed");
        for one in &answers {
            assert!(!serde_json::to_string(one).expect("json").contains(&line.password));
        }
        for one in &heard {
            assert!(!one.to_string().contains(&line.password));
        }
        running.stop();
        let _ = std::fs::remove_dir_all(dirs.own_config());
    }
}
