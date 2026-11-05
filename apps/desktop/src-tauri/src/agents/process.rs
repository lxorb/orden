//! `process`: an agent runs programs on this computer (#1078; docs/agent-native.md 8.12),
//! the way a VS Code extension's tasks and `child_process` do: `run` one to its end and
//! read what it printed, or `start` one - a dev server, a watcher - and `read`, `write`
//! and `kill` it after.
//!
//! **Never through a shell.** The program and each argument are handed to the system as
//! they are, so nothing in an argument is a second command. A bare name is looked for on
//! the app's own `PATH` (a Mac's and Linux's login shell's included, as the AI programs
//! are found), never on one the call sets, and what is started is the file found.
//!
//! **Asked as the terminal asks** (8.9, #1072): it needs the `processes` scope, and a
//! program not on the agent's list asks under *the terminal* first. Only a bare name can
//! be on the list: a path is any file that happens to be called `git`, and so is a name
//! found on a `PATH` the call chose. A call that sets variables asks as well, since
//! `GIT_SSH_COMMAND`, `NODE_OPTIONS` or `LD_PRELOAD` make a listed program run something
//! else. Each question is `Grant::asks`, so Full permissions, which a client connected
//! over MCP always has (#1099), asks nothing.
//!
//! **The agent's own.** A started program belongs to the agent that started it: no other
//! agent lists, reads, writes to or ends it. It is ended, with everything it started
//! (`ai_cli::family`), when the agent says goodbye, when it has not called for the ten
//! minutes that make it gone (shell.rs), and when the reader presses the stop, for
//! everyone or for that agent.
//!
//! **Bounded.** A `run` waits at most two minutes, inside the time `nib mcp` waits for an
//! answer; longer work is `start` and `read`. An answer holds at most 100 000 bytes of
//! output, a started program keeps its last megabyte, and an agent has at most eight
//! running at once. What a program printed is its words, marked untrusted (9.6).

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager as _};

use super::approvals::{self, Asking};
use super::grants::{Grant, Scope};
use super::stop;
use super::verbs::{Answer, Category, Code, Ended, Process, ProcessDone, ProcessEntry, ProcessOp};
use super::Caller;
use crate::ai_cli::family::{self, Family};

/// How long a `run` may take when the call does not say, and at the most.
const WAIT: u64 = 60_000;
const MOST_WAIT: u64 = 120_000;

/// The longest a `read` waits for something new.
const MOST_READ_WAIT: u64 = 30_000;

/// The most output one answer holds, in bytes.
const MOST_OUTPUT: usize = 100_000;

/// What a program's output keeps of itself, in bytes: the end.
const KEPT: usize = 1_000_000;

/// The most programs one agent has running at once.
const MOST_RUNNING: usize = 8;

/// How long the output is waited for once the program has ended: a program it started
/// may hold the pipes open for good.
const DRAINING: Duration = Duration::from_secs(1);

/// The next started program's number.
static NEXT: AtomicU64 = AtomicU64::new(1);

/// Every program an agent started that has not been forgotten.
static STARTED: Mutex<Vec<Arc<Started>>> = Mutex::new(Vec::new());

fn started() -> MutexGuard<'static, Vec<Arc<Started>>> {
    STARTED.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One program, started.
struct Started {
    id: String,
    agent: String,
    program: String,
    args: Vec<String>,
    at: u64,
    /// Whether `start` started it, rather than a `run` waiting for it.
    kept: bool,
    /// The head of the family, until it has been waited for.
    child: Mutex<Option<Child>>,
    family: Family,
    input: Mutex<Option<ChildStdin>>,
    killed: AtomicBool,
    said: Mutex<Said>,
    heard: Condvar,
}

/// What a program printed, and how it ended.
#[derive(Default)]
struct Said {
    /// Its standard output; for a started one, both outputs as they came.
    out: Stream,
    /// Its standard error, for a `run`.
    err: Stream,
    /// The outputs still open.
    open: u8,
    /// Whether it has ended.
    ended: bool,
    /// Its exit code, where it ended with one.
    code: Option<i32>,
}

/// One output: its end, and how much came before it.
#[derive(Default)]
struct Stream {
    bytes: Vec<u8>,
    dropped: u64,
}

impl Stream {
    fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > KEPT {
            let over = self.bytes.len() - KEPT;
            self.bytes.drain(..over);
            self.dropped += u64::try_from(over).unwrap_or(u64::MAX);
        }
    }

    /// The whole of it, as a cursor counts.
    fn total(&self) -> u64 {
        self.dropped + u64::try_from(self.bytes.len()).unwrap_or(u64::MAX)
    }

    /// What came after `since`, at most `MOST_OUTPUT` bytes of it, ending on a whole
    /// letter: the words, where the next read starts, and whether any was left out.
    fn after(&self, since: u64) -> (String, u64, bool) {
        let skipped = since < self.dropped;
        let from = usize::try_from(since.saturating_sub(self.dropped))
            .unwrap_or(usize::MAX)
            .min(self.bytes.len());
        let from = whole_from(&self.bytes, from);
        let rest = &self.bytes[from..];
        let cut = rest.len() > MOST_OUTPUT;
        let end = whole_to(rest, rest.len().min(MOST_OUTPUT));
        let next = self.dropped + u64::try_from(from + end).unwrap_or(u64::MAX);
        (
            String::from_utf8_lossy(&rest[..end]).into_owned(),
            next,
            skipped || cut,
        )
    }

    /// The last `MOST_OUTPUT` bytes, from a whole letter, and whether any was left out.
    fn end(&self) -> (String, bool) {
        let from = whole_from(&self.bytes, self.bytes.len().saturating_sub(MOST_OUTPUT));
        (
            String::from_utf8_lossy(&self.bytes[from..]).into_owned(),
            from > 0 || self.dropped > 0,
        )
    }
}

/// `at`, moved on past the rest of a letter it falls inside.
fn whole_from(bytes: &[u8], at: usize) -> usize {
    let mut at = at;
    while at < bytes.len() && at > 0 && (bytes[at] & 0b1100_0000) == 0b1000_0000 {
        at += 1;
    }
    at
}

/// `at`, moved back to before a letter it would cut in two.
fn whole_to(bytes: &[u8], at: usize) -> usize {
    match std::str::from_utf8(&bytes[..at]) {
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        _ => at,
    }
}

impl Started {
    fn said(&self) -> MutexGuard<'_, Said> {
        self.said.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Ends the family, while its head is still there to be named by.
    fn end(&self) {
        let held = self.child.lock().unwrap_or_else(PoisonError::into_inner);
        if held.is_some() {
            self.killed.store(true, Ordering::SeqCst);
            self.family.end();
        }
    }

    fn entry(&self) -> ProcessEntry {
        let said = self.said();
        ProcessEntry {
            id: self.id.clone(),
            program: self.program.clone(),
            args: self.args.clone(),
            started: self.at,
            running: !said.ended,
            exit: said.code,
        }
    }

    /// Waits until `done` says so of what it printed, or `patience` has gone by, or the
    /// stop is pressed after the stop `since` names. Answers whether the stop cut it short.
    fn wait(&self, patience: Duration, since: Option<u64>, done: impl Fn(&Said) -> bool) -> bool {
        let until = Instant::now() + patience;
        let mut said = self.said();
        loop {
            if done(&said) {
                return false;
            }
            if since.is_some_and(stop::cancelled) {
                return true;
            }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            said = self
                .heard
                .wait_timeout(said, left.min(Duration::from_millis(100)))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

/// One call, answered: checked against the grant, asked where it asks, then done.
pub(super) fn answer(app: &AppHandle, caller: &Caller, asked: &Process, since: u64) -> Answer {
    if !caller.holds(Scope::Processes) {
        return Answer::error(
            Code::NotGranted,
            "programs need the processes scope, which the reader grants in Settings > Agents",
        );
    }
    match asked.op {
        ProcessOp::Run | ProcessOp::Start => begin(app, caller, asked, since),
        ProcessOp::List => Answer::ok(ProcessDone {
            processes: started()
                .iter()
                .filter(|one| one.agent == caller.id() && one.kept)
                .map(|one| one.entry())
                .collect(),
            ..ProcessDone::default()
        }),
        ProcessOp::Read | ProcessOp::Write | ProcessOp::Kill => match own(caller, asked) {
            Ok(one) => match asked.op {
                ProcessOp::Read => read(&one, asked, since),
                ProcessOp::Write => written(&one, asked),
                _ => {
                    one.end();
                    one.wait(DRAINING, None, |said| said.ended);
                    Answer::ok(state(&one))
                }
            },
            Err(refused) => refused,
        },
    }
}

/// The started program a call names, if it is this agent's.
fn own(caller: &Caller, asked: &Process) -> Result<Arc<Started>, Answer> {
    let Some(id) = asked.id.as_deref() else {
        return Err(Answer::error(
            Code::BadArguments,
            "say which: the id start answered",
        ));
    };
    started()
        .iter()
        .find(|one| one.id == id && one.agent == caller.id() && one.kept)
        .cloned()
        .ok_or_else(|| {
            Answer::error(
                Code::BadArguments,
                format!("{id} is not a program you started, or it is forgotten"),
            )
        })
}

/// How a started program is now, without what it printed.
fn state(one: &Started) -> ProcessDone {
    let said = one.said();
    ProcessDone {
        id: Some(one.id.clone()),
        running: !said.ended,
        exit: said.code,
        ended: one.killed.load(Ordering::SeqCst).then_some(Ended::Killed),
        ..ProcessDone::default()
    }
}

/// `run` and `start`: found, asked about, started.
fn begin(app: &AppHandle, caller: &Caller, asked: &Process, since: u64) -> Answer {
    let Some(program) = asked
        .program
        .as_deref()
        .map(str::trim)
        .filter(|one| !one.is_empty())
    else {
        return Answer::error(Code::BadArguments, "say which program");
    };
    let home = app.path().home_dir().ok();
    let found = match located(
        program,
        home.as_deref(),
        &crate::ai_cli::program::search_path(),
    ) {
        Ok(found) => found,
        Err(why) => return Answer::error(Code::BadArguments, why),
    };
    let cwd = match asked.cwd.as_deref() {
        Some(cwd) => match absolute(cwd, home.as_deref()) {
            Ok(cwd) if cwd.is_dir() => cwd,
            Ok(cwd) => {
                return Answer::error(
                    Code::BadArguments,
                    format!("{} is not a folder", cwd.display()),
                )
            }
            Err(why) => return Answer::error(Code::BadArguments, why),
        },
        None => match home {
            Some(home) => home,
            None => return Answer::error(Code::BadArguments, "say where it runs, as cwd"),
        },
    };
    if let Caller::Agent(grant) = caller {
        if let Some(question) = question(app, grant, asked, program) {
            return question;
        }
    }
    let running = started()
        .iter()
        .filter(|one| one.agent == caller.id() && !one.said().ended)
        .count();
    if running >= MOST_RUNNING {
        return Answer::error(
            Code::Limit,
            format!("{MOST_RUNNING} of your programs are running: kill one first"),
        );
    }
    let kept = asked.op == ProcessOp::Start;
    let one = match spawned(caller.id(), &found, asked, &cwd, kept) {
        Ok(one) => one,
        Err(why) => return Answer::error(Code::Failed, why),
    };
    if kept {
        return Answer::ok(state(&one));
    }
    ran(&one, asked, since)
}

/// A `run`, waited for and answered, then forgotten.
fn ran(one: &Arc<Started>, asked: &Process, since: u64) -> Answer {
    let patience = Duration::from_millis(asked.timeout_ms.unwrap_or(WAIT).min(MOST_WAIT));
    let stopped = one.wait(patience, Some(since), |said| said.ended);
    let timed_out = !stopped && !one.said().ended;
    if stopped || timed_out {
        one.end();
        one.wait(DRAINING, None, |said| said.ended);
    }
    started().retain(|kept| !Arc::ptr_eq(kept, one));
    if stopped {
        return Answer::error(Code::Stopped, "the reader pressed the stop");
    }
    let said = one.said();
    let (out, out_cut) = said.out.end();
    let (err, err_cut) = said.err.end();
    untrusted(
        ProcessDone {
            exit: said.code,
            ended: timed_out.then_some(Ended::TimedOut),
            stdout: Some(out),
            stderr: Some(err),
            truncated: out_cut || err_cut,
            ..ProcessDone::default()
        },
        &one.program,
    )
}

/// A `read`: what came after the cursor, waited for up to `wait_ms`.
fn read(one: &Arc<Started>, asked: &Process, since: u64) -> Answer {
    let cursor = asked.since.unwrap_or(0);
    let patience = Duration::from_millis(asked.wait_ms.unwrap_or(0).min(MOST_READ_WAIT));
    if one.wait(patience, Some(since), |said| {
        said.out.total() > cursor || said.ended
    }) {
        return Answer::error(Code::Stopped, "the reader pressed the stop");
    }
    let mut done = state(one);
    let said = one.said();
    let (output, next, truncated) = said.out.after(cursor);
    done.output = Some(output);
    done.next = Some(next);
    done.truncated = truncated;
    drop(said);
    untrusted(done, &one.program)
}

/// A `write`: the words typed in, and the input closed when asked.
fn written(one: &Started, asked: &Process) -> Answer {
    let mut input = one.input.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(pipe) = input.as_mut() else {
        return Answer::error(Code::Failed, "its input is closed");
    };
    if let Some(words) = asked.stdin.as_deref() {
        if let Err(why) = pipe.write_all(words.as_bytes()).and_then(|()| pipe.flush()) {
            *input = None;
            return Answer::error(Code::Failed, format!("it would not read: {why}"));
        }
    }
    if asked.close {
        *input = None;
    }
    drop(input);
    Answer::ok(state(one))
}

/// An answer holding what a program printed: its words, not the reader's (9.6).
fn untrusted(done: ProcessDone, program: &str) -> Answer {
    Answer::Ok {
        result: serde_json::to_value(done).unwrap_or_default(),
        untrusted: Some(format!("the output of {program}")),
        dialog: None,
    }
}

/// The question a `run` or a `start` raises, or nothing where it may go ahead.
fn question(app: &AppHandle, grant: &Grant, asked: &Process, program: &str) -> Option<Answer> {
    if !grant.asks(Category::Terminal) || listed(&grant.programs, program, asked, cfg!(windows)) {
        return None;
    }
    let key = approvals::key(
        "process",
        None,
        Some(
            &serde_json::to_string(&Process {
                timeout_ms: None,
                ..asked.clone()
            })
            .unwrap_or_default(),
        ),
    );
    if approvals::allowed(&grant.id, &key) {
        return None;
    }
    Some(approvals::ask(
        app,
        Asking {
            agent: &grant.id,
            name: &grant.name,
            category: Category::Terminal,
            summary: summary(program, &asked.args),
            site: None,
            tab: None,
            key,
        },
    ))
}

/// Whether a call starts a program on the agent's list, and nothing else: a bare name,
/// as the list names it, with no variables set. `windows` is the system it runs on, said
/// so that both are tested on any machine; the call passes `cfg!(windows)`.
fn listed(programs: &[String], program: &str, asked: &Process, windows: bool) -> bool {
    if !asked.env.is_empty() || program.contains(['/', '\\']) || program.starts_with('~') {
        return false;
    }
    let name = bare(program, windows);
    programs.iter().any(|one| bare(one, windows) == name)
}

fn bare(program: &str, windows: bool) -> String {
    let name = program.trim();
    if !windows {
        return name.to_owned();
    }
    let name = name.to_lowercase();
    for ending in [".exe", ".com", ".bat", ".cmd"] {
        if let Some(stem) = name.strip_suffix(ending) {
            return stem.to_owned();
        }
    }
    name
}

/// One line for the question.
fn summary(program: &str, args: &[String]) -> String {
    let mut line = format!("Run {program}");
    for arg in args {
        line.push(' ');
        if arg.is_empty() || arg.contains(char::is_whitespace) {
            line.push('"');
            line.push_str(arg);
            line.push('"');
        } else {
            line.push_str(arg);
        }
    }
    if line.chars().count() > 300 {
        line = line.chars().take(299).collect();
        line.push('…');
    }
    line
}

/// A path as asked for, made absolute: `~/` is the home folder, and anything else has to
/// say where it is, since an agent has no folder it is "in".
fn absolute(asked: &str, home: Option<&Path>) -> Result<PathBuf, String> {
    let asked = asked.trim();
    let rest = asked
        .strip_prefix("~/")
        .or_else(|| asked.strip_prefix("~\\"))
        .or_else(|| (asked == "~").then_some(""));
    let given = match rest {
        Some(rest) => home
            .ok_or_else(|| "this account has no home folder".to_owned())?
            .join(rest),
        None => PathBuf::from(asked),
    };
    if !given.is_absolute() {
        return Err(format!(
            "{asked} is not an absolute path: say where it is, or start it with ~/"
        ));
    }
    Ok(crate::paths::folded(&given))
}

/// The file a program is: a path as it says, or a bare name on `path`.
fn located(program: &str, home: Option<&Path>, path: &std::ffi::OsStr) -> Result<PathBuf, String> {
    if program.contains(['/', '\\']) || program.starts_with('~') {
        let file = absolute(program, home)?;
        return if file.is_file() {
            Ok(file)
        } else {
            Err(format!("there is no program at {}", file.display()))
        };
    }
    let folders: Vec<PathBuf> = std::env::split_paths(path).collect();
    crate::ai_cli::program::first_in(&folders, &names(program), runnable)
        .ok_or_else(|| format!("there is no program called {program} on this computer's PATH"))
}

/// The names a bare program may have on disk: itself, and on Windows with each ending the
/// system runs.
fn names(program: &str) -> Vec<String> {
    let mut names = vec![program.to_owned()];
    if cfg!(windows) && Path::new(program).extension().is_none() {
        names = [".exe", ".cmd", ".bat", ".com"]
            .iter()
            .map(|ending| format!("{program}{ending}"))
            .collect();
    }
    names
}

/// Whether a file can be started: on a Mac and Linux, one marked so.
fn runnable(file: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::metadata(file)
            .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        file.is_file()
    }
}

/// Started, kept where the stop and the agent's going can find it, with a thread per
/// output and one that waits for it to end.
fn spawned(
    agent: &str,
    program: &Path,
    asked: &Process,
    cwd: &Path,
    kept: bool,
) -> Result<Arc<Started>, String> {
    let mut command = Command::new(program);
    command
        .args(&asked.args)
        .current_dir(cwd)
        .env("PATH", crate::ai_cli::program::search_path())
        .envs(&asked.env)
        .stdin(if kept || asked.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (mut child, family) = family::spawn(&mut command)
        .map_err(|why| format!("{} would not start: {why}", program.display()))?;
    let input = child.stdin.take();
    let out = child.stdout.take();
    let err = child.stderr.take();
    let one = Arc::new(Started {
        id: format!("p{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: agent.to_owned(),
        program: program.display().to_string(),
        args: asked.args.clone(),
        at: crate::clock::now(),
        kept,
        child: Mutex::new(Some(child)),
        family,
        input: Mutex::new(None),
        killed: AtomicBool::new(false),
        said: Mutex::new(Said {
            open: u8::from(out.is_some()) + u8::from(err.is_some()),
            ..Said::default()
        }),
        heard: Condvar::new(),
    });
    started().push(Arc::clone(&one));
    match (kept, input) {
        (true, input) => *one.input.lock().unwrap_or_else(PoisonError::into_inner) = input,
        (false, Some(mut pipe)) => {
            let words = asked.stdin.clone().unwrap_or_default();
            std::thread::spawn(move || {
                let _ = pipe.write_all(words.as_bytes());
            });
        }
        (false, None) => {}
    }
    if let Some(out) = out {
        listen(Arc::clone(&one), out, false);
    }
    if let Some(err) = err {
        listen(Arc::clone(&one), err, !kept);
    }
    let waiting = Arc::clone(&one);
    std::thread::spawn(move || reap(&waiting));
    Ok(one)
}

/// Reads one output to its end: into the standard error's stream when `apart`, else into
/// the one both share.
fn listen(one: Arc<Started>, mut pipe: impl std::io::Read + Send + 'static, apart: bool) {
    std::thread::spawn(move || {
        let mut chunk = [0_u8; 8192];
        loop {
            let read = pipe.read(&mut chunk).unwrap_or(0);
            let mut said = one.said();
            if read == 0 {
                said.open = said.open.saturating_sub(1);
                drop(said);
                one.heard.notify_all();
                return;
            }
            if apart {
                said.err.push(&chunk[..read]);
            } else {
                said.out.push(&chunk[..read]);
            }
            drop(said);
            one.heard.notify_all();
        }
    });
}

/// Waits for the head of the family, under the same lock `end` asks under, so the
/// family is never named by a number that may already be somebody else's; then for the
/// outputs to close, a moment at most.
fn reap(one: &Started) {
    let code = loop {
        {
            let mut held = one.child.lock().unwrap_or_else(PoisonError::into_inner);
            let Some(child) = held.as_mut() else {
                break None;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    *held = None;
                    break status.code();
                }
                Ok(None) => {}
                Err(_) => {
                    *held = None;
                    break None;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let until = Instant::now() + DRAINING;
    let mut said = one.said();
    while said.open > 0 {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        said = one
            .heard
            .wait_timeout(said, left)
            .unwrap_or_else(PoisonError::into_inner)
            .0;
    }
    said.ended = true;
    said.code = code;
    drop(said);
    one.heard.notify_all();
}

/// Ends and forgets every program of `agent`'s, or of every agent's: the agent went, or
/// the reader pressed the stop.
pub(super) fn end_all(agent: Option<&str>) {
    let ending: Vec<Arc<Started>> = {
        let mut all = started();
        let (gone, kept): (Vec<_>, Vec<_>) = all
            .drain(..)
            .partition(|one| agent.is_none_or(|agent| one.agent == agent));
        *all = kept;
        gone
    };
    for one in ending {
        one.end();
    }
}

/// Ends the programs of every agent not in `connected`: gone quiet, as shell.rs counts.
pub(super) fn keep_only(connected: &[String]) {
    let gone: Vec<String> = started()
        .iter()
        .filter(|one| one.agent != "cli" && !connected.contains(&one.agent))
        .map(|one| one.agent.clone())
        .collect();
    for agent in gone {
        end_all(Some(&agent));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn process(op: ProcessOp, program: &str) -> Process {
        Process {
            op,
            program: Some(program.into()),
            args: Vec::new(),
            env: BTreeMap::new(),
            cwd: None,
            stdin: None,
            timeout_ms: None,
            id: None,
            since: None,
            wait_ms: None,
            close: false,
        }
    }

    /// A program on the list goes as a bare name only: a path, `~/`, a name with
    /// variables that could make it run something else, are no longer the program the
    /// reader listed, and ask.
    #[test]
    fn only_a_bare_name_with_nothing_set_is_on_the_list() {
        let programs = vec!["git".to_owned(), "Node.exe".to_owned()];
        let run = |program: &str| process(ProcessOp::Run, program);
        for windows in [true, false] {
            assert!(listed(&programs, "git", &run("git"), windows));
            assert!(!listed(&programs, "npm", &run("npm"), windows));
            for path in [
                "/tmp/x/git",
                "./git",
                "bin/git",
                "~/bin/git",
                "C:\\Tools\\git.exe",
                "..\\git",
            ] {
                assert!(!listed(&programs, path, &run(path), windows), "{path}");
            }
            let mut hooked = run("git");
            hooked
                .env
                .insert("GIT_SSH_COMMAND".into(), "sh -c evil".into());
            assert!(!listed(&programs, "git", &hooked, windows));
            let mut pathed = run("git");
            pathed.env.insert("PATH".into(), "/tmp/x".into());
            assert!(!listed(&programs, "git", &pathed, windows));
        }
    }

    #[test]
    fn an_ending_is_the_bare_name_only_where_windows_runs_it_so() {
        let programs = vec!["git".to_owned(), "Node.exe".to_owned()];
        let run = |program: &str| process(ProcessOp::Run, program);
        for name in [
            "GIT.EXE", "git.exe", "git.com", "Git.Bat", "git.cmd", "node", "NODE.exe",
        ] {
            assert!(listed(&programs, name, &run(name), true), "{name}");
        }
        for name in ["git.sh", "git.ps1", "GIT.PS1"] {
            assert!(!listed(&programs, name, &run(name), true), "{name}");
        }
        for name in [
            "git.exe", "GIT", "git.cmd", "git.sh", "git.ps1", "node", "node.exe",
        ] {
            assert!(!listed(&programs, name, &run(name), false), "{name}");
        }
        assert!(listed(&programs, "Node.exe", &run("Node.exe"), false));
    }

    /// A path has to say where it is; a bare name is looked for on the app's own `PATH`.
    #[test]
    fn a_program_is_found_where_it_says_and_never_relative() {
        let home = std::env::temp_dir();
        for relative in ["./x", "bin/x", "..\\x", "x/../../y"] {
            assert!(
                located(relative, Some(&home), std::ffi::OsStr::new("")).is_err(),
                "{relative}"
            );
            assert!(absolute(relative, Some(&home)).is_err(), "{relative}");
        }
        assert_eq!(
            absolute("~/a/../b", Some(&home)).expect("home"),
            crate::paths::folded(&home.join("b"))
        );
        assert!(located(
            "no-such-program-anywhere",
            Some(&home),
            &crate::ai_cli::program::search_path()
        )
        .is_err());
    }

    #[test]
    fn an_output_is_read_on_whole_letters_and_keeps_its_end() {
        let mut stream = Stream::default();
        stream.push("grüß".as_bytes());
        let (words, next, cut) = stream.after(0);
        assert_eq!((words.as_str(), cut), ("grüß", false));
        assert_eq!(next, stream.total());
        // A cursor inside a letter starts after it, never half of it.
        assert_eq!(stream.after(3).0, "ß");
        // Half a letter at the end waits for its other half.
        let mut half = Stream::default();
        half.push(&"ü".as_bytes()[..1]);
        assert_eq!(half.after(0), (String::new(), 0, false));

        let mut long = Stream::default();
        long.push(&vec![b'a'; KEPT + 10]);
        assert_eq!(long.dropped, 10);
        let (_, _, skipped) = long.after(0);
        assert!(skipped);
        assert!(long.end().1);
    }

    #[test]
    fn a_question_names_the_program_and_its_arguments() {
        assert_eq!(
            summary("git", &["commit".into(), "-m".into(), "a fix".into()]),
            "Run git commit -m \"a fix\""
        );
    }

    /// A program run to its end, a started one read, written to and killed, and every
    /// one of an agent's ended when it goes - never another agent's.
    #[cfg(unix)]
    #[test]
    fn a_program_runs_and_a_started_one_is_read_written_and_killed() {
        let cwd = std::env::temp_dir();
        let found = located("sh", None, std::ffi::OsStr::new("/bin:/usr/bin")).expect("sh");

        let mut run = process(ProcessOp::Run, "sh");
        run.args = vec![
            "-c".into(),
            "read x; echo out $x; echo err >&2; exit 3".into(),
        ];
        run.stdin = Some("hi\n".into());
        let one = spawned("tester", &found, &run, &cwd, false).expect("ran");
        assert!(!one.wait(Duration::from_secs(10), None, |said| said.ended));
        let said = one.said();
        assert!(said.ended);
        assert_eq!(said.code, Some(3));
        assert_eq!(said.out.end().0, "out hi\n");
        assert_eq!(said.err.end().0, "err\n");
        drop(said);

        let mut start = process(ProcessOp::Start, "sh");
        start.args = vec!["-c".into(), "while read x; do echo got $x; done".into()];
        let kept = spawned("tester", &found, &start, &cwd, true).expect("started");
        let other = spawned("someone-else", &found, &start, &cwd, true).expect("started");
        let mut write = process(ProcessOp::Write, "sh");
        write.stdin = Some("one\n".into());
        assert_eq!(written(&kept, &write).status(), "ok");
        assert!(!kept.wait(Duration::from_secs(10), None, |said| said.out.total() > 0));
        let (output, next, _) = kept.said().out.after(0);
        assert_eq!(output, "got one\n");
        assert_eq!(kept.said().out.after(next).0, "");

        end_all(Some("tester"));
        assert!(!kept.wait(Duration::from_secs(10), None, |said| said.ended));
        assert!(kept.killed.load(Ordering::SeqCst));
        assert!(started().iter().all(|one| one.agent != "tester"));
        assert!(!other.said().ended);
        end_all(Some("someone-else"));
    }
}
