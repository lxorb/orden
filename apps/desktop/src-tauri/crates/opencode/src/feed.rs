use orden_base::Held as _;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::host::{self, Line};
use crate::http;
use crate::proxy::hidden;

const TICK: Duration = Duration::from_secs(1);
const QUIET: Duration = Duration::from_secs(60);
const AGAIN: Duration = Duration::from_millis(500);
static FOLLOWING: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);
pub(crate) fn follow(
    stop: &AtomicBool,
    lookup: impl Fn() -> Option<Line>,
    mut send: impl FnMut(Value) -> bool,
) {
    while !stop.load(Ordering::Relaxed) {
        let Some(line) = lookup() else {
            std::thread::sleep(AGAIN);
            continue;
        };
        let mut quiet = Instant::now();
        let _ = http::stream(line.port, "/event", &line.password, TICK, |data| {
            if stop.load(Ordering::Relaxed) {
                return false;
            }
            let Some(data) = data else {
                return quiet.elapsed() < QUIET && lookup().is_some_and(|now| now == line);
            };
            quiet = Instant::now();
            let Ok(event) = serde_json::from_str::<Value>(&hidden(data, &line.password)) else {
                return true;
            };
            if send(event) {
                return true;
            }
            stop.store(true, Ordering::Relaxed);
            false
        });
        if !stop.load(Ordering::Relaxed) {
            std::thread::sleep(AGAIN);
        }
    }
}
pub fn start(label: String, send: impl FnMut(Value) -> bool + Send + 'static) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(before) =
        FOLLOWING.held().get_or_insert_with(HashMap::new).insert(label.clone(), stop.clone())
    {
        before.store(true, Ordering::Relaxed);
    }
    std::thread::spawn(move || {
        follow(&stop, host::line, send);
        let mut following = FOLLOWING.held();
        let all = following.get_or_insert_with(HashMap::new);
        if all.get(&label).is_some_and(|one| Arc::ptr_eq(one, &stop)) {
            all.remove(&label);
        }
    });
}
pub fn stop(label: &str) {
    if let Some(one) = FOLLOWING.held().get_or_insert_with(HashMap::new).remove(label) {
        one.store(true, Ordering::Relaxed);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead as _, BufReader, Write as _};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;

    fn heard_head(stream: &TcpStream) -> Vec<String> {
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
    fn chunk(stream: &mut TcpStream, words: &str) {
        let _ = write!(stream, "{:x}\r\n{words}\r\n", words.len());
        let _ = stream.flush();
    }
    #[test]
    fn events_come_through_whole_without_the_password_and_a_dropped_stream_comes_back() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let (asked, heads) = mpsc::channel();
        std::thread::spawn(move || {
            for (round, stream) in listener.incoming().flatten().enumerate() {
                let _ = asked.send(heard_head(&stream));
                let mut stream = stream;
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n",
                );
                if round == 0 {
                    chunk(&mut stream, "data: {\"type\":\"server.connected\"}\r\n\r\ndata: {\"type\":\"session.upd");
                    chunk(
                        &mut stream,
                        "ated\",\"echo\":\"secret-pw-123456\"}\n\n: comment\n\ndata: nonsense\n\n",
                    );
                    chunk(&mut stream, "");
                } else {
                    chunk(&mut stream, "data: {\"type\":\"server.connected\",\"round\":2}\n\n");
                    std::thread::sleep(Duration::from_secs(3));
                }
            }
        });
        let line = Line { port, password: "secret-pw-123456".to_owned() };
        let stop = Arc::new(AtomicBool::new(false));
        let (told, events) = mpsc::channel();
        let stopped = stop.clone();
        let followed = std::thread::spawn(move || {
            follow(&stopped, || Some(line.clone()), |event| told.send(event).is_ok());
        });
        let mut said = Vec::new();
        for _ in 0..3 {
            said.push(events.recv_timeout(Duration::from_secs(10)).expect("an event"));
        }
        stop.store(true, Ordering::Relaxed);
        followed.join().expect("followed");
        assert_eq!(said[0]["type"], "server.connected");
        assert_eq!(said[1]["type"], "session.updated");
        assert_eq!(said[2]["round"], 2);
        assert!(said.iter().all(|one| !one.to_string().contains("secret-pw")), "{said:?}");
        let first = heads.recv().expect("a head");
        assert_eq!(first[0], "GET /event HTTP/1.1");
        assert!(first.iter().any(|one| one.starts_with("Authorization: Basic ")), "{first:?}");
        assert!(heads.recv().is_ok());
    }
    #[test]
    fn a_closed_webview_ends_its_stream_and_a_new_line_is_followed() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                heard_head(&stream);
                let mut stream = stream;
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\n\r\ndata: {\"n\":1}\n\ndata: {\"n\":2}\n\n");
                std::thread::sleep(Duration::from_secs(3));
            }
        });
        let stop = AtomicBool::new(false);
        let mut count = 0;
        follow(
            &stop,
            || Some(Line { port, password: "pw".to_owned() }),
            |_| {
                count += 1;
                false
            },
        );
        assert_eq!(count, 1);
        assert!(stop.load(Ordering::Relaxed));
        let refused = TcpListener::bind("127.0.0.1:0").expect("bind");
        let closed = refused.local_addr().expect("addr").port();
        drop(refused);
        let stop = AtomicBool::new(false);
        let asked = std::cell::Cell::new(0);
        let mut heard = Vec::new();
        follow(
            &stop,
            || {
                asked.set(asked.get() + 1);
                Some(Line {
                    port: if asked.get() < 3 { closed } else { port },
                    password: "pw".to_owned(),
                })
            },
            |event| {
                heard.push(event);
                heard.len() < 2
            },
        );
        assert_eq!(heard.len(), 2);
        assert!(asked.get() >= 3);
    }
}
