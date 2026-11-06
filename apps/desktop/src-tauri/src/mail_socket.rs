//! A connection to a mail server for the chats' mail provider (#321): TLS, or plain and
//! upgraded in place by STARTTLS. IMAP and SMTP are spoken by the window
//! (packages/chats/src/mail); this only carries the bytes.
//!
//! Only Orden's own document windows may open one, only to the ports mail uses, and plain
//! text only to this machine, so a page cannot use it to reach other services or to send
//! a password in the clear. Certificates are checked by the platform's verifier.

use std::collections::HashMap;
use std::io::{ErrorKind, Read as _, Write as _};
use std::net::{IpAddr, TcpStream, ToSocketAddrs as _};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use base64::Engine as _;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, StreamOwned};
use rustls_platform_verifier::BuilderVerifierExt;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager as _, Webview};

const PORTS: [u16; 8] = [25, 143, 465, 587, 993, 1025, 1143, 2525];
const PATIENCE: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(40);

type Answer = Sender<Result<(), String>>;

enum Order {
    Write(Vec<u8>, Answer),
    StartTls(Answer),
    Close,
}

struct Held {
    owner: String,
    orders: Sender<Order>,
}

#[derive(Default)]
pub struct MailSockets(Mutex<HashMap<String, Held>>);

impl MailSockets {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Held>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A window has gone, or reloaded: its connections end.
    pub fn end_where(&self, owner: &str) {
        let mut held = self.lock();
        held.retain(|_, one| {
            if one.owner == owner {
                let _ = one.orders.send(Order::Close);
                false
            } else {
                true
            }
        });
    }
}

enum Stream {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Stream {
    fn read(&mut self, into: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(socket) => socket.read(into),
            Self::Tls(stream) => stream.read(into),
        }
    }

    fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        match self {
            Self::Plain(socket) => socket.write_all(bytes).and_then(|()| socket.flush()),
            Self::Tls(stream) => stream.write_all(bytes).and_then(|()| stream.flush()),
        }
    }
}

fn owner(webview: &Webview) -> Result<String, String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(label.to_owned())
    } else {
        Err("only Orden's own window may open a mail connection".to_owned())
    }
}

/// Whether a connection there may be asked for: a mail port, and TLS unless the server
/// is on this machine.
fn allowed(port: u16, tls: &str, loopback: bool) -> Result<(), String> {
    if !PORTS.contains(&port) {
        return Err(format!("{port} is not a port mail uses"));
    }
    match tls {
        "tls" | "starttls" => Ok(()),
        "none" if loopback => Ok(()),
        "none" => Err("a mail server elsewhere is only reached encrypted".to_owned()),
        _ => Err(format!("{tls} is not a way to connect")),
    }
}

fn wrapped(host: &str, socket: TcpStream) -> Result<Stream, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .and_then(BuilderVerifierExt::with_platform_verifier)
        .map_err(|error| error.to_string())?
        .with_no_client_auth();
    let name = ServerName::try_from(host.to_owned()).map_err(|error| error.to_string())?;
    let mut connection =
        ClientConnection::new(Arc::new(config), name).map_err(|error| error.to_string())?;
    let mut socket = socket;
    socket
        .set_read_timeout(Some(PATIENCE))
        .map_err(|error| error.to_string())?;
    while connection.is_handshaking() {
        connection
            .complete_io(&mut socket)
            .map_err(|error| format!("the secure connection failed: {error}"))?;
    }
    socket
        .set_read_timeout(Some(POLL))
        .map_err(|error| error.to_string())?;
    Ok(Stream::Tls(Box::new(StreamOwned::new(connection, socket))))
}

fn connect(host: &str, port: u16, tls: &str) -> Result<Stream, String> {
    let places: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("{host} could not be found: {error}"))?
        .collect();
    let loopback = !places.is_empty() && places.iter().all(|one| one.ip().is_loopback())
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    allowed(port, tls, loopback)?;
    let mut last = format!("{host} could not be reached");
    for place in places {
        match TcpStream::connect_timeout(&place, PATIENCE) {
            Ok(socket) => {
                socket
                    .set_read_timeout(Some(POLL))
                    .map_err(|error| error.to_string())?;
                socket
                    .set_write_timeout(Some(PATIENCE))
                    .map_err(|error| error.to_string())?;
                return if tls == "tls" {
                    wrapped(host, socket)
                } else {
                    Ok(Stream::Plain(socket))
                };
            }
            Err(error) => last = format!("{host} could not be reached: {error}"),
        }
    }
    Err(last)
}

fn run(
    host: &str,
    mut stream: Stream,
    orders: &Receiver<Order>,
    output: &Channel<InvokeResponseBody>,
) -> String {
    let mut buffer = vec![0_u8; 32 * 1024];
    loop {
        loop {
            match orders.try_recv() {
                Ok(Order::Write(bytes, answer)) => {
                    let _ = answer.send(stream.write(&bytes).map_err(|error| error.to_string()));
                }
                Ok(Order::StartTls(answer)) => {
                    let Stream::Plain(socket) = stream else {
                        let _ = answer.send(Err("already encrypted".to_owned()));
                        continue;
                    };
                    match wrapped(host, socket) {
                        Ok(upgraded) => {
                            stream = upgraded;
                            let _ = answer.send(Ok(()));
                        }
                        Err(error) => {
                            let _ = answer.send(Err(error.clone()));
                            return error;
                        }
                    }
                }
                Ok(Order::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                    return "closed".to_owned()
                }
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }
        match stream.read(&mut buffer) {
            Ok(0) => return "the server closed the connection".to_owned(),
            Ok(count) => {
                if output
                    .send(InvokeResponseBody::Raw(buffer[..count].to_vec()))
                    .is_err()
                {
                    return "nobody is listening".to_owned();
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(error) => return error.to_string(),
        }
    }
}

fn ask(webview: &Webview, id: &str, order: impl FnOnce(Answer) -> Order) -> Result<(), String> {
    let owner = owner(webview)?;
    let (answer, answered) = mpsc::channel();
    {
        let held = webview.state::<MailSockets>();
        let held = held.lock();
        let one = held
            .get(id)
            .filter(|one| one.owner == owner)
            .ok_or_else(|| "that connection is closed".to_owned())?;
        one.orders
            .send(order(answer))
            .map_err(|_| "that connection is closed".to_owned())?;
    }
    answered
        .recv_timeout(PATIENCE * 2)
        .map_err(|_| "the mail server did not answer".to_owned())?
}

/// Opens one under `id`. What arrives comes on `output` as bytes; the last message is
/// `{"end": reason}`.
#[tauri::command(async)]
pub fn mail_socket_open(
    webview: Webview,
    id: String,
    host: String,
    port: u16,
    tls: String,
    output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let owner = owner(&webview)?;
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|one| one.is_ascii_alphanumeric() || one == b'-')
    {
        return Err("not a connection name".to_owned());
    }
    let stream = connect(&host, port, &tls)?;
    let (orders, heard) = mpsc::channel();
    {
        let sockets = webview.state::<MailSockets>();
        let mut held = sockets.lock();
        if held.contains_key(&id) {
            return Err(format!("{id} is already open"));
        }
        held.insert(id.clone(), Held { owner, orders });
    }
    let app = webview.app_handle().clone();
    std::thread::spawn(move || {
        let reason = run(&host, stream, &heard, &output);
        if let Some(sockets) = app.try_state::<MailSockets>() {
            sockets.lock().remove(&id);
        }
        let said = serde_json::json!({ "end": reason }).to_string();
        let _ = output.send(InvokeResponseBody::Json(said));
    });
    Ok(())
}

#[tauri::command(async)]
pub fn mail_socket_write(webview: Webview, id: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| error.to_string())?;
    ask(&webview, &id, |answer| Order::Write(bytes, answer))
}

#[tauri::command(async)]
pub fn mail_socket_tls(webview: Webview, id: String) -> Result<(), String> {
    ask(&webview, &id, Order::StartTls)
}

#[tauri::command(async)]
pub fn mail_socket_close(webview: Webview, id: String) -> Result<(), String> {
    let owner = owner(&webview)?;
    let sockets = webview.state::<MailSockets>();
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
    use super::allowed;

    #[test]
    fn only_mail_ports_and_plain_text_only_here() {
        assert!(allowed(993, "tls", false).is_ok());
        assert!(allowed(587, "starttls", false).is_ok());
        assert!(allowed(1143, "none", true).is_ok());
        assert!(allowed(143, "none", false).is_err());
        assert!(allowed(22, "tls", false).is_err());
        assert!(allowed(6379, "none", true).is_err());
        assert!(allowed(993, "maybe", false).is_err());
    }
}
