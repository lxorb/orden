use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _, Webview};

use super::listing::asked;
use super::reach::Use;

const CHANGED: &str = "explorer://changed";

const GATHER: Duration = Duration::from_millis(200);

static GATHERED: Gathered = Gathered(Mutex::new(None));

struct Gathered(Mutex<Option<BTreeSet<String>>>);

impl Gathered {
    fn add(&self, folders: Vec<String>) -> bool {
        let mut held = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let first = held.is_none();
        held.get_or_insert_with(BTreeSet::new).extend(folders);
        first
    }

    fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            .map(|folders| folders.into_iter().collect())
            .unwrap_or_default()
    }
}

fn heard(app: &AppHandle, folders: Vec<String>) {
    if !GATHERED.add(folders) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(GATHER);
        let folders = GATHERED.take();
        if !folders.is_empty() {
            let _ = app.emit(CHANGED, Changed { folders });
        }
    });
}

#[derive(Default)]
pub struct Watching(
    Mutex<Option<(RecommendedWatcher, HashMap<PathBuf, usize>)>>,
    Mutex<HashMap<String, Vec<PathBuf>>>,
);

#[derive(Serialize, Clone)]
struct Changed {
    folders: Vec<String>,
}

fn folders_of(paths: &[PathBuf]) -> Vec<String> {
    let mut out: Vec<String> = paths
        .iter()
        .flat_map(|path| [path.parent().map(Path::to_path_buf), Some(path.clone())])
        .flatten()
        .map(|one| one.display().to_string())
        .collect();
    out.sort();
    out.dedup();
    out
}

impl Watching {
    fn owned(&self) -> std::sync::MutexGuard<'_, HashMap<String, Vec<PathBuf>>> {
        self.1.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn add(
        &self,
        owner: &str,
        folder: PathBuf,
        hear: impl Fn(Vec<String>) + Send + 'static,
    ) -> Result<(), String> {
        let mut hear = Some(hear);
        watched_soon(
            || self.try_add(owner, &folder, &mut hear),
            || folder.is_dir() || std::fs::read_dir(&folder).is_ok(),
            std::thread::sleep,
        )
    }

    fn try_add<H: Fn(Vec<String>) + Send + 'static>(
        &self,
        owner: &str,
        folder: &Path,
        hear: &mut Option<H>,
    ) -> Result<(), String> {
        let mut held = self
            .0
            .lock()
            .map_err(|_| "the watcher is stuck".to_owned())?;
        if held.is_none() {
            let hear = hear
                .take()
                .ok_or_else(|| "the watcher could not be made".to_owned())?;
            let watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    if let Ok(event) = event {
                        hear(folders_of(&event.paths));
                    }
                })
                .map_err(|why| why.to_string())?;
            *held = Some((watcher, HashMap::new()));
        }
        let Some((watcher, counts)) = held.as_mut() else {
            return Ok(());
        };
        let count = counts.get(folder).copied().unwrap_or(0);
        if count == 0 {
            watcher
                .watch(folder, RecursiveMode::NonRecursive)
                .map_err(|why| why.to_string())?;
        }
        counts.insert(folder.to_path_buf(), count + 1);
        self.owned()
            .entry(owner.to_owned())
            .or_default()
            .push(folder.to_path_buf());
        Ok(())
    }

    fn remove(&self, owner: &str, folder: &Path) {
        let folder = crate::paths::folded(folder);
        let Ok(mut held) = self.0.lock() else {
            return;
        };
        let mine = {
            let mut ledger = self.owned();
            let mine = ledger.get_mut(owner).and_then(|folders| {
                let at = folders.iter().position(|one| *one == folder)?;
                Some(folders.swap_remove(at))
            });
            if ledger.get(owner).is_some_and(Vec::is_empty) {
                ledger.remove(owner);
            }
            mine
        };
        if let (Some((watcher, counts)), Some(folder)) = (held.as_mut(), mine) {
            let_go(watcher, counts, &folder);
        }
    }

    pub fn end_where(&self, owner: &str) {
        let Ok(mut held) = self.0.lock() else {
            return;
        };
        let folders = self.owned().remove(owner).unwrap_or_default();
        if let Some((watcher, counts)) = held.as_mut() {
            for folder in &folders {
                let_go(watcher, counts, folder);
            }
        }
    }
}

const WATCH_TRIES: u32 = 5;

const WATCH_PAUSE: Duration = Duration::from_millis(40);

fn watched_soon(
    mut watch: impl FnMut() -> Result<(), String>,
    there: impl Fn() -> bool,
    pause: impl Fn(Duration),
) -> Result<(), String> {
    let mut tried = 1;
    loop {
        match watch() {
            Ok(()) => return Ok(()),
            Err(why) if tried >= WATCH_TRIES || !there() => return Err(why),
            Err(_) => {
                pause(WATCH_PAUSE * tried);
                tried += 1;
            }
        }
    }
}

fn let_go(watcher: &mut RecommendedWatcher, counts: &mut HashMap<PathBuf, usize>, folder: &Path) {
    if let Some(count) = counts.get_mut(folder) {
        *count -= 1;
        if *count == 0 {
            counts.remove(folder);
            let _ = watcher.unwatch(folder);
        }
    }
}

#[tauri::command]
pub async fn explorer_watch(webview: Webview, folder: String) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let app = webview.app_handle().clone();
        let folder = asked(&app, &folder, Use::Look)?;
        let hearing = app.clone();
        app.state::<Watching>()
            .add(webview.label(), folder, move |folders| {
                heard(&hearing, folders);
            })
    })
    .await
}

#[tauri::command]
pub async fn explorer_unwatch(webview: Webview, folder: String) {
    crate::lane::off_the_runtime(move || {
        webview
            .state::<Watching>()
            .remove(webview.label(), Path::new(&folder));
    })
    .await;
}

pub fn window_gone(app: &AppHandle, label: &str) {
    if let Some(watching) = app.try_state::<Watching>() {
        watching.end_where(label);
    }
}

#[cfg(test)]
mod tests {
    use super::{folders_of, watched_soon, Gathered, Watching, WATCH_TRIES};
    use crate::explorer::listing::entries;
    use std::cell::Cell;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::channel;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn going_quickly_between_folders_while_one_keeps_changing_never_sticks() {
        let root = tempfile::tempdir().expect("a folder");
        let folders: Vec<PathBuf> = ["Videos", "Downloads", "Pictures", "Music"]
            .iter()
            .map(|name| {
                let folder = root.path().join(name);
                std::fs::create_dir(&folder).expect("a folder");
                std::fs::write(folder.join(format!("{name}.txt")), name).expect("a file");
                crate::paths::folded(&folder)
            })
            .collect();
        let busy = folders[0].clone();
        let writing = Arc::new(AtomicBool::new(true));
        let writer = {
            let writing = writing.clone();
            std::thread::spawn(move || {
                let mut at = 0u32;
                while writing.load(Ordering::Relaxed) {
                    let _ = std::fs::write(busy.join(format!("clip {}.mp4", at % 50)), [0u8; 4096]);
                    at += 1;
                }
            })
        };
        let (done, finished) = channel();
        let going = folders.clone();
        std::thread::spawn(move || {
            let watching = Watching::default();
            let mut shown = going[0].clone();
            watching
                .add("main", shown.clone(), |_| {})
                .expect("watched");
            for at in 1..400 {
                let next = going[at % going.len()].clone();
                watching.add("main", next.clone(), |_| {}).expect("watched");
                watching.remove("main", &shown);
                let (listed, _) = entries(&next, 100_000).expect("listed");
                assert!(!listed.is_empty());
                shown = next;
            }
            let _ = done.send(());
        });
        let answered = finished.recv_timeout(Duration::from_secs(120));
        writing.store(false, Ordering::Relaxed);
        writer.join().expect("the writer");
        assert!(answered.is_ok(), "going between folders stuck");
    }

    #[test]
    fn a_watch_that_fails_while_its_folder_is_there_is_tried_again() {
        let tries = Cell::new(0);
        let paused = Cell::new(0);
        let watched = watched_soon(
            || {
                tries.set(tries.get() + 1);
                if tries.get() < 3 {
                    Err("Input watch path is neither a file nor a directory.".to_owned())
                } else {
                    Ok(())
                }
            },
            || true,
            |_| paused.set(paused.get() + 1),
        );
        assert_eq!(watched, Ok(()));
        assert_eq!((tries.get(), paused.get()), (3, 2));
    }

    #[test]
    fn a_watch_on_a_folder_that_is_gone_gives_up_at_once() {
        let tries = Cell::new(0);
        let watched = watched_soon(
            || {
                tries.set(tries.get() + 1);
                Err("gone".to_owned())
            },
            || false,
            |_| panic!("waited on a folder that is gone"),
        );
        assert_eq!(watched, Err("gone".to_owned()));
        assert_eq!(tries.get(), 1);
        let always = Cell::new(0);
        let failing = watched_soon(
            || {
                always.set(always.get() + 1);
                Err("busy".to_owned())
            },
            || true,
            |_| {},
        );
        assert_eq!(failing, Err("busy".to_owned()));
        assert_eq!(always.get(), WATCH_TRIES);
    }

    #[test]
    fn a_folder_gone_while_watched_leaves_the_watcher_serving_the_next() {
        let root = tempfile::tempdir().expect("a folder");
        let base = crate::paths::folded(root.path());
        let gone = base.join("gone");
        let next = base.join("next");
        std::fs::create_dir(&gone).expect("a folder");
        std::fs::create_dir(&next).expect("a folder");
        let (told, heard) = channel::<Vec<String>>();
        let told = Mutex::new(told);
        let watching = Watching::default();
        let counted = |folder: &PathBuf| {
            watching
                .0
                .lock()
                .expect("held")
                .as_ref()
                .and_then(|(_, counts)| counts.get(folder).copied())
        };
        watching
            .add("main", gone.clone(), move |folders| {
                let _ = told.lock().expect("held").send(folders);
            })
            .expect("watched");
        std::fs::remove_dir_all(&gone).expect("removed");
        assert!(watching.add("main", base.join("never"), |_| {}).is_err());
        assert_eq!(counted(&base.join("never")), None);
        watching.remove("main", &gone);
        assert_eq!(counted(&gone), None);
        watching.add("main", next.clone(), |_| {}).expect("watched");
        while heard.try_recv().is_ok() {}
        std::fs::write(next.join("arrived.txt"), "here").expect("a file");
        let mut seen = false;
        let until = std::time::Instant::now() + Duration::from_secs(20);
        while !seen && std::time::Instant::now() < until {
            if let Ok(folders) = heard.recv_timeout(Duration::from_millis(200)) {
                seen = folders.iter().any(|one| one.ends_with("arrived.txt"));
            }
        }
        assert!(seen, "the folder after a gone one was not heard");
    }

    #[test]
    fn a_window_reloaded_or_closed_lets_go_of_every_folder_it_watched() {
        let root = tempfile::tempdir().expect("a folder");
        let one = crate::paths::folded(root.path());
        let two = one.join("two");
        std::fs::create_dir(&two).expect("a folder");
        let watching = Watching::default();
        let counted = |folder: &PathBuf| {
            watching
                .0
                .lock()
                .expect("held")
                .as_ref()
                .and_then(|(_, counts)| counts.get(folder).copied())
        };
        watching.add("a", one.clone(), |_| {}).expect("watched");
        watching.add("a", one.clone(), |_| {}).expect("watched");
        watching.add("a", two.clone(), |_| {}).expect("watched");
        watching.add("b", one.clone(), |_| {}).expect("watched");
        assert_eq!(counted(&one), Some(3));
        watching.remove("b", &two);
        assert_eq!(counted(&two), Some(1));
        watching.end_where("a");
        assert_eq!(counted(&one), Some(1));
        assert_eq!(counted(&two), None);
        watching.remove("a", &one);
        assert_eq!(counted(&one), Some(1));
        watching.remove("b", &one);
        assert_eq!(counted(&one), None);
        assert!(watching.owned().is_empty());
    }

    #[test]
    fn changes_that_come_together_are_said_once() {
        let gathered = Gathered(Mutex::new(None));
        assert!(gathered.add(vec!["/a".to_owned()]));
        for _ in 0..1000 {
            assert!(!gathered.add(vec!["/a".to_owned(), "/b".to_owned()]));
        }
        assert_eq!(gathered.take(), ["/a", "/b"]);
        assert!(gathered.take().is_empty());
        assert!(gathered.add(vec!["/c".to_owned()]));
    }

    #[test]
    fn a_change_is_said_of_its_folder_and_of_itself() {
        let said = folders_of(&[PathBuf::from("/a/b/c.txt"), PathBuf::from("/a/b/d.txt")]);
        assert_eq!(said, ["/a/b", "/a/b/c.txt", "/a/b/d.txt"]);
    }
}
