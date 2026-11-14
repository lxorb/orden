use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write as _};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::paths::{config_dir, made, write_privately};

const TAKES: Duration = Duration::from_millis(1500);

const ASKED: &str = "orden://automation";

const MOST_BYTES: usize = 8 * 1024 * 1024;

const PATIENCE: Duration = Duration::from_secs(30);

const SLOWEST: Duration = Duration::from_secs(10);

const SECRET_BYTES: usize = 32;

const MOST_AT_ONCE: usize = 32;

static OPEN: AtomicUsize = AtomicUsize::new(0);

static NEXT: AtomicU64 = AtomicU64::new(1);

static PORT: AtomicU16 = AtomicU16::new(0);

pub fn own_port() -> Option<u16> {
    match PORT.load(Ordering::SeqCst) {
        0 => None,
        port => Some(port),
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Kept {
    port: u16,
    secret: String,
    #[serde(default)]
    eval: bool,
    #[serde(default)]
    pid: u32,
}

#[derive(Default)]
pub struct Waiting(
    Mutex<HashMap<u64, SyncSender<String>>>,
    Mutex<HashSet<String>>,
    Condvar,
    Mutex<HashMap<u64, String>>,
    Mutex<HashMap<String, u64>>,
);

impl Waiting {
    fn listens(&self, label: &str) {
        if let Ok(mut heard) = self.1.lock() {
            heard.insert(label.to_owned());
        }
        self.2.notify_all();
    }

    fn page_started(&self, label: &str) {
        if let Ok(mut pages) = self.4.lock() {
            *pages.entry(label.to_owned()).or_default() += 1;
        }
        self.listens(label);
    }

    fn page_of(&self, label: &str) -> u64 {
        self.4
            .lock()
            .map_or(0, |pages| pages.get(label).copied().unwrap_or_default())
    }

    fn ask_of(&self, id: u64, label: &str) {
        if let Ok(mut asked) = self.3.lock() {
            asked.insert(id, label.to_owned());
        }
    }

    fn claim(&self, id: u64, label: &str) -> bool {
        self.listens(label);
        let Ok(mut asked) = self.3.lock() else {
            return false;
        };
        if asked.get(&id).is_some_and(|one| one == label) {
            asked.remove(&id);
            self.2.notify_all();
            return true;
        }
        false
    }

    fn gave_up(&self, id: u64) -> bool {
        self.3
            .lock()
            .map_or(true, |mut asked| asked.remove(&id).is_none())
    }

    fn taken_within(&self, id: u64, patience: Duration) -> bool {
        let deadline = Instant::now() + patience;
        loop {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                return self.gave_up(id);
            };
            if self.3.lock().map_or(true, |asked| !asked.contains_key(&id)) {
                return true;
            }
            std::thread::sleep(left.min(Duration::from_millis(5)));
        }
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut heard) = self.1.lock() {
            heard.remove(label);
        }
    }

    pub fn hears(&self, label: &str) -> bool {
        self.1.lock().is_ok_and(|heard| heard.contains(label))
    }

    fn listener_within(
        &self,
        patience: Duration,
        windows: impl Fn() -> Vec<String>,
    ) -> Option<String> {
        let deadline = Instant::now() + patience;
        let mut heard = self.1.lock().ok()?;
        loop {
            if let Some(found) = windows().into_iter().find(|one| heard.contains(one)) {
                return Some(found);
            }
            let left = deadline.checked_duration_since(Instant::now())?;
            heard = self
                .2
                .wait_timeout(heard, left.min(Duration::from_millis(250)))
                .ok()?
                .0;
        }
    }
}

pub fn start(app: &AppHandle) {
    let Ok(listener) = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))) else {
        return;
    };
    let Ok(address) = listener.local_addr() else {
        return;
    };

    let app = app.clone();
    let port = address.port();
    PORT.store(port, Ordering::SeqCst);
    std::thread::spawn(move || {
        let Ok(kept) = remember(&app, port) else {
            return;
        };

        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };

            let Some(admitted) = Admitted::into(&OPEN) else {
                turn_away(&mut stream);
                continue;
            };
            let app = app.clone();
            let secret = kept.secret.clone();
            let port = kept.port;
            let eval = kept.eval;
            let _ = std::thread::Builder::new()
                .name("automation".to_owned())
                .spawn(move || {
                    let _admitted = admitted;
                    let _ = answer(&app, stream, &secret, port, eval);
                });
        }
    });
}

struct Admitted(&'static AtomicUsize);

impl Admitted {
    fn into(open: &'static AtomicUsize) -> Option<Self> {
        let admitted = Self(open);
        (open.fetch_add(1, Ordering::SeqCst) < MOST_AT_ONCE).then_some(admitted)
    }
}

impl Drop for Admitted {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn turn_away(stream: &mut TcpStream) {
    if stream.set_nonblocking(true).is_ok() {
        let _ = say(
            stream,
            503,
            &refused("too many callers at once; ask again in a moment"),
        );
    }
}

#[tauri::command]
pub fn automation_listening(window: tauri::Window, waiting: tauri::State<'_, Waiting>) {
    waiting.page_started(window.label());
}

#[tauri::command]
pub fn automation_claim(
    window: tauri::Window,
    waiting: tauri::State<'_, Waiting>,
    id: u64,
) -> bool {
    waiting.claim(id, window.label())
}

#[tauri::command]
pub fn automation_result(waiting: tauri::State<'_, Waiting>, id: u64, result: serde_json::Value) {
    let Ok(mut held) = waiting.0.lock() else {
        return;
    };

    if let Some(send) = held.remove(&id) {
        let _ = send.try_send(result.to_string());
    }
}

fn remember(app: &AppHandle, port: u16) -> Result<Kept, String> {
    let path = endpoint_file(app)?;
    let held: Option<Kept> = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());

    let kept = Kept {
        port,
        secret: match held.as_ref() {
            Some(one) if one.secret.len() == SECRET_BYTES * 2 => one.secret.clone(),
            _ => fresh_secret()?,
        },
        eval: held.is_some_and(|one| one.eval),
        pid: std::process::id(),
    };

    let written = serde_json::to_string_pretty(&kept)
        .map_err(|error| format!("could not write the endpoint file: {error}"))?;
    write_privately(&path, written.as_bytes())?;

    Ok(kept)
}

fn endpoint_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;

    made(&dir)?;
    Ok(dir.join("automation.json"))
}

fn fresh_secret() -> Result<String, String> {
    let mut bytes = [0_u8; SECRET_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("no randomness to make a secret from: {error}"))?;

    Ok(as_hex(&bytes))
}

fn as_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }

    out
}

fn answer(
    app: &AppHandle,
    mut stream: TcpStream,
    secret: &str,
    port: u16,
    eval: bool,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(SLOWEST))?;
    stream.set_write_timeout(Some(SLOWEST))?;

    let Some(request) = read_request(&mut stream, SLOWEST)? else {
        return say(
            &mut stream,
            400,
            &refused("that is not a request this endpoint reads"),
        );
    };

    if request.method != "POST" {
        return say(&mut stream, 405, &refused("this endpoint reads a POST"));
    }
    if request.header("origin").is_some() {
        return say(
            &mut stream,
            403,
            &refused("a page in a browser is not a caller here"),
        );
    }
    if !is_json(request.header("content-type")) {
        return say(&mut stream, 415, &refused("send JSON"));
    }
    if !is_local(request.header("host"), port) {
        return say(
            &mut stream,
            400,
            &refused("that is not this endpoint's address"),
        );
    }
    let caller = if same_secret(request.header("authorization"), secret) {
        crate::agents::Caller::Reader
    } else {
        match bearer(request.header("authorization"))
            .and_then(|token| crate::agents::caller_for(app, token))
        {
            Some(agent) => agent,
            None => {
                return say(
                    &mut stream,
                    401,
                    &refused("that is not this installation's secret or an agent's token"),
                )
            }
        }
    };

    let Ok(asked) = serde_json::from_str::<serde_json::Value>(&request.body) else {
        return say(&mut stream, 400, &refused("that body is not JSON"));
    };
    let (status, body) = dispatch(app, &caller, asked, eval);
    say(&mut stream, status, &body)
}

pub(crate) fn dispatch(
    app: &AppHandle,
    caller: &crate::agents::Caller,
    mut asked: serde_json::Value,
    eval: bool,
) -> (u16, String) {
    let verb = asked
        .get("verb")
        .and_then(|one| one.as_str())
        .map(str::to_owned);
    let Some(verb) = verb else {
        return (400, refused("say which verb"));
    };

    let args = asked.get("args").cloned().unwrap_or_default();
    if let Some(read) = crate::agents::verbs::Verb::read(&verb, args.clone()) {
        let answered = match read {
            Ok(one) => crate::agents::answer(app, caller, one, args),
            Err(why) => {
                crate::agents::verbs::Answer::error(crate::agents::verbs::Code::BadArguments, why)
            }
        };
        let text = serde_json::to_string(&answered).unwrap_or_else(|_| refused("no answer"));
        return (200, text);
    }

    if verb == "eval" && !eval {
        return (
            403,
            refused("eval is off: set \"eval\": true in the endpoint file to turn it on"),
        );
    }

    if let Err(why) = crate::agents::may_ask_the_window(caller, &verb) {
        return (403, refused(&why));
    }
    let agent = matches!(caller, crate::agents::Caller::Agent(_));
    if let (Some(told), Some(body)) = (caller.told(), asked.as_object_mut()) {
        body.insert("agent".to_owned(), told);
    }

    let started = std::time::Instant::now();
    let outcome = ask_the_window(app, &mut asked);
    if agent {
        let answered = match &outcome {
            Ok(text) => crate::agents::verbs::Answer::from_window(text),
            Err(reason) => crate::agents::verbs::Answer::error(
                crate::agents::verbs::Code::Failed,
                reason.clone(),
            ),
        };
        let tab = args.get("tab").and_then(serde_json::Value::as_str);
        crate::agents::logged(app, caller, &verb, tab, args.clone(), &answered, started);
    }
    match outcome {
        Ok(answered) => (200, answered),
        Err(reason) => (503, refused(&reason)),
    }
}

pub(crate) fn ask(
    app: &AppHandle,
    verb: &str,
    args: serde_json::Value,
    patience: Duration,
) -> Result<serde_json::Value, String> {
    let mut asked = serde_json::json!({ "verb": verb, "args": args, "rest": [] });
    let answered = ask_the_window_within(app, &mut asked, patience)?;
    let said: serde_json::Value =
        serde_json::from_str(&answered).map_err(|error| error.to_string())?;
    if said.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(said.get("value").cloned().unwrap_or_default())
    } else {
        Err(said
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("the window said no")
            .to_owned())
    }
}

fn answering_order(app: &AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = crate::launch::document_windows(app)
        .iter()
        .map(|one| one.label().to_owned())
        .filter(|one| !crate::stall::page_gone(one))
        .collect();
    labels.sort_by_key(|one| (one != "main", one.clone()));
    labels
}

fn ask_the_window(app: &AppHandle, asked: &mut serde_json::Value) -> Result<String, String> {
    ask_the_window_within(app, asked, PATIENCE)
}

fn ask_the_window_within(
    app: &AppHandle,
    asked: &mut serde_json::Value,
    patience: Duration,
) -> Result<String, String> {
    if crate::launch::document_windows(app).is_empty() {
        return Err("the app has no window open to ask".to_owned());
    }

    let Some(body) = asked.as_object_mut() else {
        return Err("that body is not an object".to_owned());
    };

    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    body.insert("id".to_owned(), serde_json::Value::from(id));

    let (send, answered) = sync_channel::<String>(1);
    let waiting = app.state::<Waiting>();
    let deadline = Instant::now() + patience;
    let Some(window) = waiting.listener_within(patience, || answering_order(app)) else {
        return Err("the window is not listening yet".to_owned());
    };

    {
        let Ok(mut held) = waiting.0.lock() else {
            return Err("the app cannot take a request just now".to_owned());
        };
        held.insert(id, send);
    }

    let outcome = asked_of_one(app, &waiting, id, window, asked, deadline).and_then(|window| {
        let page = waiting.page_of(&window);
        awaited(&answered, deadline, || {
            waiting.hears(&window) && waiting.page_of(&window) == page
        })
    });

    if let Ok(mut held) = waiting.0.lock() {
        held.remove(&id);
    }

    outcome
}

fn asked_of_one(
    app: &AppHandle,
    waiting: &Waiting,
    id: u64,
    first: String,
    asked: &serde_json::Value,
    deadline: Instant,
) -> Result<String, String> {
    let mut window = first;
    loop {
        waiting.ask_of(id, &window);
        app.emit_to(window.as_str(), ASKED, asked)
            .map_err(|error| format!("the window could not be asked: {error}"))?;
        let left = deadline.saturating_duration_since(Instant::now());
        if waiting.taken_within(id, left.min(TAKES)) {
            return Ok(window);
        }
        waiting.forget(&window);
        let left = deadline.saturating_duration_since(Instant::now());
        window = waiting
            .listener_within(left, || answering_order(app))
            .ok_or_else(|| "the window did not answer".to_owned())?;
    }
}

fn awaited(
    answered: &std::sync::mpsc::Receiver<String>,
    deadline: Instant,
    still_there: impl Fn() -> bool,
) -> Result<String, String> {
    use std::sync::mpsc::RecvTimeoutError;

    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match answered.recv_timeout(left.min(Duration::from_millis(100))) {
            Ok(said) => return Ok(said),
            Err(RecvTimeoutError::Timeout) if left.is_zero() => {
                return Err("the window did not answer".to_owned());
            }
            Err(RecvTimeoutError::Timeout) if still_there() => {}
            Err(_) => {
                return Err(
                    "the window reloaded before it answered: look before asking again".to_owned(),
                );
            }
        }
    }
}

fn say(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        reason(status),
        body.len()
    );

    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        415 => "Unsupported Media Type",
        _ => "Service Unavailable",
    }
}

fn refused(why: &str) -> String {
    serde_json::json!({ "error": why }).to_string()
}

struct Request {
    method: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(held, _)| held == name)
            .map(|(_, value)| value.as_str())
    }
}

fn read_request(stream: &mut impl Read, within: Duration) -> std::io::Result<Option<Request>> {
    let deadline = Instant::now() + within;
    let mut bytes: Vec<u8> = Vec::new();
    let mut chunk = [0_u8; 8192];

    let mut scanned = 0;

    let ends = loop {
        if let Some(at) = find(&bytes[scanned..], b"\r\n\r\n") {
            break scanned + at;
        }
        scanned = bytes.len().saturating_sub(3);

        if bytes.len() > MOST_BYTES || Instant::now() > deadline {
            return Ok(None);
        }

        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk[..read]);
    };

    let Ok(head) = std::str::from_utf8(&bytes[..ends]) else {
        return Ok(None);
    };
    let Some((method, headers)) = parse_head(head) else {
        return Ok(None);
    };

    let length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    if length > MOST_BYTES {
        return Ok(None);
    }

    let mut body = bytes[ends + 4..].to_vec();
    while body.len() < length {
        if Instant::now() > deadline {
            return Ok(None);
        }
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);

    let Ok(body) = String::from_utf8(body) else {
        return Ok(None);
    };

    Ok(Some(Request {
        method,
        headers,
        body,
    }))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|one| one == needle)
}

fn parse_head(head: &str) -> Option<(String, Vec<(String, String)>)> {
    let mut lines = head.split("\r\n");
    let mut words = lines.next()?.split(' ');

    let method = words.next()?.to_owned();
    if method.is_empty() {
        return None;
    }
    words.next()?;
    words.next()?;

    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_owned()))
        .collect();

    Some((method, headers))
}

fn is_json(said: Option<&str>) -> bool {
    said.is_some_and(|one| one.trim().to_lowercase().starts_with("application/json"))
}

fn is_local(said: Option<&str>, port: u16) -> bool {
    let Some(host) = said else { return false };

    ["127.0.0.1", "localhost", "[::1]"]
        .iter()
        .any(|name| host == format!("{name}:{port}"))
}

fn bearer(said: Option<&str>) -> Option<&str> {
    let header = said?;
    header
        .strip_prefix("Bearer ")
        .or_else(|| header.strip_prefix("bearer "))
}

fn same_secret(said: Option<&str>, secret: &str) -> bool {
    let Some(token) = bearer(said) else {
        return false;
    };

    if token.len() != secret.len() {
        return false;
    }

    let mut differences = 0_u8;
    for (one, other) in token.bytes().zip(secret.bytes()) {
        differences |= one ^ other;
    }

    differences == 0
}

#[cfg(test)]
mod tests {
    use super::{
        as_hex, awaited, find, is_json, is_local, parse_head, read_request, reason, refused,
        same_secret, Admitted, Kept, Request, Waiting, MOST_AT_ONCE, MOST_BYTES, SECRET_BYTES,
        SLOWEST,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::sync_channel;
    use std::time::{Duration, Instant};

    #[test]
    fn says_which_process_is_listening() {
        let text = serde_json::to_string(&Kept {
            port: 1234,
            secret: "a".repeat(SECRET_BYTES * 2),
            eval: false,
            pid: std::process::id(),
        })
        .expect("a kept endpoint is serialisable");

        let read: Kept = serde_json::from_str(&text).expect("and readable again");
        assert_eq!(read.pid, std::process::id());
        assert_eq!(read.port, 1234);
    }

    #[test]
    fn reads_a_file_written_without_one() {
        let read: Kept = serde_json::from_str(r#"{"port":9,"secret":"ab"}"#).expect("a Kept");

        assert_eq!(read.pid, 0);
        assert!(!read.eval);
    }

    #[test]
    fn reads_a_request_line_and_folds_the_header_names() {
        let (method, headers) =
            parse_head("POST / HTTP/1.1\r\nContent-Type: application/json\r\nHost: 127.0.0.1:9")
                .expect("a request");

        assert_eq!(method, "POST");
        assert_eq!(
            headers,
            vec![
                ("content-type".to_string(), "application/json".to_string()),
                ("host".to_string(), "127.0.0.1:9".to_string()),
            ]
        );
    }

    #[test]
    fn refuses_anything_that_is_not_a_request_line() {
        assert!(parse_head("hello").is_none());
        assert!(parse_head("POST /").is_none());
        assert!(parse_head(" / HTTP/1.1").is_none());
    }

    #[test]
    fn finds_where_the_head_ends() {
        assert_eq!(find(b"ab\r\n\r\ncd", b"\r\n\r\n"), Some(2));
        assert_eq!(find(b"ab", b"\r\n\r\n"), None);
    }

    fn read(said: &[u8]) -> Option<Request> {
        read_request(&mut std::io::Cursor::new(said.to_vec()), SLOWEST)
            .expect("a cursor cannot fail")
    }

    struct Trickle(Duration);

    impl std::io::Read for Trickle {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            std::thread::sleep(self.0);
            buf[0] = b'a';
            Ok(1)
        }
    }

    #[test]
    fn a_caller_trickling_a_byte_at_a_time_is_let_go_when_its_time_is_up() {
        let started = Instant::now();

        let read = read_request(
            &mut Trickle(Duration::from_millis(2)),
            Duration::from_millis(100),
        )
        .expect("a trickle cannot fail");

        assert!(read.is_none());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn no_more_callers_are_answered_at_once_than_the_endpoint_allows() {
        static OPEN: AtomicUsize = AtomicUsize::new(0);

        let mut held: Vec<Admitted> = (0..MOST_AT_ONCE)
            .map(|_| Admitted::into(&OPEN).expect("room for one more"))
            .collect();
        assert!(Admitted::into(&OPEN).is_none());

        drop(held.pop());
        let again = Admitted::into(&OPEN);
        assert!(again.is_some());
        drop(again);
        assert_eq!(OPEN.load(Ordering::SeqCst), MOST_AT_ONCE - 1);
    }

    #[test]
    fn reads_a_whole_request_off_the_wire() {
        let request = read(b"POST / HTTP/1.1\r\ncontent-type: application/json\r\ncontent-length: 16\r\n\r\n{\"verb\":\"open\"}\n")
            .expect("a request");

        assert_eq!(request.method, "POST");
        assert_eq!(request.header("content-type"), Some("application/json"));
        assert_eq!(request.body, "{\"verb\":\"open\"}\n");
    }

    #[test]
    fn anything_that_is_not_a_request_is_no_request() {
        assert!(read(b"").is_none());
        assert!(read(b"GET /\r\n").is_none());
        assert!(read(b"\x16\x03\x01\x02\x00\x01\x00").is_none());
    }

    #[test]
    fn a_head_that_never_ends_is_refused_without_being_read_twice() {
        let started = std::time::Instant::now();

        assert!(read(&vec![b'a'; MOST_BYTES + 1]).is_none());

        let spent = started.elapsed();
        assert!(spent.as_secs() < 5, "{spent:?} for a head of 8 MB");
    }

    #[test]
    fn a_body_longer_than_a_note_is_not_read_at_all() {
        let said = format!(
            "POST / HTTP/1.1\r\ncontent-length: {}\r\n\r\n",
            MOST_BYTES + 1
        );

        assert!(read(said.as_bytes()).is_none());
    }

    #[test]
    fn a_body_shorter_than_it_said_is_what_arrived() {
        let request =
            read(b"POST / HTTP/1.1\r\ncontent-length: 99\r\n\r\n{\"verb\"").expect("a request");

        assert_eq!(request.body, "{\"verb\"");
    }

    #[test]
    fn a_body_longer_than_it_said_is_cut_where_it_said() {
        let request = read(b"POST / HTTP/1.1\r\ncontent-length: 2\r\n\r\n{}POST /").expect("one");

        assert_eq!(request.body, "{}");
    }

    #[test]
    fn a_body_that_is_not_text_is_no_request() {
        assert!(read(b"POST / HTTP/1.1\r\ncontent-length: 2\r\n\r\n\xff\xfe").is_none());
    }

    #[test]
    fn only_json_is_a_body_it_reads() {
        assert!(is_json(Some("application/json")));
        assert!(is_json(Some("Application/JSON; charset=utf-8")));
        assert!(!is_json(Some("text/plain")));
        assert!(!is_json(Some("application/x-www-form-urlencoded")));
        assert!(!is_json(Some("multipart/form-data")));
        assert!(!is_json(None));
    }

    #[test]
    fn only_this_endpoints_own_address_is_its_address() {
        assert!(is_local(Some("127.0.0.1:1500"), 1500));
        assert!(is_local(Some("localhost:1500"), 1500));
        assert!(!is_local(Some("notes.example.com:1500"), 1500));
        assert!(!is_local(Some("127.0.0.1:1501"), 1500));
        assert!(!is_local(None, 1500));
    }

    #[test]
    fn only_the_secret_itself_gets_in() {
        let secret = as_hex(&[7_u8; SECRET_BYTES]);

        assert!(same_secret(Some(&format!("Bearer {secret}")), &secret));
        assert!(same_secret(Some(&format!("bearer {secret}")), &secret));
        assert!(!same_secret(Some(&secret), &secret));
        assert!(!same_secret(Some("Bearer "), &secret));
        assert!(!same_secret(Some(&format!("Bearer {secret}x")), &secret));
        assert!(!same_secret(None, &secret));

        let wrong = as_hex(&[8_u8; SECRET_BYTES]);
        assert!(!same_secret(Some(&format!("Bearer {wrong}")), &secret));
    }

    #[test]
    fn a_secret_is_two_characters_a_byte() {
        assert_eq!(as_hex(&[0_u8, 15, 16, 255]), "000f10ff");
        assert_eq!(as_hex(&[0_u8; SECRET_BYTES]).len(), SECRET_BYTES * 2);
    }

    #[test]
    fn every_status_it_answers_with_has_a_word() {
        for status in [200_u16, 400, 401, 403, 405, 415, 503] {
            assert!(!reason(status).is_empty());
        }
        assert_eq!(reason(200), "OK");
    }

    #[test]
    fn a_refusal_is_json_with_the_reason_in_it() {
        assert_eq!(refused("no"), r#"{"error":"no"}"#);
        assert_eq!(refused(r#"say "yes""#), r#"{"error":"say \"yes\""}"#);
    }

    #[test]
    fn a_request_before_the_window_listens_waits_for_it() {
        let open = || vec!["main".to_owned()];
        let waiting = std::sync::Arc::new(Waiting::default());
        assert!(waiting
            .listener_within(std::time::Duration::from_millis(10), open)
            .is_none());

        let asking = waiting.clone();
        let asked = std::thread::spawn(move || {
            asking.listener_within(std::time::Duration::from_secs(30), open)
        });
        waiting.listens("main");

        assert_eq!(asked.join().expect("asked").as_deref(), Some("main"));
        assert_eq!(
            waiting
                .listener_within(std::time::Duration::ZERO, open)
                .as_deref(),
            Some("main")
        );
    }

    #[test]
    fn a_request_is_taken_once_by_the_window_it_is_asked_of() {
        let waiting = Waiting::default();
        waiting.ask_of(7, "main");
        assert!(!waiting.claim(7, "orden-2"));
        assert!(waiting.claim(7, "main"));
        assert!(!waiting.claim(7, "main"));

        waiting.ask_of(8, "main");
        assert!(!waiting.gave_up(8), "still asked");
        waiting.claim(8, "main");
        assert!(waiting.gave_up(8), "taken in time");

        waiting.ask_of(9, "main");
        assert!(!waiting.gave_up(9));
        waiting.forget("main");
        assert!(!waiting.claim(9, "main"), "too late");
        assert!(waiting.hears("main"), "but alive");
    }

    #[test]
    fn a_new_page_is_a_new_page() {
        let waiting = Waiting::default();
        waiting.page_started("main");
        let page = waiting.page_of("main");
        assert_eq!(waiting.page_of("main"), page);
        waiting.claim(1, "main");
        assert_eq!(waiting.page_of("main"), page, "a claim is no new page");
        waiting.page_started("main");
        assert_ne!(waiting.page_of("main"), page);
    }

    #[test]
    fn a_window_that_reloads_while_asked_is_not_waited_out() {
        let later = Instant::now() + Duration::from_secs(30);
        let (send, answered) = sync_channel::<String>(1);
        let started = Instant::now();
        assert!(awaited(&answered, later, || false)
            .expect_err("no answer")
            .contains("reloaded"));
        assert!(started.elapsed() < Duration::from_secs(5));

        send.send("said".to_owned()).expect("sent");
        assert_eq!(awaited(&answered, later, || false).as_deref(), Ok("said"));
        drop(send);
    }

    #[test]
    fn a_window_that_does_not_listen_is_passed_over_for_one_that_does() {
        let open = || {
            vec![
                "main".to_owned(),
                "orden-2".to_owned(),
                "orden-3".to_owned(),
            ]
        };
        let waiting = Waiting::default();
        let now = std::time::Duration::ZERO;
        waiting.listens("orden-2");
        assert_eq!(
            waiting.listener_within(now, open).as_deref(),
            Some("orden-2")
        );

        waiting.listens("main");
        assert_eq!(waiting.listener_within(now, open).as_deref(), Some("main"));

        waiting.forget("main");
        assert!(!waiting.hears("main"));
        assert_eq!(
            waiting.listener_within(now, open).as_deref(),
            Some("orden-2")
        );

        assert_eq!(
            waiting
                .listener_within(now, || vec!["main".to_owned()])
                .as_deref(),
            None
        );
    }
}
