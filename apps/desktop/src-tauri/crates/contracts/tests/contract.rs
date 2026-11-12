use std::collections::HashMap;
use std::sync::Mutex;

use orden_contracts::{
    is_event_name, Entry, EntryKind, Failure, FailureKind, ItemId, NotePath, NoteStore, Outcome,
    SpaceId, LONGEST_ID,
};

#[derive(Default)]
struct Memory(Mutex<HashMap<String, String>>);

impl NoteStore for Memory {
    fn read(&self, path: &NotePath) -> Outcome<String> {
        self.0
            .lock()
            .expect("the fake's lock")
            .get(path.as_str())
            .cloned()
            .ok_or_else(|| Failure::new("fake", FailureKind::Missing, "no such note"))
    }

    fn write(&self, path: &NotePath, words: &str) -> Outcome<()> {
        self.0
            .lock()
            .expect("the fake's lock")
            .insert(path.as_str().to_owned(), words.to_owned());
        Ok(())
    }

    fn write_bytes(&self, _path: &NotePath, _bytes: &[u8]) -> Outcome<()> {
        Err(Failure::new(
            "fake",
            FailureKind::Unsupported,
            "the fake holds words only",
        ))
    }

    fn tree(&self, space: &SpaceId) -> Outcome<Entry> {
        Ok(Entry {
            name: space.to_string(),
            path: NotePath::new(space.as_str()).expect("a space id is a path"),
            is_dir: true,
            modified: 0,
            created: 0,
            children: Vec::new(),
        })
    }
}

#[test]
fn ids_take_what_the_wire_takes() {
    assert!(SpaceId::new("abc").is_some());
    assert!(SpaceId::new("").is_none());
    assert!(SpaceId::new(&"x".repeat(LONGEST_ID)).is_some());
    assert!(SpaceId::new(&"x".repeat(LONGEST_ID + 1)).is_none());
    assert!(ItemId::new("note-1").is_some());
    assert!(ItemId::new("a/b").is_none());
    assert!(ItemId::new("a\\b").is_none());
    assert!(ItemId::new("..").is_none());
    assert!(ItemId::new("a\u{0}b").is_none());
    assert!(NotePath::new("Notes/One.md").is_some());
    assert!(NotePath::new("").is_none());
}

#[test]
fn entry_kinds_round_trip() {
    for kind in EntryKind::ALL {
        assert_eq!(EntryKind::parse(kind.as_str()), Some(kind));
    }
    assert_eq!(EntryKind::parse("settings"), None);
}

#[test]
fn a_store_answers_with_outcomes_not_panics() {
    let store = Memory::default();
    let path = NotePath::new("One.md").expect("a path");
    let missing = store.read(&path).expect_err("nothing written yet");
    assert_eq!(missing.kind, FailureKind::Missing);
    assert_eq!(missing.to_string(), "fake: no such note");
    store.write(&path, "hello").expect("a write");
    assert_eq!(store.read(&path).expect("the words"), "hello");
    let space = SpaceId::new("s1").expect("an id");
    assert!(store.tree(&space).expect("a tree").is_dir);
}

#[test]
fn events_live_under_the_app_scheme() {
    assert!(is_event_name("orden://open-url"));
    assert!(!is_event_name("orden://"));
    assert!(!is_event_name("https://open-url"));
}
