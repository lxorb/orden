//! Safari's tabs and bookmarks, for the import's Safari row. A Mac's only.
//!
//! Safari keeps no list of profiles to read the way Firefox and Chromium do; what
//! the import reads is three files in the home folder:
//!
//! - `Library/Safari/Bookmarks.plist`, a binary property list of every bookmark, the
//!   Favorites bar and the Bookmarks menu among them, and the Reading List as a list
//!   called `com.apple.ReadingList`;
//! - `SafariTabs.db`, where Safari 15 and later keep the open tabs: one table,
//!   `bookmarks`, whose rows of type 1 are folders (a tab group, a profile, a list of
//!   Safari's own) and of type 0 tabs. It lives in Safari's container,
//!   `Library/Containers/com.apple.Safari/Data/Library/Safari/`, and is open while
//!   Safari runs, so it is copied with its log and the copy is read, the way
//!   Firefox's bookmarks are;
//! - `Library/Safari/LastSession.plist`, the windows of a Safari from before that.
//!
//! The property lists are handed over as JSON, a date as its ISO day and time and a
//! blob of bytes as nothing, and the tabs as their rows: what each means is the
//! app's to read (`import/safari.ts`). macOS keeps all three behind Full Disk Access,
//! so the first read is refused by the system; that is answered as `no access`, as
//! Apple Notes' is, and the app says so and opens the setting. Never written.

use serde_json::{json, Map, Value};
use std::fs;
use std::io::{Cursor, ErrorKind};
use std::path::{Path, PathBuf};

use crate::browser_profiles::{copied, Profile};
use crate::firefox_profiles::BROWSERS_DIR;
use crate::paths::folder_named;

/// The bookmarks, the old session, and where the tabs may be, from the home folder.
const BOOKMARKS: &str = "Library/Safari/Bookmarks.plist";
const SESSION: &str = "Library/Safari/LastSession.plist";
const TABS: [&str; 2] = [
    "Library/Containers/com.apple.Safari/Data/Library/Safari",
    "Library/Safari",
];
const TABS_DATABASE: &str = "SafariTabs.db";

/// What the app is answered when macOS refused every file: the setting is the way
/// in, and saying so is the app's business.
const NO_ACCESS: &str = "no access";

/// More than any bookmark list is.
const MOST_BYTES: u64 = 64 * 1024 * 1024;

/// Safari's one profile, as the import lists it: on a Mac always, since Safari is
/// part of it and whether its folder can even be looked at is Full Disk Access's to
/// say; and a probe's own Safari wherever `NIB_BROWSERS_DIR` names one.
pub(crate) fn profiles() -> Vec<Profile> {
    home()
        .map(|home| Profile {
            name: "Safari".into(),
            path: home.join("Library/Safari").to_string_lossy().into_owned(),
            files: Vec::new(),
        })
        .into_iter()
        .collect()
}

/// The home folder Safari's files are under: a probe's own `safari/`, else a Mac's.
fn home() -> Option<PathBuf> {
    if let Some(named) = folder_named(std::env::var_os(BROWSERS_DIR).as_deref()) {
        let home = named.join("safari");
        return home.is_dir().then_some(home);
    }
    if cfg!(target_os = "macos") {
        dirs::home_dir()
    } else {
        None
    }
}

/// Safari's bookmarks, open tabs and old session, as one JSON object, each null where
/// its file is not there or does not read. `no access` where macOS refused them.
#[tauri::command(async)]
pub fn read_safari() -> Result<String, String> {
    let home = home().ok_or("Safari is a Mac's")?;
    read_from(&home).map(|read| read.to_string())
}

/// What a file came to: read, not there, or refused by the system.
enum Got<T> {
    Read(T),
    Missing,
    Refused,
}

fn read_from(home: &Path) -> Result<Value, String> {
    let bookmarks = plist_at(&home.join(BOOKMARKS));
    let session = plist_at(&home.join(SESSION));
    let tabs = TABS
        .iter()
        .map(|folder| tabs_in(&home.join(folder)))
        .find(|got| !matches!(got, Got::Missing))
        .unwrap_or(Got::Missing);

    let refused = [&bookmarks, &session]
        .into_iter()
        .any(|got| matches!(got, Got::Refused))
        || matches!(tabs, Got::Refused);
    let value = |got: Got<Value>| match got {
        Got::Read(value) => value,
        Got::Missing | Got::Refused => Value::Null,
    };
    let read = json!({
        "bookmarks": value(bookmarks),
        "tabs": value(tabs),
        "session": value(session),
    });

    if ["bookmarks", "tabs", "session"]
        .iter()
        .all(|key| read[key].is_null())
    {
        return Err(if refused {
            NO_ACCESS.to_owned()
        } else {
            "Safari holds no tabs or bookmarks here".to_owned()
        });
    }
    Ok(read)
}

/// A property list as JSON.
fn plist_at(path: &Path) -> Got<Value> {
    match fs::metadata(path) {
        Ok(found) if found.len() > MOST_BYTES => return Got::Missing,
        Err(error) => return refusal(&error),
        Ok(_) => {}
    }
    match fs::read(path) {
        Ok(bytes) => plist::Value::from_reader(Cursor::new(bytes))
            .map_or(Got::Missing, |read| Got::Read(json_of(&read))),
        Err(error) => refusal(&error),
    }
}

/// What an error opening a file says: the system's refusal, or no such file.
fn refusal<T>(error: &std::io::Error) -> Got<T> {
    if error.kind() == ErrorKind::PermissionDenied {
        Got::Refused
    } else {
        Got::Missing
    }
}

/// A property list's value as JSON: a date as its ISO day and time, and a blob of
/// bytes or an archiver's reference as nothing, since nothing the import reads is one.
fn json_of(value: &plist::Value) -> Value {
    match value {
        plist::Value::Array(all) => Value::Array(all.iter().map(json_of).collect()),
        plist::Value::Dictionary(entries) => Value::Object(
            entries
                .iter()
                .map(|(key, one)| (key.clone(), json_of(one)))
                .collect::<Map<String, Value>>(),
        ),
        plist::Value::Boolean(on) => json!(on),
        plist::Value::Real(number) => json!(number),
        plist::Value::Integer(number) => number
            .as_signed()
            .map(|one| json!(one))
            .or_else(|| number.as_unsigned().map(|one| json!(one)))
            .unwrap_or(Value::Null),
        plist::Value::String(words) => json!(words),
        plist::Value::Date(when) => json!(when.to_xml_format()),
        _ => Value::Null,
    }
}

/// The rows of `SafariTabs.db` in a folder: every row of its `bookmarks` table with
/// what says where it is, in Safari's order.
fn tabs_in(folder: &Path) -> Got<Value> {
    if let Err(error) = fs::metadata(folder.join(TABS_DATABASE)) {
        return refusal(&error);
    }
    let copy = match copied(folder, TABS_DATABASE) {
        Ok(copy) => copy,
        Err(error) => return refusal(&error),
    };
    rows_of(&copy.path().join(TABS_DATABASE)).map_or(Got::Missing, Got::Read)
}

/// The rows as `{ id, parent, type, title, url, order, deleted }`. A column an older
/// Safari's table does not have is read as nothing.
fn rows_of(database: &Path) -> rusqlite::Result<Value> {
    let db = rusqlite::Connection::open(database)?;
    let columns: Vec<String> = db
        .prepare("SELECT name FROM pragma_table_info('bookmarks')")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let deleted = if columns.iter().any(|one| one == "deleted") {
        "IFNULL(deleted, 0)"
    } else {
        "0"
    };
    let mut statement = db.prepare(&format!(
        "SELECT id, parent, type, title, url, order_index, {deleted} \
         FROM bookmarks ORDER BY parent, order_index, id"
    ))?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "parent": row.get::<_, Option<i64>>(1)?,
                "type": row.get::<_, Option<i64>>(2)?,
                "title": row.get::<_, Option<String>>(3)?,
                "url": row.get::<_, Option<String>>(4)?,
                "order": row.get::<_, Option<i64>>(5)?,
                "deleted": row.get::<_, i64>(6)? != 0,
            }))
        })?
        .collect::<rusqlite::Result<Vec<Value>>>()?;
    Ok(Value::Array(rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use plist::{Dictionary, Value as P};

    fn list(title: &str, children: Vec<P>) -> P {
        let mut out = Dictionary::new();
        out.insert("Title".into(), P::String(title.into()));
        out.insert(
            "WebBookmarkType".into(),
            P::String("WebBookmarkTypeList".into()),
        );
        out.insert("Children".into(), P::Array(children));
        P::Dictionary(out)
    }

    fn leaf(url: &str, title: &str) -> P {
        let mut uri = Dictionary::new();
        uri.insert("title".into(), P::String(title.into()));
        let mut out = Dictionary::new();
        out.insert("URLString".into(), P::String(url.into()));
        out.insert("URIDictionary".into(), P::Dictionary(uri));
        out.insert(
            "WebBookmarkType".into(),
            P::String("WebBookmarkTypeLeaf".into()),
        );
        out.insert("WebBookmarkUUID".into(), P::String("6F1B".into()));
        P::Dictionary(out)
    }

    /// Bookmarks.plist as Safari writes it: binary, the Favorites bar, the menu and the
    /// Reading List under the root, a reading-list item with its day added.
    fn bookmarks(at: &Path) {
        let mut read = leaf("https://later.example.com/", "Later");
        if let P::Dictionary(entries) = &mut read {
            let mut said = Dictionary::new();
            said.insert(
                "DateAdded".into(),
                P::Date(plist::Date::from_xml_format("2026-10-01T08:00:00Z").expect("a date")),
            );
            said.insert("PreviewText".into(), P::String("A long read".into()));
            entries.insert("ReadingList".into(), P::Dictionary(said));
            entries.insert("imageURL".into(), P::Data(vec![1, 2, 3]));
        }
        let root = list(
            "",
            vec![
                list(
                    "BookmarksBar",
                    vec![leaf("https://news.example.com/", "News")],
                ),
                list("BookmarksMenu", vec![]),
                list("com.apple.ReadingList", vec![read]),
            ],
        );
        fs::create_dir_all(at.parent().expect("a folder")).expect("the folder");
        root.to_file_binary(at).expect("a property list");
    }

    /// SafariTabs.db with the table as Safari 18 writes it, as far as these columns go.
    fn tabs(folder: &Path) {
        fs::create_dir_all(folder).expect("the folder");
        let db = rusqlite::Connection::open(folder.join(TABS_DATABASE)).expect("a database");
        db.execute_batch(
            "CREATE TABLE bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT,special_id INTEGER DEFAULT 0,
               parent INTEGER, type INTEGER,title TEXT,url TEXT COLLATE NOCASE,num_children INTEGER DEFAULT 0,
               order_index INTEGER NOT NULL,external_uuid TEXT UNIQUE,last_modified REAL DEFAULT NULL,
               deleted INTEGER DEFAULT 0,extra_attributes BLOB DEFAULT NULL,local_attributes BLOB DEFAULT NULL,
               date_closed REAL DEFAULT NULL, subtype INTEGER DEFAULT 0);
             INSERT INTO bookmarks (id, parent, type, title, url, order_index, deleted) VALUES
               (1, 0, 1, 'Root', NULL, 0, 0),
               (2, 1, 1, 'Cars', NULL, 0, 0),
               (3, 2, 0, 'One', 'https://one.example/', 1, 0),
               (4, 2, 0, 'Gone', 'https://gone.example/', 2, 1);",
        )
        .expect("the rows");
    }

    #[test]
    fn the_three_files_come_as_json_dates_as_days_and_bytes_as_nothing() {
        let home = tempfile::tempdir().expect("a folder");
        bookmarks(&home.path().join(BOOKMARKS));
        tabs(&home.path().join(TABS[0]));

        let read = read_from(home.path()).expect("something read");
        let bar = &read["bookmarks"]["Children"][0];
        assert_eq!(bar["Title"], "BookmarksBar");
        assert_eq!(bar["Children"][0]["URLString"], "https://news.example.com/");
        let later = &read["bookmarks"]["Children"][2]["Children"][0];
        assert_eq!(later["ReadingList"]["DateAdded"], "2026-10-01T08:00:00Z");
        assert!(later["imageURL"].is_null());

        let rows = read["tabs"].as_array().expect("rows");
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[2]["title"], "One");
        assert_eq!(rows[3]["deleted"], true);
        assert!(read["session"].is_null());
    }

    #[test]
    fn the_tabs_of_an_older_safari_are_read_where_it_kept_them() {
        let home = tempfile::tempdir().expect("a folder");
        tabs(&home.path().join(TABS[1]));
        assert_eq!(
            read_from(home.path()).expect("tabs")["tabs"][2]["url"],
            "https://one.example/"
        );
    }

    #[test]
    fn nothing_there_is_said_and_is_not_a_refusal() {
        let home = tempfile::tempdir().expect("a folder");
        assert_eq!(
            read_from(home.path()).unwrap_err(),
            "Safari holds no tabs or bookmarks here"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_the_system_will_not_open_is_no_access() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempfile::tempdir().expect("a folder");
        bookmarks(&home.path().join(BOOKMARKS));
        let safari = home.path().join("Library/Safari");
        fs::set_permissions(&safari, fs::Permissions::from_mode(0o000)).expect("closed");
        // Root reads through a closed folder; the refusal is only there for anybody else.
        let refused = fs::read(home.path().join(BOOKMARKS)).is_err();
        let read = read_from(home.path());
        fs::set_permissions(&safari, fs::Permissions::from_mode(0o755)).expect("open");
        if refused {
            assert_eq!(read.unwrap_err(), NO_ACCESS);
        }
    }
}
