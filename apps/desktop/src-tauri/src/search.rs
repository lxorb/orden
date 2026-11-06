use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use tauri::{AppHandle, Emitter, Manager};

use crate::fuzzy::{without_words, Fuzzy, FuzzyHit};
use crate::matcher::{Hit, Matcher, Note};
use crate::notes::{stamp_of, words_of, Stamp};
use crate::paths::{files_in, in_spaces, is_shortcut, relative_to};
use crate::query::Query;
use crate::tags::tags_in;

const CAP: usize = 24_000_000;

struct Kept {
    stamp: Stamp,
    body: Arc<str>,
}

struct Warm {
    root: Option<PathBuf>,
    notes: HashMap<PathBuf, Kept>,
    by_size: BTreeSet<(Reverse<usize>, PathBuf)>,
    of: usize,
    characters: usize,
    dropped: usize,
    read: usize,
    whole: bool,
    cap: usize,
}

impl Default for Warm {
    fn default() -> Self {
        Self {
            root: None,
            notes: HashMap::new(),
            by_size: BTreeSet::new(),
            of: 0,
            characters: 0,
            dropped: 0,
            read: 0,
            whole: false,
            cap: CAP,
        }
    }
}

#[derive(Serialize)]
pub struct Warmth {
    notes: usize,
    of: usize,
    characters: usize,
    cap: usize,
    dropped: usize,
    read: usize,
    warm: bool,
}

impl Warm {
    fn keep(&mut self, path: &Path, stamp: Stamp, body: &Arc<str>) {
        if let Some(was) = self.notes.insert(
            path.to_path_buf(),
            Kept {
                stamp,
                body: Arc::clone(body),
            },
        ) {
            self.characters = self.characters.saturating_sub(was.body.len());
            self.by_size
                .remove(&(Reverse(was.body.len()), path.to_path_buf()));
        }

        self.characters += body.len();
        self.by_size
            .insert((Reverse(body.len()), path.to_path_buf()));
        self.hold();
    }

    fn hold(&mut self) {
        while self.characters > self.cap {
            let Some((Reverse(len), path)) = self.by_size.pop_first() else {
                return;
            };
            if self.notes.remove(&path).is_some() {
                self.characters = self.characters.saturating_sub(len);
                self.dropped += 1;
            }
        }
    }

    fn warmth(&self) -> Warmth {
        Warmth {
            notes: self.notes.len(),
            of: self.of.max(self.notes.len()),
            characters: self.characters,
            cap: self.cap,
            dropped: self.dropped,
            read: self.read,
            warm: self.whole,
        }
    }
}

fn cache() -> &'static Mutex<Warm> {
    static WARM: OnceLock<Mutex<Warm>> = OnceLock::new();
    WARM.get_or_init(|| Mutex::new(Warm::default()))
}

fn held() -> MutexGuard<'static, Warm> {
    cache().lock().unwrap_or_else(PoisonError::into_inner)
}

fn body_of(path: &Path) -> Option<Arc<str>> {
    let stamp = stamp_of(path)?;

    {
        let warm = held();
        if let Some(kept) = warm.notes.get(path).filter(|kept| kept.stamp == stamp) {
            return Some(Arc::clone(&kept.body));
        }
    }

    let body: Arc<str> = Arc::from(words_of(path).ok()?);

    let mut warm = held();
    warm.read += 1;
    warm.keep(path, stamp, &body);
    Some(body)
}

#[tauri::command(async)]
pub fn warm_search(app: AppHandle, root: String) -> Result<Warmth, String> {
    let dir = in_spaces(&app, &root)?;
    let paths = notes_in(&dir);

    {
        let mut warm = held();
        if warm.root.as_deref() != Some(dir.as_path()) {
            *warm = Warm::default();
            warm.root = Some(dir);
        }
        warm.of = paths.len();
        warm.whole = false;
    }

    for path in &paths {
        let _ = body_of(path);
    }

    let mut warm = held();
    warm.whole = true;
    Ok(warm.warmth())
}

const BATCH: usize = 24;

const HITS: &str = "nib://search-hits";

#[derive(Serialize)]
pub struct Tag {
    tag: String,
    count: usize,
}

#[derive(Serialize, Clone)]
struct Batch {
    id: u32,
    hits: Vec<Hit>,
    loose: Vec<FuzzyHit>,
}

#[tauri::command(async)]
pub fn search_space(
    window: tauri::Window,
    root: String,
    query: Query,
    terms: Vec<String>,
    limit: usize,
    id: u32,
    excluded: Vec<String>,
) -> Result<(), String> {
    let app = window.app_handle();
    let dir = in_spaces(app, &root)?;
    let left: HashSet<&str> = excluded.iter().map(String::as_str).collect();
    let fuzzy = Fuzzy::new(&terms);
    let narrowed = fuzzy.asks().then(|| Matcher::new(without_words(&query)));
    let matcher = Matcher::new(query);

    let mut pending: Vec<Hit> = Vec::new();
    let mut loose: Vec<FuzzyHit> = Vec::new();
    let mut found = 0;

    for path in notes_in(&dir) {
        if found >= limit {
            break;
        }

        let relative = relative_to(&dir, &path);
        if left_out(&relative, &left) {
            continue;
        }

        let Some(body) = body_of(&path) else {
            continue;
        };

        let shown = path.to_string_lossy();
        let name = path
            .file_name()
            .map_or_else(String::new, |one| one.to_string_lossy().to_string());

        let note = Note::new(&shown, &relative, &name, &body);

        let mut hits = matcher.hits(&note, limit.saturating_sub(found));
        if !hits.is_empty() {
            found += hits.len();
            pending.append(&mut hits);

            if pending.len() >= BATCH {
                send(&window, id, &mut pending, Vec::new());
            }
            continue;
        }

        let Some(narrowed) = narrowed.as_ref() else {
            continue;
        };
        if narrowed.hits(&note, 1).is_empty() {
            continue;
        }

        if let Some(guess) = fuzzy.best(&note) {
            loose.push(guess);
        }

        if loose.len() > limit.saturating_mul(2) {
            loose = best(loose, limit);
        }
    }

    send(&window, id, &mut pending, best(loose, limit));
    Ok(())
}

fn best(mut loose: Vec<FuzzyHit>, most: usize) -> Vec<FuzzyHit> {
    loose.sort_by_key(|hit| Reverse(hit.score()));
    loose.truncate(most);
    loose
}

fn send(window: &tauri::Window, id: u32, pending: &mut Vec<Hit>, loose: Vec<FuzzyHit>) {
    if pending.is_empty() && loose.is_empty() {
        return;
    }

    let _ = window.app_handle().emit_to(
        window.label(),
        HITS,
        Batch {
            id,
            hits: std::mem::take(pending),
            loose,
        },
    );
}

#[tauri::command(async)]
pub fn space_tags(app: AppHandle, root: String) -> Result<Vec<Tag>, String> {
    let dir = in_spaces(&app, &root)?;
    let mut counts: HashMap<String, usize> = HashMap::new();

    for path in notes_in(&dir) {
        let Some(body) = body_of(&path) else {
            continue;
        };

        for tag in tags_in(&body) {
            *counts.entry(tag).or_default() += 1;
        }
    }

    let mut tags: Vec<Tag> = counts
        .into_iter()
        .map(|(tag, count)| Tag { tag, count })
        .collect();

    tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
    Ok(tags)
}

fn left_out(relative: &str, excluded: &HashSet<&str>) -> bool {
    if excluded.is_empty() {
        return false;
    }
    if excluded.contains(relative) {
        return true;
    }

    let mut at = relative.len();
    while let Some(cut) = relative.get(..at).and_then(|part| part.rfind('/')) {
        if cut == 0 {
            break;
        }
        if excluded.contains(&relative[..cut]) {
            return true;
        }
        at = cut;
    }

    false
}

fn notes_in(dir: &Path) -> Vec<PathBuf> {
    let (mut notes, others) = files_in(dir);

    notes.extend(others.into_iter().filter(|path| is_shortcut(path)));
    notes.sort();
    notes
}

#[cfg(test)]
mod tests {
    use super::{body_of, held, left_out, Warm};
    use crate::notes::{Stamp, MOST_NOTE_BYTES};
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;

    fn words(of: usize) -> Arc<str> {
        Arc::from("ink ".repeat(of).as_str())
    }

    fn stamp(len: u64) -> Stamp {
        Stamp { modified: 1, len }
    }

    #[test]
    fn what_is_held_is_counted_once_per_note() {
        let mut warm = Warm::default();
        let plan = Path::new("Plan.md");

        warm.keep(plan, stamp(8), &words(2));
        assert_eq!(warm.notes.len(), 1);
        assert_eq!(warm.characters, 8);

        warm.keep(plan, stamp(16), &words(4));
        assert_eq!(warm.notes.len(), 1);
        assert_eq!(warm.characters, 16);
    }

    #[test]
    fn the_cap_lets_the_largest_notes_go_first() {
        let mut warm = Warm {
            cap: 100,
            ..Warm::default()
        };

        warm.keep(Path::new("Plan.md"), stamp(20), &words(5));
        warm.keep(Path::new("Ink.md"), stamp(20), &words(5));
        assert_eq!(warm.notes.len(), 2);
        assert_eq!(warm.dropped, 0);

        warm.keep(Path::new("Novel.md"), stamp(400), &words(100));
        assert_eq!(warm.dropped, 1);
        assert!(warm.characters <= warm.cap);
        assert!(!warm.notes.contains_key(Path::new("Novel.md")));
        assert!(warm.notes.contains_key(Path::new("Plan.md")));
    }

    #[test]
    fn a_note_rewritten_is_held_at_its_new_size() {
        let mut warm = Warm {
            cap: 100,
            ..Warm::default()
        };

        warm.keep(Path::new("Draft.md"), stamp(80), &words(20));
        warm.keep(Path::new("Draft.md"), stamp(8), &words(2));
        warm.keep(Path::new("Plan.md"), stamp(60), &words(15));

        assert_eq!(warm.characters, 68);
        assert_eq!(warm.dropped, 0);

        warm.keep(Path::new("Ink.md"), stamp(40), &words(10));
        assert_eq!(warm.dropped, 1);
        assert!(!warm.notes.contains_key(Path::new("Plan.md")));
        assert!(warm.notes.contains_key(Path::new("Draft.md")));
        assert_eq!(warm.characters, 48);
    }

    #[test]
    fn a_note_is_read_once_and_held_until_the_file_changes() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let note = dir.path().join("Plan.md");
        fs::write(&note, "the quarter plan").expect("the note written");

        let first = body_of(&note).expect("the words");
        assert_eq!(&*first, "the quarter plan");
        let read = held().read;

        assert_eq!(&*body_of(&note).expect("the words"), "the quarter plan");
        assert_eq!(held().read, read);

        fs::write(&note, "the quarter plan, rewritten").expect("the rewrite");
        assert_eq!(
            &*body_of(&note).expect("the words"),
            "the quarter plan, rewritten"
        );
        assert_eq!(held().read, read + 1);

        fs::remove_file(&note).expect("the note removed");
        assert!(body_of(&note).is_none());

        let huge = dir.path().join("Dump.md");
        fs::File::create(&huge)
            .and_then(|file| file.set_len(MOST_NOTE_BYTES + 1))
            .expect("a file past the ceiling");
        assert!(body_of(&huge).is_none());
        assert_eq!(held().read, read + 1, "the file was read");
    }

    #[test]
    fn a_space_leaves_out_a_note_and_everything_in_a_folder_it_leaves_out() {
        let left: HashSet<&str> = ["Archive", "Old/Plan.md"].into_iter().collect();

        assert!(left_out("Archive", &left));
        assert!(left_out("Archive/Deep/Note.md", &left));
        assert!(left_out("Old/Plan.md", &left));
        assert!(!left_out("Old", &left));
        assert!(!left_out("Archived.md", &left));
        assert!(!left_out("Plan.md", &HashSet::new()));
    }
}
