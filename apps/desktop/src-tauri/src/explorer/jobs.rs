use std::collections::{HashMap, HashSet, VecDeque};
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
use crate::paths::{first_spot, inside, path_key, taken};

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
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub stayed: bool,
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
    staying: Option<Vec<String>>,
) -> Result<Transferred, String> {
    crate::lane::off_the_runtime(move || -> Result<Transferred, String> {
        let folder = asked(&app, &folder, Use::Into)?;
        let staying: HashSet<&str> = staying.iter().flatten().map(String::as_str).collect();
        let how_of = |one: &str| {
            if staying.contains(one) {
                How::Copy
            } else {
                how
            }
        };
        let mut hows = HashMap::new();
        let mut froms = Vec::new();
        for one in &sources {
            let item = how_of(one);
            let using = if item == How::Move {
                Use::Change
            } else {
                Use::Look
            };
            let from = asked(&app, one, using)?;
            hows.insert(from.clone(), item);
            froms.push(from);
        }
        let running = Job::begin(&job);
        let mut out = Transferred::default();
        let item_how = |from: &Path| hows.get(from).copied().unwrap_or(how);
        let plan = planned_by(&froms, &folder, &item_how, clash, &mut out);
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
            let item = item_how(&from);
            match carried(&from, &to, item, &running, &mut meter) {
                Ok(()) => out.done.push(Moved {
                    from: from.display().to_string(),
                    to: to.display().to_string(),
                    stayed: item != how,
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

#[cfg(test)]
fn planned(
    froms: &[PathBuf],
    folder: &Path,
    how: How,
    clash: Clash,
    out: &mut Transferred,
) -> Vec<(PathBuf, PathBuf)> {
    planned_by(froms, folder, &|_| how, clash, out)
}

fn planned_by(
    froms: &[PathBuf],
    folder: &Path,
    how: &dyn Fn(&Path) -> How,
    clash: Clash,
    out: &mut Transferred,
) -> Vec<(PathBuf, PathBuf)> {
    let mut plan = Vec::new();
    let mut landing = HashSet::new();
    for from in froms {
        let Some(name) = from.file_name() else {
            continue;
        };
        let is_file = !fs::symlink_metadata(from).is_ok_and(|meta| meta.is_dir());
        let free = |to: &Path| {
            first_spot(to, is_file, |one| {
                !taken(one, is_file) && !landing.contains(&path_key(one))
            })
        };
        let mut to = folder.join(name);
        if crate::carry::goes_into_itself(from, folder) {
            out.failed
                .push(failed(from, "a folder cannot go inside itself".to_owned()));
            continue;
        }
        if same(from, &to) {
            if how(from) == How::Move {
                continue;
            }
            to = free(&to);
        } else if landing.contains(&path_key(&to)) {
            if clash == Clash::Skip {
                out.skipped.push(from.display().to_string());
                continue;
            }
            to = free(&to);
        } else if fs::symlink_metadata(&to).is_ok() {
            match clash {
                Clash::Replace if froms.iter().any(|one| inside(&to, one)) => {
                    out.failed.push(failed(
                        from,
                        format!(
                            "{} holds what is being carried, so it cannot be replaced",
                            to.display()
                        ),
                    ));
                    continue;
                }
                Clash::Replace => {}
                Clash::Skip => {
                    out.skipped.push(from.display().to_string());
                    continue;
                }
                Clash::Keep => to = free(&to),
            }
        }
        landing.insert(path_key(&to));
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
    if fs::symlink_metadata(to).is_ok() {
        return Err(Stop::Failed(format!("{} is already there", to.display())));
    }
    if how == How::Move {
        let bytes = weight(from, running);
        if crate::carry::rename_new(from, to).is_ok() {
            meter.add(bytes, "");
            return Ok(());
        }
    }
    let mut made = false;
    let copied = copied(from, to, running, meter, &mut made);
    if copied.is_err() {
        if made {
            let _ = gone(to);
        }
        return copied;
    }
    if how == How::Move {
        gone(from).map_err(Stop::Failed)?;
    }
    Ok(())
}

fn copied(
    from: &Path,
    to: &Path,
    running: &Job,
    meter: &mut Meter,
    made: &mut bool,
) -> Result<(), Stop> {
    let fail = |why: std::io::Error| Stop::Failed(format!("{}: {why}", from.display()));
    let meta = fs::symlink_metadata(from).map_err(fail)?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(from).map_err(fail)?;
        crate::agents::files::linked(from, &target, to).map_err(fail)?;
        *made = true;
        return Ok(());
    }
    if meta.is_dir() {
        fs::create_dir(to).map_err(fail)?;
        *made = true;
        for one in fs::read_dir(from).map_err(fail)?.flatten() {
            if running.stopped() {
                return Err(Stop::Cancelled);
            }
            copied(
                &one.path(),
                &to.join(one.file_name()),
                running,
                meter,
                &mut true,
            )?;
        }
        let _ = fs::set_permissions(to, meta.permissions());
        return Ok(());
    }
    let name = from
        .file_name()
        .map(|one| one.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut source = super::opened_file(from).map_err(fail)?;
    let mut target = fs::File::create_new(to).map_err(fail)?;
    *made = true;
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
        put_all(judged, how, &running, &mut meter, &mut out);
        meter.say(true);
        Ok(out)
    })
    .await
}

fn put_all(
    judged: Vec<(PathBuf, PathBuf)>,
    how: How,
    running: &Job,
    meter: &mut Meter,
    out: &mut Transferred,
) {
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
        if to
            .parent()
            .is_some_and(|folder| crate::carry::goes_into_itself(&from, folder))
        {
            out.failed
                .push(failed(&from, "a folder cannot go inside itself".to_owned()));
            continue;
        }
        match carried(&from, &to, how, running, meter) {
            Ok(()) => out.done.push(Moved {
                from: from.display().to_string(),
                to: to.display().to_string(),
                stayed: false,
            }),
            Err(Stop::Cancelled) => {
                out.cancelled = true;
                break;
            }
            Err(Stop::Failed(why)) => out.failed.push(failed(&from, why)),
        }
        meter.items += 1;
    }
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
        carried, planned, put_all, walk_matching, Clash, How, Job, Meter, Searched, Stop,
        Transferred,
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

        let seen = dir.path().join("seen");
        if crate::paths::link_to(&folder, &seen) {
            let mut out = Transferred::default();
            let plan = planned(
                std::slice::from_ref(&folder),
                &seen.join("deeper"),
                How::Copy,
                Clash::Skip,
                &mut out,
            );
            assert!(plan.is_empty(), "a folder went inside itself by a link");
            assert_eq!(out.failed.len(), 1);
        }
    }

    #[test]
    fn a_replace_never_puts_away_the_folder_that_holds_what_is_carried() {
        let dir = tempfile::tempdir().expect("a folder");
        let outer = dir.path().join("photos");
        let inner = outer.join("photos");
        fs::create_dir_all(&inner).expect("folders");
        fs::write(inner.join("a.jpg"), "a").expect("a");
        fs::write(outer.join("kept.txt"), "kept").expect("kept");
        fs::create_dir_all(dir.path().join("notes")).expect("notes");
        fs::write(outer.join("notes"), "inside").expect("notes file");
        for how in [How::Move, How::Copy] {
            let mut out = Transferred::default();
            let from = vec![inner.clone(), outer.join("notes")];
            let plan = planned(&from, dir.path(), how, Clash::Replace, &mut out);
            assert_eq!(plan, [(outer.join("notes"), dir.path().join("notes"))]);
            assert_eq!(out.failed.len(), 1);
            assert_eq!(out.failed[0].path, inner.display().to_string());
        }
        assert!(inner.join("a.jpg").exists());
        assert!(outer.join("kept.txt").exists());
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
    fn a_put_back_never_copies_a_folder_into_itself() {
        let dir = tempfile::tempdir().expect("a folder");
        let folder = dir.path().join("f");
        fs::create_dir_all(folder.join("deeper")).expect("folders");
        let running = Job::begin("test-put-inside");
        let mut out = Transferred::default();
        put_all(
            vec![(folder.clone(), folder.join("deeper").join("f"))],
            How::Copy,
            &running,
            &mut meter(),
            &mut out,
        );
        assert_eq!(out.failed.len(), 1);
        assert!(out.done.is_empty());
        assert!(!folder.join("deeper").join("f").exists());
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

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn a_folder_with_a_pipe_in_it_is_refused_at_once_and_nothing_is_left_half_copied() {
        let dir = tempfile::tempdir().expect("a folder");
        let from = dir.path().join("from");
        fs::create_dir_all(&from).expect("a folder");
        fs::write(from.join("a.txt"), "a").expect("a file");
        crate::explorer::tests::pipe_in(&from);
        let to = dir.path().join("to");
        let (said, heard) = std::sync::mpsc::channel();
        let (source, target) = (from.clone(), to.clone());
        std::thread::spawn(move || {
            let running = Job::begin("test-pipe");
            let copied = carried(&source, &target, How::Copy, &running, &mut meter());
            let _ = said.send(matches!(copied, Err(Stop::Failed(_))));
        });
        let failed = heard
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("a pipe never holds the copy");
        assert!(failed);
        assert!(!to.exists());
        assert!(from.join("a.txt").is_file());
        assert!(from.join("pipe.txt").exists());
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

    #[test]
    fn a_copy_that_finds_its_place_taken_says_it_made_nothing() {
        let dir = tempfile::tempdir().expect("a folder");
        let running = Job::begin("test-taken");
        let mut counted = meter();
        let (file, folder) = (dir.path().join("a.txt"), dir.path().join("f"));
        fs::write(&file, "new").expect("a file");
        fs::create_dir(&folder).expect("a folder");
        let (theirs, their_folder) = (dir.path().join("b.txt"), dir.path().join("g"));
        fs::write(&theirs, "theirs").expect("their file");
        fs::create_dir(&their_folder).expect("their folder");

        for (from, to) in [(&file, &theirs), (&folder, &their_folder)] {
            let mut made = false;
            assert!(super::copied(from, to, &running, &mut counted, &mut made).is_err());
            assert!(!made, "{} was taken for the copy's own", to.display());
        }
        let mut made = false;
        let fresh = dir.path().join("c.txt");
        assert!(super::copied(&file, &fresh, &running, &mut counted, &mut made).is_ok());
        assert!(made);
        assert_eq!(fs::read_to_string(&theirs).expect("kept"), "theirs");
    }

    #[test]
    fn two_things_of_one_name_never_land_on_each_other() {
        let dir = tempfile::tempdir().expect("a folder");
        let (one, other, into) = (
            dir.path().join("one"),
            dir.path().join("other"),
            dir.path().join("into"),
        );
        for folder in [&one, &other, &into] {
            fs::create_dir_all(folder).expect("a folder");
        }
        fs::write(one.join("a.txt"), "one").expect("a");
        fs::write(other.join("a.txt"), "other").expect("a");
        let from = vec![one.join("a.txt"), other.join("a.txt")];

        for clash in [Clash::Keep, Clash::Replace] {
            let mut out = Transferred::default();
            let plan = planned(&from, &into, How::Move, clash, &mut out);
            assert_eq!(
                plan,
                [
                    (one.join("a.txt"), into.join("a.txt")),
                    (other.join("a.txt"), into.join("a 2.txt")),
                ]
            );
        }
        let mut out = Transferred::default();
        let plan = planned(&from, &into, How::Move, Clash::Skip, &mut out);
        assert_eq!(plan, [(one.join("a.txt"), into.join("a.txt"))]);
        assert_eq!(out.skipped.len(), 1);

        let running = Job::begin("test-land");
        let mut counted = meter();
        let to = into.join("a.txt");
        assert!(carried(&one.join("a.txt"), &to, How::Move, &running, &mut counted).is_ok());
        for how in [How::Move, How::Copy] {
            let again = carried(&other.join("a.txt"), &to, how, &running, &mut counted);
            assert!(matches!(again, Err(Stop::Failed(_))));
            assert_eq!(fs::read_to_string(&to).expect("kept"), "one");
            assert_eq!(
                fs::read_to_string(other.join("a.txt")).expect("kept"),
                "other"
            );
        }
    }
}
