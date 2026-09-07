//! Where notes are allowed to live, and how a path handed in from the window is
//! judged before anything on disk is touched.
//!
//! This module owns four things: the folder the spaces live in, the containment
//! check every note and space command goes through, the one deliberate way out
//! of that folder, and the two file operations that must not leave a mess behind
//! when they fail.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::fmt::Display;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The extensions the app treats as a note. Anything else is not listed, not
/// searched and not opened from the command line.
pub const MARKDOWN: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// Recently deleted things wait in here. It sits inside the spaces folder but is
/// not a space, and only the trash commands may touch it.
pub const TRASH: &str = ".trash";

/// How deep the tree walkers go. A folder nested further than this is either a
/// mistake or a symlink pointing at one of its own parents, and following the
/// second one forever is how a file manager hangs.
pub const MAX_DEPTH: usize = 32;

/// Makes each temp file its own, so two windows saving at the same moment cannot
/// write to the same half-finished file.
static WRITES: AtomicU64 = AtomicU64::new(0);

/// Whether a path names a note, in whichever case the extension is written.
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| MARKDOWN.contains(&extension.to_lowercase().as_str()))
}

/// What went wrong and which file it was about. An `io::Error` names the failure
/// but never the path, and a message the window puts in front of someone has to
/// say both.
pub fn cannot(verb: &str, path: &Path, error: &impl Display) -> String {
    format!("could not {verb} {}: {error}", path.display())
}

/// `Documents/Nib`, so notes sit where a person would look for them rather than
/// buried in application data. Falls back to the home folder on a system that
/// has no documents folder of its own.
pub fn spaces_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("could not find the documents folder: {error}"))?;

    let dir = base.join("Nib");
    fs::create_dir_all(&dir).map_err(|error| cannot("create", &dir, &error))?;
    Ok(dir)
}

/// The same path with `.` and `..` folded away, so it is judged by where it
/// points rather than by how it was spelled. Nothing is read from disk, and the
/// separators come out as this platform writes them.
pub fn folded(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();

    for part in path.components() {
        match part {
            Component::CurDir => {}
            // Climbing above the top of the path names no place at all, so the
            // component is simply dropped rather than kept for later.
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }

    out
}

/// True when `path` is `root` itself or something inside it.
///
/// Both sides are judged by what they say rather than by what they point at: a
/// space someone symlinked onto another disk is still their space, and `..` was
/// already folded away. What this stops is a path climbing out of the folder,
/// not a reader arranging their own notes.
pub fn inside(root: &Path, path: &Path) -> bool {
    let root = folded(root);
    let path = folded(path);
    if root.as_os_str().is_empty() {
        return false;
    }

    let mut theirs = path.components();
    for ours in root.components() {
        match theirs.next() {
            Some(mine) if same_part(ours, mine) => {}
            _ => return false,
        }
    }

    true
}

/// The space a folder belongs to: the folder directly inside `spaces` that holds
/// it, or the folder itself when it is one. None when it is not in a space at
/// all, which is what a note opened from somewhere else on the disk looks like,
/// and also what the spaces folder itself is.
///
/// Takes the spaces folder rather than the app, so what counts as a space can be
/// tested without one.
pub fn space_root(spaces: &Path, path: &Path) -> Option<PathBuf> {
    let spaces = folded(spaces);
    let path = folded(path);
    if !inside(&spaces, &path) {
        return None;
    }

    // The first part below the spaces folder is the space; the path itself is
    // the spaces folder when there is no such part, and that is no space.
    let mut parts = path.components().skip(spaces.components().count());
    parts.next().map(|first| spaces.join(first))
}

/// One part of a path against another. Windows tells `Notes` and `notes` apart
/// nowhere but in the letters, so neither does this.
fn same_part(one: Component, other: Component) -> bool {
    if cfg!(windows) {
        let (one, other) = (one.as_os_str(), other.as_os_str());
        one.to_string_lossy().to_lowercase() == other.to_string_lossy().to_lowercase()
    } else {
        one == other
    }
}

/// The gate every note, folder and space command goes through: a string from the
/// window only becomes a path once it is known to be inside the spaces folder.
/// The trash is inside that folder and still refused, because nothing but the
/// trash commands has any business in it.
pub fn in_spaces(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let root = spaces_root(app)?;
    let target = folded(Path::new(path));

    if !inside(&root, &target) || inside(&root.join(TRASH), &target) {
        return Err(format!("{path} is outside the notes folder"));
    }

    Ok(target)
}

/// A space is a folder directly inside the spaces folder, and not a hidden one.
/// Renaming or deleting a space moves a whole tree, so the path is held to the
/// stricter shape rather than to mere containment.
pub fn a_space(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let root = spaces_root(app)?;
    let target = folded(Path::new(path));

    let directly_inside = target
        .parent()
        .is_some_and(|parent| inside(&root, parent) && inside(parent, &root));
    let hidden = target
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with('.'));

    if !directly_inside || hidden {
        return Err(format!("{path} is not a space"));
    }

    Ok(target)
}

/// A path the reader chose: a file picked in the dialog, one named on the
/// command line, one the shell handed over, or the target of an export.
///
/// This is deliberately any path the app can reach. Nib edits files, and a file
/// worth editing is wherever it already is, so `read_note` and `write_note` are
/// the one way out of the spaces folder. It is written down here so that it
/// reads as a decision at the call site rather than as a missing check.
pub fn chosen(path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    if target.file_name().is_none() {
        return Err(format!("{path} does not name a file"));
    }

    Ok(target)
}

/// Whether a path lies outside the spaces folder. A documents folder that cannot
/// even be resolved counts as outside, which is the cautious answer.
pub fn outside_spaces(app: &AppHandle, path: &Path) -> bool {
    spaces_root(app).map_or(true, |root| !inside(&root, path))
}

/// The folders notes were opened from outside the spaces folder. Pictures sit
/// beside a note rather than inside it, so what is remembered is the folder and
/// not the single file.
#[derive(Default)]
pub struct Opened(Mutex<HashSet<PathBuf>>);

/// Records a note the app was asked to open from outside the spaces folder, so
/// the pictures beside it can be read and shown as well.
pub fn note_from_outside(app: &AppHandle, path: &Path) {
    let Some(folder) = path.parent().map(folded) else {
        return;
    };

    if let Some(opened) = app.try_state::<Opened>() {
        if let Ok(mut folders) = opened.0.lock() {
            folders.insert(folder.clone());
        }
    }

    // The webview loads a picture over the asset protocol, which keeps a scope
    // of its own: a note it may read is a note whose pictures it may show.
    let _ = app.asset_protocol_scope().allow_directory(&folder, true);
}

/// Where a picture may be read from or written to: inside the spaces folder, or
/// beside a note the app was asked to open from outside it. A note can point at
/// a picture, so this is the reach a note gets, and no more.
pub fn beside_a_note(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    if let Ok(root) = spaces_root(app) {
        if inside(&root, &target) && !inside(&root.join(TRASH), &target) {
            return Ok(target);
        }
    }

    if let Some(opened) = app.try_state::<Opened>() {
        if let Ok(folders) = opened.0.lock() {
            if folders.iter().any(|folder| inside(folder, &target)) {
                return Ok(target);
            }
        }
    }

    Err(format!("{path} is not in a folder Nib has open"))
}

/// Every file in a space, split into the notes and everything else, each list in
/// a stable order so two walks of an unchanged space read the same.
///
/// Here rather than in one of the two modules that walk a space, because both do:
/// `search` reads every note for a word or a tag, and `links` reads every note
/// for the links out of it and every other file for a picture an embed might
/// name. A second copy of the walk would be a second answer to what counts as
/// part of a space.
///
/// Hidden folders are skipped, which is what keeps the trash out of a search, and
/// the depth is capped so a symlink pointing at one of its own parents cannot be
/// followed forever.
pub fn files_in(dir: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut notes = Vec::new();
    let mut others = Vec::new();
    gather(dir, 0, &mut notes, &mut others);
    notes.sort();
    others.sort();
    (notes, others)
}

fn gather(dir: &Path, depth: usize, notes: &mut Vec<PathBuf>, others: &mut Vec<PathBuf>) {
    if depth >= MAX_DEPTH {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }

        if path.is_dir() {
            gather(&path, depth + 1, notes, others);
        } else if is_markdown(&path) {
            notes.push(path);
        } else {
            others.push(path);
        }
    }
}

/// A path inside a space as the space speaks of it: relative, and with `/`
/// separators whichever the platform writes.
///
/// Here rather than in one of the modules that walks a space, because both do:
/// `links` names a note this way so a link can point at it, and `search` reads
/// the same spelling for the `path:` operator.
pub fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Writes a file whole: a temp file beside it takes the content and is flushed to
/// the disk itself before being renamed over the target. A crash, a full disk or
/// a pulled cable leaves either the old file or the new one, never half of
/// either, and never a temp file lying around.
pub fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{} has no folder to write into", target.display()))?;
    let name = target.file_name().and_then(OsStr::to_str).unwrap_or("file");

    // Hidden, so a half-written note never shows up in the tree beside the real
    // one, and named after this process so two windows cannot collide.
    let temp = parent.join(format!(
        ".{name}.{}-{}.nib-tmp",
        std::process::id(),
        WRITES.fetch_add(1, Ordering::Relaxed)
    ));

    if let Err(error) = spill(&temp, bytes) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }

    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        cannot("save", target, &error)
    })
}

/// The half of an atomic write that can fail with the temp file already there.
fn spill(temp: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(temp).map_err(|error| cannot("write", temp, &error))?;
    file.write_all(bytes)
        .map_err(|error| cannot("write", temp, &error))?;
    // The rename is only atomic if the bytes reached the disk before it.
    file.sync_all()
        .map_err(|error| cannot("finish writing", temp, &error))
}

/// `path` if nothing is there, else the first free `name 2`, `name 3`... - the
/// number before the extension for a file, after the name for a folder.
pub fn free_spot(path: &Path, is_file: bool) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let file_name = path
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().to_string());

    let (stem, extension) = match file_name.rfind('.') {
        Some(dot) if is_file && dot > 0 => {
            (file_name[..dot].to_string(), file_name[dot..].to_string())
        }
        _ => (file_name.clone(), String::new()),
    };

    let mut counter = 2;
    loop {
        let candidate = parent.join(format!("{stem} {counter}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::{files_in, folded, free_spot, inside, is_markdown, space_root, write_atomically};
    use std::path::{Path, PathBuf};

    /// Written the way the platform writes them, so the assertions read the same
    /// on a runner as they do on a laptop.
    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn folds_a_path_down_to_where_it_points() {
        assert_eq!(folded(&path(&["a", ".", "b"])), path(&["a", "b"]));
        assert_eq!(folded(&path(&["a", "b", "..", "c"])), path(&["a", "c"]));
        assert_eq!(folded(&path(&["a", "..", "..", "b"])), path(&["b"]));
    }

    #[test]
    fn a_path_is_inside_the_folder_it_starts_with() {
        let root = path(&["notes", "Nib"]);
        assert!(inside(&root, &root));
        assert!(inside(&root, &path(&["notes", "Nib", "Work", "a.md"])));
        assert!(!inside(&root, &path(&["notes", "Nibble", "a.md"])));
        assert!(!inside(&root, &path(&["notes"])));
    }

    #[test]
    fn climbing_out_of_the_folder_does_not_count_as_inside() {
        let root = path(&["notes", "Nib"]);
        assert!(!inside(&root, &path(&["notes", "Nib", "..", "secret.md"])));
        assert!(!inside(
            &root,
            &path(&["notes", "Nib", "Work", "..", "..", "secret.md"])
        ));
        // Folded first, so a climb that lands back inside is still inside.
        assert!(inside(
            &root,
            &path(&["notes", "Nib", "Work", "..", "Home", "a.md"])
        ));
    }

    #[test]
    fn nothing_is_inside_a_folder_with_no_name() {
        assert!(!inside(Path::new(""), &path(&["a"])));
    }

    #[test]
    fn names_the_space_a_folder_belongs_to() {
        let spaces = path(&["Documents", "Nib"]);
        let space = path(&["Documents", "Nib", "Notes"]);

        assert_eq!(space_root(&spaces, &space), Some(space.clone()));
        assert_eq!(
            space_root(&spaces, &space.join("Work")),
            Some(space.clone())
        );
        assert_eq!(
            space_root(&spaces, &space.join("Work").join("2026")),
            Some(space.clone())
        );
        // Folded first, so a path that climbs back into its own space still
        // names that space.
        assert_eq!(
            space_root(&spaces, &space.join("Work").join("..")),
            Some(space)
        );
    }

    #[test]
    fn nothing_outside_the_spaces_folder_belongs_to_a_space() {
        let spaces = path(&["Documents", "Nib"]);

        assert_eq!(space_root(&spaces, &path(&["elsewhere", "notes"])), None);
        // The spaces folder holds the spaces and is not one of them.
        assert_eq!(space_root(&spaces, &spaces), None);
    }

    #[test]
    #[cfg(windows)]
    fn windows_paths_differ_in_case_without_differing_in_meaning() {
        assert!(inside(
            Path::new(r"C:\Users\me\Documents\Nib"),
            Path::new(r"c:\users\me\documents\nib\Work\a.md")
        ));
    }

    #[test]
    fn names_a_note_by_its_extension() {
        assert!(is_markdown(Path::new("a/b.md")));
        assert!(is_markdown(Path::new("a/b.MARKDOWN")));
        assert!(!is_markdown(Path::new("a/b.txt")));
        assert!(!is_markdown(Path::new("a/b")));
    }

    #[test]
    fn an_atomic_write_leaves_the_file_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");

        write_atomically(&target, b"first").expect("the first write");
        write_atomically(&target, b"second").expect("the second write");

        assert_eq!(
            std::fs::read_to_string(&target).expect("the note"),
            "second"
        );

        let left: Vec<_> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, vec!["Note.md".to_string()]);
    }

    #[test]
    fn numbering_goes_before_the_extension_for_files() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("Idea 2.md"), "").expect("a second note");
        std::fs::create_dir_all(here.join("Notes")).expect("a folder");

        assert_eq!(
            free_spot(&here.join("Idea.md"), true),
            here.join("Idea 3.md")
        );
        assert_eq!(free_spot(&here.join("Notes"), false), here.join("Notes 2"));
        assert_eq!(free_spot(&here.join("New.md"), true), here.join("New.md"));
    }

    /// The file names, sorted: the walk orders by whole path, and where in the
    /// tree each file sits is not what these tests are about.
    fn names(paths: &[PathBuf]) -> Vec<String> {
        let mut found: Vec<String> = paths
            .iter()
            .filter_map(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .collect();
        found.sort();
        found
    }

    #[test]
    fn tells_the_notes_of_a_space_from_the_files_beside_them() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Deep/Deeper")).expect("two folders");
        std::fs::create_dir_all(here.join(".hidden")).expect("a hidden folder");
        std::fs::write(here.join("One.md"), "").expect("a note");
        std::fs::write(here.join("Deep/Deeper/Two.markdown"), "").expect("a nested note");
        std::fs::write(here.join("Deep/notes.txt"), "").expect("a text file");
        std::fs::write(here.join("Deep/pic.png"), "").expect("a picture");
        std::fs::write(here.join(".hidden/Three.md"), "").expect("a hidden note");

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md", "Two.markdown"]);
        assert_eq!(names(&others), ["notes.txt", "pic.png"]);
    }

    #[test]
    fn stops_before_it_runs_out_of_stack() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let mut deep = dir.path().to_path_buf();
        // One past the cap, in short names so the whole path stays inside what
        // Windows allows without asking.
        for level in 0..34 {
            deep.push(format!("d{level}"));
        }
        std::fs::create_dir_all(&deep).expect("a very deep folder");
        std::fs::write(deep.join("Buried.md"), "").expect("a buried note");

        let (notes, others) = files_in(dir.path());
        assert!(notes.is_empty());
        assert!(others.is_empty());
    }
}
