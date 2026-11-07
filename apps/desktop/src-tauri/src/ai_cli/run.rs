use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::family::{self, Family};

const LONGEST_LINE: u64 = 8 << 20;

const ERR_TAIL: usize = 16 << 10;

#[derive(Debug, PartialEq, Eq)]
pub enum Heard {
    Line(String),
    End(Ended),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ended {
    pub code: Option<i32>,
    pub timed_out: bool,
    pub stopped: bool,
    pub err: String,
}

struct Shared {
    child: Mutex<Option<Child>>,
    family: Family,
    stopped: AtomicBool,
    timed_out: AtomicBool,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    born: Instant,
    last: AtomicU64,
}

impl Shared {
    fn child(&self) -> MutexGuard<'_, Option<Child>> {
        self.child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn input(&self) -> MutexGuard<'_, Option<mpsc::Sender<Vec<u8>>>> {
        self.input
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn end(&self) {
        let held = self.child();
        if held.is_some() {
            self.family.end();
        }
    }

    fn gone(&self) -> bool {
        self.child()
            .as_mut()
            .is_none_or(|child| matches!(child.try_wait(), Ok(Some(_))))
    }

    fn touch(&self) {
        let now = u64::try_from(self.born.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.last.store(now, Ordering::SeqCst);
    }

    fn quiet_for(&self) -> Duration {
        let last = Duration::from_millis(self.last.load(Ordering::SeqCst));
        self.born.elapsed().saturating_sub(last)
    }
}

#[derive(Clone)]
pub struct Running(Arc<Shared>);

impl Running {
    pub fn stop(&self) {
        self.0.stopped.store(true, Ordering::SeqCst);
        self.0.end();
    }

    pub fn write_line(&self, line: &str) -> io::Result<()> {
        let mut held = self.0.input();
        let closed = || io::Error::new(io::ErrorKind::BrokenPipe, "the input is closed");
        let input = held.as_ref().ok_or_else(closed)?;
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        if input.send(bytes).is_err() {
            held.take();
            return Err(closed());
        }
        drop(held);
        self.0.touch();
        Ok(())
    }

    pub fn close_input(&self) {
        self.0.input().take();
    }
}

#[derive(Clone, Copy, Debug)]
enum Limit {
    Total(Duration),
    Idle(Duration),
}

pub fn start(
    command: Command,
    input: Vec<u8>,
    timeout: Duration,
    heard: impl Fn(Heard) + Send + 'static,
) -> io::Result<Running> {
    launch(command, Some(input), Limit::Total(timeout), heard)
}

pub fn open(
    command: Command,
    idle: Duration,
    heard: impl Fn(Heard) + Send + 'static,
) -> io::Result<Running> {
    launch(command, None, Limit::Idle(idle), heard)
}

fn launch(
    mut command: Command,
    input: Option<Vec<u8>>,
    limit: Limit,
    heard: impl Fn(Heard) + Send + 'static,
) -> io::Result<Running> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (mut child, family) = family::spawn(&mut command)?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (once, kept) = match input {
        Some(bytes) => (stdin.map(|stdin| (stdin, bytes)), None),
        None => (None, stdin.map(writer)),
    };
    let shared = Arc::new(Shared {
        child: Mutex::new(Some(child)),
        family,
        stopped: AtomicBool::new(false),
        timed_out: AtomicBool::new(false),
        input: Mutex::new(kept),
        born: Instant::now(),
        last: AtomicU64::new(0),
    });

    if let Some((mut stdin, input)) = once {
        thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }

    let err = stderr.map(|stderr| {
        let ending = Arc::clone(&shared);
        thread::spawn(move || tail(crate::printed::lapsing(stderr, move || ending.gone())))
    });

    let (done, waiting) = mpsc::channel::<()>();
    let watched = Arc::clone(&shared);
    thread::spawn(move || watch(&watched, &waiting, limit));

    let reading = Arc::clone(&shared);
    thread::spawn(move || {
        if let Some(stdout) = stdout {
            let ending = Arc::clone(&reading);
            let stdout = crate::printed::lapsing(stdout, move || ending.gone());
            lines(stdout, &|one| {
                reading.touch();
                heard(one);
            });
        }
        reading.input().take();
        let code = reap(&reading);
        let _ = done.send(());
        let err = err.and_then(|one| one.join().ok()).unwrap_or_default();
        heard(Heard::End(Ended {
            code,
            timed_out: reading.timed_out.load(Ordering::SeqCst),
            stopped: reading.stopped.load(Ordering::SeqCst),
            err,
        }));
    });

    Ok(Running(shared))
}

fn writer(mut stdin: ChildStdin) -> mpsc::Sender<Vec<u8>> {
    let (sent, lines) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        for line in lines {
            if stdin.write_all(&line).and_then(|()| stdin.flush()).is_err() {
                return;
            }
        }
    });
    sent
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Said {
    pub out: String,
    #[serde(flatten)]
    pub ended: Ended,
}

pub fn run_to_end(command: Command, timeout: Duration) -> io::Result<Said> {
    let (sent, heard) = mpsc::channel();
    start(command, Vec::new(), timeout, move |one| {
        let _ = sent.send(one);
    })?;

    let mut out = Vec::new();
    for one in heard {
        match one {
            Heard::Line(line) => out.push(line),
            Heard::End(ended) => {
                return Ok(Said {
                    out: out.join("\n"),
                    ended,
                })
            }
        }
    }
    Err(io::Error::other("the run ended without saying so"))
}

fn watch(shared: &Shared, waiting: &Receiver<()>, limit: Limit) {
    match limit {
        Limit::Total(timeout) => {
            if waiting.recv_timeout(timeout) != Err(RecvTimeoutError::Timeout) {
                return;
            }
        }
        Limit::Idle(idle) => {
            let tick = idle.min(Duration::from_secs(1));
            loop {
                if waiting.recv_timeout(tick) != Err(RecvTimeoutError::Timeout) {
                    return;
                }
                if shared.quiet_for() >= idle {
                    break;
                }
            }
        }
    }
    shared.timed_out.store(true, Ordering::SeqCst);
    shared.end();
}

fn lines(out: impl Read, heard: &impl Fn(Heard)) {
    let mut reader = BufReader::new(out);
    let mut line = Vec::new();

    loop {
        line.clear();
        match (&mut reader)
            .take(LONGEST_LINE)
            .read_until(b'\n', &mut line)
        {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if !line.ends_with(b"\n") && line.len() as u64 == LONGEST_LINE {
            skip_line(&mut reader);
            continue;
        }

        let text = String::from_utf8_lossy(&line);
        let text = text.trim_end_matches(['\r', '\n']);
        if !text.is_empty() {
            heard(Heard::Line(text.to_owned()));
        }
    }
}

fn skip_line(reader: &mut impl BufRead) {
    loop {
        let Ok(buffer) = reader.fill_buf() else {
            return;
        };
        if buffer.is_empty() {
            return;
        }
        if let Some(at) = buffer.iter().position(|&byte| byte == b'\n') {
            reader.consume(at + 1);
            return;
        }
        let all = buffer.len();
        reader.consume(all);
    }
}

fn tail(mut err: impl Read) -> String {
    let mut kept = Vec::new();
    let mut chunk = [0_u8; 8192];
    while let Ok(read) = err.read(&mut chunk) {
        if read == 0 {
            break;
        }
        kept.extend_from_slice(&chunk[..read]);
        if kept.len() > 2 * ERR_TAIL {
            kept.drain(..kept.len() - ERR_TAIL);
        }
    }
    let from = kept.len().saturating_sub(ERR_TAIL);
    String::from_utf8_lossy(&kept[from..]).into_owned()
}

fn reap(shared: &Shared) -> Option<i32> {
    loop {
        {
            let mut held = shared.child();
            let child = held.as_mut()?;
            match child.try_wait() {
                Ok(Some(status)) => {
                    *held = None;
                    return status.code();
                }
                Ok(None) => {}
                Err(_) => {
                    *held = None;
                    return None;
                }
            }
        }
        thread::sleep(Duration::from_millis(15));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_line_to_a_program_that_is_not_reading_yet_does_not_wait_for_it() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 2; cat"]);
        let (sent, heard) = mpsc::channel();
        let running = open(command, Duration::from_secs(30), move |one| {
            let _ = sent.send(one);
        })
        .unwrap();

        let long = "x".repeat(1 << 20);
        let started = Instant::now();
        running.write_line(&long).unwrap();
        running.write_line("after").unwrap();
        running.close_input();
        assert!(started.elapsed() < Duration::from_millis(500));

        let lines: Vec<String> = heard
            .iter()
            .take_while(|one| matches!(one, Heard::Line(_)))
            .filter_map(|one| match one {
                Heard::Line(line) => Some(line),
                Heard::End(_) => None,
            })
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), 1 << 20);
        assert_eq!(lines[1], "after");
    }

    #[test]
    fn a_program_that_leaves_something_holding_its_output_ends_when_it_does() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 & echo said; echo told >&2"]);
        let started = Instant::now();

        let said = run_to_end(command, Duration::from_secs(20)).unwrap();

        assert_eq!(said.out, "said");
        assert_eq!(said.ended.err, "told\n");
        assert_eq!(said.ended.code, Some(0));
        assert!(!said.ended.timed_out);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
