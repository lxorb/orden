//! Looking through a whole space rather than at one note: the search behind
//! the search field, and the tag list the sidebar offers. Both read every note
//! in the space, so both walk it the same way.
//!
//! The query arrives already parsed, as the tree in query.rs, so a space of two
//! thousand notes is answered in one pass with every operator in hand rather
//! than in one pass per operator. What each note answers is worked out in
//! matcher.rs; this module is only the walk.
//!
//! Hits leave as they are found rather than at the end. A reader watching a
//! list fill is not waiting, and the disk is what a search spends its time on.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::matcher::{Hit, Matcher, Note};
use crate::paths::{files_in, in_spaces, relative_to};
use crate::query::Query;
use crate::tags::tags_in;

/// How many hits are worth sending at once. Small enough that the first rows
/// are on screen while the rest of the space is still being read, large enough
/// that a space full of matches is not one message per line.
const BATCH: usize = 24;

/// What the window listens on while a search is running.
const HITS: &str = "nib://search-hits";

/// A tag and how often the space uses it.
#[derive(Serialize)]
pub struct Tag {
    tag: String,
    count: usize,
}

/// One handful of hits, marked with the search that asked for them. Typing
/// outruns the disk, and answers to a word that is no longer in the field are
/// dropped by the window rather than shown.
#[derive(Serialize, Clone)]
struct Batch {
    id: u32,
    hits: Vec<Hit>,
}

/// Searches every note in a space, sending hits to the window as they are
/// found. Stops at `limit` of them, which is what keeps a one-letter query
/// from answering with the whole space.
#[tauri::command]
pub fn search_space(
    app: AppHandle,
    root: String,
    query: Query,
    limit: usize,
    id: u32,
) -> Result<(), String> {
    let dir = in_spaces(&app, &root)?;
    let matcher = Matcher::new(query);

    let mut pending: Vec<Hit> = Vec::new();
    let mut found = 0;

    for path in notes_in(&dir) {
        if found >= limit {
            break;
        }

        // A note that cannot be read is not a search failure: the rest of the
        // space still has answers.
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };

        let shown = path.to_string_lossy();
        let relative = relative_to(&dir, &path);
        let name = path
            .file_name()
            .map_or_else(String::new, |one| one.to_string_lossy().to_string());

        let note = Note {
            path: &shown,
            relative: &relative,
            name: &name,
            body: &body,
        };

        let mut hits = matcher.hits(&note, limit.saturating_sub(found));
        if hits.is_empty() {
            continue;
        }

        found += hits.len();
        pending.append(&mut hits);

        if pending.len() >= BATCH {
            send(&app, id, &mut pending);
        }
    }

    send(&app, id, &mut pending);
    Ok(())
}

/// Hands whatever has been found to the window. A window that has gone is not
/// a search failure, so a send that fails is let go.
fn send(app: &AppHandle, id: u32, pending: &mut Vec<Hit>) {
    if pending.is_empty() {
        return;
    }

    let _ = app.emit(
        HITS,
        Batch {
            id,
            hits: std::mem::take(pending),
        },
    );
}

/// Every `#tag` used in a space, most-used first.
#[tauri::command]
pub fn space_tags(app: AppHandle, root: String) -> Result<Vec<Tag>, String> {
    let dir = in_spaces(&app, &root)?;
    let mut counts: HashMap<String, usize> = HashMap::new();

    for path in notes_in(&dir) {
        let Ok(body) = fs::read_to_string(&path) else {
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

    // Most used first, and alphabetical within a count so the list holds still.
    tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
    Ok(tags)
}

/// Every note in a space, in a stable order so two searches of an unchanged
/// space read the same. The walk itself lives in `paths`, which is also where
/// `links` gets it from.
fn notes_in(dir: &Path) -> Vec<PathBuf> {
    files_in(dir).0
}
