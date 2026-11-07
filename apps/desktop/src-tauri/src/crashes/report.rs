use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::stacks::Thread;

pub const MOST_KEPT: usize = 50;

pub const KEPT_DAYS: u64 = 30;

const MOST_CRUMBS: usize = 50;

const LOG_LINES: usize = 120;

const DONE: &str = "json";

const ONGOING: &str = "ongoing";

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub version: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub build: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct System {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub engine: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Crumb {
    pub at: u64,
    pub what: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
pub struct Open {
    pub windows: usize,
    pub kinds: BTreeMap<String, u32>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
pub struct Resources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub v: u8,
    pub id: String,
    pub kind: String,
    pub at: u64,
    pub app: App,
    pub system: System,
    pub summary: String,
    #[serde(rename = "where", skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doing: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub held: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub killed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub threads: Vec<Thread>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub breadcrumbs: Vec<Crumb>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub log: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open: Option<Open>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<Resources>,
}

pub struct Facts {
    pub dir: PathBuf,
    pub log: PathBuf,
    pub app: App,
    pub system: System,
}

static FACTS: OnceLock<Facts> = OnceLock::new();

static STARTED: OnceLock<Instant> = OnceLock::new();

static CRUMBS: Mutex<VecDeque<Crumb>> = Mutex::new(VecDeque::new());

static KINDS: Mutex<BTreeMap<String, u32>> = Mutex::new(BTreeMap::new());

static WINDOWS: Mutex<usize> = Mutex::new(0);

pub fn settle(facts: Facts) {
    let _ = STARTED.get_or_init(Instant::now);
    let _ = FACTS.set(facts);
}

pub fn facts() -> Option<&'static Facts> {
    FACTS.get()
}

pub fn crumb(what: &str) {
    let mut held = CRUMBS.lock().unwrap_or_else(PoisonError::into_inner);
    if held.len() >= MOST_CRUMBS {
        held.pop_front();
    }
    held.push_back(Crumb {
        at: crate::clock::now(),
        what: what.chars().take(80).collect(),
    });
}

pub fn crumbs() -> Vec<Crumb> {
    CRUMBS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .cloned()
        .collect()
}

pub fn crumbs_now() -> Option<std::sync::MutexGuard<'static, VecDeque<Crumb>>> {
    CRUMBS.try_lock().ok()
}

pub fn shape(kinds: BTreeMap<String, u32>) {
    *KINDS.lock().unwrap_or_else(PoisonError::into_inner) = kinds;
}

pub fn windows(count: usize) {
    *WINDOWS.lock().unwrap_or_else(PoisonError::into_inner) = count;
}

fn open() -> Open {
    Open {
        windows: *WINDOWS.lock().unwrap_or_else(PoisonError::into_inner),
        kinds: KINDS.lock().unwrap_or_else(PoisonError::into_inner).clone(),
    }
}

pub fn uptime() -> u64 {
    STARTED.get().map_or(0, |started| {
        u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
    })
}

pub fn fresh_id() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        let now = crate::clock::now().to_le_bytes();
        bytes[..8].copy_from_slice(&now);
        bytes[8..12].copy_from_slice(&std::process::id().to_le_bytes());
    }
    bytes
        .iter()
        .fold(String::with_capacity(32), |mut out, byte| {
            use std::fmt::Write as _;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

pub fn fresh(kind: &str, summary: &str) -> Report {
    let (app, system) = facts().map_or_else(Default::default, |facts| {
        (facts.app.clone(), facts.system.clone())
    });
    Report {
        v: 1,
        id: fresh_id(),
        kind: kind.to_owned(),
        at: crate::clock::now(),
        app,
        system,
        summary: summary.chars().take(300).collect(),
        breadcrumbs: crumbs(),
        log: facts()
            .map(|facts| log_tail(&facts.log, None))
            .unwrap_or_default(),
        open: Some(open()),
        resources: Some(super::load::resources(uptime())),
        ..Report::default()
    }
}

pub fn log_tail(log: &Path, within: Option<(u64, u64)>) -> Vec<String> {
    let older = fs::read_to_string(log.with_extension("log.1")).unwrap_or_default();
    let newer = fs::read_to_string(log).unwrap_or_default();
    let span = within.map(|(from, to)| (crate::clock::iso(from), crate::clock::iso(to)));
    let lines: Vec<&str> = older
        .lines()
        .chain(newer.lines())
        .filter(|line| {
            span.as_ref().is_none_or(|(from, to)| {
                let at = line.split(' ').next().unwrap_or_default();
                at >= from.as_str() && at <= to.as_str()
            })
        })
        .collect();
    lines[lines.len().saturating_sub(LOG_LINES)..]
        .iter()
        .map(|line| line.chars().take(2000).collect())
        .collect()
}

fn path_of(dir: &Path, id: &str, ongoing: bool) -> PathBuf {
    if ongoing {
        dir.join(format!("{id}.{ONGOING}.{DONE}"))
    } else {
        dir.join(format!("{id}.{DONE}"))
    }
}

pub fn keep_in(dir: &Path, report: &Report, ongoing: bool) -> Result<(), String> {
    crate::paths::made(dir)?;
    let text = serde_json::to_vec(report).map_err(|error| error.to_string())?;
    let target = path_of(dir, &report.id, ongoing);
    let partial = target.with_extension("part");
    fs::write(&partial, text).map_err(|error| error.to_string())?;
    fs::rename(&partial, &target).map_err(|error| error.to_string())?;
    if !ongoing {
        let _ = fs::remove_file(path_of(dir, &report.id, true));
        prune(dir, MOST_KEPT, KEPT_DAYS);
    }
    Ok(())
}

fn writer() -> &'static std::sync::mpsc::Sender<(Report, bool)> {
    static WRITER: OnceLock<std::sync::mpsc::Sender<(Report, bool)>> = OnceLock::new();
    WRITER.get_or_init(|| crate::lane::lane(kept_later))
}

fn kept_later((report, ongoing): (Report, bool)) {
    keep_now(&report, ongoing);
}

pub fn keep(report: &Report, ongoing: bool) {
    let _ = writer().send((report.clone(), ongoing));
}

pub fn keep_now(report: &Report, ongoing: bool) {
    let Some(facts) = facts() else { return };
    if keep_in(&facts.dir, report, ongoing).is_ok() {
        if report.kind == "panic" {
            super::exit::reported();
        }
        if !ongoing {
            super::told();
        }
    }
}

pub fn waiting_in(dir: &Path) -> Vec<Report> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<Report> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_done(path))
        .filter_map(|path| fs::read(&path).ok())
        .filter_map(|bytes| serde_json::from_slice::<Report>(&bytes).ok())
        .collect();
    found.sort_by_key(|one| one.at);
    found
}

pub fn ongoing_in(dir: &Path) -> Vec<Report> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&format!(".{ONGOING}.{DONE}")))
        })
        .filter_map(|path| fs::read(&path).ok())
        .filter_map(|bytes| serde_json::from_slice::<Report>(&bytes).ok())
        .collect()
}

fn is_done(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix(&format!(".{DONE}")))
        .is_some_and(|id| id.len() == 32 && id.chars().all(|one| one.is_ascii_hexdigit()))
}

pub fn drop_in(dir: &Path, id: &str) -> Result<(), String> {
    if id.len() != 32 || !id.chars().all(|one| one.is_ascii_hexdigit()) {
        return Err("that is not a report".to_owned());
    }
    match fs::remove_file(path_of(dir, id, false)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn prune(dir: &Path, most: usize, days: u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let oldest = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(days * 86_400))
        .unwrap_or(std::time::UNIX_EPOCH);
    let mut kept: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_done(path))
        .filter_map(|path| {
            let made = fs::metadata(&path).and_then(|one| one.modified()).ok()?;
            Some((made, path))
        })
        .collect();
    kept.sort();
    let over = kept.len().saturating_sub(most);
    for (at, (made, path)) in kept.iter().enumerate() {
        if at < over || *made < oldest {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{drop_in, keep_in, log_tail, ongoing_in, prune, waiting_in, Report};

    fn one(id: &str, at: u64) -> Report {
        Report {
            v: 1,
            id: id.to_owned(),
            kind: "panic".to_owned(),
            at,
            summary: "it broke".to_owned(),
            ..Report::default()
        }
    }

    #[test]
    fn a_kept_report_waits_until_it_is_sent() {
        let dir = tempfile::tempdir().expect("a folder");
        let id = "0123456789abcdef0123456789abcdef";
        keep_in(dir.path(), &one(id, 5), false).expect("kept");

        let waiting = waiting_in(dir.path());
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0].summary, "it broke");

        drop_in(dir.path(), id).expect("dropped");
        assert!(waiting_in(dir.path()).is_empty());
        assert!(drop_in(dir.path(), "../nib.log").is_err());
    }

    #[test]
    fn an_ongoing_report_does_not_wait_until_it_is_done() {
        let dir = tempfile::tempdir().expect("a folder");
        let id = "fedcba9876543210fedcba9876543210";
        keep_in(dir.path(), &one(id, 5), true).expect("kept");
        assert!(waiting_in(dir.path()).is_empty());
        assert_eq!(ongoing_in(dir.path()).len(), 1);

        keep_in(dir.path(), &one(id, 5), false).expect("done");
        assert!(ongoing_in(dir.path()).is_empty());
        assert_eq!(waiting_in(dir.path()).len(), 1);
    }

    #[test]
    fn only_the_newest_reports_are_kept() {
        let dir = tempfile::tempdir().expect("a folder");
        for index in 0..8u64 {
            let id = format!("{index:032x}");
            keep_in(dir.path(), &one(&id, index), false).expect("kept");
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        prune(dir.path(), 3, 30);
        let left: Vec<u64> = waiting_in(dir.path()).iter().map(|one| one.at).collect();
        assert_eq!(left, vec![5, 6, 7]);
    }

    #[test]
    fn the_log_of_a_run_is_the_lines_written_during_it() {
        let dir = tempfile::tempdir().expect("a folder");
        let log = dir.path().join("nib.log");
        std::fs::write(
            &log,
            "2026-10-03T22:11:00.000Z INFO  before\n2026-10-03T22:11:03.685Z WARN  during\n2026-10-03T22:12:00.000Z INFO  after\n",
        )
        .expect("a log");
        let during = log_tail(&log, Some((1_791_065_462_000, 1_791_065_464_000)));
        assert_eq!(during, vec!["2026-10-03T22:11:03.685Z WARN  during"]);
        assert_eq!(log_tail(&log, None).len(), 3);
    }
}
