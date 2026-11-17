use std::io::Write;
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use super::hold::{self, Starter};
use super::process;
use super::shells::Launch;
use super::wire;

const FRAME: Duration = Duration::from_millis(16);

const MOST_UNSEEN: usize = 1 << 20;

const REACHED_WITHIN: Duration = Duration::from_secs(2);

const GREETED_WITHIN: Duration = Duration::from_secs(10);

#[derive(Debug, PartialEq, Eq)]
pub enum Out {
    Screen(Vec<u8>, u16, u16),
    Bytes(Vec<u8>),
    Writer(bool),
    Exit(i64),
}

pub type Sink = Box<dyn Fn(Out) + Send + Sync>;

pub struct Place {
    pub folder: PathBuf,
    pub starter: Starter,
}

impl Place {
    fn file(&self, key: &str) -> PathBuf {
        self.folder.join(format!("{key}.json"))
    }
}

pub struct Session {
    input: Sender<Vec<u8>>,
    socket: TcpStream,
    shell: Option<u32>,
    fresh: bool,
    stream: Arc<Stream>,
}

pub struct Started {
    reader: TcpStream,
    writer: TcpStream,
    queue: Receiver<Vec<u8>>,
    stream: Arc<Stream>,
}

#[derive(Default)]
struct Stream {
    flow: Mutex<Flow>,
    changed: Condvar,
}

#[derive(Default)]
struct Flow {
    screen: Option<(Vec<u8>, u16, u16)>,
    waiting: Vec<u8>,
    writer: Option<bool>,
    unseen: usize,
    drained: bool,
    exit: Option<i64>,
    ended: bool,
}

impl Stream {
    fn lock(&self) -> MutexGuard<'_, Flow> {
        self.flow
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn wait<'a>(&self, flow: MutexGuard<'a, Flow>) -> MutexGuard<'a, Flow> {
        self.changed
            .wait(flow)
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

struct Greeted {
    socket: TcpStream,
    hi: wire::Hi,
    screen: Vec<u8>,
}

fn greet(port: u16, token: &str) -> Result<Greeted, String> {
    let mut socket = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        REACHED_WITHIN,
    )
    .map_err(|error| error.to_string())?;
    let _ = socket.set_nodelay(true);
    socket
        .set_read_timeout(Some(GREETED_WITHIN))
        .map_err(|error| error.to_string())?;
    let mut hello = vec![1u8];
    hello.extend_from_slice(token.as_bytes());
    wire::send(&mut socket, wire::HELLO, &hello).map_err(|error| error.to_string())?;
    let hi = match wire::heard(&mut socket) {
        Ok((wire::HI, body)) => {
            serde_json::from_slice::<wire::Hi>(&body).map_err(|error| error.to_string())?
        }
        _ => return Err("the session did not answer".to_owned()),
    };
    let Ok((wire::SCREEN, screen)) = wire::heard(&mut socket) else {
        return Err("the session did not answer".to_owned());
    };
    socket
        .set_read_timeout(None)
        .map_err(|error| error.to_string())?;
    Ok(Greeted { socket, hi, screen })
}

fn found(file: &Path) -> Option<Greeted> {
    let record = hold::read_record(file)?;
    let greeted = greet(record.port, &record.token).ok();
    if greeted.is_none() {
        hold::forget_record(file, &record.token);
    }
    greeted
}

pub fn held(place: &Place, key: &str) -> bool {
    hold::read_record(&place.file(key)).is_some_and(|record| {
        TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, record.port)),
            REACHED_WITHIN,
        )
        .is_ok()
    })
}

pub struct Fresh {
    pub launch: Launch,
    pub farewell: Vec<u8>,
}

impl Session {
    pub fn open(
        place: &Place,
        key: &str,
        cols: u16,
        rows: u16,
        fresh: impl FnOnce() -> Result<Fresh, String>,
    ) -> Result<(Self, Started), String> {
        let file = place.file(key);
        let (greeted, fresh) = if let Some(greeted) = found(&file) {
            (greeted, false)
        } else {
            let Fresh { launch, farewell } = fresh()?;
            let token = hold::token()?;
            let spec = hold::Spec {
                program: launch.program,
                args: launch.args,
                folder: launch.folder,
                env: launch.env,
                cols,
                rows,
                file,
                token: token.clone(),
                farewell,
            };
            let port = hold::start(&place.starter, &spec)?;
            (greet(port, &token)?, true)
        };

        let Greeted { socket, hi, screen } = greeted;
        let reader = socket.try_clone().map_err(|error| error.to_string())?;
        let writer = socket.try_clone().map_err(|error| error.to_string())?;
        let (input, queue) = mpsc::channel();
        let stream = Arc::new(Stream::default());
        if !screen.is_empty() {
            stream.lock().screen = Some((screen, hi.cols, hi.rows));
        }
        let session = Self {
            input,
            socket,
            shell: hi.shell,
            fresh,
            stream: Arc::clone(&stream),
        };
        let started = Started {
            reader,
            writer,
            queue,
            stream,
        };
        Ok((session, started))
    }

    pub fn pid(&self) -> Option<u32> {
        self.shell
    }

    pub fn fresh(&self) -> bool {
        self.fresh
    }

    fn same_stream(&self, stream: &Arc<Stream>) -> bool {
        Arc::ptr_eq(&self.stream, stream)
    }

    pub fn write(&self, bytes: Vec<u8>) {
        let _ = self.input.send(wire::frame(wire::INPUT, &bytes));
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self
            .input
            .send(wire::frame(wire::SIZE, &wire::size(cols, rows)));
    }

    pub fn take(&self) {
        let _ = self.input.send(wire::frame(wire::TAKE, &[]));
    }

    pub fn seen(&self, bytes: usize) {
        let mut flow = self.stream.lock();
        flow.unseen = flow.unseen.saturating_sub(bytes);
        drop(flow);
        self.stream.changed.notify_all();
    }

    pub fn busy(&self) -> bool {
        process::busy(self.shell)
    }

    pub fn program(&self) -> Option<String> {
        process::program(self.shell)
    }

    pub fn ssh(&self) -> Option<super::remote::Destination> {
        let (program, args) = process::command(self.shell)?;
        super::remote::ssh_destination(&program, &args)
    }

    pub fn folder(&self) -> Option<String> {
        process::folder(self.shell)
    }

    pub fn shell(&self) -> Option<u32> {
        self.shell
    }

    fn quiet(&self) {
        self.stream.lock().ended = true;
        self.stream.changed.notify_all();
    }

    pub fn end(&self) {
        self.quiet();
        let _ = self.input.send(wire::frame(wire::END, &[]));
    }

    pub fn detach(&self) {
        self.quiet();
        let _ = self.socket.shutdown(Shutdown::Both);
    }
}

impl Started {
    pub fn run(self, sink: Sink, ended: impl FnOnce(&dyn Fn(&Session) -> bool) + Send + 'static) {
        let Self {
            reader,
            writer,
            queue,
            stream,
        } = self;

        let sending = Arc::clone(&stream);
        thread::spawn(move || send(&sending, &sink));

        thread::spawn(move || write(writer, &queue));

        thread::spawn(move || {
            read(reader, &stream);
            ended(&|session: &Session| session.same_stream(&stream));
        });
    }
}

fn read(mut reader: TcpStream, stream: &Stream) {
    loop {
        {
            let mut flow = stream.lock();
            while !flow.ended && flow.unseen + flow.waiting.len() > MOST_UNSEEN {
                flow = stream.wait(flow);
            }
            if flow.ended {
                break;
            }
        }

        let heard = wire::heard(&mut reader);
        let mut flow = stream.lock();
        match heard {
            Ok((wire::OUT, bytes)) => {
                if !flow.ended {
                    flow.waiting.extend_from_slice(&bytes);
                }
            }
            Ok((wire::WRITER, body)) => flow.writer = Some(body.first() == Some(&1)),
            Ok((wire::EXIT, body)) => {
                let code = <[u8; 8]>::try_from(body.as_slice()).map_or(-1, i64::from_le_bytes);
                flow.exit = Some(code);
                break;
            }
            Ok(_) => {}
            Err(_) => {
                flow.exit.get_or_insert(-1);
                break;
            }
        }
        drop(flow);
        stream.changed.notify_all();
    }

    stream.lock().drained = true;
    stream.changed.notify_all();
}

fn send(stream: &Stream, sink: &Sink) {
    let mut last: Option<Instant> = None;

    loop {
        let mut flow = stream.lock();
        while !flow.ended
            && flow.screen.is_none()
            && flow.writer.is_none()
            && flow.waiting.is_empty()
            && !(flow.drained && flow.exit.is_some())
        {
            flow = stream.wait(flow);
        }
        if flow.ended {
            return;
        }

        if let Some((screen, cols, rows)) = flow.screen.take() {
            drop(flow);
            sink(Out::Screen(screen, cols, rows));
            last = Some(Instant::now());
            continue;
        }

        if let Some(writer) = flow.writer.take() {
            drop(flow);
            sink(Out::Writer(writer));
            continue;
        }

        if flow.waiting.is_empty() {
            let code = flow.exit.unwrap_or(-1);
            drop(flow);
            sink(Out::Exit(code));
            return;
        }

        if let Some(sent) = last {
            let since = sent.elapsed();
            if since < FRAME {
                drop(flow);
                thread::sleep(FRAME.saturating_sub(since));
                flow = stream.lock();
                if flow.ended {
                    return;
                }
            }
        }

        let bytes = std::mem::take(&mut flow.waiting);
        flow.unseen += bytes.len();
        drop(flow);

        sink(Out::Bytes(bytes));
        last = Some(Instant::now());
    }
}

fn write(mut writer: TcpStream, queue: &Receiver<Vec<u8>>) {
    for frame in queue {
        if writer
            .write_all(&frame)
            .and_then(|()| writer.flush())
            .is_err()
        {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Held = Arc<Mutex<Option<Session>>>;

    fn shell() -> Launch {
        let (program, args): (PathBuf, Vec<String>) = if cfg!(windows) {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
            (
                PathBuf::from(root).join(r"System32\cmd.exe"),
                vec!["/q".to_owned()],
            )
        } else {
            (PathBuf::from("/bin/sh"), Vec::new())
        };

        Launch {
            program,
            args,
            folder: Some(std::env::temp_dir()),
            env: vec![("TERM".to_owned(), "xterm-256color".to_owned())],
        }
    }

    const SAYS_OK: &str = if cfg!(windows) {
        "echo orden-%COMSPEC:~0,0%ok"
    } else {
        r#"echo orden-""ok"#
    };

    const ENTER: &str = if cfg!(windows) { "\r" } else { "\n" };

    fn place() -> (tempfile::TempDir, Place) {
        let folder = tempfile::tempdir().expect("a folder");
        let place = Place {
            folder: folder.path().join("held"),
            starter: hold::tests::starter(),
        };
        (folder, place)
    }

    fn opened(place: &Place, key: &str, cols: u16, rows: u16) -> (Held, Receiver<Out>) {
        let (session, parts) = Session::open(place, key, cols, rows, || {
            Ok(Fresh {
                launch: shell(),
                farewell: Vec::new(),
            })
        })
        .expect("a shell");
        let held = Arc::new(Mutex::new(Some(session)));
        let (tell, heard) = mpsc::channel();
        let tell = Mutex::new(tell);

        let keeping = Arc::clone(&held);
        parts.run(
            Box::new(move |out| {
                let _ = tell.lock().expect("the channel").send(out);
            }),
            move |mine| {
                let mut slot = keeping.lock().expect("the session");
                if slot.as_ref().is_some_and(mine) {
                    slot.take();
                }
            },
        );

        (held, heard)
    }

    fn started(cols: u16, rows: u16) -> (Held, Receiver<Out>, tempfile::TempDir) {
        let (folder, place) = place();
        let (held, heard) = opened(&place, "t1", cols, rows);
        (held, heard, folder)
    }

    fn typed(held: &Held, bytes: &str) {
        if let Some(session) = held.lock().expect("the session").as_ref() {
            session.write(bytes.as_bytes().to_vec());
        }
    }

    fn line(held: &Held, words: &str) {
        typed(held, &format!("{words}{ENTER}"));
    }

    fn printed_until(held: &Held, heard: &Receiver<Out>, wanted: &str) -> (String, Option<i64>) {
        let until = Instant::now() + Duration::from_secs(20);
        let mut bytes = Vec::new();

        while let Ok(out) = heard.recv_timeout(until.saturating_duration_since(Instant::now())) {
            match out {
                Out::Bytes(more) | Out::Screen(more, _, _) => {
                    if String::from_utf8_lossy(&more).contains("\u{1b}[6n") {
                        typed(held, "\u{1b}[1;1R");
                    }
                    bytes.extend(more);
                    if String::from_utf8_lossy(&bytes).contains(wanted) {
                        break;
                    }
                }
                Out::Writer(_) => {}
                Out::Exit(code) => {
                    return (String::from_utf8_lossy(&bytes).into_owned(), Some(code));
                }
            }
        }

        (String::from_utf8_lossy(&bytes).into_owned(), None)
    }

    fn taken(held: &Held) -> Session {
        held.lock().expect("the session").take().expect("running")
    }

    #[test]
    fn a_shell_answers_resizes_and_exits() {
        let (held, heard, _folder) = started(80, 24);

        line(&held, SAYS_OK);
        let (said, _) = printed_until(&held, &heard, "orden-ok");
        assert!(said.contains("orden-ok"), "the shell printed: {said:?}");

        held.lock()
            .expect("the session")
            .as_ref()
            .expect("still running")
            .resize(120, 40);

        line(&held, "exit 3");
        let (_, code) = printed_until(&held, &heard, "\u{0}never");
        assert_eq!(code, Some(3));

        let until = Instant::now() + Duration::from_secs(5);
        while held.lock().expect("the session").is_some() && Instant::now() < until {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            held.lock().expect("the session").is_none(),
            "the session outlived its shell"
        );
    }

    #[test]
    fn a_session_let_go_of_is_found_again_as_it_was() {
        let (_folder, place) = place();
        let (held, heard) = opened(&place, "kept", 80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");
        let first = taken(&held);
        let pid = first.pid().expect("a pid");
        assert!(first.fresh());
        first.detach();
        drop(first);
        thread::sleep(Duration::from_millis(300));
        assert!(alive(pid), "letting go ended the shell");
        assert!(super::held(&place, "kept"));

        let (again, heard) = opened(&place, "kept", 100, 30);
        let session = taken(&again);
        assert!(!session.fresh(), "a second shell was started");
        assert_eq!(session.pid(), Some(pid));
        *again.lock().expect("the session") = Some(session);
        match heard.recv_timeout(Duration::from_secs(10)) {
            Ok(Out::Screen(screen, cols, rows)) => {
                assert!(String::from_utf8_lossy(&screen).contains("orden-ok"));
                assert_eq!((cols, rows), (80, 24));
            }
            other => panic!("no screen came back: {other:?}"),
        }
        line(&again, SAYS_OK);
        let (said, _) = printed_until(&again, &heard, "orden-ok");
        assert!(said.contains("orden-ok"), "the shell printed: {said:?}");

        let session = taken(&again);
        session.end();
        let until = Instant::now() + Duration::from_secs(10);
        while (alive(pid) || super::held(&place, "kept")) && Instant::now() < until {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(pid), "the shell {pid} outlived its end");
        assert!(
            !super::held(&place, "kept"),
            "the ended session is still listed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_fullscreen_program_comes_back_on_its_own_screen() {
        let (_folder, place) = place();
        let (held, heard) = opened(&place, "full", 80, 24);
        line(&held, r"printf '\033[?1049h\033[?1000hfull-''screen'");
        let _ = printed_until(&held, &heard, "full-screen");
        let first = taken(&held);
        first.detach();
        drop(first);

        let (again, heard) = opened(&place, "full", 80, 24);
        let screen = match heard.recv_timeout(Duration::from_secs(10)) {
            Ok(Out::Screen(screen, _, _)) => String::from_utf8_lossy(&screen).into_owned(),
            other => panic!("no screen came back: {other:?}"),
        };
        let switched = screen.rfind("\u{1b}[?1049h").expect("the second screen");
        assert!(screen[switched..].contains("full-screen"));
        taken(&again).end();
    }

    #[cfg(unix)]
    #[test]
    fn an_ended_session_leaves_no_process_behind() {
        let (held, heard, _folder) = started(80, 24);
        line(&held, "sleep 300 & (sleep 301 &) ; echo orden-\"\"started");
        let _ = printed_until(&held, &heard, "orden-started");
        let session = taken(&held);
        let pid = i32::try_from(session.pid().expect("a pid")).expect("a pid");
        let until = Instant::now() + Duration::from_secs(5);
        while hold::members(pid).len() < 3 && Instant::now() < until {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            hold::members(pid).len() >= 3,
            "the shell and its two sleeps: {:?}",
            hold::members(pid)
        );

        session.end();
        let until = Instant::now() + Duration::from_secs(10);
        while !hold::members(pid).is_empty() && Instant::now() < until {
            thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(hold::members(pid), Vec::<i32>::new(), "left running");
    }

    #[test]
    fn a_session_ended_by_the_window_kills_its_shell() {
        let (held, heard, _folder) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");

        let session = taken(&held);
        let pid = session.pid().expect("a pid");
        session.end();

        let quiet_until = Instant::now() + Duration::from_secs(2);
        while let Ok(out) =
            heard.recv_timeout(quiet_until.saturating_duration_since(Instant::now()))
        {
            assert!(
                !matches!(out, Out::Exit(_)),
                "an ended session said its shell exited"
            );
        }

        let until = Instant::now() + Duration::from_secs(10);
        while alive(pid) && Instant::now() < until {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(pid), "the shell {pid} outlived its tab");
    }

    #[test]
    fn ctrl_c_interrupts_what_is_running() {
        let (held, heard, _folder) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");

        let long = if cfg!(windows) {
            "ping -n 30 127.0.0.1"
        } else {
            "sleep 30"
        };
        line(&held, long);
        thread::sleep(Duration::from_millis(1500));
        let busy = |held: &Held| {
            held.lock()
                .expect("the session")
                .as_ref()
                .is_some_and(Session::busy)
        };
        assert!(busy(&held), "{long} was not running");

        typed(&held, "\u{3}");
        let until = Instant::now() + Duration::from_secs(10);
        while busy(&held) && Instant::now() < until {
            let _ = heard.recv_timeout(Duration::from_millis(100));
        }
        assert!(!busy(&held), "Ctrl+C did not stop {long}");

        taken(&held).end();
    }

    #[test]
    fn a_program_that_ends_leaves_the_shell_idle() {
        let (held, heard, _folder) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");

        let short = if cfg!(windows) {
            "ping -n 4 127.0.0.1 > NUL"
        } else {
            "sleep 3"
        };
        line(&held, short);
        let busy = |held: &Held| {
            held.lock()
                .expect("the session")
                .as_ref()
                .is_some_and(Session::busy)
        };

        let until = Instant::now() + Duration::from_secs(3);
        while !busy(&held) && Instant::now() < until {
            let _ = heard.recv_timeout(Duration::from_millis(50));
        }
        assert!(busy(&held), "{short} was not running");

        let until = Instant::now() + Duration::from_secs(15);
        while busy(&held) && Instant::now() < until {
            let _ = heard.recv_timeout(Duration::from_millis(100));
        }
        assert!(!busy(&held), "the shell stayed busy after {short} ended");

        taken(&held).end();
    }

    #[test]
    fn a_shell_at_its_prompt_is_not_busy() {
        let (held, heard, _folder) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");

        let session = taken(&held);
        assert!(!session.busy());
        session.end();
    }

    #[cfg(windows)]
    fn alive(pid: u32) -> bool {
        let listed = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed.contains(&format!(" {pid} "))
    }

    #[cfg(unix)]
    fn alive(pid: u32) -> bool {
        let state = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
            .unwrap_or_default();
        !state.is_empty() && !state.starts_with('Z')
    }

    #[test]
    fn a_session_is_shared_between_threads_and_let_go_of_without_waiting() {
        fn shared<T: Send + Sync>() {}
        shared::<Session>();

        let (held, _heard, _folder) = started(80, 24);
        let session = taken(&held);
        session.resize(100, 30);
        session.resize(100, 30);
        let began = Instant::now();
        session.end();
        drop(session);
        assert!(began.elapsed() < Duration::from_secs(1));
    }
}
