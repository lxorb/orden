use std::collections::HashMap;
use std::io::{BufRead as _, BufReader, ErrorKind, Read as _, Write as _};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;
use tauri::{Manager as _, Webview};

const PATIENCE: Duration = Duration::from_secs(600);
const ASKING: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(100);
const TOKEN_HOSTS: [&str; 2] = ["oauth2.googleapis.com", "login.microsoftonline.com"];
const FORM: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');
const PAGE: &str = "<!doctype html><meta charset=utf-8><title>Orden</title>\
    <p style=\"font:16px system-ui;margin:3em;text-align:center\">\
    You can close this page and go back to Orden.</p>";

type Query = HashMap<String, String>;
type Heard = Result<Query, String>;

struct Waiting {
    owner: String,
    stop: Arc<AtomicBool>,
    heard: Option<Receiver<Heard>>,
}

#[derive(Default)]
pub struct Loopbacks(Mutex<HashMap<String, Waiting>>);

impl Loopbacks {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Waiting>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[derive(Serialize)]
pub struct Opened {
    id: String,
    port: u16,
}

#[derive(Serialize)]
pub struct Posted {
    status: u16,
    body: String,
}

fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("only Orden's own window may sign in".to_owned())
    }
}

fn accepted(peer: &SocketAddr) -> bool {
    peer.ip().is_loopback()
}

fn decoded(text: &str) -> String {
    percent_decode_str(&text.replace('+', " "))
        .decode_utf8_lossy()
        .into_owned()
}

fn asked(line: &str) -> Option<Query> {
    let mut words = line.split_whitespace();
    if words.next() != Some("GET") {
        return None;
    }
    let target = words.next()?;
    let (_, query) = target.split_once('?')?;
    let query = query.split('#').next().unwrap_or_default();
    let found: Query = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decoded(key), decoded(value))
        })
        .collect();
    (!found.is_empty()).then_some(found)
}

fn answered(mut stream: TcpStream) -> Option<Query> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(ASKING));
    let _ = stream.set_write_timeout(Some(ASKING));
    let mut line = String::new();
    let _ = BufReader::new((&stream).take(8 * 1024)).read_line(&mut line);
    let found = asked(&line);
    let (status, page) = if found.is_some() {
        ("200 OK", PAGE)
    } else {
        ("404 Not Found", "")
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\ncache-control: no-store\r\nconnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.flush();
    found
}

fn listen(listeners: &[TcpListener], stop: &AtomicBool, until: Instant) -> Heard {
    for listener in listeners {
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
    }
    let (tell, told) = mpsc::channel();
    while Instant::now() < until {
        if stop.load(Ordering::SeqCst) {
            return Err("the sign-in was stopped".to_owned());
        }
        if let Ok(found) = told.try_recv() {
            return Ok(found);
        }
        let mut idle = true;
        for listener in listeners {
            match listener.accept() {
                Ok((stream, peer)) => {
                    idle = false;
                    if !accepted(&peer) {
                        continue;
                    }
                    let tell = tell.clone();
                    std::thread::spawn(move || {
                        if let Some(found) = answered(stream) {
                            let _ = tell.send(found);
                        }
                    });
                }
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        if idle {
            std::thread::sleep(POLL);
        }
    }
    Err("the sign-in took too long".to_owned())
}

fn bound() -> Result<(Vec<TcpListener>, u16), String> {
    let first = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| error.to_string())?;
    let port = first
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let mut listeners = vec![first];
    if let Ok(second) = TcpListener::bind(SocketAddr::from((Ipv6Addr::LOCALHOST, port))) {
        listeners.push(second);
    }
    Ok((listeners, port))
}

#[tauri::command(async)]
pub fn oauth_loopback_open(webview: Webview) -> Result<Opened, String> {
    let owner = owner(&webview)?;
    let mut random = [0_u8; 12];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let id = random.iter().fold(String::new(), |mut out, byte| {
        let _ = std::fmt::Write::write_fmt(&mut out, format_args!("{byte:02x}"));
        out
    });
    let (listeners, port) = bound()?;
    let stop = Arc::new(AtomicBool::new(false));
    let (tell, heard) = mpsc::channel();
    webview.state::<Loopbacks>().lock().insert(
        id.clone(),
        Waiting {
            owner,
            stop: Arc::clone(&stop),
            heard: Some(heard),
        },
    );
    let until = Instant::now() + PATIENCE;
    std::thread::spawn(move || {
        let _ = tell.send(listen(&listeners, &stop, until));
    });
    Ok(Opened { id, port })
}

#[tauri::command]
pub async fn oauth_loopback_wait(webview: Webview, id: String) -> Result<Query, String> {
    let owner = owner(&webview)?;
    let heard = webview
        .state::<Loopbacks>()
        .lock()
        .get_mut(&id)
        .filter(|one| one.owner == owner)
        .and_then(|one| one.heard.take())
        .ok_or_else(|| "that sign-in is over".to_owned())?;
    let result = crate::lane::off_the_runtime(move || heard.recv_timeout(PATIENCE + ASKING))
        .await
        .map_err(|_| "the sign-in took too long".to_owned());
    webview.state::<Loopbacks>().lock().remove(&id);
    result?
}

#[tauri::command(async)]
pub fn oauth_loopback_close(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let held = webview.state::<Loopbacks>();
    let mut held = held.lock();
    if held.get(&id).is_some_and(|one| one.owner == owner) {
        if let Some(one) = held.remove(&id) {
            one.stop.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

fn token_place(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    let known = parsed
        .host_str()
        .is_some_and(|host| TOKEN_HOSTS.contains(&host));
    if parsed.scheme() == "https" && known && parsed.port().is_none() {
        Ok(parsed)
    } else {
        Err(format!("{url} is not a sign-in service Orden knows"))
    }
}

fn form(fields: &HashMap<String, String>) -> String {
    fields
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                utf8_percent_encode(key, FORM),
                utf8_percent_encode(value, FORM)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

#[tauri::command]
pub async fn oauth_post(
    webview: Webview,
    url: String,
    form: HashMap<String, String>,
) -> Result<Posted, String> {
    owner(&webview)?;
    let place = token_place(&url)?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let answer = client
        .post(place)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(self::form(&form))
        .send()
        .await
        .map_err(|error| format!("the sign-in service could not be reached: {error}"))?;
    let status = answer.status().as_u16();
    let body = answer.text().await.map_err(|error| error.to_string())?;
    Ok(Posted { status, body })
}

#[cfg(test)]
mod tests {
    use super::{accepted, asked, bound, form, listen, token_place};
    use std::collections::HashMap;
    use std::io::{Read as _, Write as _};
    use std::net::{SocketAddr, TcpStream};
    use std::sync::atomic::AtomicBool;
    use std::time::{Duration, Instant};

    fn ask(port: u16, request: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("reached");
        stream.write_all(request.as_bytes()).expect("sent");
        let mut answer = String::new();
        let _ = stream.read_to_string(&mut answer);
        answer
    }

    #[test]
    fn the_answer_is_read_from_the_query_of_a_get() {
        let found = asked("GET /?code=a%2Fb+c&state=x HTTP/1.1").expect("a query");
        assert_eq!(found.get("code").map(String::as_str), Some("a/b c"));
        assert_eq!(found.get("state").map(String::as_str), Some("x"));
        assert!(asked("GET /favicon.ico HTTP/1.1").is_none());
        assert!(asked("POST /?code=a HTTP/1.1").is_none());
        assert!(asked("").is_none());
    }

    #[test]
    fn only_this_machine_is_heard() {
        assert!(accepted(&"127.0.0.1:5000".parse::<SocketAddr>().unwrap()));
        assert!(accepted(&"[::1]:5000".parse::<SocketAddr>().unwrap()));
        assert!(!accepted(&"10.0.0.7:5000".parse::<SocketAddr>().unwrap()));
        assert!(!accepted(&"192.168.1.2:80".parse::<SocketAddr>().unwrap()));
    }

    #[test]
    fn one_answer_is_taken_and_then_nothing_listens() {
        let (listeners, port) = bound().expect("bound");
        let stop = AtomicBool::new(false);
        let until = Instant::now() + Duration::from_secs(20);
        let heard = std::thread::scope(|scope| {
            let waiting = scope.spawn(|| listen(&listeners, &stop, until));
            let silent = TcpStream::connect(("127.0.0.1", port)).expect("reached");
            assert!(ask(port, "GET /favicon.ico HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
            let page = ask(port, "GET /?code=c1&state=s1 HTTP/1.1\r\nHost: x\r\n\r\n");
            assert!(page.starts_with("HTTP/1.1 200"));
            assert!(page.contains("go back to Orden"));
            drop(silent);
            waiting.join().expect("listened")
        });
        let heard = heard.expect("an answer");
        assert_eq!(heard.get("code").map(String::as_str), Some("c1"));
        assert_eq!(heard.get("state").map(String::as_str), Some("s1"));
        let mut late = TcpStream::connect(("127.0.0.1", port)).expect("still bound");
        let wait = Some(Duration::from_millis(500));
        late.set_read_timeout(wait).expect("a timeout");
        late.write_all(b"GET /?code=c2 HTTP/1.1\r\n\r\n")
            .expect("sent");
        let mut answer = String::new();
        let _ = late.read_to_string(&mut answer);
        assert!(answer.is_empty());
    }

    #[test]
    fn a_sign_in_nobody_finishes_ends() {
        let (listeners, _) = bound().expect("bound");
        let stop = AtomicBool::new(false);
        let started = Instant::now();
        let heard = listen(&listeners, &stop, started + Duration::from_millis(300));
        assert!(heard.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
        let stopped = AtomicBool::new(true);
        let far = Instant::now() + Duration::from_secs(60);
        assert!(listen(&listeners, &stopped, far).is_err());
    }

    #[test]
    fn tokens_are_asked_only_of_known_sign_in_services() {
        assert!(token_place("https://oauth2.googleapis.com/token").is_ok());
        assert!(token_place("https://login.microsoftonline.com/common/oauth2/v2.0/token").is_ok());
        assert!(token_place("http://oauth2.googleapis.com/token").is_err());
        assert!(token_place("https://oauth2.googleapis.com:8443/token").is_err());
        assert!(token_place("https://example.org/token").is_err());
        assert!(token_place("https://oauth2.googleapis.com.example.org/token").is_err());
        let mut fields = HashMap::new();
        fields.insert("code".to_owned(), "a b&c=/".to_owned());
        assert_eq!(form(&fields), "code=a%20b%26c%3D%2F");
    }
}
