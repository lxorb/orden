use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead as _, BufReader, Read, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use orden_base::Held as _;
use serde_json::Value;

use crate::family::{self, Family};
use crate::rpc::{Peer, Wire};

const KEPT_LINES: usize = 12;
const LONGEST_LINE: usize = 400;
struct Piped {
    input: Arc<Mutex<Option<ChildStdin>>>,
    family: Family,
}
impl Wire for Piped {
    fn send(&self, message: Value) -> Result<(), String> {
        said(&self.input, &message)
    }
    fn end(&self) {
        self.input.held().take();
        self.family.end();
    }
}
impl Drop for Piped {
    fn drop(&mut self) {
        self.end();
    }
}
fn said(input: &Mutex<Option<ChildStdin>>, message: &Value) -> Result<(), String> {
    let mut line = message.to_string();
    line.push('\n');
    let mut input = input.held();
    let pipe = input.as_mut().ok_or("the server was stopped")?;
    pipe.write_all(line.as_bytes())
        .and_then(|()| pipe.flush())
        .map_err(|_| "the server stopped listening".to_owned())
}
pub(crate) fn located(command: &str, home: Option<&Path>) -> Result<PathBuf, String> {
    let named = expanded(command, home);
    if named.components().count() > 1 || named.is_absolute() {
        return Ok(named);
    }
    orden_base::program::which(command)
        .ok_or_else(|| format!("{command} was not found on this computer"))
}
fn expanded(path: &str, home: Option<&Path>) -> PathBuf {
    match (path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ if path == "~" => home.map_or_else(|| PathBuf::from(path), Path::to_path_buf),
        _ => PathBuf::from(path),
    }
}
pub(crate) fn spawn(
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    env: &BTreeMap<String, String>,
    peer: &Arc<Peer>,
) -> Result<Box<dyn Wire>, String> {
    let home = dirs::home_dir();
    let exe = located(command, home.as_deref())?;
    let path = orden_base::program::with_first(exe.parent(), &orden_base::program::search_path());
    let mut run = Command::new(&exe);
    run.args(args)
        .env("PATH", path)
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd.map(str::trim).filter(|cwd| !cwd.is_empty()) {
        run.current_dir(expanded(cwd, home.as_deref()));
    }
    let (mut child, family) =
        family::spawn(&mut run).map_err(|error| format!("{command} would not start: {error}"))?;
    let input = Arc::new(Mutex::new(child.stdin.take()));
    let (Some(output), Some(errors)) = (child.stdout.take(), child.stderr.take()) else {
        family.end();
        return Err(format!("{command} would not start"));
    };
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    kept_tail(errors, Arc::clone(&tail));
    let (peer, replies) = (Arc::clone(peer), Arc::clone(&input));
    std::thread::spawn(move || {
        for line in BufReader::new(output).split(b'\n').map_while(Result::ok) {
            let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            for reply in peer.heard(message) {
                let _ = said(&replies, &reply);
            }
        }
        let code = ended(child);
        std::thread::sleep(Duration::from_millis(50));
        peer.end(&stopped(code, &tail.held()));
    });
    Ok(Box::new(Piped { input, family }))
}
fn kept_tail(errors: impl Read + Send + 'static, tail: Arc<Mutex<VecDeque<String>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(errors).lines().map_while(Result::ok) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut kept = tail.held();
            if kept.len() == KEPT_LINES {
                kept.pop_front();
            }
            kept.push_back(line.chars().take(LONGEST_LINE).collect());
        }
    });
}
fn ended(mut child: Child) -> Option<i32> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(2) {
        if let Ok(Some(status)) = child.try_wait() {
            return status.code();
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    child.wait().ok().and_then(|status| status.code())
}
fn stopped(code: Option<i32>, tail: &VecDeque<String>) -> String {
    let mut why = match code {
        Some(code) => format!("the server stopped (exit code {code})"),
        None => "the server stopped".to_owned(),
    };
    if !tail.is_empty() {
        why.push_str(": ");
        why.push_str(&tail.iter().cloned().collect::<Vec<_>>().join("\n"));
    }
    why
}
