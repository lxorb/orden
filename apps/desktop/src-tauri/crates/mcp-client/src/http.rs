use std::collections::BTreeMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use orden_base::Held as _;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use reqwest::{Client as Web, Response, StatusCode, Url};
use serde_json::Value;
use tauri::async_runtime::JoinHandle;

use crate::client::{hello, waited, STARTING};
use crate::rpc::{Peer, Wire};

const SESSION: &str = "mcp-session-id";
const VERSION: &str = "mcp-protocol-version";
const EVENTS: &str = "text/event-stream";
const MOST_KEPT: usize = 16 * 1024 * 1024;
pub(crate) fn run<T: Send + 'static>(work: impl Future<Output = T> + Send + 'static) -> Option<T> {
    let (done, heard) = mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let _ = done.send(work.await);
    });
    heard.recv().ok()
}
fn web() -> Result<Web, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Web::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())
}
fn fixed(headers: &BTreeMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let key = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("'{name}' cannot name a header"))?;
        let mut value = HeaderValue::from_str(value)
            .map_err(|_| format!("the header {name} holds something a header cannot carry"))?;
        value.set_sensitive(true);
        map.insert(key, value);
    }
    Ok(map)
}
enum Posted {
    Refused(StatusCode, String),
    Failed(String),
}
impl Posted {
    fn said(&self) -> String {
        match self {
            Self::Refused(status, text) if text.is_empty() => {
                format!("the server answered HTTP {status}")
            }
            Self::Refused(status, text) => format!("the server answered HTTP {status}: {text}"),
            Self::Failed(why) => why.clone(),
        }
    }
}
fn reached(error: &reqwest::Error) -> String {
    format!("could not reach the server: {error}")
}
#[derive(Default)]
struct Events {
    kept: Vec<u8>,
}
impl Events {
    fn more(&mut self, chunk: &[u8]) -> Vec<(String, String)> {
        self.kept.extend(chunk.iter().filter(|one| **one != b'\r'));
        if self.kept.len() > MOST_KEPT {
            self.kept.clear();
        }
        let mut found = Vec::new();
        while let Some(at) = self.kept.windows(2).position(|two| two == b"\n\n") {
            let block: Vec<u8> = self.kept.drain(..at + 2).collect();
            let text = String::from_utf8_lossy(&block);
            let (mut name, mut data) = (String::new(), Vec::new());
            for line in text.lines() {
                let (field, value) = line.split_once(':').map_or((line, ""), |(field, value)| {
                    (field, value.strip_prefix(' ').unwrap_or(value))
                });
                match field {
                    "event" => value.clone_into(&mut name),
                    "data" => data.push(value.to_owned()),
                    _ => {}
                }
            }
            if !data.is_empty() {
                found.push((name, data.join("\n")));
            }
        }
        found
    }
}
struct Link {
    web: Web,
    fixed: HeaderMap,
    url: Url,
    legacy: bool,
    peer: Arc<Peer>,
    session: Mutex<Option<HeaderValue>>,
    protocol: Mutex<Option<String>>,
    to: Mutex<Option<Url>>,
    endpoint: Mutex<Option<mpsc::Sender<Result<(), String>>>>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    ended: AtomicBool,
}
impl Link {
    fn new(web: Web, fixed: HeaderMap, url: Url, legacy: bool, peer: &Arc<Peer>) -> Arc<Self> {
        Arc::new(Self {
            web,
            fixed,
            url,
            legacy,
            peer: Arc::clone(peer),
            session: Mutex::new(None),
            protocol: Mutex::new(None),
            to: Mutex::new(None),
            endpoint: Mutex::new(None),
            tasks: Mutex::new(Vec::new()),
            ended: AtomicBool::new(false),
        })
    }
    fn headers(&self) -> HeaderMap {
        let mut headers = self.fixed.clone();
        if let Some(session) = self.session.held().clone() {
            headers.insert(SESSION, session);
        }
        if let Some(version) = self.protocol.held().as_deref() {
            if let Ok(version) = HeaderValue::from_str(version) {
                headers.insert(VERSION, version);
            }
        }
        headers
    }
    async fn post(self: Arc<Self>, message: Value) -> Result<(), Posted> {
        let to = self.to.held().clone().unwrap_or_else(|| self.url.clone());
        let response = self
            .web
            .post(to)
            .headers(self.headers())
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .body(message.to_string())
            .send()
            .await
            .map_err(|error| Posted::Failed(reached(&error)))?;
        if let Some(session) = response.headers().get(SESSION) {
            *self.session.held() = Some(session.clone());
        }
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(Posted::Refused(status, text.trim().chars().take(200).collect()));
        }
        if !self.legacy {
            self.taken_in(response).await;
        }
        Ok(())
    }
    async fn taken_in(self: &Arc<Self>, response: Response) {
        let streamed = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|kind| kind.to_str().ok())
            .is_some_and(|kind| kind.starts_with(EVENTS));
        if streamed {
            self.read_events(response).await;
        } else if let Ok(bytes) = response.bytes().await {
            if let Ok(message) = serde_json::from_slice(&bytes) {
                self.heard(message);
            }
        }
    }
    async fn read_events(self: &Arc<Self>, mut response: Response) {
        let mut events = Events::default();
        while let Ok(Some(chunk)) = response.chunk().await {
            for (name, data) in events.more(&chunk) {
                match name.as_str() {
                    "endpoint" => self.pointed(&data),
                    "" | "message" => {
                        if let Ok(message) = serde_json::from_str(&data) {
                            self.heard(message);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    fn pointed(&self, data: &str) {
        let Some(said) = self.endpoint.held().take() else {
            return;
        };
        let _ = said.send(match self.url.join(data.trim()) {
            Ok(to) => {
                *self.to.held() = Some(to);
                Ok(())
            }
            Err(_) => Err("the server named no address to send messages to".to_owned()),
        });
    }
    fn heard(self: &Arc<Self>, message: Value) {
        for reply in self.peer.heard(message) {
            self.sent(reply);
        }
    }
    fn sent(self: &Arc<Self>, message: Value) {
        let asked = message.get("method").and_then(|_| message.get("id")).and_then(Value::as_u64);
        let link = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let Err(posted) = Arc::clone(&link).post(message).await else {
                return;
            };
            let gone = matches!(posted, Posted::Refused(StatusCode::NOT_FOUND, _));
            if gone && link.session.held().is_some() {
                link.peer.end("the server ended the session");
            } else if let Some(id) = asked {
                link.peer.answered(id, Err(posted.said()));
            }
        });
    }
    fn listen(self: &Arc<Self>) {
        let link = Arc::clone(self);
        let task = tauri::async_runtime::spawn(async move {
            loop {
                let asked =
                    link.web.get(link.url.clone()).headers(link.headers()).header(ACCEPT, EVENTS);
                let Ok(response) = asked.send().await else {
                    return;
                };
                if !response.status().is_success() {
                    return;
                }
                link.read_events(response).await;
                if link.ended.load(Ordering::SeqCst) || link.peer.is_ended() {
                    return;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
        self.tasks.held().push(task);
    }
}
struct Http(Arc<Link>);
impl Wire for Http {
    fn send(&self, message: Value) -> Result<(), String> {
        if self.0.peer.is_ended() {
            return Err(self.0.peer.why());
        }
        self.0.sent(message);
        Ok(())
    }
    fn end(&self) {
        if self.0.ended.swap(true, Ordering::SeqCst) {
            return;
        }
        for task in self.0.tasks.held().drain(..) {
            task.abort();
        }
        let Some(session) = self.0.session.held().clone().filter(|_| !self.0.legacy) else {
            return;
        };
        let asked = self
            .0
            .web
            .delete(self.0.url.clone())
            .headers(self.0.fixed.clone())
            .header(SESSION, session);
        tauri::async_runtime::spawn(async move {
            let _ = asked.send().await;
        });
    }
}
impl Drop for Http {
    fn drop(&mut self) {
        self.end();
    }
}
pub(crate) fn open(
    url: &str,
    headers: &BTreeMap<String, String>,
    peer: &Arc<Peer>,
) -> Result<(Box<dyn Wire>, Value), String> {
    let url = Url::parse(url).map_err(|_| format!("'{url}' is no web address"))?;
    let link = Link::new(web()?, fixed(headers)?, url, false, peer);
    let (id, message, answer) = peer.ask("initialize", hello())?;
    let posted = run(Arc::clone(&link).post(message))
        .unwrap_or_else(|| Err(Posted::Failed("the request was dropped".to_owned())));
    match posted {
        Ok(()) => {}
        Err(Posted::Refused(status, _))
            if status.is_client_error()
                && !matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) =>
        {
            peer.forget(id);
            return legacy(&link, peer);
        }
        Err(posted) => {
            peer.forget(id);
            return Err(posted.said());
        }
    }
    let wire = Http(Arc::clone(&link));
    let init = waited(peer, id, &answer, "initialize", STARTING)?;
    *link.protocol.held() = init.get("protocolVersion").and_then(Value::as_str).map(str::to_owned);
    link.listen();
    Ok((Box::new(wire), init))
}
fn legacy(tried: &Link, peer: &Arc<Peer>) -> Result<(Box<dyn Wire>, Value), String> {
    let link = Link::new(tried.web.clone(), tried.fixed.clone(), tried.url.clone(), true, peer);
    let (found, heard) = mpsc::channel();
    *link.endpoint.held() = Some(found.clone());
    let reading = Arc::clone(&link);
    let task = tauri::async_runtime::spawn(async move {
        let asked = reading
            .web
            .get(reading.url.clone())
            .headers(reading.fixed.clone())
            .header(ACCEPT, EVENTS);
        match asked.send().await {
            Err(error) => {
                let _ = found.send(Err(reached(&error)));
            }
            Ok(response) if !response.status().is_success() => {
                let _ = found.send(Err(format!("the server answered HTTP {}", response.status())));
            }
            Ok(response) => {
                reading.read_events(response).await;
                reading.peer.end("the server closed its event stream");
            }
        }
    });
    link.tasks.held().push(task);
    let wire = Http(Arc::clone(&link));
    match heard.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(())) => {}
        Ok(Err(why)) => return Err(why),
        Err(_) => return Err("the server never said where to send messages".to_owned()),
    }
    let (id, message, answer) = peer.ask("initialize", hello())?;
    link.sent(message);
    let init = waited(peer, id, &answer, "initialize", STARTING)?;
    Ok((Box::new(wire), init))
}
#[cfg(test)]
mod tests {
    use super::Events;

    #[test]
    fn events_split_across_chunks_and_lines_come_whole() {
        let mut events = Events::default();
        assert!(events.more(b"event: endpoint\r\ndata: /messages?s=1").is_empty());
        let found = events.more(b"\r\n\r\n: ping\n\ndata: {\"a\":\ndata: 1}\n\n");
        assert_eq!(
            found,
            [
                ("endpoint".to_owned(), "/messages?s=1".to_owned()),
                (String::new(), "{\"a\":\n1}".to_owned())
            ]
        );
    }
}
