//! Looking through a whole space rather than at one note: the text search behind
//! the search field, and the tag list the sidebar offers. Both read every note in
//! the space, so both walk it the same way.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::paths::{files_in, in_spaces};

/// How much of a matching line is worth showing.
const LINE: usize = 200;

/// One matching line, named and placed, so a result reads like the note rather
/// than merely pointing at it.
#[derive(Serialize)]
pub struct Hit {
    path: String,
    name: String,
    line: usize,
    text: String,
}

/// A tag and how often the space uses it.
#[derive(Serialize)]
pub struct Tag {
    tag: String,
    count: usize,
}

/// Case-insensitive search across every note in a space, returning the matching
/// line so the result reads like the note. Stops at `limit` hits, which is what
/// keeps a one-letter query from returning the whole space.
#[tauri::command]
pub fn search_space(
    app: AppHandle,
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<Hit>, String> {
    let dir = in_spaces(&app, &root)?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let mut hits = Vec::new();

    for path in notes_in(&dir) {
        // A note that cannot be read is not a search failure: the rest of the
        // space still has answers.
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };

        for (index, line) in body.lines().enumerate() {
            if !line.to_lowercase().contains(&needle) {
                continue;
            }

            hits.push(Hit {
                path: path.to_string_lossy().to_string(),
                name: path
                    .file_name()
                    .map_or_else(String::new, |name| name.to_string_lossy().to_string()),
                line: index,
                text: line.trim().chars().take(LINE).collect(),
            });

            if hits.len() >= limit {
                return Ok(hits);
            }
        }
    }

    Ok(hits)
}

/// Every `#tag` used in a space, most-used first. A heading is not a tag: it has
/// a space after the hash, and a tag never does.
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

/// Every tag in one note's text, once per use.
fn tags_in(body: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let letters: Vec<char> = line.chars().collect();
        let mut at = 0;

        while at < letters.len() {
            if letters[at] != '#' {
                at += 1;
                continue;
            }

            // A tag starts a word, so what comes before it must be a space.
            let opens = at == 0 || letters[at - 1].is_whitespace() || letters[at - 1] == '(';
            let mut end = at + 1;
            while end < letters.len()
                && (letters[end].is_alphanumeric() || "-_/".contains(letters[end]))
            {
                end += 1;
            }

            // The first character has to be a letter, which rules out `#1`.
            let named = end > at + 1 && letters[at + 1].is_alphabetic();

            if opens && named {
                found.push(letters[at..end].iter().collect());
            }

            at = end.max(at + 1);
        }
    }

    found
}

/// Every note in a space, in a stable order so two searches of an unchanged
/// space read the same. The walk itself lives in `paths`, which is also where
/// `links` gets it from.
fn notes_in(dir: &Path) -> Vec<PathBuf> {
    files_in(dir).0
}

#[cfg(test)]
mod tests {
    use super::tags_in;

    #[test]
    fn finds_tags_but_not_headings() {
        assert_eq!(tags_in("# Heading\n#tag here"), vec!["#tag"]);
        assert_eq!(tags_in("## Also a heading"), Vec::<String>::new());
    }

    #[test]
    fn a_tag_has_to_start_a_word() {
        assert_eq!(tags_in("a#b"), Vec::<String>::new());
        assert_eq!(tags_in("(#nested)"), vec!["#nested"]);
        assert_eq!(tags_in("issue #42"), Vec::<String>::new());
    }

    #[test]
    fn keeps_the_characters_a_tag_may_contain() {
        assert_eq!(
            tags_in("#work/2026 #a-b #c_d"),
            vec!["#work/2026", "#a-b", "#c_d"]
        );
    }

    #[test]
    fn ignores_anything_inside_a_fence() {
        assert_eq!(tags_in("```\n#notatag\n```\n#real"), vec!["#real"]);
    }

    #[test]
    fn counts_a_tag_once_per_use() {
        assert_eq!(tags_in("#a #a #b").len(), 3);
    }
}
