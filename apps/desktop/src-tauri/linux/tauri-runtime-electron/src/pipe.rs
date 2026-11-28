use std::any::Any;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::ThreadId;
use std::time::Duration;

use serde::de::DeserializeOwned;
use tauri_runtime::webview::{PageLoadEvent, UriSchemeProtocolHandler};
use tauri_runtime::window::{WindowEvent, WindowId};
use tauri_runtime::{Error, Result};

use crate::wire::{FromShell, ToShell, Transport, PROTOCOL, SCHEMES};

const PATIENCE: Duration = Duration::from_secs(30);

pub(crate) type Reader = Box<dyn Read + Send>;
pub(crate) type Writer = Box<dyn Write + Send>;
pub(crate) type Ends = (Reader, Writer);
pub(crate) type Listener = Box<dyn Fn(&WindowEvent) + Send>;
pub(crate) type Posted = Box<dyn Fn(http::Request<String>) + Send>;
pub(crate) type PageLoad = Box<dyn Fn(url::Url, PageLoadEvent) + Send>;

pub(crate) enum Message {
    Task(Box<dyn FnOnce() + Send>),
    User(Box<dyn Any + Send>),
    Shell(FromShell, Vec<u8>),
    Exit(i32),
    Closed,
}

pub(crate) struct WebviewState {
    pub label: String,
    pub window: u32,
    pub protocols: HashMap<String, Box<UriSchemeProtocolHandler>>,
    pub posted: Mutex<Option<Posted>>,
    pub page_load: Mutex<Option<PageLoad>>,
}

pub(crate) struct WindowState {
    pub label: String,
    pub id: WindowId,
    pub listeners: Mutex<Vec<(u32, Listener)>>,
}

pub(crate) struct Inner {
    writer: Mutex<Writer>,
    waiting: Mutex<HashMap<u64, Sender<serde_json::Value>>>,
    next_call: AtomicU64,
    next_id: AtomicU32,
    closed: AtomicBool,
    tx: Sender<Message>,
    main: ThreadId,
    pub transport: Transport,
    pub windows: Mutex<HashMap<u32, Arc<WindowState>>>,
    pub webviews: Mutex<HashMap<u32, Arc<WebviewState>>>,
}

#[derive(Clone)]
pub struct Context(pub(crate) Arc<Inner>);

impl std::fmt::Debug for Context {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Context").finish_non_exhaustive()
    }
}

pub(crate) fn held<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(PoisonError::into_inner)
}

fn refused(why: String) -> Error {
    Error::CreateWindow(why.into())
}

#[cfg(unix)]
pub(crate) fn open(path: &str) -> std::io::Result<Ends> {
    let stream = std::os::unix::net::UnixStream::connect(path)?;
    let reader = stream.try_clone()?;
    Ok((Box::new(reader), Box::new(stream)))
}

#[cfg(windows)]
pub(crate) fn open(path: &str) -> std::io::Result<Ends> {
    use crate::wire::{TO_CORE, TO_SHELL};
    let reader = std::fs::OpenOptions::new().read(true).open(format!("{path}{TO_CORE}"))?;
    let writer = std::fs::OpenOptions::new().write(true).open(format!("{path}{TO_SHELL}"))?;
    Ok((Box::new(reader), Box::new(writer)))
}

fn size_of(bytes: [u8; 4]) -> std::io::Result<usize> {
    usize::try_from(u32::from_le_bytes(bytes))
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

fn read_frame(reader: &mut dyn Read) -> std::io::Result<(Vec<u8>, Vec<u8>)> {
    let mut head_size = [0u8; 4];
    let mut body_size = [0u8; 4];
    reader.read_exact(&mut head_size)?;
    reader.read_exact(&mut body_size)?;
    let mut head = vec![0u8; size_of(head_size)?];
    reader.read_exact(&mut head)?;
    let mut body = vec![0u8; size_of(body_size)?];
    reader.read_exact(&mut body)?;
    Ok((head, body))
}

fn write_frame(writer: &mut dyn Write, message: &ToShell, body: &[u8]) -> Result<()> {
    let head = serde_json::to_vec(message)?;
    let sizes = (u32::try_from(head.len()), u32::try_from(body.len()));
    let (Ok(head_size), Ok(body_size)) = sizes else {
        return Err(Error::FailedToSendMessage);
    };
    let mut frame = Vec::with_capacity(8 + head.len() + body.len());
    frame.extend_from_slice(&head_size.to_le_bytes());
    frame.extend_from_slice(&body_size.to_le_bytes());
    frame.extend_from_slice(&head);
    frame.extend_from_slice(body);
    writer.write_all(&frame).and_then(|()| writer.flush()).map_err(|_| Error::FailedToSendMessage)
}

fn greeted(ends: &mut Ends, identifier: String, transport: Transport) -> Result<()> {
    let hello = ToShell::Hello {
        protocol: PROTOCOL,
        identifier,
        schemes: SCHEMES.iter().map(|&one| one.to_owned()).collect(),
        transport,
    };
    write_frame(&mut *ends.1, &hello, &[])?;
    let (head, _) = read_frame(&mut *ends.0).map_err(|error| {
        refused(format!("the shell left before it answered the hello: {error}"))
    })?;
    match serde_json::from_slice::<FromShell>(&head) {
        Ok(FromShell::Welcome { protocol }) if protocol == PROTOCOL => Ok(()),
        Ok(FromShell::Welcome { protocol }) => Err(refused(format!(
            "the shell speaks protocol {protocol} and this core speaks {PROTOCOL}"
        ))),
        _ => Err(refused("the shell did not answer the hello with a welcome".to_owned())),
    }
}

impl Context {
    pub(crate) fn connect(
        mut ends: Ends,
        identifier: String,
        transport: Transport,
    ) -> Result<(Self, Receiver<Message>)> {
        greeted(&mut ends, identifier, transport)?;
        let (mut reader, writer) = ends;
        let (tx, rx) = channel();
        let context = Self(Arc::new(Inner {
            writer: Mutex::new(writer),
            waiting: Mutex::default(),
            next_call: AtomicU64::new(1),
            next_id: AtomicU32::new(1),
            closed: AtomicBool::new(false),
            tx,
            main: std::thread::current().id(),
            transport,
            windows: Mutex::default(),
            webviews: Mutex::default(),
        }));
        let reading = context.clone();
        std::thread::Builder::new()
            .name("orden-electron-pipe".into())
            .spawn(move || {
                while let Ok((head, body)) = read_frame(&mut *reader) {
                    match serde_json::from_slice::<FromShell>(&head) {
                        Ok(FromShell::Reply { id, value }) => {
                            let waiting = held(&reading.0.waiting).remove(&id);
                            if let Some(waiting) = waiting {
                                let _ = waiting.send(value);
                            }
                        }
                        Ok(message) => {
                            if reading.0.tx.send(Message::Shell(message, body)).is_err() {
                                break;
                            }
                        }
                        Err(_) => {}
                    }
                }
                reading.0.closed.store(true, Ordering::SeqCst);
                held(&reading.0.waiting).clear();
                let _ = reading.0.tx.send(Message::Closed);
            })
            .map_err(|error| refused(error.to_string()))?;
        Ok((context, rx))
    }

    pub(crate) fn next_id(&self) -> u32 {
        self.0.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub(crate) fn send(&self, message: &ToShell, body: &[u8]) -> Result<()> {
        write_frame(&mut **held(&self.0.writer), message, body)
    }

    pub(crate) fn ask<A: DeserializeOwned>(&self, asked: impl FnOnce(u64) -> ToShell) -> Result<A> {
        let id = self.0.next_call.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = channel();
        held(&self.0.waiting).insert(id, tx);
        if self.0.closed.load(Ordering::SeqCst) {
            held(&self.0.waiting).remove(&id);
            return Err(Error::FailedToReceiveMessage);
        }
        if let Err(error) = self.send(&asked(id), &[]) {
            held(&self.0.waiting).remove(&id);
            return Err(error);
        }
        let Ok(value) = rx.recv_timeout(PATIENCE) else {
            held(&self.0.waiting).remove(&id);
            return Err(Error::FailedToReceiveMessage);
        };
        serde_json::from_value(value).map_err(Error::Json)
    }

    pub(crate) fn post(&self, message: Message) -> Result<()> {
        match message {
            Message::Task(task) if std::thread::current().id() == self.0.main => {
                task();
                Ok(())
            }
            message => self.0.tx.send(message).map_err(|_| Error::EventLoopClosed),
        }
    }

    pub(crate) fn window(&self, id: u32) -> Option<Arc<WindowState>> {
        held(&self.0.windows).get(&id).cloned()
    }

    pub(crate) fn webview(&self, id: u32) -> Option<Arc<WebviewState>> {
        held(&self.0.webviews).get(&id).cloned()
    }
}
