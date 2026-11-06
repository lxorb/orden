use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::browser_profiles::{
    copied, ini_profiles, known as listed_file, once, read_listed, Profile,
};
#[cfg(test)]
use crate::browser_profiles::{entries_in, installed_defaults};
use crate::firefox_profiles::{tree_of, FAVICONS, PLACES, SEARCH};
use crate::paths::folder_named;

pub type ZenProfile = Profile;

const ZEN_DIR: &str = "NIB_ZEN_DIR";

const SESSIONS: [&str; 4] = [
    "zen-sessions.jsonlz4",
    "zen-sessions-backup/clean.jsonlz4",
    "sessionstore-backups/recovery.jsonlz4",
    "sessionstore.jsonlz4",
];

const BACKUPS: &str = "zen-sessions-backup";
const BACKUP_PREFIX: &str = "zen-sessions-";
const BACKUP_SUFFIX: &str = ".jsonlz4";

#[tauri::command(async)]
pub fn zen_profiles() -> Vec<ZenProfile> {
    listed()
}

#[tauri::command(async)]
pub fn read_zen_file(profile: String, file: String) -> Result<String, String> {
    read_listed("Zen", &profile, &file, &listed())
}

#[tauri::command(async)]
pub fn read_zen_places(profile: String) -> Result<String, String> {
    let path = listed_file("Zen", &profile, PLACES, &listed())?;
    let folder = path.parent().ok_or("a profile has a folder")?;
    let copy =
        copied(folder, PLACES).map_err(|error| format!("{PLACES} could not be copied: {error}"))?;
    let db = Connection::open(copy.path().join(PLACES))
        .map_err(|error| format!("{PLACES} could not be opened: {error}"))?;
    Ok(places_of(&db).to_string())
}

fn places_of(db: &Connection) -> Value {
    json!({
        "bookmarks": tree_of(db).unwrap_or(Value::Null),
        "spaces": table_rows(db, "SELECT * FROM zen_workspaces"),
        "pins": table_rows(db, "SELECT * FROM zen_pins"),
        "assigned": table_rows(db, "SELECT bookmark_guid, workspace_uuid FROM zen_bookmarks_workspaces"),
    })
}

fn table_rows(db: &Connection, query: &str) -> Vec<Value> {
    let Ok(mut statement) = db.prepare(query) else {
        return Vec::new();
    };
    let names: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect();
    let Ok(rows) = statement.query_map([], |row| {
        let mut out = Map::new();
        for (at, name) in names.iter().enumerate() {
            let value = match row.get_ref(at)? {
                ValueRef::Integer(one) => json!(one),
                ValueRef::Real(one) => json!(one),
                ValueRef::Text(one) => json!(String::from_utf8_lossy(one)),
                ValueRef::Null | ValueRef::Blob(_) => Value::Null,
            };
            out.insert(name.clone(), value);
        }
        Ok(Value::Object(out))
    }) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

pub(crate) fn listed() -> Vec<ZenProfile> {
    once(homes().iter().flat_map(|home| profiles_in(home)))
}

fn homes() -> Vec<PathBuf> {
    if let Some(named) = folder_named(std::env::var_os(ZEN_DIR).as_deref()) {
        return vec![named];
    }

    let mut found = Vec::new();
    if let Some(config) = dirs::config_dir() {
        found.push(config.join("zen"));
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        found.push(home.join(".zen"));
        found.push(home.join(".var/app/app.zen_browser.zen/.zen"));
    }

    found
}

fn profiles_in(home: &Path) -> Vec<ZenProfile> {
    ini_profiles(home, files_of)
}

fn files_of(profile: &Path) -> Vec<String> {
    let mut found: Vec<String> = SESSIONS
        .iter()
        .filter(|name| profile.join(name).is_file())
        .map(|name| (*name).to_owned())
        .collect();
    if found.is_empty() {
        return found;
    }

    let newest = fs::read_dir(profile.join(BACKUPS))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX))
        .max();
    if let Some(name) = newest {
        let at = found
            .iter()
            .position(|one| one.starts_with("sessionstore"))
            .unwrap_or(found.len());
        found.insert(at, format!("{BACKUPS}/{name}"));
    }
    found.extend(
        [PLACES, FAVICONS, SEARCH]
            .into_iter()
            .filter(|name| profile.join(name).is_file())
            .map(str::to_owned),
    );

    found
}

#[cfg(test)]
fn known(profile: &str, file: &str, listed: &[ZenProfile]) -> Result<PathBuf, String> {
    crate::browser_profiles::known("Zen", profile, file, listed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Install6F193CCC56814779]\r\nDefault=Profiles/b2.Default (release)\r\nLocked=1\r\n\r\n[Profile1]\r\nName=Default Profile\r\nIsRelative=1\r\nPath=Profiles/a1.default\r\nDefault=1\r\n\r\n[Profile0]\r\nName=Default (release)\r\nIsRelative=1\r\nPath=Profiles/b2.Default (release)\r\n\r\n[Profile2]\r\nName=Work\r\nIsRelative=1\r\nPath=Profiles/c3.Work\r\n\r\n[General]\r\nStartWithLastProfile=1\r\nVersion=2\r\n";

    fn profile(home: &Path, path: &str, files: &[&str]) {
        for file in files {
            let at = home.join(path).join(file);
            fs::create_dir_all(at.parent().expect("a folder")).expect("the folder");
            fs::write(at, b"mozLz40\0").expect("a session");
        }
    }

    #[test]
    fn every_profile_of_the_file_is_read() {
        assert_eq!(
            entries_in(INI)
                .into_iter()
                .map(|one| (one.name, one.path, one.relative, one.default))
                .collect::<Vec<_>>(),
            vec![
                (
                    "Default Profile".into(),
                    "Profiles/a1.default".into(),
                    true,
                    true
                ),
                (
                    "Default (release)".into(),
                    "Profiles/b2.Default (release)".into(),
                    true,
                    false
                ),
                ("Work".into(), "Profiles/c3.Work".into(), true, false),
            ]
        );
        assert_eq!(
            installed_defaults(INI),
            vec!["Profiles/b2.Default (release)".to_owned()]
        );
    }

    #[test]
    fn the_profile_zen_opens_comes_first_and_one_without_a_session_not_at_all() {
        let here = tempfile::tempdir().expect("a folder");
        fs::write(here.path().join("profiles.ini"), INI).expect("the list");
        profile(
            here.path(),
            "Profiles/a1.default",
            &["sessionstore-backups/recovery.jsonlz4"],
        );
        profile(
            here.path(),
            "Profiles/b2.Default (release)",
            &["zen-sessions.jsonlz4"],
        );
        fs::create_dir_all(here.path().join("Profiles/c3.Work")).expect("an empty profile");

        let found = profiles_in(here.path());
        let names: Vec<&str> = found.iter().map(|one| one.name.as_str()).collect();
        assert_eq!(names, vec!["Default (release)", "Default Profile"]);
        assert_eq!(found[0].files, vec!["zen-sessions.jsonlz4".to_owned()]);
    }

    #[test]
    fn the_session_files_come_in_the_order_they_are_worth_reading() {
        let here = tempfile::tempdir().expect("a folder");
        profile(
            here.path(),
            "p",
            &[
                "sessionstore-backups/recovery.jsonlz4",
                "zen-sessions.jsonlz4",
                "zen-sessions-backup/clean.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-01-09.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-12-21.jsonlz4",
                "zen-sessions-backup/recovery.baklz4",
            ],
        );

        assert_eq!(
            files_of(&here.path().join("p")),
            vec![
                "zen-sessions.jsonlz4",
                "zen-sessions-backup/clean.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-12-21.jsonlz4",
                "sessionstore-backups/recovery.jsonlz4",
            ]
        );
    }

    #[test]
    fn only_a_listed_file_of_a_listed_profile_is_read() {
        let listed = vec![ZenProfile {
            name: "Default".into(),
            path: "/home/me/.zen/p".into(),
            files: vec!["zen-sessions.jsonlz4".into()],
        }];

        assert!(known("/home/me/.zen/p", "zen-sessions.jsonlz4", &listed).is_ok());
        assert!(known("/home/me/.zen/p/../q", "zen-sessions.jsonlz4", &listed).is_err());
        assert!(known("/home/me/.zen/p", "../../.ssh/id_ed25519", &listed).is_err());
        assert!(known("/home/me/.zen/p", "places.sqlite", &listed).is_err());
        assert!(known("/home/me/.zen/other", "zen-sessions.jsonlz4", &listed).is_err());
    }

    #[test]
    fn the_databases_and_the_engines_come_after_the_sessions_and_only_with_one() {
        let here = tempfile::tempdir().expect("a folder");
        profile(
            here.path(),
            "p",
            &["zen-sessions.jsonlz4", PLACES, FAVICONS, SEARCH],
        );
        profile(here.path(), "q", &[PLACES]);

        assert_eq!(
            files_of(&here.path().join("p")),
            vec!["zen-sessions.jsonlz4", PLACES, FAVICONS, SEARCH]
        );
        assert!(files_of(&here.path().join("q")).is_empty());
    }

    #[test]
    fn the_places_of_a_zen_before_its_sessions_file_come_as_rows() {
        let db = Connection::open_in_memory().expect("a database");
        db.execute_batch(
            "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
             CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER,
               parent INTEGER, position INTEGER, title TEXT, dateAdded INTEGER, guid TEXT);
             INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 1, 'root________');
             CREATE TABLE zen_workspaces (id INTEGER PRIMARY KEY, uuid TEXT, name TEXT,
               icon TEXT, container_id INTEGER, position INTEGER, theme_colors TEXT,
               theme_opacity REAL);
             INSERT INTO zen_workspaces VALUES (2, '{h}', 'Home', NULL, NULL, 1000, '[]', 0.5);
             CREATE TABLE zen_pins (id INTEGER PRIMARY KEY, uuid TEXT, is_essential INTEGER,
               folder_icon BLOB);
             INSERT INTO zen_pins VALUES (8, '{m}', 1, x'00');",
        )
        .expect("the tables");

        let places = places_of(&db);
        assert_eq!(places["bookmarks"]["guid"], "root________");
        assert_eq!(
            places["spaces"],
            json!([{ "id": 2, "uuid": "{h}", "name": "Home", "icon": null, "container_id": null,
                "position": 1000, "theme_colors": "[]", "theme_opacity": 0.5 }])
        );
        assert_eq!(places["pins"][0]["is_essential"], 1);
        assert_eq!(places["pins"][0]["folder_icon"], Value::Null);
        assert_eq!(places["assigned"], json!([]));
    }

    #[test]
    fn a_missing_or_broken_list_is_no_profiles() {
        let here = tempfile::tempdir().expect("a folder");
        assert!(profiles_in(here.path()).is_empty());
        fs::write(here.path().join("profiles.ini"), "not an ini\0\u{1}").expect("a list");
        assert!(profiles_in(here.path()).is_empty());
    }
}
