use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::{Deserialize, Serialize};

use super::native;
use super::report::{self, Crumb, Report};

const MARKER: &str = "running.json";

const MOST_CRUMBS: usize = 20;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub version: String,
    pub pid: u32,
    pub started: u64,
    pub alive: u64,
    #[serde(default)]
    pub leaving: bool,
    #[serde(default)]
    pub reported: bool,
    #[serde(default)]
    pub breadcrumbs: Vec<Crumb>,
}

static MINE: Mutex<Option<Running>> = Mutex::new(None);

static PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn marker(dir: &Path) -> PathBuf {
    dir.join(MARKER)
}

pub struct Before {
    pub last: Option<Running>,
    pub booted: Option<u64>,
    pub version: String,
}

pub fn after_last_run(dir: &Path, before: &Before) -> Vec<Report> {
    let mut found = Vec::new();
    let stub = native::stub_path(dir);
    let crashed = std::fs::read_to_string(&stub)
        .ok()
        .and_then(|text| native::read_stub(&text));
    let _ = std::fs::remove_file(&stub);
    if let Some(crash) = crashed {
        let mut report = crash.report;
        if let Some(facts) = report::facts() {
            report.app = facts.app.clone();
            report.system = facts.system.clone();
            let from = before.last.as_ref().map_or(0, |last| last.started);
            report.log = report::log_tail(&facts.log, Some((from, crash.at)));
        }
        if !crash.version.is_empty() {
            report.app.version = crash.version;
        }
        found.push(report);
    }

    for mut ongoing in report::ongoing_in(dir) {
        ongoing.killed = Some(true);
        found.push(ongoing);
    }

    if let Some(last) = &before.last {
        let rebooted = before.booted.is_some_and(|booted| booted > last.alive);
        let updated = last.version != before.version;
        if found.is_empty() && !last.leaving && !last.reported && !rebooted && !updated {
            found.push(ended(last));
        }
    }
    found
}

fn ended(last: &Running) -> Report {
    let mut report = report::fresh(
        "exit",
        &format!(
            "Orden ended without quitting, {} after it started",
            spoken(last.alive.saturating_sub(last.started))
        ),
    );
    report.at = last.alive;
    report.app.version.clone_from(&last.version);
    report.breadcrumbs.clone_from(&last.breadcrumbs);
    report.open = None;
    report.resources = None;
    report.log = report::facts()
        .map(|facts| report::log_tail(&facts.log, Some((last.started, last.alive + 60_000))))
        .unwrap_or_default();
    report
}

fn spoken(millis: u64) -> String {
    let seconds = millis / 1000;
    if seconds < 120 {
        format!("{seconds} s")
    } else if seconds < 7200 {
        format!("{} min", seconds / 60)
    } else {
        format!("{} h", seconds / 3600)
    }
}

pub fn read(dir: &Path) -> Option<Running> {
    let text = std::fs::read(marker(dir)).ok()?;
    serde_json::from_slice(&text).ok()
}

pub fn begin(dir: &Path, version: &str) {
    let now = crate::clock::now();
    let mine = Running {
        version: version.to_owned(),
        pid: std::process::id(),
        started: now,
        alive: now,
        ..Running::default()
    };
    let _ = PATH.set(marker(dir));
    *MINE.lock().unwrap_or_else(PoisonError::into_inner) = Some(mine);
    write();
}

fn changed(change: impl FnOnce(&mut Running)) {
    let mut held = MINE.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(mine) = held.as_mut() {
        change(mine);
    } else {
        return;
    }
    drop(held);
    write();
}

fn write() {
    let Some(path) = PATH.get() else { return };
    let text = {
        let held = MINE.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(mine) = held.as_ref() else { return };
        serde_json::to_vec(mine).unwrap_or_default()
    };
    let partial = path.with_extension("part");
    if std::fs::write(&partial, text).is_ok() {
        let _ = std::fs::rename(&partial, path);
    }
}

pub fn alive() {
    let crumbs = report::crumbs();
    changed(|mine| {
        mine.alive = crate::clock::now();
        mine.breadcrumbs = crumbs[crumbs.len().saturating_sub(MOST_CRUMBS)..].to_vec();
    });
}

pub fn reported() {
    let already = MINE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .is_none_or(|mine| mine.reported);
    if !already {
        changed(|mine| mine.reported = true);
    }
}

pub fn leaving() {
    changed(|mine| mine.leaving = true);
}

pub fn ended_well() {
    *MINE.lock().unwrap_or_else(PoisonError::into_inner) = None;
    if let Some(path) = PATH.get() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "how long Windows has run is GetTickCount64's to say"
)]
#[allow(
    clippy::unnecessary_wraps,
    reason = "one signature on every system; only Windows always knows"
)]
pub fn booted() -> Option<u64> {
    let since = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() };
    Some(crate::clock::now().saturating_sub(since))
}

#[cfg(target_os = "linux")]
pub fn booted() -> Option<u64> {
    let stat = std::fs::read_to_string("/proc/stat").ok()?;
    let seconds: u64 = stat
        .lines()
        .find_map(|line| line.strip_prefix("btime "))?
        .trim()
        .parse()
        .ok()?;
    Some(seconds * 1000)
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code, reason = "the boot time is asked of sysctl")]
pub fn booted() -> Option<u64> {
    let mut when: libc::timeval = unsafe { std::mem::zeroed() };
    let mut size = std::mem::size_of::<libc::timeval>();
    let asked = unsafe {
        libc::sysctlbyname(
            c"kern.boottime".as_ptr(),
            (&raw mut when).cast(),
            &raw mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if asked != 0 {
        return None;
    }
    Some(u64::try_from(when.tv_sec).ok()? * 1000)
}

#[cfg(test)]
mod tests {
    use super::{after_last_run, marker, Before, Running};
    use crate::crashes::report::{keep_in, Report};

    fn last(alive: u64) -> Running {
        Running {
            version: "1.0.0".to_owned(),
            pid: 7,
            started: 1000,
            alive,
            ..Running::default()
        }
    }

    fn before(last: Option<Running>, booted: u64) -> Before {
        Before {
            last,
            booted: Some(booted),
            version: "1.0.0".to_owned(),
        }
    }

    #[test]
    fn a_run_that_ended_without_quitting_is_reported_once_it_is_seen() {
        let dir = tempfile::tempdir().expect("a folder");
        let found = after_last_run(dir.path(), &before(Some(last(90_000)), 10));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "exit");
        assert_eq!(
            found[0].summary,
            "Orden ended without quitting, 89 s after it started"
        );
        assert_eq!(found[0].at, 90_000);
    }

    #[test]
    fn a_run_ended_by_a_restart_an_update_or_a_quit_is_not_reported() {
        let dir = tempfile::tempdir().expect("a folder");
        assert!(after_last_run(dir.path(), &before(Some(last(90_000)), 100_000)).is_empty());
        let mut leaving = last(90_000);
        leaving.leaving = true;
        assert!(after_last_run(dir.path(), &before(Some(leaving), 10)).is_empty());
        let mut older = last(90_000);
        older.version = "0.9.0".to_owned();
        assert!(after_last_run(dir.path(), &before(Some(older), 10)).is_empty());
        assert!(after_last_run(dir.path(), &before(None, 10)).is_empty());
        assert!(!marker(dir.path()).exists());
    }

    #[test]
    fn a_freeze_the_last_run_was_killed_in_is_reported_as_killed_and_alone() {
        let dir = tempfile::tempdir().expect("a folder");
        let freeze = Report {
            v: 1,
            id: "00112233445566778899aabbccddeeff".to_owned(),
            kind: "freeze".to_owned(),
            held: Some(41_000),
            ..Report::default()
        };
        keep_in(dir.path(), &freeze, true).expect("kept");
        let found = after_last_run(dir.path(), &before(Some(last(90_000)), 10));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "freeze");
        assert_eq!(found[0].killed, Some(true));
    }

    #[test]
    fn a_native_crash_the_last_run_wrote_is_reported_in_place_of_its_exit() {
        let dir = tempfile::tempdir().expect("a folder");
        std::fs::write(
            dir.path().join(crate::crashes::native::STUB),
            "orden-crash 1\nat 5000\nversion 1.0.0\nwhat SIGSEGV\ncode 0x1\naddress 0x0\nthread main\nmain 1\nframe nib\t0x10\t\n",
        )
        .expect("a stub");
        let found = after_last_run(dir.path(), &before(Some(last(90_000)), 10));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "crash");
        assert_eq!(found[0].app.version, "1.0.0");
        assert!(!dir.path().join(crate::crashes::native::STUB).exists());
    }
}
