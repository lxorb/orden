use notify::event::{AccessKind, AccessMode};
use notify::{ErrorKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::known::{Seen, Space};

const QUIET: Duration = Duration::from_millis(250);

const LONGEST: Duration = Duration::from_secs(1);

pub const MOST_CHANGES: usize = 500;

const OVERFLOWING: usize = 256;

const ROOT_CHECK: Duration = Duration::from_secs(2);

const FAILED_GAP: Duration = Duration::from_secs(60);

#[derive(Clone, Debug)]
pub struct Root {
    pub given: PathBuf,
    pub real: PathBuf,
}

impl Root {
    fn inside(&self, path: &Path) -> Option<PathBuf> {
        path.strip_prefix(&self.real)
            .or_else(|_| path.strip_prefix(&self.given))
            .ok()
            .map(Path::to_path_buf)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heard {
    pub root: usize,
    pub seen: Vec<Seen>,
    pub scan: bool,
    pub gone: bool,
    pub unwatched: Option<Unwatched>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unwatched {
    Folders,
    Limit,
}

pub type Sink = Box<dyn FnMut(Heard) -> bool + Send>;

pub struct Watch {
    shared: Arc<Shared>,
    roots: Arc<Vec<Root>>,
    watcher: Arc<Mutex<RecommendedWatcher>>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.shared.stop();
    }
}

impl Watch {
    fn let_go(self) {
        self.shared.stop();
        let mut watcher = lock_watcher(&self.watcher);
        for root in self.roots.iter() {
            let _ = watcher.unwatch(&root.real);
        }
    }
}

pub struct Armed {
    shared: Arc<Shared>,
    roots: Arc<Vec<Root>>,
    watcher: RecommendedWatcher,
    unwatched: Vec<Option<Unwatched>>,
}

#[cfg(test)]
pub fn watch(roots: Vec<Root>, sink: Sink) -> Result<Watch, String> {
    armed(roots)?.start(sink)
}

pub fn armed(roots: Vec<Root>) -> Result<Armed, String> {
    let roots = Arc::new(roots);
    let shared = Arc::new(Shared::new(roots.len()));

    let heard = Arc::clone(&shared);
    let resolving = Arc::clone(&roots);
    let mut watcher = notify::recommended_watcher(move |event| heard.heard(&resolving, event))
        .map_err(|error| format!("could not watch the spaces: {error}"))?;
    let unwatched: Vec<Option<Unwatched>> =
        roots.iter().map(|root| arm(&mut watcher, root)).collect();

    Ok(Armed {
        shared,
        roots,
        watcher,
        unwatched,
    })
}

impl Armed {
    pub fn start(self, sink: Sink) -> Result<Watch, String> {
        let Self {
            shared,
            roots,
            watcher,
            unwatched,
        } = self;
        let watcher = Arc::new(Mutex::new(watcher));
        let (working, settling, using) = (
            Arc::clone(&shared),
            Arc::clone(&roots),
            Arc::clone(&watcher),
        );
        std::thread::Builder::new()
            .name("nib space watch".into())
            .spawn(move || work(&settling, &working, &using, sink, unwatched))
            .map_err(|error| format!("could not start watching the spaces: {error}"))?;

        Ok(Watch {
            shared,
            roots,
            watcher,
        })
    }

    pub fn replacing(mut self, old: &mut Option<Watch>) -> Self {
        if !self.unwatched.contains(&Some(Unwatched::Limit)) {
            return self;
        }
        let Some(old) = old.take() else {
            return self;
        };
        old.let_go();
        for (at, root) in self.roots.iter().enumerate() {
            let _ = self.watcher.unwatch(&root.real);
            self.unwatched[at] = arm(&mut self.watcher, root);
        }
        self
    }
}

fn arm(watcher: &mut RecommendedWatcher, root: &Root) -> Option<Unwatched> {
    let error = watch_tree(watcher, &root.real).err()?;
    eprintln!(
        "nib: could not watch all of {}: {error}",
        root.given.display()
    );
    Some(if matches!(error.kind, ErrorKind::MaxFilesWatch) {
        Unwatched::Limit
    } else {
        Unwatched::Folders
    })
}

fn watch_tree(watcher: &mut RecommendedWatcher, dir: &Path) -> notify::Result<()> {
    let Err(error) = watcher.watch(dir, RecursiveMode::Recursive) else {
        return Ok(());
    };
    let below = error
        .paths
        .iter()
        .any(|path| path != dir && path.starts_with(dir));
    if !below || matches!(error.kind, ErrorKind::MaxFilesWatch) {
        return Err(error);
    }
    let mut outcome = Ok(());
    for entry in fs::read_dir(dir).map_err(notify::Error::io)?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let one = watch_tree(watcher, &path);
            if one
                .as_ref()
                .is_err_and(|error| matches!(error.kind, ErrorKind::MaxFilesWatch))
            {
                return one;
            }
            outcome = outcome.and(one);
        }
    }
    outcome
}

fn work(
    roots: &[Root],
    shared: &Shared,
    watcher: &Mutex<RecommendedWatcher>,
    mut sink: Sink,
    unwatched: Vec<Option<Unwatched>>,
) {
    let mut spaces: Vec<Option<Space>> = Vec::with_capacity(roots.len());
    for (at, root) in roots.iter().enumerate() {
        spaces.push(Some(Space::read(&root.real).unwrap_or_default()));
        let said = Heard {
            unwatched: unwatched.get(at).copied().flatten(),
            ..Heard::scan(at)
        };
        if shared.stopped() || !sink(said) {
            shared.stop();
            return;
        }
    }
    let mut released: Vec<BTreeSet<PathBuf>> = vec![BTreeSet::new(); roots.len()];
    let mut failed_at: Vec<Option<Instant>> = vec![None; roots.len()];

    while let Some(batch) = shared.next() {
        for (at, root) in roots.iter().enumerate() {
            let Some(space) = spaces[at].as_mut() else {
                continue;
            };
            let touched = &batch.touched[at];
            let failing =
                batch.failed[at] && failed_at[at].is_none_or(|when| when.elapsed() >= FAILED_GAP);
            if failing {
                failed_at[at] = Some(Instant::now());
            }

            let mut heard = Vec::new();
            if !root.real.is_dir() {
                let _ = lock_watcher(watcher).unwatch(&root.real);
                spaces[at] = None;
                heard.push(Heard::gone(at));
            } else if touched.is_empty() && !batch.rescan[at] && !failing {
                continue;
            } else if batch.rescan[at] || failing || batch.raw[at] >= OVERFLOWING {
                let unwatched = {
                    let mut watcher = lock_watcher(watcher);
                    if shared.stopped() {
                        return;
                    }
                    let _ = watcher.unwatch(&root.real);
                    arm(&mut watcher, root)
                };
                *space = Space::read(&root.real).unwrap_or_default();
                released[at].clear();
                heard.push(Heard {
                    unwatched,
                    ..Heard::scan(at)
                });
            } else {
                let (seen, held) = space.settle(&root.real, touched, batch.cut, &released[at]);
                shared.touch_again(at, &held);
                released[at] = held.into_iter().collect();
                heard.extend(seen.chunks(MOST_CHANGES).map(|some| Heard {
                    root: at,
                    seen: some.to_vec(),
                    scan: false,
                    gone: false,
                    unwatched: None,
                }));
            }

            for one in heard {
                if shared.stopped() || !sink(one) {
                    shared.stop();
                    return;
                }
            }
        }
    }
}

impl Heard {
    fn scan(root: usize) -> Self {
        Self {
            root,
            seen: Vec::new(),
            scan: true,
            gone: false,
            unwatched: None,
        }
    }

    fn gone(root: usize) -> Self {
        Self {
            root,
            seen: Vec::new(),
            scan: false,
            gone: true,
            unwatched: None,
        }
    }
}

fn named(roots: &[Root], paths: &[PathBuf]) -> Vec<usize> {
    let named: Vec<usize> = (0..roots.len())
        .filter(|at| paths.iter().any(|path| roots[*at].inside(path).is_some()))
        .collect();
    if named.is_empty() {
        (0..roots.len()).collect()
    } else {
        named
    }
}

fn lock_watcher(watcher: &Mutex<RecommendedWatcher>) -> MutexGuard<'_, RecommendedWatcher> {
    watcher
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
}

struct Queue {
    touched: Vec<BTreeSet<PathBuf>>,
    raw: Vec<usize>,
    rescan: Vec<bool>,
    failed: Vec<bool>,
    first: Option<Instant>,
    last: Option<Instant>,
    stopped: bool,
}

struct Batch {
    touched: Vec<BTreeSet<PathBuf>>,
    raw: Vec<usize>,
    rescan: Vec<bool>,
    failed: Vec<bool>,
    cut: bool,
}

impl Batch {
    fn quiet(roots: usize) -> Self {
        Self {
            touched: vec![BTreeSet::new(); roots],
            raw: vec![0; roots],
            rescan: vec![false; roots],
            failed: vec![false; roots],
            cut: false,
        }
    }
}

impl Shared {
    fn new(roots: usize) -> Self {
        Self {
            queue: Mutex::new(Queue {
                touched: vec![BTreeSet::new(); roots],
                raw: vec![0; roots],
                rescan: vec![false; roots],
                failed: vec![false; roots],
                first: None,
                last: None,
                stopped: false,
            }),
            wake: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Queue> {
        self.queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn stop(&self) {
        let mut queue = self.lock();
        queue.stopped = true;
        queue.touched.iter_mut().for_each(BTreeSet::clear);
        self.wake.notify_all();
    }

    fn stopped(&self) -> bool {
        self.lock().stopped
    }

    fn heard(&self, roots: &[Root], event: notify::Result<notify::Event>) {
        let mut queue = self.lock();
        if queue.stopped {
            return;
        }

        match event {
            Err(error) => {
                for at in named(roots, &error.paths) {
                    queue.failed[at] = true;
                }
            }
            Ok(event) => {
                if matches!(
                    event.kind,
                    EventKind::Access(kind) if kind != AccessKind::Close(AccessMode::Write)
                ) {
                    return;
                }
                if event.need_rescan() {
                    for at in named(roots, &event.paths) {
                        queue.rescan[at] = true;
                    }
                }
                for path in &event.paths {
                    if let Some((at, rel)) = roots
                        .iter()
                        .enumerate()
                        .find_map(|(at, root)| root.inside(path).map(|rel| (at, rel)))
                    {
                        queue.touched[at].insert(rel);
                        queue.raw[at] += 1;
                    }
                }
            }
        }

        let now = Instant::now();
        queue.first.get_or_insert(now);
        queue.last = Some(now);
        self.wake.notify_one();
    }

    fn touch_again(&self, root: usize, paths: &[PathBuf]) {
        if paths.is_empty() {
            return;
        }
        let mut queue = self.lock();
        queue.touched[root].extend(paths.iter().cloned());
        let now = Instant::now();
        queue.first.get_or_insert(now);
        queue.last.get_or_insert(now);
    }

    fn next(&self) -> Option<Batch> {
        let mut queue = self.lock();
        loop {
            if queue.stopped {
                return None;
            }
            let (Some(first), Some(last)) = (queue.first, queue.last) else {
                let (waited, timed) = self
                    .wake
                    .wait_timeout(queue, ROOT_CHECK)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                queue = waited;
                if timed.timed_out() && queue.first.is_none() && !queue.stopped {
                    return Some(Batch::quiet(queue.touched.len()));
                }
                continue;
            };

            let now = Instant::now();
            let quiet = last + QUIET;
            let longest = first + LONGEST;
            if now >= quiet || now >= longest {
                let roots = queue.touched.len();
                let batch = Batch {
                    touched: std::mem::replace(&mut queue.touched, vec![BTreeSet::new(); roots]),
                    raw: std::mem::replace(&mut queue.raw, vec![0; roots]),
                    rescan: std::mem::replace(&mut queue.rescan, vec![false; roots]),
                    failed: std::mem::replace(&mut queue.failed, vec![false; roots]),
                    cut: now < quiet,
                };
                queue.first = None;
                queue.last = None;
                return Some(batch);
            }

            queue = self
                .wake
                .wait_timeout(queue, quiet.min(longest) - now)
                .map_or_else(|poisoned| poisoned.into_inner().0, |(queue, _)| queue);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{watch, Heard, Root, MOST_CHANGES, QUIET};
    use crate::space_watch::known::Seen;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::{channel, Receiver};
    use std::time::{Duration, Instant};

    fn until_quiet(heard: &Receiver<Heard>) -> Vec<Heard> {
        let mut all = Vec::new();
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(10) {
            match heard.recv_timeout(Duration::from_millis(1500)) {
                Ok(one) => all.push(one),
                Err(_) => break,
            }
        }
        all
    }

    fn said(heard: &[Heard]) -> Vec<String> {
        heard
            .iter()
            .flat_map(|one| one.seen.iter())
            .map(|one| match one {
                Seen::Created(to) => format!("created {}", slash(&to.rel)),
                Seen::Modified(to) => format!("modified {}", slash(&to.rel)),
                Seen::Removed { rel, .. } => format!("removed {}", slash(rel)),
                Seen::Renamed { from, to } => format!("renamed {} {}", slash(from), slash(&to.rel)),
            })
            .collect()
    }

    fn slash(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn watching(dir: &Path) -> (super::Watch, Receiver<Heard>) {
        let (tell, heard) = channel();
        let root = Root {
            given: dir.to_path_buf(),
            real: fs::canonicalize(dir).expect("a real path"),
        };
        let watch =
            watch(vec![root], Box::new(move |one| tell.send(one).is_ok())).expect("watching");
        (watch, heard)
    }

    #[cfg(target_os = "linux")]
    fn holders(dir: &Path) -> usize {
        use std::os::unix::fs::MetadataExt;
        let ino = format!("ino:{:x} ", fs::metadata(dir).expect("a folder").ino());
        fs::read_dir("/proc/self/fdinfo")
            .expect("fdinfo")
            .flatten()
            .filter(|one| {
                fs::read_to_string(one.path()).is_ok_and(|info| {
                    info.lines()
                        .any(|line| line.starts_with("inotify") && line.contains(&ino))
                })
            })
            .count()
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_watch_refused_past_the_limit_is_armed_again_once_the_old_lets_go() {
        use super::{armed, Unwatched};

        let dir = tempfile::tempdir().expect("a folder");
        let root = fs::canonicalize(dir.path()).expect("a real path");
        fs::create_dir(root.join("Deep")).expect("a folder");
        let spelled = || {
            vec![Root {
                given: root.clone(),
                real: root.clone(),
            }]
        };

        let mut old = Some(
            armed(spelled())
                .expect("armed")
                .start(Box::new(|_| true))
                .expect("started"),
        );
        let mut made = armed(spelled()).expect("armed");
        assert_eq!(holders(&root.join("Deep")), 2);
        made.unwatched[0] = Some(Unwatched::Limit);

        let (tell, heard) = channel();
        let _watch = made
            .replacing(&mut old)
            .start(Box::new(move |one| tell.send(one).is_ok()))
            .expect("started");

        assert!(old.is_none());
        assert_eq!(holders(&root.join("Deep")), 1, "the old one's are free");
        let first = until_quiet(&heard);
        assert!(first[0].scan);
        assert_eq!(first[0].unwatched, None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_watch_not_refused_has_nothing_armed_twice() {
        use super::armed;

        let dir = tempfile::tempdir().expect("a folder");
        let root = fs::canonicalize(dir.path()).expect("a real path");
        let spelled = || {
            vec![Root {
                given: root.clone(),
                real: root.clone(),
            }]
        };
        let mut old = Some(
            armed(spelled())
                .expect("armed")
                .start(Box::new(|_| true))
                .expect("started"),
        );
        let made = armed(spelled()).expect("armed").replacing(&mut old);
        assert!(old.is_some());
        assert_eq!(made.unwatched, vec![None]);
        assert_eq!(holders(&root), 2);
    }

    #[test]
    fn a_note_is_heard_through_its_whole_life() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::write(root.join("Plan.md"), "words").expect("a note");
        let (_watch, heard) = watching(root);

        let first = until_quiet(&heard);
        assert_eq!(first.len(), 1);
        assert!(first[0].scan, "the watch says it is ready to be caught up");

        fs::write(root.join("Idea.md"), "new").expect("made");
        assert_eq!(said(&until_quiet(&heard)), ["created Idea.md"]);

        fs::write(root.join("Idea.md"), "new, and longer").expect("written");
        assert_eq!(said(&until_quiet(&heard)), ["modified Idea.md"]);

        fs::rename(root.join("Idea.md"), root.join("Thought.md")).expect("renamed");
        assert_eq!(said(&until_quiet(&heard)), ["renamed Idea.md Thought.md"]);

        fs::create_dir(root.join("Box")).expect("a folder");
        assert_eq!(said(&until_quiet(&heard)), ["created Box"]);
        fs::rename(root.join("Thought.md"), root.join("Box").join("Thought.md")).expect("moved");
        let moved = until_quiet(&heard);
        assert_eq!(said(&moved), ["renamed Thought.md Box/Thought.md"]);

        fs::remove_file(root.join("Box").join("Thought.md")).expect("deleted");
        assert_eq!(said(&until_quiet(&heard)), ["removed Box/Thought.md"]);
    }

    #[test]
    fn a_burst_is_heard_in_bounded_batches() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        let (_watch, heard) = watching(root);
        assert!(until_quiet(&heard)[0].scan);

        let started = Instant::now();
        for at in 0..1000 {
            fs::write(root.join(format!("note-{at:04}.md")), format!("note {at}")).expect("a note");
        }
        let burst = until_quiet(&heard);

        let most = started.elapsed().as_millis() / QUIET.as_millis() + 1;
        assert!(
            burst.len() as u128 <= most,
            "{} messages, at most {most}",
            burst.len()
        );
        for one in &burst {
            assert!(
                one.seen.len() <= MOST_CHANGES,
                "{} in one message",
                one.seen.len()
            );
        }
        let named: Vec<PathBuf> = burst
            .iter()
            .flat_map(|one| one.seen.iter())
            .filter_map(|one| match one {
                Seen::Created(to) => Some(to.rel.clone()),
                _ => None,
            })
            .collect();
        let listed = burst.iter().any(|one| one.scan);
        assert!(
            listed || named.len() == 1000,
            "{} named, no listing",
            named.len()
        );
    }

    #[test]
    fn a_root_that_goes_is_gone_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path().join("Space");
        fs::create_dir_all(&root).expect("a space");
        fs::write(root.join("Plan.md"), "words").expect("a note");
        let (_watch, heard) = watching(&root);
        assert!(until_quiet(&heard)[0].scan);

        let renamed = dir.path().join("Renamed");
        fs::rename(&root, &renamed).expect("the space renamed");
        fs::write(renamed.join("Idea.md"), "new").expect("written in");

        let mut after = Vec::new();
        let started = Instant::now();
        while !after.iter().any(|one: &Heard| one.gone)
            && started.elapsed() < Duration::from_secs(10)
        {
            if let Ok(one) = heard.recv_timeout(Duration::from_millis(500)) {
                after.push(one);
            }
        }
        assert!(after.iter().all(|one| one.seen.is_empty()), "{after:?}");
        assert!(after.iter().any(|one| one.gone), "{after:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_watched_is_left_out_and_nothing_else() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("a folder");
        let (space, other) = (dir.path().join("Space"), dir.path().join("Other"));
        let locked = space.join("lost+found");
        for folder in [&locked, &space.join("Box"), &other] {
            fs::create_dir_all(folder).expect("a folder");
        }
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).expect("locked");
        let unreadable = fs::read_dir(&locked).is_err();
        let (tell, heard) = channel();
        let roots = [&space, &other].map(|dir| Root {
            given: dir.clone(),
            real: fs::canonicalize(dir).expect("a real path"),
        });
        let watched = watch(roots.to_vec(), Box::new(move |one| tell.send(one).is_ok()));
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).expect("unlocked");
        if !unreadable {
            return;
        }
        let _watch = watched.expect("watching");
        assert_eq!(until_quiet(&heard).iter().filter(|one| one.scan).count(), 2);

        fs::write(space.join("Box").join("Plan.md"), "new").expect("written");
        fs::write(other.join("Idea.md"), "new").expect("written");
        assert_eq!(
            said(&until_quiet(&heard)),
            ["created Box/Plan.md", "created Idea.md"]
        );
    }
}
