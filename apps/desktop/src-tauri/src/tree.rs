//! The file tree the sidebar draws: one space read into the shape the window
//! renders, sorted here so that every window agrees on the order.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

use crate::clock;
use crate::paths::{in_spaces, is_canvas, is_markdown, is_pdf, Seen, MAX_DEPTH};

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
#[tauri::command(async)]
pub fn read_tree(
    app: AppHandle,
    root: String,
    options: Option<TreeOptions>,
) -> Result<Entry, String> {
    let path = in_spaces(&app, &root)?;
    if !path.is_dir() {
        return Err("root is not a directory".into());
    }

    Ok(walk(
        &path,
        &options.unwrap_or_default(),
        0,
        &mut Seen::default(),
    ))
}

/// One folder and its children. A folder nested deeper than `MAX_DEPTH` is read
/// as empty, and so is one the read has already been inside: either is a symlink
/// pointing back at one of its own parents, and following those is how a file tree
/// never finishes loading. The folder is still in the tree; only its children are
/// left to the one place they live. See `Seen`.
fn walk(path: &Path, options: &TreeOptions, depth: usize, seen: &mut Seen) -> Entry {
    let mut children = Vec::new();

    if depth < MAX_DEPTH && seen.first_time(path) {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let child = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();

                if name.starts_with('.') && !options.show_hidden {
                    continue;
                }

                if child.is_dir() {
                    children.push(walk(&child, options, depth + 1, seen));
                } else if is_markdown(&child) || is_pdf(&child) || is_canvas(&child) {
                    // The notes, the PDFs beside them and the canvases: the
                    // three things a tab can hold. Everything else in a space
                    // belongs to a note rather than standing on its own - a
                    // picture, a PDF's own highlights - and a file list nobody
                    // can act on is noise.
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
    use super::{sort_children, walk, Entry, TreeOptions};
    use crate::paths::{link_to, Seen};

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
    fn a_space_lists_what_a_tab_can_hold_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("Board.canvas"), "{}").expect("a canvas");
        std::fs::write(here.join("paper.pdf"), "").expect("a pdf");
        std::fs::write(here.join("paper.pdf.highlights.json"), "{}").expect("its highlights");
        std::fs::write(here.join("shot.png"), "").expect("a picture");
        std::fs::write(here.join("Reading").join("Deep.PDF"), "").expect("a nested pdf");

        let top = walk(here, &options("name", false), 0, &mut Seen::default());
        assert_eq!(
            names(&top.children),
            ["Reading", "Board.canvas", "Idea.md", "paper.pdf"]
        );

        let nested = &top.children[0];
        assert_eq!(names(&nested.children), ["Deep.PDF"]);
    }

    /// A folder holding two symlinks back to the folder above it. Reading each
    /// folder once is what makes that finish at all: the two links double the work
    /// at every level otherwise, which is two billion folders to read and a
    /// sidebar that never appears. Both links stay in the tree, and neither
    /// reopens the tree above them.
    #[test]
    fn a_folder_already_read_is_read_as_empty() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");
        std::fs::write(inner.join("Idea.md"), "").expect("a note");

        assert!(link_to(here, &inner.join("up")), "one link back up");
        assert!(link_to(here, &inner.join("over")), "a second link back up");

        let top = walk(here, &options("name", false), 0, &mut Seen::default());
        assert_eq!(names(&top.children), ["Notes"]);

        let notes = &top.children[0];
        assert_eq!(names(&notes.children), ["over", "up", "Idea.md"]);
        for link in notes.children.iter().filter(|child| child.is_dir) {
            assert!(link.children.is_empty(), "{} was read twice", link.name);
        }
    }

    /// The listing is a listing: names, kinds and two times off one `stat` each,
    /// and not one byte of any note.
    ///
    /// Which is the whole of why the file list can be on screen before anything
    /// else has happened, so it is worth a test that would fail the moment a field
    /// arrived here that had to be read out of a body - an icon, a title, a tag.
    /// A note whose bytes are not text is how that is said without stubbing a
    /// filesystem: every way Rust has of reading a file as a string fails on it, so
    /// a walk that lists it is a walk that did not open it. See `scan_links` in
    /// links.rs, which is where reading every note belongs.
    #[test]
    fn a_listing_reads_no_note() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        // A lone continuation byte, which is not valid UTF-8 anywhere in it.
        std::fs::write(here.join("Unreadable.md"), [0x80, 0x80, 0x80]).expect("a note");
        std::fs::write(here.join("Plain.md"), "icon: rocket\n").expect("a second note");

        let top = walk(here, &options("name", false), 0, &mut Seen::default());

        assert_eq!(names(&top.children), ["Plain.md", "Unreadable.md"]);
        for child in &top.children {
            assert!(child.modified > 0, "{} has no time", child.name);
        }
    }

    #[test]
    fn an_unknown_key_sorts_by_name() {
        let mut children = vec![entry("b.md", false, 9), entry("a.md", false, 1)];

        sort_children(&mut children, &options("", false));
        assert_eq!(names(&children), ["a.md", "b.md"]);
    }
}
