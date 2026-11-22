use std::fmt::Write as _;
use std::io::{self, Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use base64::Engine as _;

use crate::env::USERNAME;

const WITHIN: Duration = Duration::from_secs(5);
pub struct Said {
    pub status: u16,
    pub body: String,
}
pub fn get(port: u16, path: &str, password: Option<&str>) -> io::Result<Said> {
    request(port, ("GET", path), None, password, WITHIN)
}
fn opened(port: u16, within: Duration) -> io::Result<TcpStream> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&address, WITHIN)?;
    stream.set_read_timeout(Some(within))?;
    stream.set_write_timeout(Some(WITHIN))?;
    Ok(stream)
}
fn head(port: u16, (method, path): (&str, &str), password: Option<&str>) -> String {
    let mut asked =
        format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    if let Some(password) = password {
        let pair =
            base64::engine::general_purpose::STANDARD.encode(format!("{USERNAME}:{password}"));
        let _ = write!(asked, "Authorization: Basic {pair}\r\n");
    }
    asked
}
pub fn request(
    port: u16,
    asked: (&str, &str),
    body: Option<&str>,
    password: Option<&str>,
    within: Duration,
) -> io::Result<Said> {
    let mut stream = opened(port, within)?;
    let mut said = head(port, asked, password);
    if let Some(body) = body {
        let _ =
            write!(said, "Content-Type: application/json\r\nContent-Length: {}\r\n", body.len());
    } else if asked.0 != "GET" {
        said.push_str("Content-Length: 0\r\n");
    }
    said.push_str("\r\n");
    said.push_str(body.unwrap_or_default());
    stream.write_all(said.as_bytes())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    said_of(&raw)
}
pub fn stream(
    port: u16,
    path: &str,
    password: &str,
    tick: Duration,
    mut heard: impl FnMut(Option<&str>) -> bool,
) -> io::Result<()> {
    let mut stream = opened(port, tick)?;
    let mut asked = head(port, ("GET", path), Some(password));
    asked.push_str("Accept: text/event-stream\r\n\r\n");
    stream.write_all(asked.as_bytes())?;
    let mut raw = Vec::new();
    let mut text = Vec::new();
    let mut chunked = None;
    let mut piece = [0u8; 16384];
    loop {
        match stream.read(&mut piece) {
            Ok(0) => return Ok(()),
            Ok(size) => raw.extend_from_slice(&piece[..size]),
            Err(why)
                if matches!(why.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) =>
            {
                if heard(None) {
                    continue;
                }
                return Ok(());
            }
            Err(why) => return Err(why),
        }
        if chunked.is_none() {
            let Some(split) = raw.windows(4).position(|one| one == b"\r\n\r\n") else {
                continue;
            };
            let said = said_of(&raw[..split + 4])?;
            if said.status != 200 {
                return Err(io::Error::other(format!("the stream answered {}", said.status)));
            }
            let top = String::from_utf8_lossy(&raw[..split]).to_ascii_lowercase();
            chunked =
                Some(top.lines().any(|line| {
                    line.starts_with("transfer-encoding:") && line.contains("chunked")
                }));
            raw.drain(..split + 4);
        }
        let ended = if chunked == Some(true) {
            unchunked_so_far(&mut raw, &mut text)
        } else {
            text.append(&mut raw);
            false
        };
        text.retain(|one| *one != b'\r');
        while let Some(end) = text.windows(2).position(|one| one == b"\n\n") {
            let block: Vec<u8> = text.drain(..end + 2).collect();
            let block = String::from_utf8_lossy(&block);
            let data: Vec<&str> = block
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(|data| data.strip_prefix(' ').unwrap_or(data))
                .collect();
            if !data.is_empty() && !heard(Some(&data.join("\n"))) {
                return Ok(());
            }
        }
        if ended {
            return Ok(());
        }
    }
}
fn unchunked_so_far(raw: &mut Vec<u8>, out: &mut Vec<u8>) -> bool {
    while let Some(end) = raw.windows(2).position(|one| one == b"\r\n") {
        let size = String::from_utf8_lossy(&raw[..end]);
        let Ok(size) = usize::from_str_radix(size.split(';').next().unwrap_or("").trim(), 16)
        else {
            return true;
        };
        if size == 0 {
            return true;
        }
        if raw.len() < end + 2 + size + 2 {
            return false;
        }
        out.extend_from_slice(&raw[end + 2..end + 2 + size]);
        raw.drain(..end + 2 + size + 2);
    }
    false
}
fn said_of(raw: &[u8]) -> io::Result<Said> {
    let broken = || io::Error::new(io::ErrorKind::InvalidData, "not an http answer");
    let split = raw.windows(4).position(|one| one == b"\r\n\r\n").ok_or_else(broken)?;
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let rest = &raw[split + 4..];
    let status =
        head.split_whitespace().nth(1).and_then(|one| one.parse().ok()).ok_or_else(broken)?;
    let chunked = head.lines().any(|line| {
        let line = line.to_ascii_lowercase();
        line.starts_with("transfer-encoding:") && line.contains("chunked")
    });
    let body = if chunked { unchunked(rest) } else { rest.to_vec() };
    Ok(Said { status, body: String::from_utf8_lossy(&body).into_owned() })
}
fn unchunked(mut rest: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(end) = rest.windows(2).position(|one| one == b"\r\n") {
        let size = String::from_utf8_lossy(&rest[..end]);
        let Ok(size) = usize::from_str_radix(size.split(';').next().unwrap_or("").trim(), 16)
        else {
            break;
        };
        rest = &rest[end + 2..];
        if size == 0 || rest.len() < size {
            out.extend_from_slice(&rest[..size.min(rest.len())]);
            break;
        }
        out.extend_from_slice(&rest[..size]);
        rest = rest.get(size + 2..).unwrap_or_default();
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead as _;
    use std::net::TcpListener;

    #[test]
    fn a_question_carries_the_password_and_a_chunked_answer_is_read_whole() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let heard = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = io::BufReader::new(stream.try_clone().expect("clone"));
            let mut lines = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                lines.push(line.trim_end().to_owned());
            }
            let mut stream = stream;
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\n{\"ok\"\r\n6\r\n:true}\r\n0\r\n\r\n",
            );
            lines
        });
        let said = get(port, "/global/health", Some("pw")).expect("answered");
        assert_eq!(said.status, 200);
        assert_eq!(said.body, "{\"ok\":true}");
        let lines = heard.join().expect("heard");
        assert_eq!(lines[0], "GET /global/health HTTP/1.1");
        let pair = base64::engine::general_purpose::STANDARD.encode("orden:pw");
        assert!(lines.contains(&format!("Authorization: Basic {pair}")), "{lines:?}");
        let plain =
            said_of(b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 2\r\n\r\nno").expect("read");
        assert_eq!((plain.status, plain.body.as_str()), (401, "no"));
        assert!(said_of(b"nonsense").is_err());
    }
}
