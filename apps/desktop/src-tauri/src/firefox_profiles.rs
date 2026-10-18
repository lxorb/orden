//! The profiles Firefox keeps on this machine, the files of each the import reads,
//! and its bookmarks out of `places.sqlite`.
//!
//! Firefox lists its profiles in `profiles.ini`, the file Zen's is a copy of, so
//! they are read the same way (`browser_profiles::ini_profiles`). Of a profile, the
//! import reads its session - `sessionstore-backups/recovery.jsonlz4` while Firefox
//! runs, `sessionstore.jsonlz4` after it quit, the one before that behind them - which
//! holds the open tabs, the pinned ones, the tab groups and the saved groups; and its
//! bookmarks. Those are `places.sqlite`, which Firefox keeps open and locked, so the
//! database is copied out with its write-ahead log first and the copy is read, the way
//! Apple Notes' is; the newest of the daily backups in `bookmarkbackups/` stands behind
//! it, a day old at most. Those files, by those names, of a profile Firefox lists, and
//! nothing else. Never written.

use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::browser_profiles::{ini_profiles, known, once, Profile};
use crate::paths::folder_named;

/// Where a drive keeps the browsers of its own, so a probe never reads the reader's:
/// a folder with a folder per browser in it, `firefox/` holding a `profiles.ini`.
pub(crate) const BROWSERS_DIR: &str = "NIB_BROWSERS_DIR";

/// The session files, in the order they are worth reading: the one a running Firefox
/// keeps writing, the one it wrote as it quit, and the one before that.
const SESSIONS: [&str; 3] = [
    "sessionstore-backups/recovery.jsonlz4",
    "sessionstore.jsonlz4",
    "sessionstore-backups/previous.jsonlz4",
];

/// The bookmarks, and where Firefox keeps a copy of them every day.
pub(crate) const PLACES: &str = "places.sqlite";
const BACKUPS: &str = "bookmarkbackups";
const BACKUP_PREFIX: &str = "bookmarks-";
const BACKUP_SUFFIX: &str = ".jsonlz4";

/// What beside the database holds what was written since it was last folded in.
const ALONGSIDE: [&str; 1] = ["places.sqlite-wal"];

/// The roots that are not bookmarks: the tags, which list again what is already
/// bookmarked, under each tag.
const TAGS: &str = "tags________";

/// The profiles on this machine Firefox lists that hold anything to read, the one it
/// opens first in front.
pub(crate) fn profiles() -> Vec<Profile> {
    once(homes().iter().flat_map(|home| ini_profiles(home, files_of)))
}

/// The bookmarks of a listed profile, as the tree Firefox's own backups are written
/// as: `{ guid, title, typeCode, uri, dateAdded, children }`.
#[tauri::command(async)]
pub fn read_firefox_places(profile: String) -> Result<String, String> {
    let path = known("Firefox", &profile, PLACES, &profiles())?;
    let folder = path.parent().ok_or("a profile has a folder")?;
    let copied = copy_out(folder)?;
    let db = Connection::open(copied.path().join(PLACES))
        .map_err(|error| format!("{PLACES} could not be opened: {error}"))?;
    let tree = tree_of(&db).map_err(|error| format!("{PLACES} could not be read: {error}"))?;
    Ok(tree.to_string())
}

/// The folders Firefox keeps `profiles.ini` in: on Linux the dotted one, its XDG one,
/// the Snap's and the Flatpak's; a Mac's and Windows' application data.
fn homes() -> Vec<PathBuf> {
    if let Some(named) = folder_named(std::env::var_os(BROWSERS_DIR).as_deref()) {
        return vec![named.join("firefox")];
    }

    let mut found = Vec::new();
    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            found.push(home.join(".mozilla/firefox"));
            found.push(home.join("snap/firefox/common/.mozilla/firefox"));
            found.push(home.join(".var/app/org.mozilla.firefox/.mozilla/firefox"));
        }
        if let Some(config) = dirs::config_dir() {
            found.push(config.join("mozilla/firefox"));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(support) = dirs::config_dir() {
        found.push(support.join("Firefox"));
    }
    #[cfg(windows)]
    if let Some(roaming) = dirs::config_dir() {
        found.push(roaming.join("Mozilla/Firefox"));
    }

    found
}

/// The files a profile holds that the import reads: its sessions in the order they
/// are worth reading, the bookmarks, and the newest daily copy of them.
fn files_of(profile: &Path) -> Vec<String> {
    let mut found: Vec<String> = SESSIONS
        .iter()
        .chain(&[PLACES])
        .filter(|name| profile.join(name).is_file())
        .map(|name| (*name).to_owned())
        .collect();

    // Named for the day, so the newest sorts last.
    let newest = fs::read_dir(profile.join(BACKUPS))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX))
        .max();
    if let Some(name) = newest {
        found.push(format!("{BACKUPS}/{name}"));
    }

    found
}

/// The database and its log, copied where nothing changes them while they are read.
/// The log is only there while Firefox has the database open, and a copy without it
/// is the bookmarks as of the last time it was closed, which is behind rather than
/// wrong.
fn copy_out(folder: &Path) -> Result<tempfile::TempDir, String> {
    let copied = tempfile::tempdir().map_err(|error| format!("no temporary folder: {error}"))?;
    fs::copy(folder.join(PLACES), copied.path().join(PLACES))
        .map_err(|error| format!("{PLACES} could not be copied: {error}"))?;
    for name in ALONGSIDE {
        // Not there is a database that was closed cleanly.
        let _ = fs::copy(folder.join(name), copied.path().join(name));
    }
    Ok(copied)
}

/// One row of `moz_bookmarks`, with the address of a bookmark.
struct Row {
    id: i64,
    parent: i64,
    kind: i64,
    title: String,
    added: i64,
    guid: String,
    url: Option<String>,
}

/// Every bookmark, folder and separator, nested as Firefox nests them and in its
/// order, from the root down. The tags are left out.
fn tree_of(db: &Connection) -> rusqlite::Result<Value> {
    let mut statement = db.prepare(
        "SELECT b.id, b.parent, b.type, IFNULL(b.title, ''), IFNULL(b.dateAdded, 0), \
         IFNULL(b.guid, ''), p.url \
         FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk \
         ORDER BY b.parent, b.position",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                parent: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                added: row.get(4)?,
                guid: row.get(5)?,
                url: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<Row>>>()?;

    let mut children: HashMap<i64, Vec<&Row>> = HashMap::new();
    for row in &rows {
        children.entry(row.parent).or_default().push(row);
    }
    let root = rows.iter().find(|row| row.parent == 0 && row.id != 0);
    Ok(root.map_or(Value::Null, |root| node(root, &children, 0)))
}

/// How deep a folder may be nested before the walk stops: well past anybody's, and a
/// stop for a database whose parents go round.
const DEEPEST: usize = 64;

fn node(row: &Row, children: &HashMap<i64, Vec<&Row>>, depth: usize) -> Value {
    let mut out = Map::new();
    out.insert("guid".into(), json!(row.guid));
    out.insert("title".into(), json!(row.title));
    out.insert("typeCode".into(), json!(row.kind));
    out.insert("dateAdded".into(), json!(row.added));
    if let Some(url) = &row.url {
        out.insert("uri".into(), json!(url));
    }
    if row.kind == 2 && depth < DEEPEST {
        let inside: Vec<Value> = children
            .get(&row.id)
            .into_iter()
            .flatten()
            .filter(|one| one.guid != TAGS && one.id != row.id)
            .map(|one| node(one, children, depth + 1))
            .collect();
        out.insert("children".into(), Value::Array(inside));
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/x1.default-release\nDefault=1\n\n[Profile1]\nName=Empty\nIsRelative=1\nPath=Profiles/y2.empty\n";

    fn touch(at: &Path) {
        fs::create_dir_all(at.parent().expect("a folder")).expect("the folder");
        fs::write(at, b"mozLz40\0").expect("a file");
    }

    #[test]
    fn a_profile_lists_its_sessions_its_bookmarks_and_their_newest_copy() {
        let here = tempfile::tempdir().expect("a folder");
        fs::write(here.path().join("profiles.ini"), INI).expect("the list");
        let profile = here.path().join("Profiles/x1.default-release");
        for file in [
            "sessionstore.jsonlz4",
            "sessionstore-backups/recovery.jsonlz4",
            "places.sqlite",
            "bookmarkbackups/bookmarks-2026-10-01_12_abc.jsonlz4",
            "bookmarkbackups/bookmarks-2026-10-17_14_def.jsonlz4",
            "cookies.sqlite",
        ] {
            touch(&profile.join(file));
        }
        fs::create_dir_all(here.path().join("Profiles/y2.empty")).expect("an empty profile");

        let found = ini_profiles(here.path(), files_of);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "default-release");
        assert_eq!(
            found[0].files,
            vec![
                "sessionstore-backups/recovery.jsonlz4",
                "sessionstore.jsonlz4",
                "places.sqlite",
                "bookmarkbackups/bookmarks-2026-10-17_14_def.jsonlz4",
            ]
        );
    }

    /// The tables as Firefox makes them, as far as the bookmarks go.
    fn places(at: &Path) -> Connection {
        let db = Connection::open(at).expect("a database");
        db.execute_batch(
            "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR);
             CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER,
               parent INTEGER, position INTEGER, title LONGVARCHAR, dateAdded INTEGER, guid TEXT);
             INSERT INTO moz_places VALUES (1, 'https://docs.example.com/', 'Docs'),
               (2, 'https://news.example.com/', 'News'), (3, 'place:tag=x', NULL);
             INSERT INTO moz_bookmarks VALUES
               (1, 2, NULL, 0, 0, '', 1, 'root________'),
               (2, 2, NULL, 1, 0, 'menu', 1, 'menu________'),
               (3, 2, NULL, 1, 1, 'toolbar', 1, 'toolbar_____'),
               (4, 2, NULL, 1, 2, 'tags', 1, 'tags________'),
               (5, 1, 2, 3, 1, 'News', 1700000000000000, 'news'),
               (6, 2, NULL, 3, 0, 'Work', 1700000000000000, 'work'),
               (7, 1, 1, 6, 0, 'Docs', 1700000000000000, 'docs'),
               (8, 3, NULL, 2, 0, NULL, 1, 'sep'),
               (9, 2, NULL, 4, 0, 'x', 1, 'tagx'),
               (10, 1, 1, 9, 0, NULL, 1, 'tagged');",
        )
        .expect("the tables");
        db
    }

    #[test]
    fn the_bookmarks_come_out_nested_in_firefox_order_without_the_tags() {
        let here = tempfile::tempdir().expect("a folder");
        let db = places(&here.path().join(PLACES));

        let tree = tree_of(&db).expect("a tree");
        assert_eq!(tree["guid"], "root________");
        let roots: Vec<&str> = tree["children"]
            .as_array()
            .expect("roots")
            .iter()
            .filter_map(|one| one["guid"].as_str())
            .collect();
        assert_eq!(roots, vec!["menu________", "toolbar_____"]);
        let toolbar = &tree["children"][1]["children"];
        assert_eq!(toolbar[0]["title"], "Work");
        assert_eq!(
            toolbar[0]["children"][0]["uri"],
            "https://docs.example.com/"
        );
        assert_eq!(toolbar[1]["uri"], "https://news.example.com/");
        assert_eq!(toolbar[1]["dateAdded"], 1_700_000_000_000_000_i64);
        assert_eq!(tree["children"][0]["children"][0]["typeCode"], 3);
    }

    #[test]
    fn a_database_firefox_has_open_is_read_from_a_copy() {
        let here = tempfile::tempdir().expect("a folder");
        let db = places(&here.path().join(PLACES));
        db.pragma_update(None, "journal_mode", "wal")
            .expect("a log");

        let copied = copy_out(here.path()).expect("a copy");
        let read = Connection::open(copied.path().join(PLACES)).expect("the copy");
        assert!(tree_of(&read).expect("a tree")["children"].is_array());
        drop(db);
    }

    #[test]
    fn only_the_places_of_a_listed_profile_are_read() {
        let listed = vec![Profile {
            name: "default".into(),
            path: "/home/me/.mozilla/firefox/x1".into(),
            files: vec![PLACES.into()],
        }];
        assert!(known("Firefox", "/home/me/.mozilla/firefox/x1", PLACES, &listed).is_ok());
        assert!(known(
            "Firefox",
            "/home/me/.mozilla/firefox/x1/..",
            PLACES,
            &listed
        )
        .is_err());
        assert!(known(
            "Firefox",
            "/home/me/.mozilla/firefox/x1",
            "logins.json",
            &listed
        )
        .is_err());
    }
}
