use rusqlite::types::Value as Sql;
use rusqlite::{params_from_iter, Connection, ErrorCode, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Map, Value as Json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::store::{files_of, migrated_with, set_aside, Refused};
use crate::paths::{cannot, made};

const MIGRATIONS: [&str; 1] = [include_str!("chats.sql")];

const PATIENCE: Duration = Duration::from_secs(5);

const MOST_ROWS: u32 = 5000;

#[derive(Default)]
pub struct ChatStores(Mutex<Option<(String, PathBuf, ChatStore)>>);

impl ChatStores {
    fn lock(&self) -> MutexGuard<'_, Option<(String, PathBuf, ChatStore)>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Deserialize, Debug)]
#[serde(
    tag = "t",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Ask {
    Chats,
    Window {
        chat: String,
        #[serde(default)]
        parent: Option<String>,
        #[serde(default)]
        before: Option<i64>,
        #[serde(default)]
        after: Option<i64>,
        #[serde(default)]
        around: Option<i64>,
        limit: u32,
    },
    Messages {
        chat: String,
        ids: Vec<String>,
    },
    Search {
        #[serde(default)]
        chats: Vec<String>,
        #[serde(default)]
        words: Vec<String>,
        #[serde(default)]
        phrases: Vec<String>,
        #[serde(default)]
        has: Vec<String>,
        #[serde(default)]
        authors: Vec<String>,
        #[serde(default)]
        reply: bool,
        #[serde(default)]
        since: Option<i64>,
        #[serde(default)]
        until: Option<i64>,
        limit: u32,
    },
    Unread {
        chat: String,
        after: i64,
        me: String,
    },
    Outbox,
    Drafts,
}

#[derive(Deserialize, Debug)]
#[serde(
    tag = "t",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Change {
    Chat {
        id: String,
        space: String,
        seq: i64,
        read_seq: i64,
        #[serde(default)]
        oldest: Option<i64>,
        complete: bool,
        #[serde(default)]
        row: Option<String>,
    },
    Message {
        chat: String,
        id: String,
        seq: i64,
        at: i64,
        author: String,
        #[serde(default)]
        parent: Option<String>,
        main: bool,
        deleted: bool,
        body: String,
        has: String,
        upto: i64,
        json: String,
        #[serde(default)]
        marks: Option<String>,
    },
    Unmessage {
        chat: String,
        id: String,
    },
    Queue {
        id: String,
        chat: String,
        event: String,
        made_at: i64,
        tries: i64,
        #[serde(default)]
        refused: Option<String>,
    },
    Unqueue {
        id: String,
    },
    Draft {
        chat: String,
        text: String,
        at: i64,
    },
    Undraft {
        chat: String,
    },
    Forget {
        chat: String,
    },
}

pub struct ChatStore {
    conn: Connection,
}

struct Failed {
    said: String,
    damaged: bool,
}

impl From<rusqlite::Error> for Failed {
    fn from(error: rusqlite::Error) -> Self {
        Self {
            damaged: damaged(&error),
            said: format!("the chats' store failed: {error}"),
        }
    }
}

fn damaged(error: &rusqlite::Error) -> bool {
    error
        .sqlite_error_code()
        .is_some_and(|code| matches!(code, ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase))
}

fn whole(value: i64) -> Sql {
    Sql::Integer(value)
}

fn text(value: &str) -> Sql {
    Sql::Text(value.to_owned())
}

fn maybe_text(value: Option<&String>) -> Sql {
    value.map_or(Sql::Null, |one| Sql::Text(one.clone()))
}

fn slots(count: usize) -> String {
    vec!["?"; count].join(", ")
}

fn quoted(words: &str, prefix: bool) -> String {
    let inner = words.replace('"', "\"\"");
    if prefix {
        format!("\"{inner}\"*")
    } else {
        format!("\"{inner}\"")
    }
}

const MESSAGE: &str = "chat, id, seq, upto, json, marks";

impl ChatStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(folder) = path.parent() {
            made(folder)?;
        }
        match Self::opened(path) {
            Err(Refused::Damaged(_)) => {
                set_aside(path).map_err(|refused| refused.said())?;
                Self::opened(path).map_err(|refused| refused.said())
            }
            other => other.map_err(|refused| refused.said()),
        }
    }

    fn opened(path: &Path) -> Result<Self, Refused> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(PATIENCE)?;
        conn.pragma_update(None, "journal_mode", "wal")?;
        conn.pragma_update(None, "synchronous", "normal")?;
        migrated_with(&conn, &MIGRATIONS)?;
        Ok(Self { conn })
    }

    fn read(&mut self, asks: &[Ask]) -> Result<Vec<Json>, Failed> {
        let snapshot = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let mut answers = Vec::with_capacity(asks.len());
        for ask in asks {
            answers.push(answer(&snapshot, ask)?);
        }
        Ok(answers)
    }

    fn write(&mut self, changes: &[Change]) -> Result<(), Failed> {
        let batch = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for change in changes {
            apply(&batch, change)?;
        }
        batch.commit()?;
        Ok(())
    }

    fn close(self) -> Result<(), String> {
        self.conn
            .close()
            .map_err(|(_, error)| format!("the chats' store would not close: {error}"))
    }
}

fn rows(conn: &Connection, sql: &str, values: &[Sql]) -> Result<Vec<Json>, Failed> {
    let mut statement = conn.prepare_cached(sql)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    let mut found = statement.query(params_from_iter(values))?;
    let mut out = Vec::new();
    while let Some(row) = found.next()? {
        let mut object = Map::with_capacity(names.len());
        for (at, name) in names.iter().enumerate() {
            let value = match row.get_ref(at)? {
                rusqlite::types::ValueRef::Null | rusqlite::types::ValueRef::Blob(_) => Json::Null,
                rusqlite::types::ValueRef::Integer(number) => json!(number),
                rusqlite::types::ValueRef::Real(number) => json!(number),
                rusqlite::types::ValueRef::Text(bytes) => {
                    Json::String(String::from_utf8_lossy(bytes).into_owned())
                }
            };
            object.insert(name.clone(), value);
        }
        out.push(Json::Object(object));
    }
    Ok(out)
}

fn answer(conn: &Connection, ask: &Ask) -> Result<Json, Failed> {
    Ok(match ask {
        Ask::Chats => Json::Array(rows(
            conn,
            "select id, space, seq, read_seq, oldest, complete, row from chats order by id",
            &[],
        )?),
        Ask::Window {
            chat,
            parent,
            before,
            after,
            around,
            limit,
        } => Json::Array(window(
            conn,
            chat,
            parent.as_deref(),
            *before,
            *after,
            *around,
            *limit,
        )?),
        Ask::Messages { chat, ids } => {
            if ids.is_empty() {
                return Ok(Json::Array(Vec::new()));
            }
            let sql = format!(
                "select {MESSAGE} from messages where chat = ? and id in ({}) order by seq",
                slots(ids.len())
            );
            let mut values = vec![text(chat)];
            values.extend(ids.iter().map(|id| text(id)));
            Json::Array(rows(conn, &sql, &values)?)
        }
        Ask::Search { .. } => search(conn, ask)?,
        Ask::Unread { chat, after, me } => {
            let count: i64 = conn.query_row(
                "select count(*) from messages
                  where chat = ?1 and main = 1 and seq > ?2 and author <> ?3 and deleted = 0",
                rusqlite::params![chat, after, me],
                |row| row.get(0),
            )?;
            json!(count)
        }
        Ask::Outbox => Json::Array(rows(
            conn,
            "select id, chat, event, made_at, tries, refused from outbox order by made_at, id",
            &[],
        )?),
        Ask::Drafts => Json::Array(rows(conn, "select chat, text, at from drafts", &[])?),
    })
}

fn search(conn: &Connection, ask: &Ask) -> Result<Json, Failed> {
    let Ask::Search {
        chats,
        words,
        phrases,
        has,
        authors,
        reply,
        since,
        until,
        limit,
    } = ask
    else {
        return Ok(Json::Null);
    };
    let mut filters = Vec::new();
    let mut values = Vec::new();
    let matched: Vec<String> = words
        .iter()
        .filter(|one| !one.trim().is_empty())
        .map(|one| quoted(one, true))
        .chain(
            phrases
                .iter()
                .filter(|one| !one.trim().is_empty())
                .map(|one| quoted(one, false)),
        )
        .collect();
    if !matched.is_empty() {
        filters.push("rowid in (select rowid from words where words match ?)".to_owned());
        values.push(Sql::Text(matched.join(" ")));
    }
    if !chats.is_empty() {
        filters.push(format!("chat in ({})", slots(chats.len())));
        values.extend(chats.iter().map(|one| text(one)));
    }
    if !authors.is_empty() {
        filters.push(format!("author in ({})", slots(authors.len())));
        values.extend(authors.iter().map(|one| text(one)));
    }
    for one in has {
        filters.push("has like ?".to_owned());
        values.push(Sql::Text(format!("% {one} %")));
    }
    if *reply {
        filters.push("parent is not null".to_owned());
    }
    if let Some(since) = since {
        filters.push("at >= ?".to_owned());
        values.push(whole(*since));
    }
    if let Some(until) = until {
        filters.push("at < ?".to_owned());
        values.push(whole(*until));
    }
    filters.push("deleted = 0".to_owned());
    values.push(whole(i64::from((*limit).min(MOST_ROWS))));
    let sql = format!(
        "select {MESSAGE} from messages where {} order by at desc, seq desc limit ?",
        filters.join(" and ")
    );
    Ok(Json::Array(rows(conn, &sql, &values)?))
}

fn window(
    conn: &Connection,
    chat: &str,
    parent: Option<&str>,
    before: Option<i64>,
    after: Option<i64>,
    around: Option<i64>,
    limit: u32,
) -> Result<Vec<Json>, Failed> {
    let limit = i64::from(limit.clamp(1, MOST_ROWS));
    let (which, key) = match parent {
        Some(parent) => ("parent = ?2", text(parent)),
        None => ("main = ?2", whole(1)),
    };
    let older = |from: i64, many: i64| -> Result<Vec<Json>, Failed> {
        let sql = format!(
            "select {MESSAGE} from messages where chat = ?1 and {which} and seq < ?3
              order by seq desc limit ?4"
        );
        let mut found = rows(
            conn,
            &sql,
            &[text(chat), key.clone(), whole(from), whole(many)],
        )?;
        found.reverse();
        Ok(found)
    };
    let newer = |from: i64, many: i64| -> Result<Vec<Json>, Failed> {
        let sql = format!(
            "select {MESSAGE} from messages where chat = ?1 and {which} and seq > ?3
              order by seq limit ?4"
        );
        rows(
            conn,
            &sql,
            &[text(chat), key.clone(), whole(from), whole(many)],
        )
    };

    if let Some(around) = around {
        let half = limit / 2;
        let mut out = older(around, half)?;
        out.extend(newer(around - 1, limit - half)?);
        return Ok(out);
    }
    if let Some(after) = after {
        return newer(after, limit);
    }
    older(before.unwrap_or(i64::MAX), limit)
}

fn run(conn: &Connection, sql: &str, values: &[Sql]) -> Result<(), Failed> {
    conn.prepare_cached(sql)?
        .execute(params_from_iter(values))?;
    Ok(())
}

fn apply(conn: &Connection, change: &Change) -> Result<(), Failed> {
    match change {
        Change::Chat {
            id,
            space,
            seq,
            read_seq,
            oldest,
            complete,
            row,
        } => run(
            conn,
            "insert or replace into chats (id, space, seq, read_seq, oldest, complete, row)
             values (?, ?, ?, ?, ?, ?, ?)",
            &[
                text(id),
                text(space),
                whole(*seq),
                whole(*read_seq),
                oldest.map_or(Sql::Null, whole),
                whole(i64::from(*complete)),
                maybe_text(row.as_ref()),
            ],
        ),
        Change::Message { .. } => message(conn, change),
        Change::Unmessage { chat, id } => run(
            conn,
            "delete from messages where chat = ? and id = ?",
            &[text(chat), text(id)],
        ),
        Change::Queue {
            id,
            chat,
            event,
            made_at,
            tries,
            refused,
        } => run(
            conn,
            "insert or replace into outbox (id, chat, event, made_at, tries, refused)
             values (?, ?, ?, ?, ?, ?)",
            &[
                text(id),
                text(chat),
                text(event),
                whole(*made_at),
                whole(*tries),
                maybe_text(refused.as_ref()),
            ],
        ),
        Change::Unqueue { id } => run(conn, "delete from outbox where id = ?", &[text(id)]),
        Change::Draft {
            chat,
            text: words,
            at,
        } => run(
            conn,
            "insert or replace into drafts (chat, text, at) values (?, ?, ?)",
            &[text(chat), text(words), whole(*at)],
        ),
        Change::Undraft { chat } => run(conn, "delete from drafts where chat = ?", &[text(chat)]),
        Change::Forget { chat } => {
            run(conn, "delete from messages where chat = ?", &[text(chat)])?;
            run(conn, "delete from drafts where chat = ?", &[text(chat)])?;
            run(conn, "delete from chats where id = ?", &[text(chat)])
        }
    }
}

fn message(conn: &Connection, change: &Change) -> Result<(), Failed> {
    let Change::Message {
        chat,
        id,
        seq,
        at,
        author,
        parent,
        main,
        deleted,
        body,
        has,
        upto,
        json,
        marks,
    } = change
    else {
        return Ok(());
    };
    run(
        conn,
        "insert into messages
           (chat, id, seq, at, author, parent, main, deleted, body, has, upto, json, marks)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (chat, id) do update set seq = excluded.seq, at = excluded.at,
           author = excluded.author, parent = excluded.parent, main = excluded.main,
           deleted = excluded.deleted, body = excluded.body, has = excluded.has,
           upto = excluded.upto, json = excluded.json, marks = excluded.marks",
        &[
            text(chat),
            text(id),
            whole(*seq),
            whole(*at),
            text(author),
            maybe_text(parent.as_ref()),
            whole(i64::from(*main)),
            whole(i64::from(*deleted)),
            text(body),
            text(has),
            whole(*upto),
            text(json),
            maybe_text(marks.as_ref()),
        ],
    )
}

fn chats_path(app: &AppHandle, account: &str) -> Result<PathBuf, String> {
    let store = super::store_path(app, account)?;
    Ok(store.with_extension("chats.db"))
}

fn with_chats<T>(
    app: &AppHandle,
    account: &str,
    act: impl FnOnce(&mut ChatStore) -> Result<T, Failed>,
) -> Result<T, String> {
    let path = chats_path(app, account)?;
    let stores = app.state::<super::Stores>();
    let mut held = stores.1.lock();
    if held.as_ref().is_none_or(|(open, ..)| open != account) {
        if let Some((_, _, other)) = held.take() {
            other.close()?;
        }
        let store = ChatStore::open(&path)?;
        *held = Some((account.to_owned(), path, store));
    }
    let Some((_, path, store)) = held.as_mut() else {
        return Err("the chats' store is not open".into());
    };
    match act(store) {
        Ok(answer) => Ok(answer),
        Err(failed) if failed.damaged => {
            let path = path.clone();
            if let Some((_, _, open)) = held.take() {
                let _ = open.close();
            }
            set_aside(&path).map_err(|refused| refused.said())?;
            Err(format!("{}; it has been set aside", failed.said))
        }
        Err(failed) => Err(failed.said),
    }
}

#[tauri::command(async)]
pub fn chat_store_read(app: AppHandle, account: String, asks: Vec<Ask>) -> Result<Json, String> {
    with_chats(&app, &account, |store| store.read(&asks).map(Json::Array))
}

#[tauri::command(async)]
pub fn chat_store_write(
    app: AppHandle,
    account: String,
    changes: Vec<Change>,
) -> Result<(), String> {
    with_chats(&app, &account, |store| store.write(&changes))
}

#[tauri::command(async)]
pub fn chat_store_forget(app: AppHandle, account: String) -> Result<(), String> {
    let path = chats_path(&app, &account)?;
    {
        let stores = app.state::<super::Stores>();
        let mut held = stores.1.lock();
        if held.as_ref().is_some_and(|(open, ..)| *open == account) {
            if let Some((_, _, open)) = held.take() {
                open.close()?;
            }
        }
    }
    for one in files_of(&path) {
        match fs::remove_file(&one) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(cannot("delete", &one, &error)),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Ask, Change, ChatStore};
    use serde_json::{json, Value as Json};
    use std::path::Path;

    fn opened(path: &Path) -> ChatStore {
        ChatStore::open(path).expect("a chats' store")
    }

    fn write(store: &mut ChatStore, changes: Json) {
        let changes: Vec<Change> = serde_json::from_value(changes).expect("changes");
        if let Err(failed) = store.write(&changes) {
            panic!("{}", failed.said);
        }
    }

    fn ask(store: &mut ChatStore, ask: Json) -> Json {
        let asks: Vec<Ask> = serde_json::from_value(json!([ask])).expect("a question");
        match store.read(&asks) {
            Ok(mut answers) => answers.remove(0),
            Err(failed) => panic!("{}", failed.said),
        }
    }

    fn message(chat: &str, seq: i64, body: &str) -> Json {
        json!({
            "t": "message", "chat": chat, "id": format!("m{seq}"), "seq": seq, "at": seq * 1000,
            "author": if seq % 2 == 0 { "user:a" } else { "user:b" }, "main": true,
            "deleted": false, "body": body, "has": if body.contains("http") { " link " } else { " " },
            "upto": seq, "json": "{}",
        })
    }

    fn seqs(rows: &Json) -> Vec<i64> {
        rows.as_array()
            .expect("rows")
            .iter()
            .map(|row| row["seq"].as_i64().expect("a seq"))
            .collect()
    }

    #[test]
    fn a_window_is_oldest_first_on_every_side() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.chats.db"));
        let all: Vec<Json> = (1..=20).map(|seq| message("c", seq, "hello")).collect();
        write(&mut store, Json::Array(all));

        let newest = ask(
            &mut store,
            json!({ "t": "window", "chat": "c", "limit": 3 }),
        );
        assert_eq!(seqs(&newest), [18, 19, 20]);
        let before = ask(
            &mut store,
            json!({ "t": "window", "chat": "c", "before": 5, "limit": 3 }),
        );
        assert_eq!(seqs(&before), [2, 3, 4]);
        let after = ask(
            &mut store,
            json!({ "t": "window", "chat": "c", "after": 18, "limit": 9 }),
        );
        assert_eq!(seqs(&after), [19, 20]);
        let around = ask(
            &mut store,
            json!({ "t": "window", "chat": "c", "around": 10, "limit": 4 }),
        );
        assert_eq!(seqs(&around), [8, 9, 10, 11]);
        let other = ask(
            &mut store,
            json!({ "t": "window", "chat": "d", "limit": 3 }),
        );
        assert_eq!(seqs(&other), Vec::<i64>::new());
    }

    #[test]
    fn replies_are_a_window_of_their_own() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.chats.db"));
        let mut reply = message("c", 2, "a reply");
        reply["parent"] = json!("m1");
        reply["main"] = json!(false);
        write(
            &mut store,
            json!([message("c", 1, "a question"), reply, message("c", 3, "on")]),
        );

        let chat = ask(
            &mut store,
            json!({ "t": "window", "chat": "c", "limit": 10 }),
        );
        assert_eq!(seqs(&chat), [1, 3]);
        let replies = ask(
            &mut store,
            json!({ "t": "window", "chat": "c", "parent": "m1", "limit": 10 }),
        );
        assert_eq!(seqs(&replies), [2]);
    }

    #[test]
    fn words_are_found_by_their_start_without_accents_and_follow_edits() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.chats.db"));
        write(
            &mut store,
            json!([
                message("c", 1, "Meet at the Café tonight"),
                message("c", 2, "see https://example.com"),
                message("d", 3, "café in another chat"),
            ]),
        );

        let found = ask(
            &mut store,
            json!({ "t": "search", "words": ["cafe"], "limit": 10 }),
        );
        assert_eq!(seqs(&found), [3, 1], "newest first, across chats");
        let one = ask(
            &mut store,
            json!({ "t": "search", "words": ["caf"], "chats": ["c"], "limit": 10 }),
        );
        assert_eq!(seqs(&one), [1]);
        let phrase = ask(
            &mut store,
            json!({ "t": "search", "phrases": ["at the cafe"], "limit": 10 }),
        );
        assert_eq!(seqs(&phrase), [1]);
        let links = ask(
            &mut store,
            json!({ "t": "search", "has": ["link"], "limit": 10 }),
        );
        assert_eq!(seqs(&links), [2]);
        let odd = ask(
            &mut store,
            json!({ "t": "search", "words": ["\"NEAR(("], "limit": 10 }),
        );
        assert_eq!(seqs(&odd), Vec::<i64>::new(), "typed syntax is only words");

        write(&mut store, json!([message("c", 1, "Meet at the bar")]));
        let gone = ask(
            &mut store,
            json!({ "t": "search", "words": ["cafe"], "chats": ["c"], "limit": 10 }),
        );
        assert_eq!(seqs(&gone), Vec::<i64>::new());
        let now = ask(
            &mut store,
            json!({ "t": "search", "words": ["bar"], "limit": 10 }),
        );
        assert_eq!(seqs(&now), [1]);

        write(
            &mut store,
            json!([{ "t": "unmessage", "chat": "c", "id": "m1" }]),
        );
        let none = ask(
            &mut store,
            json!({ "t": "search", "words": ["bar"], "limit": 10 }),
        );
        assert_eq!(seqs(&none), Vec::<i64>::new());
    }

    #[test]
    fn unread_counts_somebody_elses_messages_past_the_place() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.chats.db"));
        let all: Vec<Json> = (1..=10).map(|seq| message("c", seq, "x")).collect();
        write(&mut store, Json::Array(all));
        let unread = ask(
            &mut store,
            json!({ "t": "unread", "chat": "c", "after": 4, "me": "user:a" }),
        );
        assert_eq!(unread, json!(3), "5, 7 and 9 are user:b's");
    }

    #[test]
    fn the_outbox_and_drafts_outlive_the_store() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.chats.db");
        let mut store = opened(&path);
        write(
            &mut store,
            json!([
                { "t": "queue", "id": "e2", "chat": "c", "event": "{}", "madeAt": 2, "tries": 0 },
                { "t": "queue", "id": "e1", "chat": "c", "event": "{}", "madeAt": 1, "tries": 3, "refused": "rate" },
                { "t": "draft", "chat": "c", "text": "half a thought", "at": 5 },
            ]),
        );
        store.close().expect("closed");

        let mut again = opened(&path);
        let outbox = ask(&mut again, json!({ "t": "outbox" }));
        let ids: Vec<&str> = outbox
            .as_array()
            .expect("rows")
            .iter()
            .map(|row| row["id"].as_str().expect("an id"))
            .collect();
        assert_eq!(ids, ["e1", "e2"]);
        assert_eq!(outbox[0]["refused"], json!("rate"));
        assert_eq!(
            ask(&mut again, json!({ "t": "drafts" }))[0]["text"],
            json!("half a thought")
        );

        write(
            &mut again,
            json!([{ "t": "unqueue", "id": "e1" }, { "t": "forget", "chat": "c" }]),
        );
        assert_eq!(
            ask(&mut again, json!({ "t": "outbox" }))
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(ask(&mut again, json!({ "t": "drafts" })), json!([]));
    }

    #[test]
    fn a_file_that_is_not_a_store_is_set_aside() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("a.chats.db");
        std::fs::write(&path, b"not a database at all, not even close to one").expect("written");
        let mut store = opened(&path);
        assert_eq!(ask(&mut store, json!({ "t": "chats" })), json!([]));
    }

    #[test]
    fn a_window_of_a_hundred_thousand_is_quick() {
        let dir = tempfile::tempdir().expect("a folder");
        let mut store = opened(&dir.path().join("a.chats.db"));
        for start in (0..100_000).step_by(10_000) {
            let batch: Vec<Json> = (start + 1..=start + 10_000)
                .map(|seq| message("c", seq, "a line of words like any other message has"))
                .collect();
            write(&mut store, Json::Array(batch));
        }

        for place in [73_210, 61_377, 84_052, 12_904, 95_118] {
            steps(&store);
            let around = ask(
                &mut store,
                json!({ "t": "window", "chat": "c", "around": place, "limit": 100 }),
            );
            let took = steps(&store);
            assert_eq!(seqs(&around).len(), 100);
            assert!(took < 10_000, "the window around {place} took {took} steps");
        }
    }

    #[allow(unsafe_code)]
    fn steps(store: &ChatStore) -> i64 {
        use rusqlite::ffi;
        let mut total = 0;
        unsafe {
            let db = store.conn.handle();
            let mut statement = ffi::sqlite3_next_stmt(db, std::ptr::null_mut());
            while !statement.is_null() {
                total += i64::from(ffi::sqlite3_stmt_status(
                    statement,
                    ffi::SQLITE_STMTSTATUS_VM_STEP,
                    1,
                ));
                statement = ffi::sqlite3_next_stmt(db, statement);
            }
        }
        total
    }
}
