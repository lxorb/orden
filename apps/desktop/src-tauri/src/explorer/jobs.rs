use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter as _, Manager as _};

use super::bin::{self, Ticket};
use super::changes::gone;
use super::listing::{asked, listed, Entry};
use super::reach::{Explored, Use};
use crate::paths::{free_spot, inside};

const PROGRESS: &str = "explorer://progress";

const FOUND: &str = "explorer://found";

const EVERY: Duration = Duration::from_millis(120);

const CHUNK: usize = 1024 * 1024;

const MOST_FOUND: usize = 5_000;
const MOST_WALKED: usize = 500_000;

static RUNNING: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static CANCELLED_EARLY: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

const MOST_CANCELLED_EARLY: usize = 64;

struct Job {
    id: String,
    stop: Arc<AtomicBool>,
}

impl Job {
    fn begin(id: &str) -> Self {
        let early = CANCELLED_EARLY.lock().is_ok_and(|mut early| {
            let was = early.iter().position(|one| one == id);
            was.and_then(|at| early.remove(at)).is_some()
        });
        let stop = Arc::new(AtomicBool::new(early));
        if let Ok(mut running) = RUNNING.lock() {
            running.insert(id.to_owned(), Arc::clone(&stop));
        }
        Self {
            id: id.to_owned(),
            stop,
        }
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut running) = RUNNING.lock() {
            running.remove(&self.id);
        }
    }
}

#[tauri::command]
pub fn explorer_cancel(job: String) {
    if let Ok(running) = RUNNING.lock() {
        if let Some(stop) = running.get(&job) {
            stop.store(true, Ordering::Relaxed);
            return;
        }
    }
    if let Ok(mut early) = CANCELLED_EARLY.lock() {
        if early.len() >= MOST_CANCELLED_EARLY {
            early.pop_front();
        }
        early.push_back(job);
    }
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum How {
    Copy,
    Move,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Clash {
    Replace,
    Skip,
    Keep,
}

#[derive(Serialize, Clone)]
struct Progress<'a> {
    job: &'a str,
    bytes: u64,
    total: u64,
    items: usize,
    count: usize,
    name: &'a str,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Moved {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Failed {
    pub path: String,
    pub why: String,
}

#[derive(Serialize, Default, Debug)]
pub struct Transferred {
    pub done: Vec<Moved>,
    pub replaced: Vec<Ticket>,
    pub skipped: Vec<String>,
    pub failed: Vec<Failed>,
    pub cancelled: bool,
}

#[tauri::command]
pub async fn explorer_clashes(
    app: AppHandle,
    sources: Vec<String>,
    folder: String,
) -> Result<Vec<String>, String> {
    crate::lane::off_the_runtime(move || -> Result<Vec<String>, String> {
        let folder = asked(&app, &folder, Use::Into)?;
        let mut out = Vec::new();
        for one in &sources {
            let from = asked(&app, one, Use::Look)?;
            let Some(name) = from.file_name() else {
                continue;
            };
            let to = folder.join(name);
            if !same(&from, &to) && fs::symlink_metadata(&to).is_ok() {
                out.push(name.to_string_lossy().into_owned());
            }
        }
        Ok(out)
    })
    .await
}

fn same(one: &Path, other: &Path) -> bool {
    inside(one, other) && inside(other, one)
}

#[tauri::command]
pub async fn explorer_transfer(
    app: AppHandle,
    job: String,
    sources: Vec<String>,
    folder: String,
    how: How,
    clash: Clash,
) -> Result<Transferred, String> {
    crate::lane::off_the_runtime(move || -> Result<Transferred, String> {
        let folder = asked(&app, &folder, Use::Into)?;
        let using = if how == How::Move {
            Use::Change
        } else {
            Use::Look
        };
        let froms: Vec<PathBuf> = sources
            .iter()
            .map(|one| asked(&app, one, using))
            .collect::<Result<_, _>>()?;
        let running = Job::begin(&job);
        let mut out = Transferred::default();
        let plan = planned(&froms, &folder, how, clash, &mut out);
        let mut meter = Meter {
            app: Some(&app),
            job: &job,
            total: plan.iter().map(|(from, _)| weight(from, &running)).sum(),
            bytes: 0,
            items: 0,
            count: plan.len(),
            said: None,
        };
        for (from, to) in plan {
            if running.stopped() {
                out.cancelled = true;
                break;
            }
            if clash == Clash::Replace && fs::symlink_metadata(&to).is_ok() {
                match bin::trash(&to) {
                    Ok(ticket) => out.replaced.push(ticket),
                    Err(why) => {
                        out.failed.push(failed(&from, why));
                        continue;
                    }
                }
            }
            match carried(&from, &to, how, &running, &mut meter) {
                Ok(()) => out.done.push(Moved {
                    from: from.display().to_string(),
                    to: to.display().to_string(),
                }),
                Err(Stop::Cancelled) => {
                    out.cancelled = true;
                    break;
                }
                Err(Stop::Failed(why)) => out.failed.push(failed(&from, why)),
            }
            meter.items += 1;
        }
        meter.say(true);
        Ok(out)
    })
    .await
}

fn failed(path: &Path, why: String) -> Failed {
    Failed {
        path: path.display().to_string(),
        why,
    }
}

fn planned(
    froms: &[PathBuf],
    folder: &Path,
    how: How,
    clash: Clash,
    out: &mut Transferred,
) -> Vec<(PathBuf, PathBuf)> {
    let mut plan = Vec::new();
    for from in froms {
        let Some(name) = from.file_name() else {
            continue;
        };
        let is_file = !fs::symlink_metadata(from).is_ok_and(|meta| meta.is_dir());
        let mut to = folder.join(name);
        if inside(from, folder) {
            out.failed
                .push(failed(from, "a folder cannot go inside itself".to_owned()));
            continue;
        }
        if same(from, &to) {
            if how == How::Move {
                continue;
            }
            to = free_spot(&to, is_file);
        } else if fs::symlink_metadata(&to).is_ok() {
            match clash {
                Clash::Replace => {}
                Clash::Skip => {
                    out.skipped.push(from.display().to_string());
                    continue;
                }
                Clash::Keep => to = free_spot(&to, is_file),
            }
        }
        plan.push((from.clone(), to));
    }
    plan
}

fn weight(path: &Path, running: &Job) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !meta.is_dir() {
        return meta.len();
    }
    let mut total = 0;
    let mut waiting = vec![path.to_path_buf()];
    while let Some(folder) = waiting.pop() {
        if running.stopped() {
            break;
        }
        for one in fs::read_dir(&folder).into_iter().flatten().flatten() {
            match one.file_type() {
                Ok(kind) if kind.is_dir() => waiting.push(one.path()),
                Ok(kind) if kind.is_file() => {
                    total += one.metadata().map_or(0, |meta| meta.len());
                }
                _ => {}
            }
        }
    }
    total
}

enum Stop {
    Cancelled,
    Failed(String),
}

struct Meter<'a> {
    app: Option<&'a AppHandle>,
    job: &'a str,
    total: u64,
    bytes: u64,
    items: usize,
    count: usize,
    said: Option<Instant>,
}

impl Meter<'_> {
    fn add(&mut self, bytes: u64, name: &str) {
        self.bytes += bytes;
        if self.said.is_none_or(|at| at.elapsed() >= EVERY) {
            self.said = Some(Instant::now());
            self.emit(name);
        }
    }

    fn say(&mut self, last: bool) {
        if last || self.said.is_none_or(|at| at.elapsed() >= EVERY) {
            self.said = Some(Instant::now());
            self.emit("");
        }
    }

    fn emit(&self, name: &str) {
        let Some(app) = self.app else {
            return;
        };
        let _ = app.emit(
            PROGRESS,
            Progress {
                job: self.job,
                bytes: self.bytes,
                total: self.total,
                items: self.items,
                count: self.count,
                name,
            },
        );
    }
}

fn carried(from: &Path, to: &Path, how: How, running: &Job, meter: &mut Meter) -> Result<(), Stop> {
    if how == How::Move {
        let bytes = weight(from, running);
        if fs::rename(from, to).is_ok() {
            meter.add(bytes, "");
            return Ok(());
        }
    }
    let copied = copied(from, to, running, meter);
    if copied.is_err() {
        let _ = gone(to);
        return copied;
    }
    if how == How::Move {
        gone(from).map_err(Stop::Failed)?;
    }
    Ok(())
}

fn copied(from: &Path, to: &Path, running: &Job, meter: &mut Meter) -> Result<(), Stop> {
    let fail = |why: std::io::Error| Stop::Failed(format!("{}: {why}", from.display()));
    let meta = fs::symlink_metadata(from).map_err(fail)?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(from).map_err(fail)?;
        return crate::agents::files::linked(from, &target, to).map_err(fail);
    }
    if meta.is_dir() {
        fs::create_dir(to).map_err(fail)?;
        for one in fs::read_dir(from).map_err(fail)?.flatten() {
            if running.stopped() {
                return Err(Stop::Cancelled);
            }
            copied(&one.path(), &to.join(one.file_name()), running, meter)?;
        }
        let _ = fs::set_permissions(to, meta.permissions());
        return Ok(());
    }
    let name = from
        .file_name()
        .map(|one| one.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut source = fs::File::open(from).map_err(fail)?;
    let mut target = fs::File::create_new(to).map_err(fail)?;
    let mut buffer = vec![0; CHUNK];
    loop {
        if running.stopped() {
            return Err(Stop::Cancelled);
        }
        let read = source.read(&mut buffer).map_err(fail)?;
        if read == 0 {
            break;
        }
        target.write_all(&buffer[..read]).map_err(fail)?;
        meter.add(read as u64, &name);
    }
    if let Ok(modified) = meta.modified() {
        let _ = target.set_modified(modified);
    }
    let _ = target.set_permissions(meta.permissions());
    Ok(())
}

#[derive(Deserialize, Clone, Debug)]
pub struct Pair {
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn explorer_put(
    app: AppHandle,
    job: String,
    pairs: Vec<Pair>,
    how: How,
) -> Result<Transferred, String> {
    crate::lane::off_the_runtime(move || -> Result<Transferred, String> {
        let using = if how == How::Move {
            Use::Change
        } else {
            Use::Look
        };
        let judged: Vec<(PathBuf, PathBuf)> = pairs
            .iter()
            .map(|one| {
                Ok((
                    asked(&app, &one.from, using)?,
                    asked(&app, &one.to, Use::Change)?,
                ))
            })
            .collect::<Result<_, String>>()?;
        let running = Job::begin(&job);
        let mut out = Transferred::default();
        let mut meter = Meter {
            app: Some(&app),
            job: &job,
            total: judged.iter().map(|(from, _)| weight(from, &running)).sum(),
            bytes: 0,
            items: 0,
            count: judged.len(),
            said: None,
        };
        for (from, to) in judged {
            if running.stopped() {
                out.cancelled = true;
                break;
            }
            if fs::symlink_metadata(&to).is_ok() {
                out.failed
                    .push(failed(&from, format!("{} is there already", to.display())));
                continue;
            }
            match carried(&from, &to, how, &running, &mut meter) {
                Ok(()) => out.done.push(Moved {
                    from: from.display().to_string(),
                    to: to.display().to_string(),
                }),
                Err(Stop::Cancelled) => {
                    out.cancelled = true;
                    break;
                }
                Err(Stop::Failed(why)) => out.failed.push(failed(&from, why)),
            }
            meter.items += 1;
        }
        meter.say(true);
        Ok(out)
    })
    .await
}

#[derive(Serialize, Default)]
pub struct Count {
    pub files: u64,
    pub folders: u64,
    pub bytes: u64,
    pub cancelled: bool,
}

#[tauri::command]
pub async fn explorer_count(app: AppHandle, job: String, path: String) -> Result<Count, String> {
    crate::lane::off_the_runtime(move || -> Result<Count, String> {
        let root = asked(&app, &path, Use::Look)?;
        let running = Job::begin(&job);
        let mut out = Count::default();
        let mut waiting = vec![root];
        while let Some(folder) = waiting.pop() {
            if running.stopped() {
                out.cancelled = true;
                break;
            }
            for one in fs::read_dir(&folder).into_iter().flatten().flatten() {
                match one.file_type() {
                    Ok(kind) if kind.is_dir() => {
                        out.folders += 1;
                        waiting.push(one.path());
                    }
                    Ok(_) => {
                        out.files += 1;
                        out.bytes += one.metadata().map_or(0, |meta| meta.len());
                    }
                    Err(_) => {}
                }
            }
        }
        Ok(out)
    })
    .await
}

#[derive(Serialize, Clone)]
pub struct Found {
    pub within: String,
    #[serde(flatten)]
    pub entry: Entry,
}

#[derive(Serialize, Clone)]
struct Finding<'a> {
    job: &'a str,
    found: &'a [Found],
}

#[derive(Serialize, Default)]
pub struct Searched {
    pub found: usize,
    pub cut: bool,
    pub cancelled: bool,
}

#[tauri::command]
pub async fn explorer_search(
    app: AppHandle,
    job: String,
    folder: String,
    query: String,
    hidden: bool,
) -> Result<Searched, String> {
    crate::lane::off_the_runtime(move || -> Result<Searched, String> {
        let root = asked(&app, &folder, Use::Look)?;
        let running = Job::begin(&job);
        let explored = app.state::<Explored>();
        let mut out = Searched::default();
        let mut batch = Vec::new();
        let mut said = Instant::now();
        let send = |batch: &mut Vec<Found>| {
            if !batch.is_empty() {
                let _ = app.emit(
                    FOUND,
                    Finding {
                        job: &job,
                        found: batch,
                    },
                );
                batch.clear();
            }
        };
        walk_matching(
            &root,
            &query,
            hidden,
            &running,
            &mut out,
            |folder, found| {
                explored.saw(folder);
                batch.push(Found {
                    within: folder.display().to_string(),
                    entry: found,
                });
                if said.elapsed() >= EVERY {
                    said = Instant::now();
                    send(&mut batch);
                }
            },
        );
        send(&mut batch);
        Ok(out)
    })
    .await
}

fn walk_matching(
    root: &Path,
    query: &str,
    hidden: bool,
    running: &Job,
    out: &mut Searched,
    mut found: impl FnMut(&Path, Entry),
) {
    let wanted = query.trim().to_lowercase();
    if wanted.is_empty() {
        return;
    }
    let mut waiting = std::collections::VecDeque::from([root.to_path_buf()]);
    let mut walked = 0;
    while let Some(folder) = waiting.pop_front() {
        if running.stopped() {
            out.cancelled = true;
            return;
        }
        for one in fs::read_dir(&folder).into_iter().flatten().flatten() {
            walked += 1;
            if walked > MOST_WALKED || out.found >= MOST_FOUND {
                out.cut = true;
                return;
            }
            let Some(item) = listed(&one) else {
                continue;
            };
            if item.hidden && !hidden {
                continue;
            }
            if item.kind == super::listing::Kind::Folder {
                waiting.push_back(one.path());
            }
            if item.name.to_lowercase().contains(&wanted) {
                out.found += 1;
                found(&folder, item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        carried, planned, walk_matching, Clash, How, Job, Meter, Searched, Stop, Transferred,
    };
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn a_clash_is_decided_before_anything_is_written() {
        let dir = tempfile::tempdir().expect("a folder");
        let (here, there) = (dir.path().join("here"), dir.path().join("there"));
        fs::create_dir_all(&here).expect("here");
        fs::create_dir_all(&there).expect("there");
        fs::write(here.join("a.txt"), "new").expect("a");
        fs::write(there.join("a.txt"), "old").expect("a there");
        let from = vec![here.join("a.txt")];

        let mut out = Transferred::default();
        let plan = planned(&from, &there, How::Copy, Clash::Skip, &mut out);
        assert!(plan.is_empty());
        assert_eq!(out.skipped.len(), 1);

        let mut out = Transferred::default();
        let plan = planned(&from, &there, How::Copy, Clash::Keep, &mut out);
        assert_eq!(plan, [(here.join("a.txt"), there.join("a 2.txt"))]);

        let mut out = Transferred::default();
        let plan = planned(&from, &there, How::Move, Clash::Replace, &mut out);
        assert_eq!(plan, [(here.join("a.txt"), there.join("a.txt"))]);
        assert_eq!(fs::read_to_string(there.join("a.txt")).expect("old"), "old");
    }

    #[test]
    fn a_copy_into_its_own_folder_lands_beside_itself_and_a_move_there_is_nothing() {
        let dir = tempfile::tempdir().expect("a folder");
        fs::write(dir.path().join("a.txt"), "a").expect("a");
        let from = vec![dir.path().join("a.txt")];
        let mut out = Transferred::default();
        let plan = planned(&from, dir.path(), How::Copy, Clash::Skip, &mut out);
        assert_eq!(
            plan,
            [(dir.path().join("a.txt"), dir.path().join("a 2.txt"))]
        );
        assert!(planned(&from, dir.path(), How::Move, Clash::Skip, &mut out).is_empty());
    }

    #[test]
    fn a_folder_cannot_go_inside_itself() {
        let dir = tempfile::tempdir().expect("a folder");
        let folder = dir.path().join("f");
        fs::create_dir_all(folder.join("deeper")).expect("folders");
        let mut out = Transferred::default();
        let plan = planned(
            std::slice::from_ref(&folder),
            &folder.join("deeper"),
            How::Move,
            Clash::Skip,
            &mut out,
        );
        assert!(plan.is_empty());
        assert_eq!(out.failed.len(), 1);
    }

    fn meter() -> Meter<'static> {
        Meter {
            app: None,
            job: "test",
            total: 0,
            bytes: 0,
            items: 0,
            count: 0,
            said: None,
        }
    }

    #[test]
    fn a_folder_is_copied_whole_and_moved_with_nothing_left_behind() {
        let dir = tempfile::tempdir().expect("a folder");
        let from = dir.path().join("from");
        fs::create_dir_all(from.join("inner")).expect("folders");
        fs::write(from.join("inner/a.txt"), "four").expect("a file");
        fs::write(from.join("b.txt"), "six!!!").expect("a file");
        let running = Job::begin("test-copy");
        let mut counted = meter();
        let copy = dir.path().join("copy");
        assert!(carried(&from, &copy, How::Copy, &running, &mut counted).is_ok());
        assert_eq!(
            fs::read_to_string(copy.join("inner/a.txt")).expect("copied"),
            "four"
        );
        assert_eq!(counted.bytes, 10);
        let moved = dir.path().join("moved");
        assert!(carried(&copy, &moved, How::Move, &running, &mut counted).is_ok());
        assert!(!copy.exists());
        assert!(moved.join("b.txt").is_file());
        assert!(from.join("b.txt").is_file());
    }

    #[test]
    fn a_cancelled_copy_takes_away_what_it_wrote() {
        let dir = tempfile::tempdir().expect("a folder");
        let from = dir.path().join("from");
        fs::create_dir_all(&from).expect("a folder");
        fs::write(from.join("a.txt"), "a").expect("a file");
        let running = Job::begin("test-cancel");
        files_tab_cancel_named("test-cancel");
        let to = dir.path().join("to");
        let copied = carried(&from, &to, How::Copy, &running, &mut meter());
        assert!(matches!(copied, Err(Stop::Cancelled)));
        assert!(!to.exists());
        assert!(from.join("a.txt").is_file());
    }

    #[test]
    fn a_job_cancelled_before_it_began_begins_stopped_and_only_once() {
        files_tab_cancel_named("test-early");
        assert!(Job::begin("test-early").stopped());
        assert!(!Job::begin("test-early").stopped());
        for one in 0..200 {
            files_tab_cancel_named(&format!("test-gone-{one}"));
        }
        assert!(super::CANCELLED_EARLY.lock().expect("the list").len() <= 64);
    }

    fn files_tab_cancel_named(job: &str) {
        super::explorer_cancel(job.to_owned());
    }

    #[test]
    fn a_search_finds_names_below_and_keeps_out_of_hidden_folders() {
        let dir = tempfile::tempdir().expect("a folder");
        fs::create_dir_all(dir.path().join("a/b")).expect("folders");
        fs::create_dir_all(dir.path().join(".cache")).expect("hidden");
        fs::write(dir.path().join("a/b/Plan.txt"), "").expect("deep");
        fs::write(dir.path().join(".cache/plan.txt"), "").expect("hidden");
        fs::write(dir.path().join("other.txt"), "").expect("other");
        let running = Job::begin("test-search");
        let mut found: Vec<PathBuf> = Vec::new();
        let mut out = Searched::default();
        walk_matching(
            dir.path(),
            "PLAN",
            false,
            &running,
            &mut out,
            |folder, one| {
                found.push(folder.join(one.name));
            },
        );
        assert_eq!(found, [dir.path().join("a/b/Plan.txt")]);
        let mut out = Searched::default();
        let mut all = 0;
        walk_matching(dir.path(), "plan", true, &running, &mut out, |_, _| {
            all += 1;
        });
        assert_eq!(all, 2);
    }
}
