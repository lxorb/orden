use orden_base::Held as _;
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};

use super::wire;

pub const MODE: &str = "terminal-hold";
pub const SPEC: &str = "ORDEN_HOLD";
const SAID: &str = "orden-hold ";
const REFUSED: &str = "orden-hold-refused ";
const KEPT: usize = 4 << 20;
const BEHIND: usize = 1 << 20;
const PART: usize = 64 * 1024;
const GREETED_WITHIN: Duration = Duration::from_secs(5);
const STARTED_WITHIN: Duration = Duration::from_secs(20);
const PARTING: Duration = Duration::from_secs(3);
const SAID_AGAIN: Duration = Duration::from_millis(500);
const LINGER: Duration = Duration::from_millis(500);
const UNSEEN: Duration = Duration::from_secs(24 * 60 * 60);
const SCREENS: [u16; 3] = [47, 1047, 1049];
const TRACKED: [u16; 15] = [
    1, 7, 25, 47, 66, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1047, 1049, 2004,
];
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Spec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub folder: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
    pub file: PathBuf,
    pub token: String,
    #[serde(default)]
    pub farewell: Vec<u8>,
    #[serde(default)]
    pub label: Label,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Label {
    pub shell: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Record {
    pub v: u32,
    pub port: u16,
    pub token: String,
    pub holder: u32,
    #[serde(default)]
    pub shell: Option<u32>,
    #[serde(default)]
    pub started: u64,
    #[serde(default)]
    pub label: Label,
}
#[derive(Clone, Debug)]
pub struct Starter {
    pub program: PathBuf,
    pub args: Vec<String>,
}
#[derive(Default)]
struct Modes {
    set: BTreeMap<u16, bool>,
    at: Scan,
    number: u32,
    numbers: Vec<u32>,
}
#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Scan {
    #[default]
    Ground,
    Escape,
    Csi,
    Private,
}
impl Modes {
    fn feed(&mut self, bytes: impl IntoIterator<Item = u8>) {
        for byte in bytes {
            self.one(byte);
        }
    }
    fn one(&mut self, byte: u8) {
        self.at = match (self.at, byte) {
            (_, 0x1b) => Scan::Escape,
            (Scan::Escape, b'[') => {
                self.number = 0;
                self.numbers.clear();
                Scan::Csi
            }
            (Scan::Escape, b'c') => {
                self.set.clear();
                Scan::Ground
            }
            (Scan::Private, b'0'..=b'9') => {
                self.number = (self.number * 10 + u32::from(byte - b'0')).min(100_000);
                Scan::Private
            }
            (Scan::Private, b';') => {
                if self.numbers.len() < 16 {
                    self.numbers.push(self.number);
                }
                self.number = 0;
                Scan::Private
            }
            (Scan::Private, b'h' | b'l') => {
                self.numbers.push(self.number);
                for one in self.numbers.drain(..) {
                    if let Some(mode) = u16::try_from(one).ok().filter(|one| TRACKED.contains(one))
                    {
                        self.set.insert(mode, byte == b'h');
                    }
                }
                Scan::Ground
            }
            (Scan::Csi, b'?') | (Scan::Private, 0x20..=0x3f) => Scan::Private,
            _ => Scan::Ground,
        };
    }
    fn prelude(&self) -> Vec<u8> {
        let screens = self.set.iter().filter(|(mode, _)| SCREENS.contains(mode));
        let rest = self.set.iter().filter(|(mode, _)| !SCREENS.contains(mode));
        screens
            .chain(rest)
            .flat_map(|(mode, on)| {
                format!("\x1b[?{mode}{}", if *on { 'h' } else { 'l' }).into_bytes()
            })
            .collect()
    }
}
#[derive(Default)]
struct Ring {
    bytes: VecDeque<u8>,
    start: u64,
    base: Modes,
}
impl Ring {
    fn end(&self) -> u64 {
        self.start + self.bytes.len() as u64
    }
    fn push(&mut self, more: &[u8]) {
        self.bytes.extend(more);
        if self.bytes.len() > KEPT {
            let over = self.bytes.len() - KEPT;
            self.base.feed(self.bytes.drain(..over));
            self.start += over as u64;
        }
    }
    fn after(&self, at: u64, most: usize) -> Vec<u8> {
        let skip = usize::try_from(at.saturating_sub(self.start)).unwrap_or(usize::MAX);
        let skip = skip.min(self.bytes.len());
        let end = skip.saturating_add(most).min(self.bytes.len());
        self.bytes.range(skip..end).copied().collect()
    }
    fn whole(&self) -> Vec<u8> {
        let mut out = self.base.prelude();
        out.extend(self.bytes.iter());
        out
    }
}
struct Client {
    id: u64,
    at: u64,
    writer: bool,
    told: bool,
}
#[derive(Default)]
struct State {
    ring: Ring,
    clients: Vec<Client>,
    next: u64,
    size: (u16, u16),
    exit: Option<i64>,
    exited: Option<Instant>,
    last: u64,
    drained: bool,
    told: bool,
    ending: Option<Instant>,
    swept: bool,
}
impl State {
    fn client(&mut self, id: u64) -> Option<&mut Client> {
        self.clients.iter_mut().find(|one| one.id == id)
    }
    fn writing(&self, id: u64) -> bool {
        self.clients.iter().any(|one| one.id == id && one.writer)
    }
    fn lag(&self) -> usize {
        let end = self.ring.end();
        self.clients
            .iter()
            .filter(|one| one.writer)
            .map(|one| usize::try_from(end.saturating_sub(one.at)).unwrap_or(usize::MAX))
            .max()
            .unwrap_or(0)
    }
    fn take(&mut self, id: u64) {
        for one in &mut self.clients {
            one.writer = one.id == id;
        }
    }
    fn gone(&mut self, id: u64) {
        self.clients.retain(|one| one.id != id);
    }
}
struct Holder {
    state: Mutex<State>,
    changed: Condvar,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    input: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    shell: Option<u32>,
    token: String,
    farewell: Vec<u8>,
    file: PathBuf,
    record: Mutex<Record>,
}
impl Holder {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.held()
    }
    fn wait<'a>(&self, state: MutexGuard<'a, State>) -> MutexGuard<'a, State> {
        self.changed
            .wait(state)
            .unwrap_or_else(PoisonError::into_inner)
    }
    fn resize(&self, cols: u16, rows: u16) {
        if let Some(master) = self.master.held().as_deref() {
            let _ = master.resize(size(cols, rows));
        }
    }
    fn write(&self, bytes: &[u8]) {
        let mut input = self.input.held();
        let _ = input.write_all(bytes).and_then(|()| input.flush());
    }
}
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(1, 1000),
        cols: cols.clamp(2, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}
pub fn serve() -> i32 {
    let Some(spec) = std::env::var(SPEC)
        .ok()
        .and_then(|one| serde_json::from_str::<Spec>(&one).ok())
    else {
        return 2;
    };
    on_its_own();
    let told = hold(spec, |said| {
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{said}").and_then(|()| out.flush());
    });
    i32::from(told.is_err())
}
#[cfg(unix)]
#[allow(unsafe_code)]
fn on_its_own() {
    unsafe {
        libc::setsid();
    }
}
#[cfg(windows)]
#[allow(unsafe_code)]
fn on_its_own() {
    use windows::Win32::System::Console::SetConsoleCtrlHandler;
    let _ = unsafe { SetConsoleCtrlHandler(None, false) };
}
fn hold(spec: Spec, say: impl Fn(String)) -> Result<(), String> {
    let opened = open(&spec);
    let (holder, reader, child, listener) = match opened {
        Ok(opened) => opened,
        Err(error) => {
            say(format!("{REFUSED}{error}"));
            return Err(error);
        }
    };
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let record = Record {
        v: wire::VERSION,
        port,
        token: spec.token.clone(),
        holder: std::process::id(),
        shell: holder.shell,
        started: orden_base::clock::now(),
        label: spec.label.clone(),
    };
    *holder.record.held() = record.clone();
    if let Err(error) = write_record(&spec.file, &record) {
        say(format!("{REFUSED}{error}"));
        end_tree(holder.shell);
        return Err(error);
    }
    say(format!("{SAID}{port}"));
    let reading = Arc::clone(&holder);
    thread::spawn(move || read(&reading, reader));
    let waiting = Arc::clone(&holder);
    thread::spawn(move || wait(&waiting, child));
    let serving = Arc::clone(&holder);
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let one = Arc::clone(&serving);
            thread::spawn(move || attached(&one, stream));
        }
    });
    let mut state = holder.lock();
    loop {
        let done = match state.ending {
            Some(since) => state.swept || since.elapsed() > PARTING * 3,
            None => {
                state.told
                    || state.clients.is_empty()
                        && state.exited.is_some_and(|since| since.elapsed() > UNSEEN)
            }
        };
        if done {
            break;
        }
        state = holder
            .changed
            .wait_timeout(state, Duration::from_secs(1))
            .map_or_else(|poisoned| poisoned.into_inner().0, |(state, _)| state);
    }
    drop(state);
    thread::sleep(Duration::from_millis(200));
    forget_record(&spec.file, &spec.token);
    Ok(())
}
type Opened = (
    Arc<Holder>,
    Box<dyn Read + Send>,
    Box<dyn Child + Send + Sync>,
    TcpListener,
);
fn open(spec: &Spec) -> Result<Opened, String> {
    let pair = native_pty_system()
        .openpty(size(spec.cols, spec.rows))
        .map_err(|error| format!("could not open a terminal: {error}"))?;
    let mut command = CommandBuilder::new(&spec.program);
    command.args(&spec.args);
    command.env_remove(SPEC);
    if let Some(folder) = &spec.folder {
        command.cwd(folder);
    }
    for (name, value) in &spec.env {
        command.env(name, value);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("could not start {}: {error}", spec.program.display()))?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let input = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| error.to_string())?;
    let holder = Arc::new(Holder {
        state: Mutex::new(State {
            size: (spec.cols, spec.rows),
            ..State::default()
        }),
        changed: Condvar::new(),
        killer: Mutex::new(child.clone_killer()),
        shell: child.process_id(),
        master: Mutex::new(Some(pair.master)),
        input: Mutex::new(input),
        token: spec.token.clone(),
        farewell: spec.farewell.clone(),
        file: spec.file.clone(),
        record: Mutex::new(Record {
            v: wire::VERSION,
            port: 0,
            token: spec.token.clone(),
            holder: std::process::id(),
            shell: None,
            started: 0,
            label: spec.label.clone(),
        }),
    });
    Ok((holder, reader, child, listener))
}
fn read(holder: &Holder, mut reader: Box<dyn Read + Send>) {
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        {
            let mut state = holder.lock();
            while state.ending.is_none() && state.lag() > BEHIND {
                state = holder.wait(state);
            }
        }
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let mut state = holder.lock();
                state.ring.push(&buffer[..count]);
                state.last = orden_base::clock::now();
                drop(state);
                holder.changed.notify_all();
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
    holder.lock().drained = true;
    holder.changed.notify_all();
}
fn wait(holder: &Holder, mut child: Box<dyn Child + Send + Sync>) {
    let code = child
        .wait()
        .map_or(-1, |status| i64::from(status.exit_code()));
    let until = Instant::now() + LINGER;
    let mut state = holder.lock();
    state.exit = Some(code);
    state.exited = Some(Instant::now());
    holder.changed.notify_all();
    while !state.drained {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        state = holder
            .changed
            .wait_timeout(state, left)
            .map_or_else(|poisoned| poisoned.into_inner().0, |(state, _)| state);
    }
    state.drained = true;
    drop(state);
    holder.changed.notify_all();
}
fn end(holder: &Arc<Holder>) {
    {
        let mut state = holder.lock();
        if state.ending.is_some() {
            return;
        }
        state.ending = Some(Instant::now());
    }
    holder.changed.notify_all();
    let holder = Arc::clone(holder);
    thread::spawn(move || {
        let until = Instant::now() + PARTING;
        while !holder.farewell.is_empty() && Instant::now() < until {
            holder.write(&holder.farewell);
            let again = Instant::now() + SAID_AGAIN;
            let mut state = holder.lock();
            while state.exit.is_none() && Instant::now() < again {
                let left = again.saturating_duration_since(Instant::now());
                state = holder
                    .changed
                    .wait_timeout(state, left)
                    .map_or_else(|poisoned| poisoned.into_inner().0, |(state, _)| state);
            }
            if state.exit.is_some() {
                break;
            }
        }
        end_tree(holder.shell);
        let _ = holder.killer.held().kill();
        let master = holder.master.held().take();
        drop(master);
        holder.lock().swept = true;
        holder.changed.notify_all();
    });
}
fn attached(holder: &Arc<Holder>, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(GREETED_WITHIN));
    let Ok((wire::HELLO, hello)) = wire::heard(&mut stream) else {
        return;
    };
    let Some((&flags, token)) = hello.split_first() else {
        return;
    };
    if !wire::same(token, holder.token.as_bytes()) {
        return;
    }
    let _ = stream.set_read_timeout(None);
    let _ = stream.set_nodelay(true);
    if flags & wire::ASKING != 0 {
        asked(holder, stream);
        return;
    }
    let Ok(out) = stream.try_clone() else {
        return;
    };
    let (id, hi, screen, nudge) = {
        let mut state = holder.lock();
        let id = state.next;
        state.next += 1;
        let writer = flags & wire::TAKING != 0 || !state.clients.iter().any(|one| one.writer);
        if writer {
            for one in &mut state.clients {
                one.writer = false;
            }
        }
        let at = state.ring.end();
        state.clients.push(Client {
            id,
            at,
            writer,
            told: writer,
        });
        let hi = wire::Hi {
            v: wire::VERSION,
            holder: std::process::id(),
            shell: holder.shell,
            cols: state.size.0,
            rows: state.size.1,
            writer,
            last: state.last,
            clients: u32::try_from(state.clients.len()).unwrap_or(u32::MAX),
            exit: state.exit,
        };
        let nudge = writer && state.ring.start > 0 && state.exit.is_none();
        (id, hi, state.ring.whole(), nudge.then_some(state.size))
    };
    holder.changed.notify_all();
    let sending = Arc::clone(holder);
    thread::spawn(move || send(&sending, id, out, &hi, &screen, nudge));
    loop {
        match wire::heard(&mut stream) {
            Ok((wire::INPUT, bytes)) => {
                let writes = {
                    let state = holder.lock();
                    state.writing(id) && state.exit.is_none() && state.ending.is_none()
                };
                if writes {
                    holder.write(&bytes);
                }
            }
            Ok((wire::SIZE, body)) => {
                let Some((cols, rows)) = wire::size_of(&body) else {
                    continue;
                };
                let resizes = {
                    let mut state = holder.lock();
                    let writes = state.writing(id);
                    if writes {
                        state.size = (cols, rows);
                    }
                    writes
                };
                if resizes {
                    holder.resize(cols, rows);
                }
            }
            Ok((wire::TAKE, _)) => {
                holder.lock().take(id);
                holder.changed.notify_all();
            }
            Ok((wire::END, _)) => end(holder),
            Ok((wire::NAME, body)) => renamed(holder, &body),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    holder.lock().gone(id);
    holder.changed.notify_all();
}
fn asked(holder: &Arc<Holder>, mut stream: TcpStream) {
    let hi = {
        let state = holder.lock();
        wire::Hi {
            v: wire::VERSION,
            holder: std::process::id(),
            shell: holder.shell,
            cols: state.size.0,
            rows: state.size.1,
            writer: false,
            last: state.last,
            clients: u32::try_from(state.clients.len()).unwrap_or(u32::MAX),
            exit: state.exit,
        }
    };
    let told = serde_json::to_vec(&hi)
        .map_err(std::io::Error::other)
        .and_then(|hi| wire::send(&mut stream, wire::HI, &hi));
    if told.is_err() {
        return;
    }
    while let Ok((kind, body)) = wire::heard(&mut stream) {
        match kind {
            wire::NAME => renamed(holder, &body),
            wire::END => end(holder),
            _ => {}
        }
    }
}
fn renamed(holder: &Holder, body: &[u8]) {
    let name = String::from_utf8_lossy(body).trim().to_owned();
    let mut record = holder.record.held();
    record.label.name = (!name.is_empty()).then(|| name.chars().take(200).collect());
    let _ = write_record(&holder.file, &record);
}
enum Next {
    Bytes(Vec<u8>),
    Writer(bool),
    Exit(i64),
}
fn send(
    holder: &Holder,
    id: u64,
    mut out: TcpStream,
    hi: &wire::Hi,
    screen: &[u8],
    nudge: Option<(u16, u16)>,
) {
    let greeted = serde_json::to_vec(hi)
        .map_err(std::io::Error::other)
        .and_then(|hi| wire::send(&mut out, wire::HI, &hi))
        .and_then(|()| wire::send(&mut out, wire::SCREEN, screen));
    if greeted.is_err() {
        holder.lock().gone(id);
        holder.changed.notify_all();
        return;
    }
    if let Some((cols, rows)) = nudge {
        holder.resize(cols, rows.saturating_sub(1).max(1));
        thread::sleep(Duration::from_millis(50));
        holder.resize(cols, rows);
    }
    loop {
        let next = {
            let mut state = holder.lock();
            loop {
                let start = state.ring.start;
                let end = state.ring.end();
                let exit = state.exit.filter(|_| state.drained);
                let Some(client) = state.client(id) else {
                    return;
                };
                if client.at < start {
                    state.gone(id);
                    holder.changed.notify_all();
                    return;
                }
                if client.writer != client.told {
                    client.told = client.writer;
                    break Next::Writer(client.writer);
                }
                if client.at < end {
                    let at = client.at;
                    let part = state.ring.after(at, PART);
                    if let Some(client) = state.client(id) {
                        client.at = at + part.len() as u64;
                    }
                    break Next::Bytes(part);
                }
                if let Some(code) = exit {
                    break Next::Exit(code);
                }
                state = holder.wait(state);
            }
        };
        holder.changed.notify_all();
        let sent = match &next {
            Next::Bytes(bytes) => wire::send(&mut out, wire::OUT, bytes),
            Next::Writer(writer) => wire::send(&mut out, wire::WRITER, &[u8::from(*writer)]),
            Next::Exit(code) => wire::send(&mut out, wire::EXIT, &code.to_le_bytes()),
        };
        if sent.is_err() {
            holder.lock().gone(id);
            holder.changed.notify_all();
            return;
        }
        if matches!(next, Next::Exit(_)) {
            holder.lock().told = true;
            holder.changed.notify_all();
            return;
        }
    }
}
fn write_record(file: &Path, record: &Record) -> Result<(), String> {
    let parent = file
        .parent()
        .ok_or_else(|| "a session has a folder".to_owned())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
    let part = file.with_extension(format!("{}.part", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options
        .open(&part)
        .and_then(|mut one| one.write_all(&bytes))
        .and_then(|()| std::fs::rename(&part, file))
        .map_err(|error| {
            let _ = std::fs::remove_file(&part);
            error.to_string()
        })
}
pub fn read_record(file: &Path) -> Option<Record> {
    let bytes = std::fs::read(file)
        .ok()
        .filter(|bytes| bytes.len() <= 4096)?;
    serde_json::from_slice(&bytes).ok()
}
pub fn forget_record(file: &Path, token: &str) {
    if read_record(file).is_some_and(|record| record.token == token) {
        let _ = std::fs::remove_file(file);
    }
}
pub fn start(how: &Starter, spec: &Spec) -> Result<u16, String> {
    let told = serde_json::to_string(spec).map_err(|error| error.to_string())?;
    let mut command = Command::new(&how.program);
    command
        .args(&how.args)
        .env(SPEC, told)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = spawned(&mut command).map_err(|error| error.to_string())?;
    let out = child
        .stdout
        .take()
        .ok_or_else(|| "the session said nothing".to_owned())?;
    thread::spawn(move || {
        let _ = child.wait();
    });
    let (tell, heard) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            if let Some(port) = line.strip_prefix(SAID) {
                let _ = tell.send(
                    port.trim()
                        .parse::<u16>()
                        .map_err(|error| error.to_string()),
                );
                return;
            }
            if let Some(why) = line.strip_prefix(REFUSED) {
                let _ = tell.send(Err(why.to_owned()));
                return;
            }
        }
        let _ = tell.send(Err("the session did not start".to_owned()));
    });
    heard
        .recv_timeout(STARTED_WITHIN)
        .map_err(|_| "the session did not start in time".to_owned())?
}
#[cfg(windows)]
fn spawned(command: &mut Command) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
    command.spawn().or_else(|_| {
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        command.spawn()
    })
}
#[cfg(not(windows))]
fn spawned(command: &mut Command) -> std::io::Result<std::process::Child> {
    command.spawn()
}
pub fn token() -> Result<String, String> {
    use std::fmt::Write as _;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    Ok(random.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    }))
}
#[cfg(unix)]
#[allow(unsafe_code)]
fn signal(pid: i32, signal: i32) {
    unsafe {
        libc::kill(pid, signal);
    }
}
#[cfg(unix)]
fn end_tree(shell: Option<u32>) {
    let Some(session) = shell
        .and_then(|one| i32::try_from(one).ok())
        .filter(|one| *one > 1)
    else {
        return;
    };
    signal(-session, libc::SIGHUP);
    signal(session, libc::SIGHUP);
    let until = Instant::now() + Duration::from_millis(300);
    while Instant::now() < until && !members(session).is_empty() {
        thread::sleep(Duration::from_millis(20));
    }
    let until = Instant::now() + PARTING;
    loop {
        let left = members(session);
        if left.is_empty() || Instant::now() > until {
            break;
        }
        for pid in left {
            signal(pid, libc::SIGKILL);
        }
        thread::sleep(Duration::from_millis(20));
    }
}
#[cfg(windows)]
fn end_tree(_shell: Option<u32>) {}
#[cfg(target_os = "linux")]
pub fn members(session: i32) -> Vec<i32> {
    let Ok(listed) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    listed
        .filter_map(|one| one.ok()?.file_name().to_str()?.parse::<i32>().ok())
        .filter(|pid| {
            orden_base::stat::read(pid).is_some_and(|stat| !stat.gone() && stat.session == session)
        })
        .collect()
}
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
pub fn members(session: i32) -> Vec<i32> {
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    let Ok(room) = usize::try_from(count) else {
        return Vec::new();
    };
    let mut pids: Vec<libc::c_int> = vec![0; room + 64];
    let bytes = libc::c_int::try_from(pids.len() * std::mem::size_of::<libc::c_int>())
        .unwrap_or(libc::c_int::MAX);
    let found = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    pids.truncate(usize::try_from(found).unwrap_or(0).min(pids.len()));
    pids.into_iter()
        .filter(|pid| *pid > 0 && unsafe { libc::getsid(*pid) } == session && !zombie(*pid))
        .collect()
}
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn zombie(pid: i32) -> bool {
    const ZOMBIE: u32 = 5;
    let Ok(size) = libc::c_int::try_from(std::mem::size_of::<libc::proc_bsdinfo>()) else {
        return true;
    };
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    written != size || unsafe { info.assume_init() }.pbi_status == ZOMBIE
}
#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
pub fn members(_session: i32) -> Vec<i32> {
    Vec::new()
}
#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    #[ignore = "the holder the other tests start as a process of its own"]
    fn holder() {
        if std::env::var_os(SPEC).is_some() {
            std::process::exit(serve());
        }
    }
    pub fn starter() -> Starter {
        Starter {
            program: std::env::current_exe().expect("the test binary"),
            args: [
                "--exact",
                "terminal::hold::tests::holder",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
                "-q",
            ]
            .map(str::to_owned)
            .to_vec(),
        }
    }
    fn modes(bytes: &[u8]) -> Vec<u8> {
        let mut modes = Modes::default();
        modes.feed(bytes.iter().copied());
        modes.prelude()
    }
    #[test]
    fn the_modes_a_dropped_part_set_are_set_again_first() {
        assert_eq!(modes(b"plain text\r\n"), b"");
        assert_eq!(
            modes(b"\x1b[?2004h\x1b[?1049h\x1b[2J\x1b[?1;1000h"),
            b"\x1b[?1049h\x1b[?1h\x1b[?1000h\x1b[?2004h".to_vec()
        );
        assert_eq!(modes(b"\x1b[?1049h\x1b[?1049l"), b"\x1b[?1049l".to_vec());
        assert_eq!(modes(b"\x1b[?1049h\x1bc"), b"");
        assert_eq!(modes(b"\x1b[?9999h\x1b[1049h"), b"");
    }
    #[test]
    fn a_mode_split_between_two_reads_is_still_seen() {
        let mut modes = Modes::default();
        modes.feed(b"\x1b[?10".iter().copied());
        modes.feed(b"49h".iter().copied());
        assert_eq!(modes.prelude(), b"\x1b[?1049h".to_vec());
    }
    #[test]
    fn the_ring_keeps_its_end_and_what_it_dropped_shapes_the_screen() {
        let mut ring = Ring::default();
        ring.push(b"\x1b[?1049h");
        ring.push(&vec![b'x'; KEPT]);
        assert_eq!(ring.bytes.len(), KEPT);
        assert_eq!(ring.end(), KEPT as u64 + 8);
        let whole = ring.whole();
        assert!(whole.starts_with(b"\x1b[?1049hxxx"));
        assert_eq!(ring.after(ring.end() - 3, 10), b"xxx".to_vec());
    }
}
