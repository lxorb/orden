#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Text,
    Integer,
    Bool,
    Blob,
    Packed,
    Any,
}

#[derive(Debug)]
pub struct Column {
    pub name: &'static str,
    pub kind: Kind,
    pub required: bool,
}

#[derive(Debug)]
pub struct Table {
    pub name: &'static str,
    pub key: Option<&'static str>,
    pub space: Option<&'static str>,
    pub order: &'static str,
    pub columns: &'static [Column],
}

const fn maybe(name: &'static str, kind: Kind) -> Column {
    Column {
        name,
        kind,
        required: false,
    }
}

const fn always(name: &'static str, kind: Kind) -> Column {
    Column {
        name,
        kind,
        required: true,
    }
}

pub const TABLES: [Table; 10] = [
    Table {
        name: "meta",
        key: Some("key"),
        space: None,
        order: "key",
        columns: &[always("key", Kind::Text), maybe("value", Kind::Any)],
    },
    Table {
        name: "spaces",
        key: Some("space_id"),
        space: None,
        order: "space_id",
        columns: &[
            always("space_id", Kind::Text),
            always("root", Kind::Text),
            always("cursor", Kind::Integer),
            maybe("role", Kind::Text),
            maybe("store", Kind::Text),
        ],
    },
    Table {
        name: "entries",
        key: Some("id"),
        space: Some("space_id"),
        order: "id",
        columns: &[
            always("id", Kind::Text),
            always("space_id", Kind::Text),
            always("kind", Kind::Text),
            maybe("parent", Kind::Text),
            always("name", Kind::Text),
            always("local_path", Kind::Text),
            maybe("file_key", Kind::Text),
            maybe("written_hash", Kind::Text),
            maybe("mtime", Kind::Integer),
            maybe("size", Kind::Integer),
            maybe("seq", Kind::Integer),
            always("deleted", Kind::Bool),
        ],
    },
    Table {
        name: "written",
        key: Some("id"),
        space: None,
        order: "id",
        columns: &[always("id", Kind::Text), always("text", Kind::Packed)],
    },
    Table {
        name: "docs",
        key: Some("id"),
        space: None,
        order: "id",
        columns: &[
            always("id", Kind::Text),
            always("epoch", Kind::Integer),
            always("client_id", Kind::Integer),
            always("confirmed", Kind::Blob),
            always("confirmed_sv", Kind::Blob),
            maybe("pending", Kind::Blob),
            maybe("pending_at", Kind::Integer),
        ],
    },
    Table {
        name: "outbox",
        key: Some("op_id"),
        space: Some("space_id"),
        order: "made_at, op_id",
        columns: &[
            always("op_id", Kind::Text),
            always("space_id", Kind::Text),
            always("op", Kind::Blob),
            always("seen", Kind::Integer),
            always("made_at", Kind::Integer),
        ],
    },
    Table {
        name: "held",
        key: Some("id"),
        space: None,
        order: "id",
        columns: &[
            always("id", Kind::Text),
            always("remote", Kind::Blob),
            always("remote_sv", Kind::Blob),
            maybe("device", Kind::Text),
            always("at", Kind::Integer),
        ],
    },
    Table {
        name: "files",
        key: Some("hash"),
        space: None,
        order: "hash",
        columns: &[always("hash", Kind::Text), always("state", Kind::Text)],
    },
    Table {
        name: "web",
        key: Some("key"),
        space: None,
        order: "key",
        columns: &[
            always("key", Kind::Text),
            maybe("fence", Kind::Integer),
            maybe("version", Kind::Integer),
            maybe("applied", Kind::Integer),
        ],
    },
    Table {
        name: "log",
        key: None,
        space: Some("space"),
        order: "rowid",
        columns: &[
            always("at", Kind::Integer),
            maybe("space", Kind::Text),
            maybe("pulled", Kind::Integer),
            maybe("pushed", Kind::Integer),
            maybe("failed", Kind::Text),
        ],
    },
];

pub fn table(name: &str) -> Result<&'static Table, String> {
    TABLES
        .iter()
        .find(|one| one.name == name)
        .ok_or_else(|| format!("the sync store has no table {name}"))
}

impl Table {
    pub fn column(&self, name: &str) -> Result<&'static Column, String> {
        self.columns
            .iter()
            .find(|one| one.name == name)
            .ok_or_else(|| format!("{} has no column {name}", self.name))
    }

    pub fn keyed(&self) -> Result<&'static str, String> {
        self.key
            .ok_or_else(|| format!("{} rows have no key to find one by", self.name))
    }

    pub fn listed(&self) -> String {
        self.columns
            .iter()
            .map(|one| one.name)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::{table, Kind, TABLES};
    use crate::sync_store::store::migrated;
    use rusqlite::Connection;

    #[test]
    fn the_list_is_what_the_migrations_make() {
        let conn = Connection::open_in_memory().expect("a store in memory");
        migrated(&conn).expect("the migrations");

        for one in &TABLES {
            let mut asked = conn
                .prepare(&format!("pragma table_info({})", one.name))
                .expect("the table's shape");
            let made: Vec<(String, String, bool, bool)> = asked
                .query_map([], |row| {
                    Ok((
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get::<_, i64>(5)? > 0,
                    ))
                })
                .expect("its columns")
                .collect::<Result<_, _>>()
                .expect("every column");

            let names: Vec<&str> = made.iter().map(|(name, ..)| name.as_str()).collect();
            let listed: Vec<&str> = one.columns.iter().map(|column| column.name).collect();
            assert_eq!(names, listed, "{}", one.name);

            for (column, (name, declared, not_null, key)) in one.columns.iter().zip(&made) {
                assert_eq!(column.required, *not_null || *key, "{}.{name}", one.name);
                assert_eq!(one.key == Some(column.name), *key, "{}.{name}", one.name);
                let fits = match column.kind {
                    Kind::Text => declared == "TEXT",
                    Kind::Integer | Kind::Bool => declared == "INTEGER",
                    Kind::Blob | Kind::Packed | Kind::Any => declared == "BLOB",
                };
                assert!(fits, "{}.{name} is {declared}", one.name);
            }
        }

        let count: i64 = conn
            .query_row(
                "select count(*) from sqlite_master where type = 'table'",
                [],
                |row| row.get(0),
            )
            .expect("the tables");
        assert_eq!(usize::try_from(count).ok(), Some(TABLES.len()));
    }

    #[test]
    fn a_name_nobody_made_is_refused() {
        assert!(table("docs").is_ok());
        assert!(table("sqlite_master").is_err());
        assert!(table("docs; drop table docs").is_err());
        assert!(table("docs")
            .and_then(|docs| docs.column("id; --"))
            .is_err());
        assert!(table("log").and_then(super::Table::keyed).is_err());
    }
}
