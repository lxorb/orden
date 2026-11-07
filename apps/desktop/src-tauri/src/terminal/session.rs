use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::process;
use super::shells::Launch;

const FRAME: Duration = Duration::from_millis(16);

const MOST_UNSEEN: usize = 1 << 20;

const LINGER: Duration = Duration::from_millis(500);

#[derive(Debug, PartialEq, Eq)]
pub enum Out {
    Bytes(Vec<u8>),
    Exit(i64),
}

pub type Sink = Box<dyn Fn(Out) + Send + Sync>;

pub struct Session {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    wanted: Mutex<Option<PtySize>>,
    input: Sender<Vec<u8>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    stream: Arc<Stream>,
}

pub struct Started {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
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
    waiting: Vec<u8>,
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

impl Session {
    pub fn open(launch: &Launch, cols: u16, rows: u16) -> Result<(Self, Started), String> {
        #[cfg(windows)]
        interrupts_reach_shells();

        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|error| format!("could not open a terminal: {error}"))?;

        let mut command = CommandBuilder::new(&launch.program);
        command.args(&launch.args);
        if let Some(folder) = &launch.folder {
            command.cwd(folder);
        }
        for (name, value) in &launch.env {
            command.env(name, value);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("could not start {}: {error}", launch.program.display()))?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| error.to_string())?;
        let (input, queue) = mpsc::channel();
        let stream = Arc::new(Stream::default());

        let session = Self {
            master: Mutex::new(Some(pair.master)),
            wanted: Mutex::new(None),
            input,
            killer: Mutex::new(child.clone_killer()),
            pid: child.process_id(),
            stream: Arc::clone(&stream),
        };
        let started = Started {
            reader,
            writer,
            child,
            queue,
            stream,
        };

        Ok((session, started))
    }

    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    fn same_stream(&self, stream: &Arc<Stream>) -> bool {
        Arc::ptr_eq(&self.stream, stream)
    }

    pub fn write(&self, bytes: Vec<u8>) {
        let _ = self.input.send(bytes);
    }

    fn master(&self) -> MutexGuard<'_, Option<Box<dyn MasterPty + Send>>> {
        self.master.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        *self.wanted.lock().unwrap_or_else(PoisonError::into_inner) = Some(size(cols, rows));
        let master = self.master();
        let wanted = self
            .wanted
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        match (master.as_deref(), wanted) {
            (Some(master), Some(wanted)) => {
                master.resize(wanted).map_err(|error| error.to_string())
            }
            _ => Ok(()),
        }
    }

    pub fn seen(&self, bytes: usize) {
        let mut flow = self.stream.lock();
        flow.unseen = flow.unseen.saturating_sub(bytes);
        drop(flow);
        self.stream.changed.notify_all();
    }

    pub fn busy(&self) -> bool {
        self.master()
            .as_deref()
            .is_some_and(|master| process::busy(self.pid, master))
    }

    pub fn program(&self) -> Option<String> {
        process::program(self.pid, self.master().as_deref()?)
    }

    pub fn ssh(&self) -> Option<super::remote::Destination> {
        let (program, args) = process::command(self.pid, self.master().as_deref()?)?;
        super::remote::ssh_destination(&program, &args)
    }

    pub fn folder(&self) -> Option<String> {
        process::folder(self.pid)
    }

    pub fn shell(&self) -> Option<u32> {
        self.pid
    }

    pub fn end(&self) {
        self.stream.lock().ended = true;
        self.stream.changed.notify_all();
        let _ = self
            .killer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .kill();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let master = self
            .master
            .get_mut()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(master) = master {
            thread::spawn(move || drop(master));
        }
    }
}

impl Started {
    pub fn run(self, sink: Sink, ended: impl FnOnce(&dyn Fn(&Session) -> bool) + Send + 'static) {
        let Self {
            reader,
            writer,
            child,
            queue,
            stream,
        } = self;

        let reading = Arc::clone(&stream);
        thread::spawn(move || read(reader, &reading));

        let sending = Arc::clone(&stream);
        thread::spawn(move || send(&sending, &sink));

        thread::spawn(move || write(writer, &queue));

        thread::spawn(move || {
            wait(child, &stream);
            ended(&|session: &Session| session.same_stream(&stream));
            linger(&stream);
        });
    }
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "SetConsoleCtrlHandler is Win32's own call and has no safe wrapper"
)]
fn interrupts_reach_shells() {
    use std::sync::Once;
    use windows::Win32::System::Console::SetConsoleCtrlHandler;

    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = unsafe { SetConsoleCtrlHandler(None, false) };
    });
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(1, 1000),
        cols: cols.clamp(2, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn read(mut reader: Box<dyn Read + Send>, stream: &Stream) {
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        {
            let mut flow = stream.lock();
            while !flow.ended && !flow.drained && flow.unseen + flow.waiting.len() > MOST_UNSEEN {
                flow = stream.wait(flow);
            }
        }

        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let mut flow = stream.lock();
                if !flow.ended {
                    flow.waiting.extend_from_slice(&buffer[..count]);
                }
                drop(flow);
                stream.changed.notify_all();
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }

    stream.lock().drained = true;
    stream.changed.notify_all();
}

fn send(stream: &Stream, sink: &Sink) {
    let mut last: Option<Instant> = None;

    loop {
        let mut flow = stream.lock();
        while !flow.ended && flow.waiting.is_empty() && !(flow.drained && flow.exit.is_some()) {
            flow = stream.wait(flow);
        }
        if flow.ended {
            return;
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

fn write(mut writer: Box<dyn Write + Send>, queue: &Receiver<Vec<u8>>) {
    for bytes in queue {
        if writer
            .write_all(&bytes)
            .and_then(|()| writer.flush())
            .is_err()
        {
            break;
        }
    }
}

fn wait(mut child: Box<dyn Child + Send + Sync>, stream: &Stream) {
    let code = child
        .wait()
        .map_or(-1, |status| i64::from(status.exit_code()));
    stream.lock().exit = Some(code);
    stream.changed.notify_all();
}

fn linger(stream: &Stream) {
    let until = Instant::now() + LINGER;
    let mut flow = stream.lock();

    while !flow.drained && !flow.ended {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        flow = stream
            .changed
            .wait_timeout(flow, left)
            .map_or_else(|poisoned| poisoned.into_inner().0, |(flow, _)| flow);
    }

    flow.drained = true;
    drop(flow);
    stream.changed.notify_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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

    fn started(cols: u16, rows: u16) -> (Held, Receiver<Out>) {
        let (session, parts) = Session::open(&shell(), cols, rows).expect("a shell");
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
                Out::Bytes(more) => {
                    if String::from_utf8_lossy(&more).contains("\u{1b}[6n") {
                        typed(held, "\u{1b}[1;1R");
                    }
                    bytes.extend(more);
                    if String::from_utf8_lossy(&bytes).contains(wanted) {
                        break;
                    }
                }
                Out::Exit(code) => {
                    return (String::from_utf8_lossy(&bytes).into_owned(), Some(code));
                }
            }
        }

        (String::from_utf8_lossy(&bytes).into_owned(), None)
    }

    #[test]
    fn output_nobody_will_see_is_read_to_its_end_once_the_shell_is_gone() {
        let stream = Arc::new(Stream::default());
        {
            let mut flow = stream.lock();
            flow.unseen = MOST_UNSEEN + 1;
            flow.exit = Some(0);
        }
        let reading = Arc::clone(&stream);
        let (done, finished) = std::sync::mpsc::channel();
        thread::spawn(move || {
            read(Box::new(std::io::Cursor::new(vec![7_u8; 4096])), &reading);
            let _ = done.send(());
        });
        linger(&stream);
        assert!(
            finished.recv_timeout(Duration::from_secs(5)).is_ok(),
            "the reader still waits for a window that will never say it saw the output"
        );
    }

    #[test]
    fn a_shell_answers_resizes_and_exits() {
        let (held, heard) = started(80, 24);

        line(&held, SAYS_OK);
        let (said, _) = printed_until(&held, &heard, "orden-ok");
        assert!(said.contains("orden-ok"), "the shell printed: {said:?}");

        held.lock()
            .expect("the session")
            .as_ref()
            .expect("still running")
            .resize(120, 40)
            .expect("a resize");

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
    fn a_session_ended_by_the_window_kills_its_shell() {
        let (held, heard) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");

        let session = held.lock().expect("the session").take().expect("running");
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
        let (held, heard) = started(80, 24);
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

        let session = held.lock().expect("the session").take().expect("running");
        session.end();
    }

    #[test]
    fn a_program_that_ends_leaves_the_shell_idle() {
        let (held, heard) = started(80, 24);
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

        let session = held.lock().expect("the session").take().expect("running");
        session.end();
    }

    #[test]
    fn a_shell_at_its_prompt_is_not_busy() {
        let (held, heard) = started(80, 24);
        line(&held, SAYS_OK);
        let _ = printed_until(&held, &heard, "orden-ok");

        let session = held.lock().expect("the session").take().expect("running");
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

        let (held, _heard) = started(80, 24);
        let session = held.lock().expect("the session").take().expect("a session");
        session.resize(100, 30).expect("resized");
        session.resize(100, 30).expect("resized again");
        let began = Instant::now();
        session.end();
        drop(session);
        assert!(began.elapsed() < Duration::from_secs(1));
    }
}
