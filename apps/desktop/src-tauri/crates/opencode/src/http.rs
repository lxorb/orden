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
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, WITHIN)?;
    stream.set_read_timeout(Some(WITHIN))?;
    stream.set_write_timeout(Some(WITHIN))?;
    let mut asked =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    if let Some(password) = password {
        let pair =
            base64::engine::general_purpose::STANDARD.encode(format!("{USERNAME}:{password}"));
        let _ = write!(asked, "Authorization: Basic {pair}\r\n");
    }
    asked.push_str("\r\n");
    stream.write_all(asked.as_bytes())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    said_of(&raw)
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
