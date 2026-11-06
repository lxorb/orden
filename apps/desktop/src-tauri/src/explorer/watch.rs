use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _};

use super::listing::asked;
use super::reach::Use;

const CHANGED: &str = "explorer://changed";

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

#[tauri::command(async)]
pub fn explorer_watch(app: AppHandle, folder: String) -> Result<(), String> {
    let folder = asked(&app, &folder, Use::Look)?;
    let watching = app.state::<Watching>();
    let mut held = watching
        .0
        .lock()
        .map_err(|_| "the watcher is stuck".to_owned())?;
    if held.is_none() {
        let heard = app.clone();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                let _ = heard.emit(
                    CHANGED,
                    Changed {
                        folders: folders_of(&event.paths),
                    },
                );
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

#[tauri::command(async)]
pub fn explorer_unwatch(app: AppHandle, folder: String) {
    let folder = crate::paths::folded(Path::new(&folder));
    let watching = app.state::<Watching>();
    let Ok(mut held) = watching.0.lock() else {
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

#[cfg(test)]
mod tests {
    use super::folders_of;
    use std::path::PathBuf;

    #[test]
    fn a_change_is_said_of_its_folder_and_of_itself() {
        let said = folders_of(&[PathBuf::from("/a/b/c.txt"), PathBuf::from("/a/b/d.txt")]);
        assert_eq!(said, ["/a/b", "/a/b/c.txt", "/a/b/d.txt"]);
    }
}
