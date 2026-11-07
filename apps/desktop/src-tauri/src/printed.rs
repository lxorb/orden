use std::io::{self, Read};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::time::{Duration, Instant};

pub const GRACE: Duration = Duration::from_millis(300);

const LOOK: Duration = Duration::from_millis(10);

const LAPSE_LOOK: Duration = Duration::from_millis(50);

pub fn chunks(mut from: impl Read + Send + 'static) -> Receiver<Vec<u8>> {
    let (sent, heard) = mpsc::channel();
    let _ = std::thread::Builder::new()
        .name("printed".to_owned())
        .spawn(move || {
            let mut chunk = [0_u8; 8192];
            while let Ok(read) = from.read(&mut chunk) {
                if read == 0 || sent.send(chunk[..read].to_vec()).is_err() {
                    break;
                }
            }
        });
    heard
}

pub fn output(command: &mut Command, patience: Duration) -> io::Result<Output> {
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    wait_output(child, patience)
}

pub fn wait_output(mut child: Child, patience: Duration) -> io::Result<Output> {
    let mut out = Heard::new(child.stdout.take());
    let mut err = Heard::new(child.stderr.take());
    let started = Instant::now();
    let mut ended: Option<(ExitStatus, Instant)> = None;
    loop {
        out.take();
        err.take();
        if ended.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => ended = Some((status, Instant::now())),
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
        }
        match ended {
            Some((status, at)) if (out.done() && err.done()) || at.elapsed() >= GRACE => {
                return Ok(Output {
                    status,
                    stdout: out.printed,
                    stderr: err.printed,
                });
            }
            None if started.elapsed() >= patience => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("no answer within {} seconds", patience.as_secs()),
                ));
            }
            _ => std::thread::sleep(LOOK),
        }
    }
}

struct Heard {
    from: Option<Receiver<Vec<u8>>>,
    printed: Vec<u8>,
}

impl Heard {
    fn new(from: Option<impl Read + Send + 'static>) -> Self {
        Heard {
            from: from.map(chunks),
            printed: Vec::new(),
        }
    }

    fn take(&mut self) {
        while let Some(from) = &self.from {
            match from.try_recv() {
                Ok(more) => self.printed.extend(more),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => self.from = None,
            }
        }
    }

    fn done(&self) -> bool {
        self.from.is_none()
    }
}

pub struct Lapsing<F> {
    heard: Option<Receiver<Vec<u8>>>,
    kept: Vec<u8>,
    at: usize,
    ended: F,
    since: Option<Instant>,
}

pub fn lapsing<F: FnMut() -> bool>(from: impl Read + Send + 'static, ended: F) -> Lapsing<F> {
    Lapsing {
        heard: Some(chunks(from)),
        kept: Vec::new(),
        at: 0,
        ended,
        since: None,
    }
}

impl<F: FnMut() -> bool> Read for Lapsing<F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        loop {
            if self.at < self.kept.len() {
                let read = (self.kept.len() - self.at).min(buf.len());
                buf[..read].copy_from_slice(&self.kept[self.at..self.at + read]);
                self.at += read;
                return Ok(read);
            }
            let Some(heard) = &self.heard else {
                return Ok(0);
            };
            match heard.recv_timeout(LAPSE_LOOK) {
                Ok(more) => {
                    self.kept = more;
                    self.at = 0;
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.heard = None;
                    return Ok(0);
                }
                Err(RecvTimeoutError::Timeout) => {
                    if (self.ended)() {
                        let since = *self.since.get_or_insert_with(Instant::now);
                        if since.elapsed() >= GRACE {
                            self.heard = None;
                            return Ok(0);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn sh(script: &str) -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }

    #[test]
    fn what_a_program_prints_is_read_when_it_ends() {
        let said = output(
            &mut sh("echo out; echo err >&2; exit 3"),
            Duration::from_secs(10),
        )
        .expect("it ran");
        assert_eq!(said.stdout, b"out\n");
        assert_eq!(said.stderr, b"err\n");
        assert_eq!(said.status.code(), Some(3));
    }

    #[test]
    fn a_program_that_leaves_something_holding_its_output_is_not_waited_for() {
        let started = Instant::now();
        let said =
            output(&mut sh("sleep 30 & echo done"), Duration::from_secs(20)).expect("it ran");
        assert_eq!(said.stdout, b"done\n");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_program_that_never_ends_is_stopped_when_its_time_is_up() {
        let started = Instant::now();
        let said = output(
            &mut sh("echo first; exec sleep 30"),
            Duration::from_millis(400),
        );
        assert_eq!(
            said.map_err(|error| error.kind()).err(),
            Some(io::ErrorKind::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_spawned_program_fed_its_input_is_read_to_its_end() {
        use std::io::Write as _;

        let mut child = sh("cat; sleep 30 &")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("it ran");
        let mut sink = child.stdin.take().expect("its input");
        sink.write_all(b"fed").expect("fed");
        drop(sink);
        let started = Instant::now();
        let said = wait_output(child, Duration::from_secs(20)).expect("it ended");
        assert_eq!(said.stdout, b"fed");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_lapsing_read_ends_once_the_program_has_ended_though_its_pipe_is_held() {
        let mut child = sh("echo one; sleep 30 & echo two")
            .stdout(Stdio::piped())
            .spawn()
            .expect("it ran");
        let out = child.stdout.take().expect("its output");
        let started = Instant::now();
        let mut read = String::new();
        lapsing(out, || matches!(child.try_wait(), Ok(Some(_))))
            .read_to_string(&mut read)
            .expect("read");
        assert_eq!(read, "one\ntwo\n");
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
