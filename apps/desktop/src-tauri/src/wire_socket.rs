use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::io::ErrorKind;
use std::net::{IpAddr, TcpStream, ToSocketAddrs as _};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager as _, Webview};

use crate::mail_socket::{wrapped, Stream};

const HOSTS: [&str; 2] = ["web.whatsapp.com", "g.whatsapp.net"];
const HEADERS: [&str; 3] = ["origin", "user-agent", "accept-language"];
const PATIENCE: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(40);
const MOST: usize = 64 * 1024 * 1024;
const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const TEXT: u8 = 0x1;
const BINARY: u8 = 0x2;
const CLOSE: u8 = 0x8;
const PING: u8 = 0x9;
const PONG: u8 = 0xA;

enum Order {
    Send(u8, Vec<u8>),
    Close,
}

struct Held {
    owner: String,
    orders: Sender<Order>,
}

#[derive(Default)]
pub struct WireSockets(Mutex<HashMap<String, Held>>);

impl WireSockets {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Held>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn end_where(&self, owner: &str) {
        self.lock().retain(|_, one| {
            if one.owner == owner {
                let _ = one.orders.send(Order::Close);
                false
            } else {
                true
            }
        });
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Place {
    secure: bool,
    host: String,
    port: u16,
    path: String,
}

fn place_of(url: &str) -> Result<Place, String> {
    let (secure, rest) = if let Some(rest) = url.strip_prefix("wss://") {
        (true, rest)
    } else if let Some(rest) = url.strip_prefix("ws://") {
        (false, rest)
    } else {
        return Err("only a WebSocket address can be reached".to_owned());
    };
    let split = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, path) = rest.split_at(split);
    let path = if path.is_empty() {
        "/".to_owned()
    } else if path.starts_with('?') {
        format!("/{path}")
    } else {
        path.to_owned()
    };
    if authority.contains('@') || path.bytes().any(|one| one <= b' ' || one == 0x7f) {
        return Err("that address is not allowed".to_owned());
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (host, after) = inner
            .split_once(']')
            .ok_or_else(|| "that address has no host".to_owned())?;
        (host, after.strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    let port = match port {
        Some(port) => port
            .parse::<u16>()
            .map_err(|_| "that address has no port".to_owned())?,
        None if secure => 443,
        None => 80,
    };
    if host.is_empty() {
        return Err("that address has no host".to_owned());
    }
    Ok(Place {
        secure,
        host: host.to_ascii_lowercase(),
        port,
        path,
    })
}

fn loopback(host: &str) -> bool {
    host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn allowed(place: &Place) -> Result<(), String> {
    if loopback(&place.host) {
        return Ok(());
    }
    if !HOSTS.contains(&place.host.as_str()) {
        return Err(format!("{} is not a server Orden talks to", place.host));
    }
    if !place.secure || place.port != 443 {
        return Err(format!("{} is only reached encrypted", place.host));
    }
    Ok(())
}

fn headers_of(asked: &BTreeMap<String, String>) -> Result<Vec<(String, String)>, String> {
    let mut headers: Vec<(String, String)> = Vec::new();
    for (name, value) in asked {
        let lower = name.to_ascii_lowercase();
        if !HEADERS.contains(&lower.as_str()) {
            return Err(format!("{name} cannot be set on a connection"));
        }
        if value.bytes().any(|one| one < b' ' || one == 0x7f) {
            return Err(format!("{name} is not a header value"));
        }
        headers.push((lower, value.clone()));
    }
    headers.sort();
    Ok(headers)
}

fn protocols_of(asked: &[String]) -> Result<Option<String>, String> {
    if asked.is_empty() {
        return Ok(None);
    }
    for one in asked {
        if one.is_empty()
            || !one
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        {
            return Err(format!("{one} is not a protocol name"));
        }
    }
    Ok(Some(asked.join(", ")))
}

fn sha1(bytes: &[u8]) -> [u8; 20] {
    let mut state: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut message = bytes.to_vec();
    let length = u64::try_from(bytes.len())
        .unwrap_or(u64::MAX)
        .wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&length.to_be_bytes());
    for block in message.as_chunks::<64>().0 {
        let mut words = [0_u32; 80];
        for (at, word) in block.as_chunks::<4>().0.iter().enumerate() {
            words[at] = u32::from_be_bytes(*word);
        }
        for at in 16..80 {
            words[at] =
                (words[at - 3] ^ words[at - 8] ^ words[at - 14] ^ words[at - 16]).rotate_left(1);
        }
        let mut work = state;
        for (at, word) in words.iter().enumerate() {
            let [first, second, third, fourth, fifth] = work;
            let (mixed, constant) = match at {
                0..=19 => ((second & third) | (!second & fourth), 0x5A82_7999),
                20..=39 => (second ^ third ^ fourth, 0x6ED9_EBA1),
                40..=59 => (
                    (second & third) | (second & fourth) | (third & fourth),
                    0x8F1B_BCDC,
                ),
                _ => (second ^ third ^ fourth, 0xCA62_C1D6),
            };
            let next = first
                .rotate_left(5)
                .wrapping_add(mixed)
                .wrapping_add(fifth)
                .wrapping_add(constant)
                .wrapping_add(*word);
            work = [next, first, second.rotate_left(30), third, fourth];
        }
        for (kept, added) in state.iter_mut().zip(work) {
            *kept = kept.wrapping_add(added);
        }
    }
    let mut out = [0_u8; 20];
    for (at, word) in state.iter().enumerate() {
        out[at * 4..at * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn accept_of(key: &str) -> String {
    BASE64.encode(sha1(format!("{key}{GUID}").as_bytes()))
}

fn request_of(
    place: &Place,
    key: &str,
    headers: &[(String, String)],
    protocols: Option<&str>,
) -> String {
    let default_port = if place.secure { 443 } else { 80 };
    let host = if place.host.contains(':') {
        format!("[{}]", place.host)
    } else {
        place.host.clone()
    };
    let host = if place.port == default_port {
        host
    } else {
        format!("{host}:{}", place.port)
    };
    let mut request = format!(
        "GET {} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n",
        place.path
    );
    for (name, value) in headers {
        let _ = write!(request, "{name}: {value}\r\n");
    }
    if let Some(protocols) = protocols {
        let _ = write!(request, "Sec-WebSocket-Protocol: {protocols}\r\n");
    }
    request.push_str("\r\n");
    request
}

fn answered(head: &str, key: &str) -> Result<(), String> {
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap_or_default();
    if status.split(' ').nth(1) != Some("101") {
        return Err(format!(
            "the server refused the connection: {}",
            status.chars().take(80).collect::<String>()
        ));
    }
    let mut upgraded = false;
    let mut accepted = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "upgrade" => upgraded = value.eq_ignore_ascii_case("websocket"),
            "sec-websocket-accept" => accepted = value == accept_of(key),
            _ => {}
        }
    }
    if upgraded && accepted {
        Ok(())
    } else {
        Err("the server did not open a WebSocket".to_owned())
    }
}

fn mask() -> [u8; 4] {
    let mut bytes = [0_u8; 4];
    if getrandom::fill(&mut bytes).is_err() {
        bytes = [0x5A, 0xC3, 0x0F, 0x96];
    }
    bytes
}

fn frame(opcode: u8, payload: &[u8], masked: Option<[u8; 4]>) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 14);
    out.push(0x80 | opcode);
    let flag = if masked.is_some() { 0x80 } else { 0 };
    match payload.len() {
        length @ 0..=125 => out.push(flag | u8::try_from(length).unwrap_or(0x7D)),
        length @ 126..=65_535 => {
            out.push(flag | 0x7E);
            out.extend_from_slice(&u16::try_from(length).unwrap_or(u16::MAX).to_be_bytes());
        }
        length => {
            out.push(flag | 0x7F);
            out.extend_from_slice(&u64::try_from(length).unwrap_or(u64::MAX).to_be_bytes());
        }
    }
    match masked {
        Some(key) => {
            out.extend_from_slice(&key);
            out.extend(
                payload
                    .iter()
                    .enumerate()
                    .map(|(at, one)| one ^ key[at % 4]),
            );
        }
        None => out.extend_from_slice(payload),
    }
    out
}

#[derive(Debug, PartialEq, Eq)]
enum Heard {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Closed(String),
}

type Frame = (bool, u8, Vec<u8>, usize);

#[derive(Default)]
struct Frames {
    buffer: Vec<u8>,
    message: Vec<u8>,
    kind: Option<u8>,
}

impl Frames {
    fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    fn next(&mut self) -> Result<Option<Heard>, String> {
        loop {
            let Some((fin, opcode, payload, used)) = Self::one(&self.buffer)? else {
                return Ok(None);
            };
            self.buffer.drain(..used);
            match opcode {
                0x0 => {
                    let Some(kind) = self.kind else {
                        return Err("the server continued a message it never began".to_owned());
                    };
                    self.message.extend_from_slice(&payload);
                    if self.message.len() > MOST {
                        return Err("the server sent too large a message".to_owned());
                    }
                    if fin {
                        self.kind = None;
                        return Self::whole(kind, std::mem::take(&mut self.message)).map(Some);
                    }
                }
                TEXT | BINARY if fin => return Self::whole(opcode, payload).map(Some),
                TEXT | BINARY => {
                    self.kind = Some(opcode);
                    self.message = payload;
                }
                CLOSE => {
                    let reason = if payload.len() > 2 {
                        String::from_utf8_lossy(&payload[2..]).into_owned()
                    } else {
                        String::new()
                    };
                    let code = if payload.len() >= 2 {
                        u16::from_be_bytes([payload[0], payload[1]])
                    } else {
                        1005
                    };
                    return Ok(Some(Heard::Closed(if reason.is_empty() {
                        format!("the server closed the connection ({code})")
                    } else {
                        format!("the server closed the connection ({code}): {reason}")
                    })));
                }
                PING => return Ok(Some(Heard::Ping(payload))),
                PONG => {}
                other => return Err(format!("the server sent an unknown frame {other}")),
            }
        }
    }

    fn whole(kind: u8, payload: Vec<u8>) -> Result<Heard, String> {
        if kind == TEXT {
            String::from_utf8(payload)
                .map(Heard::Text)
                .map_err(|_| "the server sent text that is not UTF-8".to_owned())
        } else {
            Ok(Heard::Binary(payload))
        }
    }

    fn one(buffer: &[u8]) -> Result<Option<Frame>, String> {
        if buffer.len() < 2 {
            return Ok(None);
        }
        let fin = buffer[0] & 0x80 != 0;
        let opcode = buffer[0] & 0x0F;
        let masked = buffer[1] & 0x80 != 0;
        let (length, mut at) = match buffer[1] & 0x7F {
            126 => {
                if buffer.len() < 4 {
                    return Ok(None);
                }
                (usize::from(u16::from_be_bytes([buffer[2], buffer[3]])), 4)
            }
            127 => {
                if buffer.len() < 10 {
                    return Ok(None);
                }
                let mut wide = [0_u8; 8];
                wide.copy_from_slice(&buffer[2..10]);
                (
                    usize::try_from(u64::from_be_bytes(wide)).unwrap_or(usize::MAX),
                    10,
                )
            }
            short => (usize::from(short), 2),
        };
        if length > MOST {
            return Err("the server sent too large a message".to_owned());
        }
        let key = if masked {
            if buffer.len() < at + 4 {
                return Ok(None);
            }
            let key = [buffer[at], buffer[at + 1], buffer[at + 2], buffer[at + 3]];
            at += 4;
            Some(key)
        } else {
            None
        };
        if buffer.len() < at + length {
            return Ok(None);
        }
        let mut payload = buffer[at..at + length].to_vec();
        if let Some(key) = key {
            for (place, one) in payload.iter_mut().enumerate() {
                *one ^= key[place % 4];
            }
        }
        Ok(Some((fin, opcode, payload, at + length)))
    }
}

fn reached(place: &Place) -> Result<Stream, String> {
    let places: Vec<_> = (place.host.as_str(), place.port)
        .to_socket_addrs()
        .map_err(|error| format!("{} could not be found: {error}", place.host))?
        .collect();
    if loopback(&place.host) && !places.iter().all(|one| one.ip().is_loopback()) {
        return Err(format!("{} is not this machine", place.host));
    }
    let mut last = format!("{} could not be reached", place.host);
    for one in places {
        match TcpStream::connect_timeout(&one, PATIENCE) {
            Ok(socket) => {
                socket
                    .set_read_timeout(Some(POLL))
                    .map_err(|error| error.to_string())?;
                socket
                    .set_write_timeout(Some(PATIENCE))
                    .map_err(|error| error.to_string())?;
                return if place.secure {
                    wrapped(&place.host, socket)
                } else {
                    Ok(Stream::Plain(socket))
                };
            }
            Err(error) => last = format!("{} could not be reached: {error}", place.host),
        }
    }
    Err(last)
}

fn opened(
    url: &str,
    asked: &BTreeMap<String, String>,
    protocols: &[String],
) -> Result<(Stream, Frames), String> {
    let place = place_of(url)?;
    allowed(&place)?;
    let headers = headers_of(asked)?;
    let protocols = protocols_of(protocols)?;
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let key = BASE64.encode(random);
    let mut stream = reached(&place)?;
    stream
        .write(request_of(&place, &key, &headers, protocols.as_deref()).as_bytes())
        .map_err(|error| error.to_string())?;
    let mut head: Vec<u8> = Vec::new();
    let mut buffer = vec![0_u8; 4096];
    let started = Instant::now();
    let end = loop {
        if let Some(end) = head.windows(4).position(|one| one == b"\r\n\r\n") {
            break end;
        }
        if head.len() > 16 * 1024 {
            return Err("the server sent too long an answer".to_owned());
        }
        if started.elapsed() > PATIENCE {
            return Err("the server did not answer".to_owned());
        }
        match stream.read(&mut buffer) {
            Ok(0) => return Err("the server closed the connection".to_owned()),
            Ok(count) => head.extend_from_slice(&buffer[..count]),
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                ) => {}
            Err(error) => return Err(error.to_string()),
        }
    };
    answered(&String::from_utf8_lossy(&head[..end]), &key)?;
    let mut frames = Frames::default();
    frames.push(&head[end + 4..]);
    Ok((stream, frames))
}

enum Said {
    Heard(Heard),
    Nothing,
}

fn heard_next(stream: &mut Stream, frames: &mut Frames, buffer: &mut [u8]) -> Result<Said, String> {
    if let Some(heard) = frames.next()? {
        return Ok(Said::Heard(heard));
    }
    match stream.read(buffer) {
        Ok(0) => Err("the server closed the connection".to_owned()),
        Ok(count) => {
            frames.push(&buffer[..count]);
            Ok(frames.next()?.map_or(Said::Nothing, Said::Heard))
        }
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
            ) =>
        {
            Ok(Said::Nothing)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn run(
    mut stream: Stream,
    mut frames: Frames,
    orders: &Receiver<Order>,
    hear: &dyn Fn(Heard) -> bool,
) -> String {
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        loop {
            match orders.try_recv() {
                Ok(Order::Send(opcode, bytes)) => {
                    if let Err(error) = stream.write(&frame(opcode, &bytes, Some(mask()))) {
                        return error.to_string();
                    }
                }
                Ok(Order::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                    let _ = stream.write(&frame(CLOSE, &1000_u16.to_be_bytes(), Some(mask())));
                    return "closed".to_owned();
                }
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }
        match heard_next(&mut stream, &mut frames, &mut buffer) {
            Ok(Said::Nothing) => {}
            Ok(Said::Heard(Heard::Ping(payload))) => {
                if let Err(error) = stream.write(&frame(PONG, &payload, Some(mask()))) {
                    return error.to_string();
                }
            }
            Ok(Said::Heard(Heard::Closed(reason))) => {
                let _ = stream.write(&frame(CLOSE, &[], Some(mask())));
                return reason;
            }
            Ok(Said::Heard(heard)) => {
                if !hear(heard) {
                    return "nobody is listening".to_owned();
                }
            }
            Err(error) => return error,
        }
    }
}

fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("only Orden's own window may open a connection".to_owned())
    }
}

fn named(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|one| one.is_ascii_alphanumeric() || one == b'-')
    {
        Err("not a connection name".to_owned())
    } else {
        Ok(())
    }
}

fn order(webview: &Webview, id: &str, order: Order) -> Result<(), String> {
    let owner = owner(webview)?;
    let sockets = webview.state::<WireSockets>();
    let held = sockets.lock();
    held.get(id)
        .filter(|one| one.owner == owner)
        .ok_or_else(|| "that connection is closed".to_owned())?
        .orders
        .send(order)
        .map_err(|_| "that connection is closed".to_owned())
}

#[tauri::command]
pub async fn wire_socket_open(
    webview: Webview,
    id: String,
    url: String,
    headers: BTreeMap<String, String>,
    protocols: Vec<String>,
    output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let owner = owner(&webview)?;
    named(&id)?;
    if webview.state::<WireSockets>().lock().contains_key(&id) {
        return Err(format!("{id} is already open"));
    }
    let (stream, frames) =
        crate::lane::off_the_runtime(move || opened(&url, &headers, &protocols)).await?;
    let (orders, inbox) = mpsc::channel();
    {
        let sockets = webview.state::<WireSockets>();
        let mut held = sockets.lock();
        if held.contains_key(&id) {
            return Err(format!("{id} is already open"));
        }
        held.insert(id.clone(), Held { owner, orders });
    }
    let app = webview.app_handle().clone();
    std::thread::spawn(move || {
        let hear = |heard: Heard| match heard {
            Heard::Binary(bytes) => output.send(InvokeResponseBody::Raw(bytes)).is_ok(),
            Heard::Text(text) => output
                .send(InvokeResponseBody::Json(
                    serde_json::json!({ "text": text }).to_string(),
                ))
                .is_ok(),
            Heard::Ping(_) | Heard::Closed(_) => true,
        };
        let reason = run(stream, frames, &inbox, &hear);
        if let Some(sockets) = app.try_state::<WireSockets>() {
            sockets.lock().remove(&id);
        }
        let said = serde_json::json!({ "end": reason }).to_string();
        let _ = output.send(InvokeResponseBody::Json(said));
    });
    Ok(())
}

#[derive(serde::Deserialize)]
struct Sent {
    id: String,
}

#[tauri::command(async)]
pub fn wire_socket_send(webview: Webview, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let (Sent { id }, bytes) = crate::notes::raw_sent(request.headers(), request.body())?;
    order(&webview, &id, Order::Send(BINARY, bytes.into_owned()))
}

#[tauri::command(async)]
pub fn wire_socket_send_text(webview: Webview, id: String, text: String) -> Result<(), String> {
    order(&webview, &id, Order::Send(TEXT, text.into_bytes()))
}

#[tauri::command(async)]
pub fn wire_socket_close(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let sockets = webview.state::<WireSockets>();
    let mut held = sockets.lock();
    if held.get(&id).is_some_and(|one| one.owner == owner) {
        if let Some(one) = held.remove(&id) {
            let _ = one.orders.send(Order::Close);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        accept_of, allowed, frame, headers_of, opened, place_of, protocols_of, run, sha1, Frames,
        Heard, Order, Place, BINARY, CLOSE, PING, TEXT,
    };
    use std::collections::BTreeMap;
    use std::fmt::Write as _;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().fold(String::new(), |mut out, one| {
            let _ = write!(out, "{one:02x}");
            out
        })
    }

    #[test]
    fn sha1_matches_the_standard_vectors() {
        assert_eq!(
            hex(&sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            hex(&sha1(
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
            )),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
        assert_eq!(
            accept_of("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn only_whatsapp_encrypted_or_this_machine() {
        let ok = |url: &str| place_of(url).and_then(|place| allowed(&place));
        assert!(ok("wss://web.whatsapp.com/ws/chat").is_ok());
        assert!(ok("wss://WEB.whatsapp.com:443/ws/chat?ED=CAI").is_ok());
        assert!(ok("ws://127.0.0.1:8080/ws").is_ok());
        assert!(ok("ws://localhost:9/").is_ok());
        assert!(ok("ws://[::1]:9/").is_ok());
        assert!(ok("ws://web.whatsapp.com/ws/chat").is_err());
        assert!(ok("wss://web.whatsapp.com:8443/ws/chat").is_err());
        assert!(ok("wss://evil.example/ws").is_err());
        assert!(ok("wss://web.whatsapp.com.evil.example/ws").is_err());
        assert!(ok("wss://user@web.whatsapp.com/ws").is_err());
        assert!(ok("https://web.whatsapp.com/ws").is_err());
        assert!(ok("wss://web.whatsapp.com/ws\r\nX: y").is_err());
        assert_eq!(
            place_of("wss://web.whatsapp.com?x=1").unwrap(),
            Place {
                secure: true,
                host: "web.whatsapp.com".to_owned(),
                port: 443,
                path: "/?x=1".to_owned()
            }
        );
    }

    #[test]
    fn only_harmless_headers_and_protocol_names() {
        let mut asked = BTreeMap::new();
        asked.insert("Origin".to_owned(), "https://web.whatsapp.com".to_owned());
        assert_eq!(
            headers_of(&asked).unwrap(),
            vec![("origin".to_owned(), "https://web.whatsapp.com".to_owned())]
        );
        for (name, value) in [
            ("Host", "elsewhere"),
            ("Sec-WebSocket-Key", "x"),
            ("Cookie", "a=b"),
            ("Origin", "a\r\nX-Evil: 1"),
        ] {
            let mut asked = BTreeMap::new();
            asked.insert(name.to_owned(), value.to_owned());
            assert!(headers_of(&asked).is_err(), "{name}");
        }
        assert_eq!(protocols_of(&[]).unwrap(), None);
        assert_eq!(
            protocols_of(&["chat".to_owned(), "v2.x".to_owned()]).unwrap(),
            Some("chat, v2.x".to_owned())
        );
        assert!(protocols_of(&["a b".to_owned()]).is_err());
    }

    #[test]
    fn frames_of_every_length_read_back_masked_or_not() {
        for length in [0, 1, 125, 126, 127, 65_535, 65_536, 200_000] {
            let payload: Vec<u8> = (0..length)
                .map(|at: usize| u8::try_from(at % 251).unwrap())
                .collect();
            for masked in [None, Some([1, 2, 3, 4])] {
                let mut frames = Frames::default();
                let bytes = frame(BINARY, &payload, masked);
                for piece in bytes.chunks(7000) {
                    frames.push(piece);
                }
                assert_eq!(frames.next().unwrap(), Some(Heard::Binary(payload.clone())));
                assert_eq!(frames.next().unwrap(), None);
            }
        }
    }

    #[test]
    fn a_split_message_comes_whole_and_control_frames_pass_between() {
        let mut frames = Frames::default();
        let mut first = frame(TEXT, b"hel", None);
        first[0] &= 0x7F;
        let mut last = frame(0, b"lo", None);
        last[0] |= 0x80;
        frames.push(&first);
        frames.push(&frame(PING, b"p", None));
        frames.push(&last);
        frames.push(&frame(CLOSE, &[0x03, 0xE8, b'b', b'y', b'e'], None));
        assert_eq!(frames.next().unwrap(), Some(Heard::Ping(b"p".to_vec())));
        assert_eq!(
            frames.next().unwrap(),
            Some(Heard::Text("hello".to_owned()))
        );
        assert_eq!(
            frames.next().unwrap(),
            Some(Heard::Closed(
                "the server closed the connection (1000): bye".to_owned()
            ))
        );
    }

    #[test]
    fn talks_to_a_server_with_the_headers_asked_and_bytes_both_ways() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(String::new()));
        let kept = Arc::clone(&seen);
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut asked = Vec::new();
            let mut one = [0_u8; 1];
            while !asked.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut one).unwrap();
                asked.push(one[0]);
            }
            let asked = String::from_utf8(asked).unwrap();
            let key = asked
                .lines()
                .find_map(|line| line.strip_prefix("Sec-WebSocket-Key: "))
                .unwrap()
                .trim()
                .to_owned();
            *kept.lock().unwrap() = asked.clone();
            let mut answer = format!(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
                accept_of(&key)
            )
            .into_bytes();
            answer.extend(frame(BINARY, &[0, 159, 255, 1], None));
            socket.write_all(&answer).unwrap();
            let mut frames = Frames::default();
            let mut buffer = [0_u8; 1024];
            let got = loop {
                if let Some(one) = frames.next().unwrap() {
                    break one;
                }
                let count = socket.read(&mut buffer).unwrap();
                frames.push(&buffer[..count]);
            };
            let Heard::Binary(bytes) = got else {
                panic!("{got:?}")
            };
            let mut back = bytes.clone();
            back.reverse();
            socket.write_all(&frame(BINARY, &back, None)).unwrap();
            socket
                .write_all(&frame(CLOSE, &[0x03, 0xE8], None))
                .unwrap();
            bytes
        });
        let mut headers = BTreeMap::new();
        headers.insert("Origin".to_owned(), "https://web.whatsapp.com".to_owned());
        let (stream, frames) =
            opened(&format!("ws://127.0.0.1:{port}/ws/chat"), &headers, &[]).unwrap();
        let (orders, inbox) = mpsc::channel();
        let got = Arc::new(Mutex::new(Vec::new()));
        let into = Arc::clone(&got);
        let sender = orders.clone();
        let reason = run(stream, frames, &inbox, &move |one| {
            let mut got = into.lock().unwrap();
            if got.is_empty() {
                let _ = sender.send(Order::Send(BINARY, vec![9, 8, 7, 0]));
            }
            got.push(one);
            true
        });
        let echoed = server.join().unwrap();
        let request = seen.lock().unwrap().clone();
        assert!(
            request.starts_with("GET /ws/chat HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(
            request.contains("\r\norigin: https://web.whatsapp.com\r\n"),
            "{request}"
        );
        assert!(
            request.contains(&format!("\r\nHost: 127.0.0.1:{port}\r\n")),
            "{request}"
        );
        assert_eq!(echoed, vec![9, 8, 7, 0]);
        assert_eq!(
            *got.lock().unwrap(),
            vec![
                Heard::Binary(vec![0, 159, 255, 1]),
                Heard::Binary(vec![0, 7, 8, 9])
            ]
        );
        assert_eq!(reason, "the server closed the connection (1000)");
        drop(orders);
    }

    #[test]
    fn a_server_that_will_not_upgrade_is_refused() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 2048];
            let _ = socket.read(&mut buffer).unwrap();
            socket
                .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });
        let refused = opened(&format!("ws://127.0.0.1:{port}/"), &BTreeMap::new(), &[]);
        server.join().unwrap();
        let Err(reason) = refused else {
            panic!("a refusing server was taken")
        };
        assert!(reason.contains("403"));
    }
}
