mod identity;
mod known;
mod walk;
mod watching;

pub use walk::says_gone;

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::paths::{a_space, cannot, folded, in_spaces, inside, spaces_dir};
use crate::tree::MAX_ENTRIES;
use known::Seen;
use walk::Found;
use watching::{armed, Heard, Root, Watch, MOST_CHANGES};

#[derive(Default)]
pub struct Watching(Mutex<Option<Watch>>);

impl Watching {
    fn lock(&self) -> MutexGuard<'_, Option<Watch>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Default)]
pub struct Working(Mutex<HashMap<PathBuf, Watch>>);

impl Working {
    fn lock(&self) -> MutexGuard<'_, HashMap<PathBuf, Watch>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

const KEPT: &str = ".orden";

const WORKING: &str = ".work";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    path: String,
    dir: bool,
    size: u64,
    mtime: u64,
    id: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    unlisted: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Change {
    Created(Listed),
    Modified(Listed),
    Removed {
        path: String,
        dir: bool,
        id: Option<String>,
    },
    Renamed {
        from: String,
        #[serde(flatten)]
        to: Listed,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct News {
    root: String,
    changes: Vec<Change>,
    scan: bool,
    gone: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    unwatched: Option<watching::Unwatched>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    listed: Vec<Listed>,
    done: bool,
}

fn listed(root: &Path, one: Found) -> Listed {
    Listed {
        path: spelled(root, &one.rel),
        dir: one.dir,
        size: one.size,
        mtime: one.mtime,
        id: one.id,
        unlisted: one.unlisted,
    }
}

fn spelled(root: &Path, rel: &Path) -> String {
    root.join(rel).to_string_lossy().into_owned()
}

fn change(root: &Path, seen: Seen) -> Change {
    match seen {
        Seen::Created(one) => Change::Created(listed(root, one)),
        Seen::Modified(one) => Change::Modified(listed(root, one)),
        Seen::Removed { rel, dir, id } => Change::Removed {
            path: spelled(root, &rel),
            dir,
            id,
        },
        Seen::Renamed { from, to } => Change::Renamed {
            from: spelled(root, &from),
            to: listed(root, to),
        },
    }
}

fn news(roots: &[Root], heard: Heard) -> News {
    let root = &roots[heard.root].given;
    News {
        root: root.to_string_lossy().into_owned(),
        changes: heard
            .seen
            .into_iter()
            .map(|one| change(root, one))
            .collect(),
        scan: heard.scan,
        gone: heard.gone,
        unwatched: heard.unwatched,
    }
}

fn judged_root(app: &AppHandle, root: &str) -> Result<Root, String> {
    rooted(a_space(app, root)?, root)
}

fn working_copy(spaces: &Path, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));
    let home = spaces.join(KEPT).join(WORKING);
    let directly_inside = target
        .parent()
        .is_some_and(|parent| inside(&home, parent) && inside(parent, &home));
    let hidden = target
        .file_name()
        .and_then(OsStr::to_str)
        .is_none_or(|name| name.starts_with('.'));
    if !directly_inside || hidden {
        return Err(format!("{path} is not a space's working folder"));
    }
    Ok(target)
}

fn judged_working(app: &AppHandle, root: &str) -> Result<Root, String> {
    rooted(working_copy(&spaces_dir(app)?, root)?, root)
}

fn rooted(given: PathBuf, root: &str) -> Result<Root, String> {
    let real = std::fs::canonicalize(&given).map_err(|error| cannot("watch", &given, &error))?;
    if !real.is_dir() {
        return Err(format!("{root} is not a folder"));
    }
    Ok(Root { given, real })
}

#[tauri::command(async)]
pub fn space_watch(app: AppHandle, roots: Vec<String>, news: Channel<News>) -> Result<(), String> {
    let judged = roots
        .iter()
        .map(|root| judged_root(&app, root))
        .collect::<Result<Vec<_>, _>>()?;

    let watching = app.state::<Watching>();
    let mut running = watching.lock();
    if judged.is_empty() {
        *running = None;
        return Ok(());
    }

    let spelled = judged.clone();
    let made = armed(judged)?
        .replacing(&mut running)
        .start(Box::new(move |heard| {
            news.send(self::news(&spelled, heard)).is_ok()
        }))?;
    *running = Some(made);
    Ok(())
}

#[tauri::command(async)]
pub fn space_unwatch(app: AppHandle) {
    *app.state::<Watching>().lock() = None;
}

#[tauri::command(async)]
pub fn space_scan(app: AppHandle, root: String, listing: Channel<Listing>) -> Result<(), String> {
    scanned(&judged_root(&app, &root)?, &listing)
}

#[tauri::command(async)]
pub fn working_watch(app: AppHandle, root: String, news: Channel<News>) -> Result<(), String> {
    let judged = judged_working(&app, &root)?;
    let key = judged.given.clone();
    let spelled = vec![judged.clone()];
    let ready = armed(vec![judged])?;
    let working = app.state::<Working>();
    let mut running = working.lock();
    ready.start_in(
        &mut running,
        key,
        Box::new(move |heard| news.send(self::news(&spelled, heard)).is_ok()),
    )
}

#[tauri::command(async)]
pub fn working_unwatch(app: AppHandle, root: String) -> Result<(), String> {
    let given = working_copy(&spaces_dir(&app)?, &root)?;
    let old = app.state::<Working>().lock().remove(&given);
    drop(old);
    Ok(())
}

#[tauri::command(async)]
pub fn working_scan(app: AppHandle, root: String, listing: Channel<Listing>) -> Result<(), String> {
    scanned(&judged_working(&app, &root)?, &listing)
}

fn scanned(root: &Root, listing: &Channel<Listing>) -> Result<(), String> {
    let mut chunk = Vec::with_capacity(MOST_CHANGES);
    let mut left = MAX_ENTRIES;
    let mut sent = Ok(());

    walk::walk(&root.real, Path::new(""), &mut left, &mut |one| {
        chunk.push(listed(&root.given, one));
        if chunk.len() == MOST_CHANGES && sent.is_ok() {
            let full = std::mem::replace(&mut chunk, Vec::with_capacity(MOST_CHANGES));
            sent = listing.send(Listing {
                listed: full,
                done: false,
            });
        }
    })?;
    sent.map_err(|error| error.to_string())?;

    listing
        .send(Listing {
            listed: chunk,
            done: true,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn file_identity(app: AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(identity::identity(&in_spaces(&app, &path)?))
}

#[cfg(test)]
mod tests {
    use super::{change, working_copy, Change, Listed, KEPT, WORKING};
    use crate::space_watch::known::Seen;
    use crate::space_watch::walk::Found;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    #[test]
    fn only_a_spaces_working_folder_is_watched_as_one() {
        let spaces = Path::new("/spaces");
        let home = spaces.join(KEPT).join(WORKING);
        let notes = home.join("Notes");
        assert_eq!(
            working_copy(spaces, &notes.to_string_lossy()).expect("a working folder"),
            notes
        );
        for path in [
            spaces.join("Notes"),
            spaces.join(KEPT).join("Notes"),
            home.clone(),
            home.join(".hidden"),
            notes.join("Inner"),
            home.join("..").join("Notes"),
            PathBuf::from("/elsewhere/.orden/.work/Notes"),
        ] {
            assert!(
                working_copy(spaces, &path.to_string_lossy()).is_err(),
                "{}",
                path.display()
            );
        }
    }

    #[test]
    fn what_the_window_is_told() {
        let root = Path::new("/spaces/Work");
        let found = |rel: &str| Found {
            rel: PathBuf::from(rel),
            dir: false,
            size: 5,
            mtime: 1_700_000_000_000,
            stamp: 1_700_000_000_000_000_000,
            unlisted: false,
            id: Some("2a:1f".into()),
        };

        let renamed = change(
            root,
            Seen::Renamed {
                from: PathBuf::from("Old.md"),
                to: found("New.md"),
            },
        );
        let spelled = |rel: &str| root.join(rel).to_string_lossy().into_owned();
        assert_eq!(
            serde_json::to_value(&renamed).expect("json"),
            json!({ "kind": "renamed", "from": spelled("Old.md"), "path": spelled("New.md"),
                    "dir": false, "size": 5, "mtime": 1_700_000_000_000_u64, "id": "2a:1f" })
        );

        let removed = change(
            root,
            Seen::Removed {
                rel: PathBuf::from("Gone"),
                dir: true,
                id: None,
            },
        );
        assert_eq!(
            serde_json::to_value(&removed).expect("json"),
            json!({ "kind": "removed", "path": spelled("Gone"), "dir": true, "id": null })
        );

        let created = Change::Created(Listed {
            path: "p".into(),
            dir: false,
            size: 0,
            mtime: 0,
            id: None,
            unlisted: false,
        });
        assert_eq!(
            serde_json::to_value(&created).expect("json")["kind"],
            "created"
        );
    }
}
