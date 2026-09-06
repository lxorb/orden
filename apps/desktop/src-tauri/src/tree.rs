//! The file tree the sidebar draws: one space read into the shape the window
//! renders, sorted here so that every window agrees on the order.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

use crate::clock;
use crate::paths::{in_spaces, is_markdown, MAX_DEPTH};

/// A note or a folder, and everything under it if it is a folder.
#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    /// Milliseconds since the epoch, so the tree can sort by age.
    modified: u64,
    created: u64,
    children: Vec<Entry>,
}

/// How the window would like the tree read, which is whatever its own settings
/// say. All three have a default, so a window that sends nothing still gets a
/// tree.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TreeOptions {
    /// Files and folders beginning with a dot.
    pub show_hidden: bool,
    /// `name`, `modified` or `created`.
    pub sort: String,
    pub descending: bool,
}

/// Reads a space into a tree of notes and folders.
#[tauri::command]
pub fn read_tree(
    app: AppHandle,
    root: String,
    options: Option<TreeOptions>,
) -> Result<Entry, String> {
    let path = in_spaces(&app, &root)?;
    if !path.is_dir() {
        return Err("root is not a directory".into());
    }

    Ok(walk(&path, &options.unwrap_or_default(), 0))
}

/// One folder and its children. A folder nested deeper than `MAX_DEPTH` is read
/// as empty: past that it is a symlink pointing back at one of its own parents,
/// and following that is how a file tree never finishes loading.
fn walk(path: &Path, options: &TreeOptions, depth: usize) -> Entry {
    let mut children = Vec::new();

    if depth < MAX_DEPTH {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let child = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();

                if name.starts_with('.') && !options.show_hidden {
                    continue;
                }

                if child.is_dir() {
                    children.push(walk(&child, options, depth + 1));
                } else if is_markdown(&child) {
                    let meta = entry.metadata().ok();
                    children.push(Entry {
                        name,
                        path: child.to_string_lossy().to_string(),
                        is_dir: false,
                        modified: clock::of(meta.as_ref().and_then(|one| one.modified().ok())),
                        created: clock::of(meta.as_ref().and_then(|one| one.created().ok())),
                        children: Vec::new(),
                    });
                }
            }
        }
    }

    sort_children(&mut children, options);

    let meta = fs::metadata(path).ok();
    Entry {
        name: path.file_name().map_or_else(
            || path.to_string_lossy().to_string(),
            |name| name.to_string_lossy().to_string(),
        ),
        path: path.to_string_lossy().to_string(),
        is_dir: true,
        modified: clock::of(meta.as_ref().and_then(|one| one.modified().ok())),
        created: clock::of(meta.as_ref().and_then(|one| one.created().ok())),
        children,
    }
}

/// Folders always come first; the chosen key only orders within each group.
fn sort_children(children: &mut [Entry], options: &TreeOptions) {
    children.sort_by(|a, b| {
        let grouped = b.is_dir.cmp(&a.is_dir);
        if grouped != Ordering::Equal {
            return grouped;
        }

        let order = match options.sort.as_str() {
            "modified" => a.modified.cmp(&b.modified),
            "created" => a.created.cmp(&b.created),
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        };

        if options.descending {
            order.reverse()
        } else {
            order
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{sort_children, Entry, TreeOptions};

    fn entry(name: &str, is_dir: bool, modified: u64) -> Entry {
        Entry {
            name: name.into(),
            path: format!("/notes/{name}"),
            is_dir,
            modified,
            created: modified,
            children: Vec::new(),
        }
    }

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|one| one.name.as_str()).collect()
    }

    fn options(sort: &str, descending: bool) -> TreeOptions {
        TreeOptions {
            show_hidden: false,
            sort: sort.into(),
            descending,
        }
    }

    #[test]
    fn folders_come_before_notes() {
        let mut children = vec![
            entry("beta.md", false, 1),
            entry("Alpha", true, 2),
            entry("alpha.md", false, 3),
            entry("Beta", true, 4),
        ];

        sort_children(&mut children, &options("name", false));
        assert_eq!(names(&children), ["Alpha", "Beta", "alpha.md", "beta.md"]);
    }

    #[test]
    fn a_name_sorts_the_same_in_either_case() {
        let mut children = vec![entry("b.md", false, 1), entry("A.md", false, 2)];

        sort_children(&mut children, &options("name", false));
        assert_eq!(names(&children), ["A.md", "b.md"]);
    }

    #[test]
    fn the_newest_first_is_the_other_direction() {
        let mut children = vec![
            entry("old.md", false, 1),
            entry("new.md", false, 9),
            entry("middle.md", false, 5),
        ];

        sort_children(&mut children, &options("modified", true));
        assert_eq!(names(&children), ["new.md", "middle.md", "old.md"]);
    }

    #[test]
    fn an_unknown_key_sorts_by_name() {
        let mut children = vec![entry("b.md", false, 9), entry("a.md", false, 1)];

        sort_children(&mut children, &options("", false));
        assert_eq!(names(&children), ["a.md", "b.md"]);
    }
}
