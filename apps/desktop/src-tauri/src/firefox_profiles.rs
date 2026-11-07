use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::browser_profiles::{copied, ini_profiles, known, once, Profile};
use crate::paths::folder_named;

pub(crate) const BROWSERS_DIR: &str = "ORDEN_BROWSERS_DIR";

const SESSIONS: [&str; 3] = [
    "sessionstore-backups/recovery.jsonlz4",
    "sessionstore.jsonlz4",
    "sessionstore-backups/previous.jsonlz4",
];

pub(crate) const PLACES: &str = "places.sqlite";
pub(crate) const FAVICONS: &str = "favicons.sqlite";
pub(crate) const SEARCH: &str = "search.json.mozlz4";
const BACKUPS: &str = "bookmarkbackups";
const BACKUP_PREFIX: &str = "bookmarks-";
const BACKUP_SUFFIX: &str = ".jsonlz4";

const TAGS: &str = "tags________";

pub(crate) fn profiles() -> Vec<Profile> {
    once(homes().iter().flat_map(|home| ini_profiles(home, files_of)))
}

#[tauri::command(async)]
pub fn read_firefox_places(profile: String) -> Result<String, String> {
    let path = known("Firefox", &profile, PLACES, &profiles())?;
    let folder = path.parent().ok_or("a profile has a folder")?;
    let copy =
        copied(folder, PLACES).map_err(|error| format!("{PLACES} could not be copied: {error}"))?;
    let db = Connection::open(copy.path().join(PLACES))
        .map_err(|error| format!("{PLACES} could not be opened: {error}"))?;
    let tree = tree_of(&db).map_err(|error| format!("{PLACES} could not be read: {error}"))?;
    Ok(tree.to_string())
}

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

fn files_of(profile: &Path) -> Vec<String> {
    let mut found: Vec<String> = SESSIONS
        .iter()
        .chain(&[PLACES, FAVICONS, SEARCH])
        .filter(|name| profile.join(name).is_file())
        .map(|name| (*name).to_owned())
        .collect();

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

struct Row {
    id: i64,
    parent: i64,
    kind: i64,
    title: String,
    added: i64,
    guid: String,
    url: Option<String>,
}

pub(crate) fn tree_of(db: &Connection) -> rusqlite::Result<Value> {
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

        let copy = copied(here.path(), PLACES).expect("a copy");
        let read = Connection::open(copy.path().join(PLACES)).expect("the copy");
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
