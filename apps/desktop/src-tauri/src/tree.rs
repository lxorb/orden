use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::clock;
use crate::paths::{
    cannot, held_paper, in_spaces, inside, is_application, is_base, is_canvas, is_chat,
    is_markdown, is_pages, is_pdf, is_shortcut, is_term, paper_of, space_root, spaces_dir, Seen,
    MAX_DEPTH,
};

pub const MAX_ENTRIES: usize = 100_000;

#[derive(Serialize)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "four separate facts the window reads off the listing, each its own JSON field, three of them left out when false"
)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    modified: u64,
    created: u64,
    children: Vec<Entry>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    evicted: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    unlisted: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    paper: bool,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TreeOptions {
    pub show_hidden: bool,
    pub papers: bool,
    pub every: bool,
}

#[tauri::command(async)]
pub fn read_tree(
    app: AppHandle,
    root: String,
    options: Option<TreeOptions>,
) -> Result<Entry, String> {
    let spaces = spaces_dir(&app)?;
    let path = in_spaces(&app, &root)?;
    if !path.is_dir() {
        return Err("root is not a directory".into());
    }

    let space = space_root(&spaces, &path).unwrap_or_else(|| path.clone());
    let space = fs::canonicalize(&space).map_err(|error| cannot("resolve", &space, &error))?;
    let mut left = MAX_ENTRIES;

    let tree = walk(
        &space,
        &path,
        &options.unwrap_or_default(),
        0,
        &mut Seen::default(),
        &mut left,
    );

    crate::trace::mark(&format!("tree walked: {} entries", MAX_ENTRIES - left));

    tree
}

fn walk(
    space: &Path,
    path: &Path,
    options: &TreeOptions,
    depth: usize,
    seen: &mut Seen,
    left: &mut usize,
) -> Result<Entry, String> {
    let mut children = Vec::new();
    let mut unlisted = true;

    if depth < MAX_DEPTH && seen.first_time(path) {
        if let Ok(entries) = fs::read_dir(path) {
            unlisted = false;
            for entry in entries {
                let Ok(entry) = entry else {
                    unlisted = true;
                    break;
                };
                let (child, name, evicted) = named(&entry);

                if name.starts_with('.') && !options.show_hidden {
                    continue;
                }
                if evicted && child.exists() {
                    continue;
                }

                let listing = entry.file_type().ok();
                let directory = !evicted
                    && match listing {
                        Some(kind) if kind.is_symlink() => child.is_dir(),
                        Some(kind) => kind.is_dir(),
                        None => child.is_dir(),
                    };

                if directory {
                    room(left)?;
                    children.push(if in_the_space(space, &child) {
                        walk(space, &child, options, depth + 1, seen, left)?
                    } else {
                        Entry {
                            unlisted: true,
                            ..folder(&child, name)
                        }
                    });
                } else if options.every
                    || ((is_markdown(&child)
                        || is_pdf(&child)
                        || is_canvas(&child)
                        || is_pages(&child)
                        || is_base(&child)
                        || is_shortcut(&child)
                        || is_chat(&child)
                        || is_term(&child)
                        || is_application(&child))
                        && (options.papers || !held_paper(&child)))
                {
                    room(left)?;
                    let meta = entry.metadata().ok();
                    #[cfg(target_os = "macos")]
                    let dataless = meta.as_ref().is_some_and(crate::notes::icloud::is_dataless);
                    #[cfg(not(target_os = "macos"))]
                    let dataless = false;
                    let mut one = listed(&child, name, false, meta);
                    one.evicted = evicted || dataless;
                    one.paper = is_pages(&child) && paper_of(&child).is_file();
                    children.push(one);
                }
            }
        }
    }

    sort_children(&mut children);

    let mut here = folder(
        path,
        path.file_name().map_or_else(
            || path.to_string_lossy().to_string(),
            |name| name.to_string_lossy().to_string(),
        ),
    );
    here.children = children;
    here.unlisted = unlisted;
    Ok(here)
}

fn named(entry: &fs::DirEntry) -> (PathBuf, String, bool) {
    let child = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    if let Some(real) = crate::notes::icloud::evicted_name(&name) {
        return (child.with_file_name(real), real.to_string(), true);
    }

    (child, name, false)
}

fn folder(path: &Path, name: String) -> Entry {
    listed(path, name, true, fs::metadata(path).ok())
}

fn listed(path: &Path, name: String, is_dir: bool, meta: Option<fs::Metadata>) -> Entry {
    Entry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        modified: clock::of(meta.as_ref().and_then(|one| one.modified().ok())),
        created: clock::of(meta.as_ref().and_then(|one| one.created().ok())),
        children: Vec::new(),
        evicted: false,
        unlisted: false,
        paper: false,
    }
}

fn room(left: &mut usize) -> Result<(), String> {
    *left = left
        .checked_sub(1)
        .ok_or_else(|| format!("this space holds more than {MAX_ENTRIES} notes and folders"))?;

    Ok(())
}

fn in_the_space(space: &Path, child: &Path) -> bool {
    fs::canonicalize(child).is_ok_and(|real| inside(space, &real))
}

fn sort_children(children: &mut [Entry]) {
    children.sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
}

#[cfg(test)]
mod tests {
    use super::{sort_children, walk, Entry, TreeOptions, MAX_ENTRIES};
    use crate::paths::{link_to, Seen};
    use std::path::Path;

    fn read(here: &Path, options: &TreeOptions) -> Entry {
        tree_of(here, options, MAX_ENTRIES).expect("a tree")
    }

    fn tree_of(here: &Path, options: &TreeOptions, most: usize) -> Result<Entry, String> {
        let space = std::fs::canonicalize(here).expect("a real path");
        let mut left = most;
        walk(&space, here, options, 0, &mut Seen::default(), &mut left)
    }

    fn entry(name: &str, is_dir: bool, modified: u64) -> Entry {
        Entry {
            name: name.into(),
            path: format!("/notes/{name}"),
            is_dir,
            modified,
            created: modified,
            children: Vec::new(),
            evicted: false,
            unlisted: false,
            paper: false,
        }
    }

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|one| one.name.as_str()).collect()
    }

    fn options() -> TreeOptions {
        TreeOptions::default()
    }

    #[test]
    fn folders_come_before_notes() {
        let mut children = vec![
            entry("beta.md", false, 1),
            entry("Alpha", true, 2),
            entry("alpha.md", false, 3),
            entry("Beta", true, 4),
        ];

        sort_children(&mut children);
        assert_eq!(names(&children), ["Alpha", "Beta", "alpha.md", "beta.md"]);
    }

    #[test]
    fn a_name_sorts_the_same_in_either_case() {
        let mut children = vec![entry("b.md", false, 1), entry("A.md", false, 2)];

        sort_children(&mut children);
        assert_eq!(names(&children), ["A.md", "b.md"]);
    }

    #[test]
    fn a_space_lists_what_a_tab_can_hold_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("Board.canvas"), "{}").expect("a canvas");
        std::fs::write(here.join("Journal.pages"), "{}").expect("a page note");
        std::fs::write(here.join("Svelte docs.url"), "[InternetShortcut]").expect("a website");
        std::fs::write(here.join("Team.chat"), "{}").expect("a chat");
        std::fs::write(here.join("Build.term"), "{}").expect("an online terminal");
        std::fs::write(here.join("GIMP.application"), "{}").expect("an application");
        std::fs::write(here.join("paper.pdf"), "").expect("a pdf");
        std::fs::write(here.join("paper.pdf.highlights.json"), "{}").expect("its highlights");
        std::fs::write(here.join("shot.png"), "").expect("a picture");
        std::fs::write(here.join("Reading").join("Deep.PDF"), "").expect("a nested pdf");

        let top = read(here, &options());
        assert_eq!(
            names(&top.children),
            [
                "Reading",
                "Board.canvas",
                "Build.term",
                "GIMP.application",
                "Idea.md",
                "Journal.pages",
                "paper.pdf",
                "Svelte docs.url",
                "Team.chat"
            ]
        );

        let nested = &top.children[0];
        assert_eq!(names(&nested.children), ["Deep.PDF"]);
    }

    #[test]
    fn a_page_note_is_listed_and_the_paper_it_holds_is_not() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Lecture.pages"), "{}").expect("a page note");
        std::fs::write(here.join("Lecture.pages.pdf"), "%PDF").expect("its paper");
        std::fs::write(here.join("Orphan.pages.pdf"), "%PDF").expect("a paper with no note");

        let top = read(here, &options());
        assert_eq!(names(&top.children), ["Lecture.pages", "Orphan.pages.pdf"]);
        assert!(top.children[0].paper);

        let every = read(
            here,
            &TreeOptions {
                papers: true,
                ..options()
            },
        );
        assert_eq!(
            names(&every.children),
            ["Lecture.pages", "Lecture.pages.pdf", "Orphan.pages.pdf"]
        );
    }

    #[test]
    fn every_file_is_listed_when_asked_for() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("shot.png"), "").expect("a picture");
        std::fs::write(here.join("paper.pdf.highlights.json"), "{}").expect("highlights");

        assert_eq!(names(&read(here, &options()).children), ["Idea.md"]);
        let every = read(
            here,
            &TreeOptions {
                every: true,
                ..options()
            },
        );
        assert_eq!(
            names(&every.children),
            ["Idea.md", "paper.pdf.highlights.json", "shot.png"]
        );
    }

    #[test]
    fn a_folder_already_read_is_read_as_empty() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");
        std::fs::write(inner.join("Idea.md"), "").expect("a note");

        assert!(link_to(here, &inner.join("up")), "one link back up");
        assert!(link_to(here, &inner.join("over")), "a second link back up");

        let top = read(here, &options());
        assert_eq!(names(&top.children), ["Notes"]);

        let notes = &top.children[0];
        assert_eq!(names(&notes.children), ["over", "up", "Idea.md"]);
        for link in notes.children.iter().filter(|child| child.is_dir) {
            assert!(link.children.is_empty(), "{} was read twice", link.name);
        }
    }

    #[test]
    fn a_listing_reads_no_note() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Unreadable.md"), [0x80, 0x80, 0x80]).expect("a note");
        std::fs::write(here.join("Plain.md"), "icon: rocket\n").expect("a second note");

        let top = read(here, &options());

        assert_eq!(names(&top.children), ["Plain.md", "Unreadable.md"]);
        for child in &top.children {
            assert!(child.modified > 0, "{} has no time", child.name);
        }
    }

    #[test]
    fn a_link_out_of_the_space_is_not_read() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let space = dir.path().join("Space");
        let elsewhere = dir.path().join("Elsewhere");
        std::fs::create_dir_all(&space).expect("a space");
        std::fs::create_dir_all(elsewhere.join("Deeper")).expect("somewhere else");
        std::fs::write(elsewhere.join("Elsewhere.md"), "").expect("a note nobody asked for");
        std::fs::write(space.join("Idea.md"), "").expect("a note");

        assert!(link_to(&elsewhere, &space.join("out")), "a link out");

        let top = read(&space, &options());
        assert_eq!(names(&top.children), ["out", "Idea.md"]);

        let out = &top.children[0];
        assert!(out.is_dir, "a folder is what it is");
        assert!(out.children.is_empty(), "the walk left the space");
        assert!(out.unlisted, "a link out is not read into");
        assert!(!top.unlisted, "the space itself is read");
    }

    #[test]
    fn a_folder_past_the_depth_limit_says_it_was_not_read() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let mut deep = here.to_path_buf();
        for _ in 0..super::MAX_DEPTH {
            deep = deep.join("d");
        }
        std::fs::create_dir_all(&deep).expect("a deep folder");
        std::fs::write(deep.join("Deep.md"), "").expect("a note past the limit");

        let mut last = read(here, &options());
        while let Some(next) = last.children.pop() {
            last = next;
        }
        assert!(last.children.is_empty(), "past the limit nothing is read");
        assert!(last.unlisted, "and the folder says so");
    }

    #[test]
    fn a_folder_linked_to_itself_still_finishes() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");

        assert!(link_to(&inner, &inner.join("itself")), "a link to itself");

        let top = read(here, &options());
        let notes = &top.children[0];
        assert_eq!(names(&notes.children), ["itself"]);
        assert!(notes.children[0].children.is_empty(), "read twice");
        assert!(notes.children[0].unlisted, "and says it was not read again");
    }

    #[test]
    fn a_space_larger_than_the_tree_says_so() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(here.join("Reading").join("Deep.md"), "").expect("a nested note");
        std::fs::write(here.join("Idea.md"), "").expect("a note");

        let whole = tree_of(here, &options(), 3).expect("a tree");
        assert_eq!(names(&whole.children), ["Reading", "Idea.md"]);

        let Err(refused) = tree_of(here, &options(), 2) else {
            panic!("a space larger than the tree was read anyway");
        };
        assert!(refused.contains("notes and folders"), "{refused}");
    }

    #[test]
    fn the_listing_has_one_order_whatever_a_window_sends() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let old = std::fs::File::create(here.join("a.md")).expect("an old note");
        old.set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1))
            .expect("an old time");
        std::fs::write(here.join("b.md"), "").expect("a new note");

        let asked: TreeOptions =
            serde_json::from_str(r#"{"showHidden":false,"sort":"modified","descending":true}"#)
                .expect("what an older window sends");
        assert_eq!(names(&read(here, &asked).children), ["a.md", "b.md"]);
    }
}
