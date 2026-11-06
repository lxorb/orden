mod identity;
mod known;
mod walk;
mod watching;

pub use walk::says_gone;

use serde::Serialize;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::paths::{a_space, cannot, in_spaces};
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
    let given = a_space(app, root)?;
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
    let root = judged_root(&app, &root)?;
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
    use super::{change, Change, Listed};
    use crate::space_watch::known::Seen;
    use crate::space_watch::walk::Found;
    use serde_json::json;
    use std::path::{Path, PathBuf};

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
