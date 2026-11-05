//! What a browser's profile keeps in its databases besides its bookmarks, for the
//! import: the pages it has been to, and the marks of the sites its tabs are on.
//!
//! The history is Firefox's and Zen's `moz_places` in `places.sqlite`, a Chromium's
//! `urls` in `History`, Safari's `history_items` and `history_visits` in
//! `History.db`: the most recent as many pages as Orden keeps, each with its title,
//! how often it was visited, how often typed and when last. The marks are Firefox's
//! and Zen's `favicons.sqlite` and a Chromium's `Favicons`, each page's own picture
//! or else one of its site's, as a `data:` address the app writes into a web note.
//!
//! Every one is a database the browser keeps open, so it is copied with its log and
//! the copy is read, as `places.sqlite` is for the bookmarks (`firefox_profiles.rs`);
//! only a listed file of a profile the browser lists, and never written.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;

use crate::browser_profiles::{copied, known, profiles_of};
use crate::paths::folded;

/// As many pages as Orden's history keeps (`MOST_VISITS` in web-tab/visits.ts).
const MOST_VISITS: i64 = 2000;

/// The most pages one call asks marks for: more tabs than anybody keeps open.
const MOST_PAGES: usize = 5000;

/// A picture past this is not a site's mark. Its `data:` address stays under the
/// longest the app keeps (`LONGEST_MARK` in import/sidebar-plan.ts).
const LONGEST_MARK: usize = 46 * 1024;

/// The size a mark is drawn at in the file list, at twice the pixels.
const MARK_SIZE: i64 = 32;

/// Microseconds from 1601 to 1970, which is where Chromium counts its times from.
const CHROMIUM_EPOCH: i64 = 11_644_473_600_000_000;

/// Seconds from 1970 to 2001, which is where Safari counts its times from.
const SAFARI_EPOCH: f64 = 978_307_200.0;

/// Which kind of profile a browser keeps.
#[derive(Clone, Copy)]
enum Kind {
    Mozilla,
    Chromium,
    Safari,
}

fn profile_kind(browser: &str) -> Option<Kind> {
    match browser {
        "zen" | "firefox" => Some(Kind::Mozilla),
        "safari" => Some(Kind::Safari),
        _ if crate::chromium_profiles::BROWSERS.contains(&browser) => Some(Kind::Chromium),
        _ => None,
    }
}

/// The pages a profile has been to, newest first, as JSON: `[{ url, title, visits,
/// typed, last }]`, `last` in milliseconds.
#[tauri::command(async)]
pub fn read_browser_history(browser: String, profile: String) -> Result<String, String> {
    let kind = profile_kind(&browser).ok_or("not a browser the import reads")?;
    let file = match kind {
        Kind::Mozilla => "places.sqlite",
        Kind::Chromium => "History",
        Kind::Safari => "History.db",
    };
    let db = copied_database(&browser, &profile, file)?;
    let rows = history_of(&db.connection, kind).map_err(|error| format!("{file}: {error}"))?;
    Ok(Value::Array(rows).to_string())
}

/// The marks of the pages asked for that the profile holds, as JSON: each page's
/// `data:` address by the page.
#[tauri::command(async)]
pub fn read_browser_icons(
    browser: String,
    profile: String,
    pages: Vec<String>,
) -> Result<String, String> {
    let kind = profile_kind(&browser).ok_or("not a browser the import reads")?;
    let file = match kind {
        Kind::Mozilla => "favicons.sqlite",
        Kind::Chromium => "Favicons",
        Kind::Safari => return Ok("{}".into()),
    };
    let db = copied_database(&browser, &profile, file)?;
    let asked: Vec<&str> = pages.iter().map(String::as_str).take(MOST_PAGES).collect();
    let marks =
        marks_of(&db.connection, kind, &asked).map_err(|error| format!("{file}: {error}"))?;
    Ok(Value::Object(marks).to_string())
}

/// A copy of a database, open, and the folder that holds it for as long as it is read.
struct Opened {
    connection: Connection,
    _copy: tempfile::TempDir,
}

/// One listed database of a listed profile, copied and opened. Safari lists no files:
/// its one profile is its folder, and `History.db` is the one asked of it here.
fn copied_database(browser: &str, profile: &str, file: &str) -> Result<Opened, String> {
    let listed = profiles_of(browser);
    let path = if browser == "safari" {
        let one = listed
            .iter()
            .find(|one| folded(Path::new(&one.path)) == folded(Path::new(profile)))
            .ok_or_else(|| format!("{profile} is not a profile Safari lists"))?;
        Path::new(&one.path).join(file)
    } else {
        known(browser, profile, file, &listed)?
    };
    let folder = path.parent().ok_or("a profile has a folder")?;
    let copy =
        copied(folder, file).map_err(|error| format!("{file} could not be copied: {error}"))?;
    let connection = Connection::open(copy.path().join(file))
        .map_err(|error| format!("{file} could not be opened: {error}"))?;
    Ok(Opened {
        connection,
        _copy: copy,
    })
}

fn history_of(db: &Connection, kind: Kind) -> rusqlite::Result<Vec<Value>> {
    let query = match kind {
        Kind::Mozilla => {
            "SELECT url, IFNULL(title, ''), visit_count, typed, last_visit_date FROM moz_places \
             WHERE hidden = 0 AND visit_count > 0 AND last_visit_date IS NOT NULL \
             ORDER BY last_visit_date DESC LIMIT ?1"
        }
        Kind::Chromium => {
            "SELECT url, IFNULL(title, ''), visit_count, typed_count, last_visit_time FROM urls \
             WHERE hidden = 0 AND visit_count > 0 AND last_visit_time > 0 \
             ORDER BY last_visit_time DESC LIMIT ?1"
        }
        // The title is the last visit's: SQLite takes a bare column from the row MAX picked.
        Kind::Safari => {
            "SELECT i.url, IFNULL(v.title, ''), i.visit_count, 0, MAX(v.visit_time) \
             FROM history_items i JOIN history_visits v ON v.history_item = i.id \
             GROUP BY i.id ORDER BY MAX(v.visit_time) DESC LIMIT ?1"
        }
    };
    let mut statement = db.prepare(query)?;
    let rows = statement.query_map(params![MOST_VISITS], |row| {
        let last = match kind {
            Kind::Mozilla => row.get::<_, i64>(4)? / 1000,
            Kind::Chromium => (row.get::<_, i64>(4)? - CHROMIUM_EPOCH) / 1000,
            Kind::Safari => safari_time(row.get::<_, f64>(4)?),
        };
        Ok(json!({
            "url": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "visits": row.get::<_, i64>(2)?,
            "typed": row.get::<_, i64>(3)?,
            "last": last,
        }))
    })?;
    rows.collect()
}

/// A Safari time, seconds since 2001, as the whole milliseconds since 1970 the app
/// counts in.
#[allow(clippy::cast_possible_truncation)]
fn safari_time(seconds: f64) -> i64 {
    ((seconds + SAFARI_EPOCH) * 1000.0) as i64
}

/// One picture a page is drawn with: what it is found by, and how wide it is.
struct Candidate {
    page: String,
    id: i64,
    width: i64,
}

fn marks_of(db: &Connection, kind: Kind, pages: &[&str]) -> rusqlite::Result<Map<String, Value>> {
    let (listing, picture) = match kind {
        Kind::Mozilla => (
            "SELECT p.page_url, i.id, i.width FROM moz_pages_w_icons p \
             JOIN moz_icons_to_pages ip ON ip.page_id = p.id \
             JOIN moz_icons i ON i.id = ip.icon_id WHERE i.data IS NOT NULL",
            "SELECT data FROM moz_icons WHERE id = ?1",
        ),
        Kind::Chromium => (
            "SELECT m.page_url, b.id, b.width FROM icon_mapping m \
             JOIN favicon_bitmaps b ON b.icon_id = m.icon_id WHERE b.image_data IS NOT NULL",
            "SELECT image_data FROM favicon_bitmaps WHERE id = ?1",
        ),
        Kind::Safari => return Ok(Map::new()),
    };
    let mut statement = db.prepare(listing)?;
    let candidates = statement
        .query_map([], |row| {
            Ok(Candidate {
                page: row.get(0)?,
                id: row.get(1)?,
                width: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<Candidate>>>()?;

    let chosen = chosen_marks(&candidates, pages);
    let mut picture = db.prepare(picture)?;
    let mut drawn: HashMap<i64, Option<String>> = HashMap::new();
    let mut out = Map::new();
    for (page, id) in chosen {
        let address = drawn.entry(id).or_insert_with(|| {
            let bytes: Option<Vec<u8>> = picture.query_row(params![id], |row| row.get(0)).ok();
            bytes.as_deref().and_then(data_address)
        });
        if let Some(address) = address {
            out.insert(page.to_owned(), json!(address));
        }
    }
    Ok(out)
}

/// The picture each page asked for is drawn with: the page's own, else one of another
/// page of its site's, each the narrowest at least as wide as a mark is drawn, or the
/// widest there is.
fn chosen_marks<'a>(candidates: &[Candidate], pages: &[&'a str]) -> Vec<(&'a str, i64)> {
    let better =
        |held: &Candidate, one: &Candidate| match (held.width >= MARK_SIZE, one.width >= MARK_SIZE)
        {
            (true, true) => one.width < held.width,
            (false, false) => one.width > held.width,
            (held_big, _) => !held_big,
        };
    let mut by_page: HashMap<&str, &Candidate> = HashMap::new();
    let mut by_site: HashMap<&str, &Candidate> = HashMap::new();
    for one in candidates {
        for (key, map) in [
            (one.page.as_str(), &mut by_page),
            (site_part(&one.page), &mut by_site),
        ] {
            let keep = map.get(key).is_none_or(|held| better(held, one));
            if keep {
                map.insert(key, one);
            }
        }
    }

    pages
        .iter()
        .filter_map(|page| {
            by_page
                .get(page)
                .or_else(|| by_site.get(site_part(page)))
                .map(|one| (*page, one.id))
        })
        .collect()
}

/// A page's site: its scheme and host, the address up to the path.
fn site_part(page: &str) -> &str {
    let after = page.find("://").map_or(0, |at| at + 3);
    let end = page[after..]
        .find(['/', '?', '#'])
        .map_or(page.len(), |at| after + at);
    &page[..end]
}

/// A picture as a `data:` address, of the kind its first bytes say it is; none for
/// bytes that are no picture a page draws, or one too large to be a mark.
fn data_address(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > LONGEST_MARK {
        return None;
    }
    let kind = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        "image/x-icon"
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).contains("<svg") {
        "image/svg+xml"
    } else {
        return None;
    };
    Some(format!("data:{kind};base64,{}", BASE64.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";

    fn mozilla() -> Connection {
        let db = Connection::open_in_memory().expect("a database");
        db.execute_batch(
            "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT,
               visit_count INTEGER, hidden INTEGER, typed INTEGER, last_visit_date INTEGER);
             INSERT INTO moz_places VALUES
               (1, 'https://old.example.com/', 'Old', 3, 0, 0, 1600000000000000),
               (2, 'https://new.example.com/', NULL, 7, 0, 1, 1700000000000000),
               (3, 'https://hidden.example.com/', 'Hidden', 1, 1, 0, 1750000000000000),
               (4, 'https://never.example.com/', 'Never', 0, 0, 0, NULL);
             CREATE TABLE moz_icons (id INTEGER PRIMARY KEY, icon_url TEXT, width INTEGER, data BLOB);
             CREATE TABLE moz_pages_w_icons (id INTEGER PRIMARY KEY, page_url TEXT);
             CREATE TABLE moz_icons_to_pages (page_id INTEGER, icon_id INTEGER);
             INSERT INTO moz_pages_w_icons VALUES (1, 'https://mail.example.com/inbox'),
               (2, 'https://docs.example.com/'), (3, 'https://docs.example.com/guide');
             INSERT INTO moz_icons_to_pages VALUES (1, 1), (1, 2), (1, 3), (2, 4), (3, 5);",
        )
        .expect("the tables");
        let mut add = db
            .prepare("INSERT INTO moz_icons VALUES (?1, ?2, ?3, ?4)")
            .expect("a row");
        for (id, width, data) in [
            (1, 16, PNG.to_vec()),
            (2, 32, b"GIF89a".to_vec()),
            (3, 192, PNG.to_vec()),
            (
                4,
                64,
                b"<?xml?><svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
            ),
            (5, 16, b"not a picture".to_vec()),
        ] {
            add.execute(params![id, "https://example.com/i", width, data])
                .expect("an icon");
        }
        drop(add);
        db
    }

    #[test]
    fn the_history_comes_newest_first_without_hidden_or_unvisited_pages() {
        let rows = history_of(&mozilla(), Kind::Mozilla).expect("the history");
        assert_eq!(
            rows,
            vec![
                json!({ "url": "https://new.example.com/", "title": "", "visits": 7, "typed": 1, "last": 1_700_000_000_000_i64 }),
                json!({ "url": "https://old.example.com/", "title": "Old", "visits": 3, "typed": 0, "last": 1_600_000_000_000_i64 }),
            ]
        );
    }

    #[test]
    fn a_chromium_history_counts_from_1601() {
        let db = Connection::open_in_memory().expect("a database");
        db.execute_batch(
            "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER,
               typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER);
             INSERT INTO urls VALUES (1, 'https://a.example.com/', 'A', 2, 1, 13344473600000000, 0);",
        )
        .expect("the table");
        let rows = history_of(&db, Kind::Chromium).expect("the history");
        assert_eq!(rows[0]["last"], 1_700_000_000_000_i64);
        assert_eq!(rows[0]["typed"], 1);
    }

    #[test]
    fn a_safari_history_takes_the_last_visits_title_and_counts_from_2001() {
        let db = Connection::open_in_memory().expect("a database");
        db.execute_batch(
            "CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER);
             CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER,
               visit_time REAL, title TEXT);
             INSERT INTO history_items VALUES (1, 'https://a.example.com/', 2);
             INSERT INTO history_visits VALUES (1, 1, 700000000.0, 'Before'),
               (2, 1, 721692800.0, 'After');",
        )
        .expect("the tables");
        let rows = history_of(&db, Kind::Safari).expect("the history");
        assert_eq!(rows[0]["title"], "After");
        assert_eq!(rows[0]["last"], 1_700_000_000_000_i64);
    }

    #[test]
    fn each_page_gets_its_own_mark_else_its_sites_at_the_size_it_is_drawn() {
        let marks = marks_of(
            &mozilla(),
            Kind::Mozilla,
            &[
                "https://mail.example.com/inbox",
                "https://docs.example.com/api",
                "https://docs.example.com/guide",
                "https://nowhere.example.com/",
            ],
        )
        .expect("the marks");
        assert_eq!(
            marks["https://mail.example.com/inbox"],
            format!("data:image/gif;base64,{}", BASE64.encode(b"GIF89a"))
        );
        assert!(marks["https://docs.example.com/api"]
            .as_str()
            .is_some_and(|one| one.starts_with("data:image/svg+xml;base64,")));
        // Its own picture is no picture, and nothing stands in for a page's own.
        assert!(!marks.contains_key("https://docs.example.com/guide"));
        assert!(!marks.contains_key("https://nowhere.example.com/"));
    }

    #[test]
    fn a_site_is_its_scheme_and_host() {
        assert_eq!(
            site_part("https://a.example.com/x?y"),
            "https://a.example.com"
        );
        assert_eq!(
            site_part("https://a.example.com?q"),
            "https://a.example.com"
        );
        assert_eq!(site_part("https://a.example.com"), "https://a.example.com");
    }

    #[test]
    fn a_picture_too_large_is_no_mark() {
        let big = [PNG, &vec![0_u8; LONGEST_MARK]].concat();
        assert!(data_address(&big).is_none());
        assert!(data_address(PNG).is_some());
    }

    #[test]
    fn only_a_browser_the_import_reads_is_asked() {
        assert!(read_browser_history("netscape".into(), "/x".into()).is_err());
        assert!(read_browser_icons("firefox".into(), "/not/listed".into(), Vec::new()).is_err());
    }
}
