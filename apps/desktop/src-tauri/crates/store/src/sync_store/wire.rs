use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use rusqlite::types::{Value as Sql, ValueRef};
use serde::Deserialize;
use serde_json::{Map, Value as Json};
use std::io::{Read, Write};

use super::tables::{Column, Kind, Table};

#[derive(Deserialize, Debug)]
#[serde(tag = "t", rename_all = "camelCase", deny_unknown_fields)]
pub enum Query {
    Get {
        table: String,
        key: String,
    },
    Scan {
        table: String,
        #[serde(default)]
        space: Option<String>,
    },
}

#[derive(Deserialize, Debug)]
#[serde(tag = "t", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Put {
        table: String,
        row: Map<String, Json>,
    },
    Patch {
        table: String,
        key: String,
        set: Map<String, Json>,
    },
    Delete {
        table: String,
        key: String,
    },
    Clear {
        table: String,
        space: String,
    },
}

const MOST: u64 = (1 << 53) - 1;

const VERSION: u8 = 1;

const PART: &str = "$part";

pub const MOST_PARTS: usize = 10_000;

pub fn frame(value: &Json, parts: &[Vec<u8>]) -> Vec<u8> {
    let header = value.to_string().into_bytes();
    let size = 1 + 4 + header.len() + 4 + parts.iter().map(|part| 4 + part.len()).sum::<usize>();

    let mut out = Vec::with_capacity(size);
    out.push(VERSION);
    out.extend_from_slice(&length_of(header.len()));
    out.extend_from_slice(&header);
    out.extend_from_slice(&length_of(parts.len()));
    for part in parts {
        out.extend_from_slice(&length_of(part.len()));
        out.extend_from_slice(part);
    }
    out
}

fn length_of(length: usize) -> [u8; 4] {
    u32::try_from(length).unwrap_or(u32::MAX).to_be_bytes()
}

pub fn unframe(bytes: &[u8]) -> Result<(Json, Vec<&[u8]>), String> {
    envelope(bytes)
        .ok_or_else(|| "the sync store was sent something that is not an envelope".to_owned())
}

fn envelope(bytes: &[u8]) -> Option<(Json, Vec<&[u8]>)> {
    let mut reading = Reading { bytes, at: 0 };
    if reading.take(1)? != [VERSION] {
        return None;
    }
    let length = reading.length()?;
    let header = serde_json::from_slice(reading.take(length)?).ok()?;
    let count = reading.length()?;
    if count > MOST_PARTS {
        return None;
    }
    let mut parts = Vec::with_capacity(count);
    for _ in 0..count {
        let length = reading.length()?;
        parts.push(reading.take(length)?);
    }
    (reading.at == bytes.len()).then_some((header, parts))
}

struct Reading<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reading<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(length)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn length(&mut self) -> Option<usize> {
        let four: [u8; 4] = self.take(4)?.try_into().ok()?;
        usize::try_from(u32::from_be_bytes(four)).ok()
    }
}

#[derive(Default)]
pub struct Parts(Vec<Vec<u8>>);

impl Parts {
    pub fn add(&mut self, bytes: &[u8]) -> Json {
        self.0.push(bytes.to_vec());
        serde_json::json!({ PART: self.0.len() - 1 })
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn into_parts(self) -> Vec<Vec<u8>> {
        self.0
    }
}

fn part<'a>(value: &Json, parts: &[&'a [u8]]) -> Option<&'a [u8]> {
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    let at = usize::try_from(object.get(PART)?.as_u64()?).ok()?;
    parts.get(at).copied()
}

pub fn to_sql(
    table: &Table,
    column: &Column,
    value: &Json,
    parts: &[&[u8]],
) -> Result<Sql, String> {
    let wrong = || format!("{}.{} does not take {value}", table.name, column.name);

    if value.is_null() {
        return if column.required {
            Err(format!("{}.{} may not be empty", table.name, column.name))
        } else {
            Ok(Sql::Null)
        };
    }

    Ok(match column.kind {
        Kind::Text => Sql::Text(value.as_str().ok_or_else(wrong)?.to_owned()),
        Kind::Integer => Sql::Integer(whole(value).ok_or_else(wrong)?),
        Kind::Bool => Sql::Integer(i64::from(value.as_bool().ok_or_else(wrong)?)),
        Kind::Blob => Sql::Blob(part(value, parts).ok_or_else(wrong)?.to_vec()),
        Kind::Packed => Sql::Blob(pack(value.as_str().ok_or_else(wrong)?)),
        Kind::Any => match value {
            Json::String(text) => Sql::Text(text.clone()),
            Json::Number(_) => Sql::Integer(whole(value).ok_or_else(wrong)?),
            _ => Sql::Blob(part(value, parts).ok_or_else(wrong)?.to_vec()),
        },
    })
}

fn whole(value: &Json) -> Option<i64> {
    value
        .as_i64()
        .filter(|number| number.unsigned_abs() <= MOST)
}

pub fn from_sql(column: &Column, value: ValueRef<'_>, parts: &mut Parts) -> Result<Json, String> {
    let odd = || format!("the sync store holds an odd {}", column.name);

    Ok(match (column.kind, value) {
        (_, ValueRef::Null) => Json::Null,
        (Kind::Text | Kind::Any, ValueRef::Text(text)) => {
            Json::String(std::str::from_utf8(text).map_err(|_| odd())?.to_owned())
        }
        (Kind::Integer | Kind::Any, ValueRef::Integer(number)) if number.unsigned_abs() <= MOST => {
            Json::from(number)
        }
        (Kind::Bool, ValueRef::Integer(number)) => Json::Bool(number != 0),
        (Kind::Blob | Kind::Any, ValueRef::Blob(bytes)) => parts.add(bytes),
        (Kind::Packed, ValueRef::Blob(bytes)) => Json::String(unpack(bytes)?),
        _ => return Err(odd()),
    })
}

const PLAIN: u8 = 0;
const DEFLATED: u8 = 1;

const WORTH_PACKING: usize = 128;

pub fn pack(text: &str) -> Vec<u8> {
    if text.len() >= WORTH_PACKING {
        let mut packing = DeflateEncoder::new(vec![DEFLATED], Compression::default());
        if packing.write_all(text.as_bytes()).is_ok() {
            if let Ok(packed) = packing.finish() {
                if packed.len() < text.len() + 1 {
                    return packed;
                }
            }
        }
    }

    let mut plain = Vec::with_capacity(text.len() + 1);
    plain.push(PLAIN);
    plain.extend_from_slice(text.as_bytes());
    plain
}

pub fn unpack(bytes: &[u8]) -> Result<String, String> {
    let broken = || "the sync store holds a text it cannot read".to_owned();

    match bytes.split_first() {
        Some((&PLAIN, rest)) => String::from_utf8(rest.to_vec()).map_err(|_| broken()),
        Some((&DEFLATED, rest)) => {
            let mut text = String::new();
            DeflateDecoder::new(rest)
                .read_to_string(&mut text)
                .map_err(|_| broken())?;
            Ok(text)
        }
        _ => Err(broken()),
    }
}

#[cfg(test)]
mod tests {
    use super::{frame, pack, to_sql, unframe, unpack, Change, Parts, Query};
    use crate::sync_store::tables::table;
    use rusqlite::types::Value as Sql;
    use serde_json::json;

    #[test]
    fn an_envelope_comes_back_as_it_went() {
        let mut parts = Parts::default();
        let first = parts.add(&[1, 2, 3]);
        let second = parts.add(&[]);
        let value = json!({ "rows": [first, second] });

        let bytes = frame(&value, &parts.into_parts());
        let (back, parts) = unframe(&bytes).expect("an envelope");

        assert_eq!(back, json!({ "rows": [{ "$part": 0 }, { "$part": 1 }] }));
        assert_eq!(parts, [&[1_u8, 2, 3][..], &[][..]]);
    }

    #[test]
    fn the_envelope_is_the_one_sync_core_speaks() {
        let header = br#"{"a":{"$part":0}}"#;
        let mut theirs = vec![1_u8, 0, 0, 0, u8::try_from(header.len()).expect("short")];
        theirs.extend_from_slice(header);
        theirs.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 2, 7, 8]);

        let mut parts = Parts::default();
        let ours = frame(&json!({ "a": parts.add(&[7, 8]) }), &parts.into_parts());
        assert_eq!(ours, theirs);
    }

    #[test]
    fn what_is_not_an_envelope_is_refused() {
        let good = frame(&json!([]), &[vec![1]]);
        assert!(unframe(&good).is_ok());
        assert!(unframe(&[]).is_err());
        assert!(
            unframe(&good[..good.len() - 1]).is_err(),
            "a part cut short"
        );
        assert!(
            unframe(&[good.as_slice(), &[0]].concat()).is_err(),
            "a byte left over"
        );
        let mut versioned = good.clone();
        versioned[0] = 2;
        assert!(unframe(&versioned).is_err(), "another version");
        let mut counted = frame(&json!([]), &[]);
        let at = counted.len() - 4;
        counted[at..].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(unframe(&counted).is_err(), "a count past the ceiling");
    }

    #[test]
    fn a_value_is_held_to_its_column() {
        let docs = table("docs").expect("docs");
        let entries = table("entries").expect("entries");
        let sent: [&[u8]; 2] = [&[7], &[8, 9]];
        let tail = sent.as_slice();

        let epoch = docs.column("epoch").expect("epoch");
        assert_eq!(to_sql(docs, epoch, &json!(3), tail), Ok(Sql::Integer(3)));
        assert!(to_sql(docs, epoch, &json!("3"), tail).is_err());
        assert!(to_sql(docs, epoch, &json!(1.5), tail).is_err());
        assert!(to_sql(docs, epoch, &json!(9_007_199_254_740_992_i64), tail).is_err());
        let empty = to_sql(docs, epoch, &json!(null), tail).expect_err("required");
        assert!(empty.contains("docs.epoch"), "{empty}");

        let pending = docs.column("pending").expect("pending");
        assert_eq!(to_sql(docs, pending, &json!(null), tail), Ok(Sql::Null));
        assert_eq!(
            to_sql(docs, pending, &json!({ "$part": 1 }), tail),
            Ok(Sql::Blob(vec![8, 9]))
        );
        assert!(to_sql(docs, pending, &json!({ "$part": 2 }), tail).is_err());
        assert!(to_sql(docs, pending, &json!([1, 2]), tail).is_err());

        let deleted = entries.column("deleted").expect("deleted");
        assert_eq!(
            to_sql(entries, deleted, &json!(true), tail),
            Ok(Sql::Integer(1))
        );
        assert!(to_sql(entries, deleted, &json!(1), tail).is_err());
    }

    #[test]
    fn a_text_is_packed_when_that_is_smaller_and_opened_the_same() {
        let short = "a line";
        let long = "The same sentence, again and again. ".repeat(200);
        let odd = "\u{1F600} and CJK \u{6F22}\u{5B57} ".repeat(20);

        for text in [short, long.as_str(), odd.as_str(), ""] {
            assert_eq!(unpack(&pack(text)).as_deref(), Ok(text));
        }
        assert_eq!(pack(short)[0], 0, "a line is kept as it is");
        assert!(pack(&long).len() < long.len() / 10, "prose deflates");
        assert!(unpack(&[]).is_err());
        assert!(unpack(&[1, 0xff, 0xff]).is_err());
        assert!(unpack(&[0, 0xff]).is_err());
    }

    #[test]
    fn a_batch_says_what_it_is() {
        let queries: Vec<Query> = serde_json::from_value(json!([
            { "t": "get", "table": "docs", "key": "a" },
            { "t": "scan", "table": "entries", "space": "s" },
            { "t": "scan", "table": "files" },
        ]))
        .expect("queries");
        assert_eq!(queries.len(), 3);

        let changes: Vec<Change> = serde_json::from_value(json!([
            { "t": "put", "table": "files", "row": { "hash": "h", "state": "here" } },
            { "t": "patch", "table": "docs", "key": "a", "set": { "pending_at": 1 } },
            { "t": "delete", "table": "files", "key": "h" },
            { "t": "clear", "table": "outbox", "space": "s" },
        ]))
        .expect("changes");
        assert_eq!(changes.len(), 4);

        let odd: Result<Vec<Query>, _> =
            serde_json::from_value(json!([{ "t": "get", "table": "docs", "key": "a", "sql": 1 }]));
        assert!(odd.is_err(), "a field nobody asked for is refused");
    }
}
