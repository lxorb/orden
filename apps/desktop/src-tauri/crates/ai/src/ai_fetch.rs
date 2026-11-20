use orden_base::Held as _;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, COOKIE, ORIGIN, REFERER};
use reqwest::{redirect, Client, Method, Response, Url};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;

const CONNECT_WITHIN: Duration = Duration::from_secs(15);
const MOST_HOPS: usize = 5;
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Head {
    pub status: u16,
    pub headers: Vec<(String, String)>,
}
struct Asked {
    method: Method,
    url: Url,
    headers: HeaderMap,
    body: Option<Vec<u8>>,
}
fn asked_of(
    url: &str,
    method: &str,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<Asked, String> {
    let parsed = Url::parse(url.trim()).map_err(|_| format!("{url} is not an address"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("{url} is not an http or https address"));
    }
    let method = Method::from_bytes(method.trim().to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("{method} is not a method"))?;
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| format!("{name} is not a header"))?;
        if name == ORIGIN || name == REFERER || name == COOKIE {
            continue;
        }
        let value = HeaderValue::from_str(&value)
            .map_err(|_| format!("{name} holds what a header cannot"))?;
        map.append(name, value);
    }
    let body = body
        .map(|said| base64::engine::general_purpose::STANDARD.decode(said))
        .transpose()
        .map_err(|_| "the body is not base64".to_owned())?;
    Ok(Asked { method, url: parsed, headers: map, body })
}
fn same_origin(one: &Url, other: &Url) -> bool {
    one.scheme() == other.scheme()
        && one.host_str() == other.host_str()
        && one.port_or_known_default() == other.port_or_known_default()
}
fn client() -> Result<Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .connect_timeout(CONNECT_WITHIN)
        .redirect(redirect::Policy::custom(|hop| {
            let first = hop.previous().first().cloned();
            match first {
                Some(first)
                    if hop.previous().len() <= MOST_HOPS && same_origin(&first, hop.url()) =>
                {
                    hop.follow()
                }
                _ => hop.stop(),
            }
        }))
        .build()
        .map_err(|why| why.to_string())
}
async fn opened(asked: Asked) -> Result<Response, String> {
    let url = asked.url.to_string();
    let mut sending = client()?.request(asked.method, asked.url).headers(asked.headers);
    if let Some(body) = asked.body {
        sending = sending.body(body);
    }
    sending.send().await.map_err(|why| {
        if why.is_connect() || why.is_timeout() || why.is_request() {
            format!("Could not reach {url}")
        } else {
            why.to_string()
        }
    })
}
fn head_of(response: &Response) -> Head {
    Head {
        status: response.status().as_u16(),
        headers: response
            .headers()
            .iter()
            .map(|(name, value)| {
                (name.as_str().to_owned(), String::from_utf8_lossy(value.as_bytes()).into_owned())
            })
            .collect(),
    }
}
async fn pump(mut response: Response, mut send: impl FnMut(Value) -> bool) {
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let data = base64::engine::general_purpose::STANDARD.encode(&chunk);
                if !send(json!({ "data": data })) {
                    return;
                }
            }
            Ok(None) => {
                send(json!({ "end": true }));
                return;
            }
            Err(why) => {
                send(json!({ "error": why.to_string() }));
                return;
            }
        }
    }
}
type Key = (String, u32);
type Running = HashMap<Key, (u64, JoinHandle<()>)>;
static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);
fn run(key: Key, task: impl Future<Output = ()> + Send + 'static) {
    let turn = NEXT.fetch_add(1, Ordering::Relaxed);
    let mut running = RUNNING.held();
    let all = running.get_or_insert_with(HashMap::new);
    let ending = key.clone();
    let handle = tauri::async_runtime::spawn(async move {
        task.await;
        let mut running = RUNNING.held();
        if let Some(all) = running.as_mut() {
            if all.get(&ending).is_some_and(|one| one.0 == turn) {
                all.remove(&ending);
            }
        }
    });
    if let Some((_, before)) = all.insert(key, (turn, handle)) {
        before.abort();
    }
}
fn stop(key: &Key) {
    let gone = RUNNING.held().as_mut().and_then(|all| all.remove(key));
    if let Some((_, handle)) = gone {
        handle.abort();
    }
}
async fn fetched(
    key: Key,
    asked: Asked,
    send: impl FnMut(Value) -> bool + Send + 'static,
) -> Result<Head, String> {
    let (told, heard) = tokio::sync::oneshot::channel();
    run(key, async move {
        match opened(asked).await {
            Ok(response) => {
                if told.send(Ok(head_of(&response))).is_ok() {
                    pump(response, send).await;
                }
            }
            Err(why) => {
                let _ = told.send(Err(why));
            }
        }
    });
    heard.await.unwrap_or_else(|_| Err("the request was stopped".to_owned()))
}
#[tauri::command]
pub async fn ai_fetch(
    webview: tauri::Webview,
    id: u32,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    output: Channel<Value>,
) -> Result<Head, String> {
    orden_base::labels::from_the_app(&webview)?;
    let asked = asked_of(&url, &method, headers, body)?;
    let key = (webview.label().to_owned(), id);
    fetched(key, asked, move |message| output.send(message).is_ok()).await
}
#[tauri::command]
pub fn ai_fetch_stop(webview: tauri::Webview, id: u32) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    stop(&(webview.label().to_owned(), id));
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead as _, BufReader, Write as _};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex as Shared};

    fn head_lines(stream: &TcpStream) -> Vec<String> {
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        let mut lines = Vec::new();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                return lines;
            }
            lines.push(line.trim_end().to_owned());
        }
    }
    fn serve(answer: impl Fn(Vec<String>, TcpStream) + Send + 'static) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let lines = head_lines(&stream);
                answer(lines, stream);
            }
        });
        port
    }
    fn chunk(stream: &mut TcpStream, words: &str) {
        let _ = write!(stream, "{:x}\r\n{words}\r\n", words.len());
        let _ = stream.flush();
    }
    fn asked(url: &str, headers: &[(&str, &str)]) -> Asked {
        let headers = headers.iter().map(|(a, b)| ((*a).to_owned(), (*b).to_owned())).collect();
        asked_of(url, "POST", headers, Some(base64::engine::general_purpose::STANDARD.encode("{}")))
            .expect("asked")
    }
    fn words(said: &[Value]) -> String {
        said.iter()
            .filter_map(|one| one["data"].as_str())
            .map(|data| {
                String::from_utf8(
                    base64::engine::general_purpose::STANDARD.decode(data).expect("b64"),
                )
                .expect("utf8")
            })
            .collect()
    }
    #[test]
    fn a_request_leaves_with_no_origin_referer_or_cookie() {
        let (seen, request) = mpsc::channel();
        let port = serve(move |lines, mut stream| {
            let _ = seen.send(lines);
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 2\r\n\r\nok");
        });
        let url = format!("http://127.0.0.1:{port}/v1/models");
        let asked = asked(
            &url,
            &[
                ("Origin", "http://tauri.localhost"),
                ("Referer", "x"),
                ("Cookie", "a=b"),
                ("x-api-key", "k"),
            ],
        );
        let said = Arc::new(Shared::new(Vec::new()));
        let kept = Arc::clone(&said);
        let head = tauri::async_runtime::block_on(fetched(("w".into(), 1), asked, move |one| {
            kept.lock().expect("kept").push(one);
            true
        }))
        .expect("head");
        assert_eq!(head.status, 200);
        let lines: Vec<String> = request
            .recv_timeout(Duration::from_secs(5))
            .expect("asked")
            .iter()
            .map(|one| one.to_lowercase())
            .collect();
        assert!(lines[0].starts_with("post /v1/models"));
        assert!(lines.iter().any(|one| one == "x-api-key: k"));
        for name in ["origin:", "referer:", "cookie:"] {
            assert!(!lines.iter().any(|one| one.starts_with(name)), "{name} {lines:?}");
        }
    }
    #[test]
    fn a_stream_comes_in_order_each_piece_as_it_arrives() {
        let (go_on, wait) = mpsc::channel::<()>();
        let wait = Shared::new(wait);
        let port = serve(move |_, mut stream| {
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n");
            chunk(&mut stream, "first ");
            let _ = wait.lock().expect("wait").recv_timeout(Duration::from_secs(10));
            chunk(&mut stream, "second ");
            chunk(&mut stream, "third");
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let (told, said) = mpsc::channel();
        let head = tauri::async_runtime::block_on(fetched(
            ("w".into(), 2),
            asked(&format!("http://127.0.0.1:{port}/"), &[]),
            move |one| told.send(one).is_ok(),
        ))
        .expect("head");
        assert_eq!(head.status, 200);
        let first =
            said.recv_timeout(Duration::from_secs(5)).expect("the first piece before the rest");
        assert_eq!(words(&[first]), "first ");
        go_on.send(()).expect("go on");
        let mut rest = Vec::new();
        while let Ok(one) = said.recv_timeout(Duration::from_secs(5)) {
            let end = one.get("end").is_some();
            rest.push(one);
            if end {
                break;
            }
        }
        assert_eq!(words(&rest), "second third");
        assert_eq!(rest.last(), Some(&json!({ "end": true })));
    }
    #[test]
    fn a_stopped_request_sends_nothing_more() {
        let port = serve(move |_, mut stream| {
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n");
            for _ in 0..200 {
                chunk(&mut stream, "more ");
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        let (told, said) = mpsc::channel();
        let key = ("w".to_owned(), 3);
        tauri::async_runtime::block_on(fetched(
            key.clone(),
            asked(&format!("http://127.0.0.1:{port}/"), &[]),
            move |one| told.send(one).is_ok(),
        ))
        .expect("head");
        said.recv_timeout(Duration::from_secs(5)).expect("a piece");
        stop(&key);
        std::thread::sleep(Duration::from_millis(100));
        while said.try_recv().is_ok() {}
        std::thread::sleep(Duration::from_millis(300));
        assert!(said.try_recv().is_err());
        assert!(RUNNING.held().as_ref().is_none_or(|all| !all.contains_key(&key)));
    }
    #[test]
    fn only_http_and_https_are_asked() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/",
            "javascript:alert(1)",
            "orden://x",
            "nonsense",
        ] {
            assert!(asked_of(url, "GET", Vec::new(), None).is_err(), "{url}");
        }
        assert!(asked_of("https://api.example.com/v1", "post", Vec::new(), None).is_ok());
        assert!(asked_of("http://127.0.0.1:11434/v1", "GET", Vec::new(), Some("!".into())).is_err());
    }
    #[test]
    fn a_redirect_is_followed_only_to_the_same_origin() {
        let (elsewhere_heard, heard) = mpsc::channel();
        let elsewhere = serve(move |lines, mut stream| {
            let _ = elsewhere_heard.send(lines);
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
        });
        let port = serve(move |lines, mut stream| {
            let path = lines.first().cloned().unwrap_or_default();
            let answer = if path.contains(" /away ") {
                format!("HTTP/1.1 302 Found\r\nconnection: close\r\nlocation: http://127.0.0.1:{elsewhere}/x\r\ncontent-length: 0\r\n\r\n")
            } else if path.contains(" /here ") {
                "HTTP/1.1 302 Found\r\nconnection: close\r\nlocation: /there\r\ncontent-length: 0\r\n\r\n".to_owned()
            } else {
                "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 5\r\n\r\nthere".to_owned()
            };
            let _ = stream.write_all(answer.as_bytes());
        });
        let get = |path: &str| {
            let asked = asked_of(
                &format!("http://127.0.0.1:{port}{path}"),
                "GET",
                vec![("x-api-key".into(), "k".into())],
                None,
            )
            .expect("asked");
            tauri::async_runtime::block_on(fetched(("w".into(), 4), asked, |_| true)).expect("head")
        };
        assert_eq!(get("/here").status, 200);
        let away = get("/away");
        assert_eq!(away.status, 302);
        assert!(away.headers.iter().any(|(name, _)| name == "location"));
        assert!(heard.recv_timeout(Duration::from_millis(500)).is_err());
        let unreachable = asked_of("http://127.0.0.1:1/", "GET", Vec::new(), None).expect("asked");
        assert_eq!(
            tauri::async_runtime::block_on(fetched(("w".into(), 5), unreachable, |_| true)),
            Err("Could not reach http://127.0.0.1:1/".to_owned())
        );
    }
}
