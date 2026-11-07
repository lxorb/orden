use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _};

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
pub struct Watching(Mutex<Option<(RecommendedWatcher, HashMap<PathBuf, usize>)>>);

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
    fn add(
        &self,
        folder: PathBuf,
        hear: impl Fn(Vec<String>) + Send + 'static,
    ) -> Result<(), String> {
        let mut held = self
            .0
            .lock()
            .map_err(|_| "the watcher is stuck".to_owned())?;
        if held.is_none() {
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
        let count = counts.entry(folder.clone()).or_insert(0);
        if *count == 0 {
            watcher
                .watch(&folder, RecursiveMode::NonRecursive)
                .map_err(|why| why.to_string())?;
        }
        *count += 1;
        Ok(())
    }

    fn remove(&self, folder: &Path) {
        let folder = crate::paths::folded(folder);
        let Ok(mut held) = self.0.lock() else {
            return;
        };
        let Some((watcher, counts)) = held.as_mut() else {
            return;
        };
        if let Some(count) = counts.get_mut(&folder) {
            *count -= 1;
            if *count == 0 {
                counts.remove(&folder);
                let _ = watcher.unwatch(&folder);
            }
        }
    }
}

#[tauri::command]
pub async fn explorer_watch(app: AppHandle, folder: String) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let folder = asked(&app, &folder, Use::Look)?;
        let hearing = app.clone();
        app.state::<Watching>()
            .add(folder, move |folders| heard(&hearing, folders))
    })
    .await
}

#[tauri::command]
pub async fn explorer_unwatch(app: AppHandle, folder: String) {
    crate::lane::off_the_runtime(move || {
        app.state::<Watching>().remove(Path::new(&folder));
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::{folders_of, Gathered, Watching};
    use crate::explorer::listing::entries;
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
            watching.add(shown.clone(), |_| {}).expect("watched");
            for at in 1..400 {
                let next = going[at % going.len()].clone();
                watching.add(next.clone(), |_| {}).expect("watched");
                watching.remove(&shown);
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
