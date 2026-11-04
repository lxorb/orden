//! Every file and folder in a space, as sync sees them: what `space_scan` lists, what
//! the watcher learns a space from before it watches, and what it reads a folder that
//! arrived whole with.
//!
//! The same bounds as the file tree's walk (tree.rs), for the same reasons: no deeper
//! than `MAX_DEPTH`, no more than `MAX_ENTRIES`, and a space larger than that says so
//! rather than answering with half of itself. Two rules differ, and both are about what
//! a second computer should be handed:
//!
//! - Links are left alone, not followed. The tree follows a link into a folder of the
//!   same space, which draws one note in two places; sync would send it twice, under two
//!   names, and a link is a thing about this disk that means nothing on another one.
//!   Syncthing makes the same choice.
//! - Hidden names are left out, as the tree leaves them out: `.git`, `.obsidian`, and
//!   Orden's own half-written temp files, which are hidden so that no list ever shows one.
//!   So is what an operating system leaves in every folder it opens (`Thumbs.db`,
//!   `desktop.ini`, an open Office file's `~$` owner file): a folder full of those
//!   arriving on a Mac is noise, and none of them is anybody's writing. Bar one hidden
//!   name: the space's own inbox (`.Inbox.md`, #1044), hidden from every list and a note
//!   every device needs.

use std::fs;
use std::path::{Path, PathBuf};

use super::identity::identity;
use crate::clock;
use crate::paths::MAX_DEPTH;
use crate::tree::MAX_ENTRIES;

/// One file or folder: where it is inside its space, and what it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    /// Inside the space, with the platform's separators.
    pub rel: PathBuf,
    /// Whether it is a folder.
    pub dir: bool,
    /// Its size in bytes; nothing for a folder.
    pub size: u64,
    /// When it was last written, in milliseconds since the epoch.
    pub mtime: u64,
    /// The same moment as finely as the file system keeps it, in nanoseconds: what a
    /// write is told from the one before by, where two land in the same millisecond.
    /// NTFS keeps a tenth of a microsecond, APFS and ext4 a nanosecond, though Linux
    /// stamps a write with a clock that moves every few milliseconds.
    pub stamp: u128,
    /// What it is apart from where it is; see identity.rs. None where the file system
    /// would not say, which a file that vanished between the listing and the question
    /// also answers.
    pub id: Option<String>,
    /// A folder whose children were not read: it would not list, or is past `MAX_DEPTH`.
    /// It looks empty and may not be, and what is known under it is not therefore gone.
    pub unlisted: bool,
}

/// Whether sync leaves a name alone; see the top of this file.
pub fn ignored(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with("~$")
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
        || name == "Icon\r"
}

/// What sync carries though it is hidden: the space's own inbox (#1044), at its root,
/// where a task with no note of the reader's goes. Hidden from every list, and a note
/// every device needs. The window says the same (`carriedOwn` in
/// packages/bases/src/inbox.ts).
const CARRIED: &str = ".Inbox.md";

fn carried(rel: &Path) -> bool {
    rel.as_os_str() == CARRIED
}

/// Whether any part of a path inside a space is a name sync leaves alone.
pub fn ignored_path(rel: &Path) -> bool {
    if carried(rel) {
        return false;
    }
    rel.components()
        .any(|part| part.as_os_str().to_str().is_none_or(ignored))
}

/// What is at `rel` inside `root` now, or None where nothing sync keeps is there: no
/// file, a link, a name it leaves alone, a name that is not text.
pub fn found(root: &Path, rel: &Path) -> Option<Found> {
    if rel.as_os_str().is_empty() || ignored_path(rel) {
        return None;
    }
    let path = root.join(rel);
    let meta = fs::symlink_metadata(&path).ok()?;
    if meta.file_type().is_symlink() {
        return None;
    }

    Some(Found {
        rel: rel.to_path_buf(),
        dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime: clock::of(meta.modified().ok()),
        stamp: meta
            .modified()
            .ok()
            .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_nanos()),
        id: identity(&path),
        unlisted: false,
    })
}

/// Whether a failed look at a path says nothing is there. Any other failure (no permission,
/// a network drive away, a virus scanner in the way) says only that nobody could look.
pub fn says_gone(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

/// Whether anything sync keeps is at `rel` inside `root` now: `found` without asking
/// what it is, which on Windows is a handle opened and closed.
pub fn present(root: &Path, rel: &Path) -> bool {
    !rel.as_os_str().is_empty()
        && !ignored_path(rel)
        && match fs::symlink_metadata(root.join(rel)) {
            Ok(meta) => !meta.file_type().is_symlink(),
            // Nobody could look: not a removal, which would leave the account too.
            Err(error) => !says_gone(&error),
        }
}

/// The names sync keeps in a folder, in order. An error partway through the listing is the
/// listing failing: what it had got to is not all that is there.
fn names_in(root: &Path, rel: &Path) -> std::io::Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root.join(rel))? {
        if let Ok(name) = entry?.file_name().into_string() {
            if !ignored(&name) || carried(&rel.join(&name)) {
                names.push(name);
            }
        }
    }
    names.sort_unstable();
    Ok(names)
}

/// Everything under `rel` inside `root`, `rel` itself left out, handed to `visit` a
/// folder before what is in it and each folder's names in order. `left` is what the
/// walk may still list; a walk that runs out answers the sentence that says so.
///
/// A folder inside that will not list is handed over `unlisted`, and the walk goes on. `rel`
/// itself not listing is an error: answered as an empty space, every note in it is a delete.
pub fn walk(
    root: &Path,
    rel: &Path,
    left: &mut usize,
    visit: &mut dyn FnMut(Found),
) -> Result<(), String> {
    if rel.components().count() >= MAX_DEPTH {
        return Ok(());
    }
    match names_in(root, rel) {
        Ok(names) => walk_names(root, rel, names, left, visit),
        Err(error) if says_gone(&error) => Ok(()),
        Err(error) => Err(format!(
            "{} would not list: {error}",
            root.join(rel).display()
        )),
    }
}

fn walk_names(
    root: &Path,
    rel: &Path,
    names: Vec<String>,
    left: &mut usize,
    visit: &mut dyn FnMut(Found),
) -> Result<(), String> {
    for name in names {
        let child = rel.join(&name);
        let Some(mut one) = found(root, &child) else {
            continue;
        };
        *left = left
            .checked_sub(1)
            .ok_or_else(|| format!("this space holds more than {MAX_ENTRIES} files and folders"))?;

        // Listed before it is handed over, which is when it has to say whether it could be.
        let inside =
            (one.dir && child.components().count() < MAX_DEPTH).then(|| names_in(root, &child));
        one.unlisted = one.dir
            && match &inside {
                None => true,
                Some(Err(error)) => !says_gone(error),
                Some(Ok(_)) => false,
            };
        visit(one);
        if let Some(Ok(names)) = inside {
            walk_names(root, &child, names, left, visit)?;
        }
    }

    Ok(())
}

/// Everything in a space, in the walk's order.
#[cfg(test)]
pub fn everything(root: &Path) -> Result<Vec<Found>, String> {
    let mut all = Vec::new();
    let mut left = MAX_ENTRIES;
    walk(root, Path::new(""), &mut left, &mut |one| all.push(one))?;
    Ok(all)
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::present;
    use super::{everything, ignored, walk};
    use crate::paths::link_to;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn rels(root: &Path) -> Vec<PathBuf> {
        everything(root)
            .expect("a walk")
            .into_iter()
            .map(|one| one.rel)
            .collect()
    }

    #[test]
    fn a_space_is_every_file_in_it_but_what_sync_leaves_alone() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::create_dir_all(root.join("Reading").join(".obsidian")).expect("folders");
        fs::create_dir_all(root.join(".git")).expect("a repository");
        fs::write(root.join(".git").join("HEAD"), "ref").expect("its head");
        fs::write(root.join("Plan.md"), "words").expect("a note");
        fs::write(root.join("shot.png"), [1, 2, 3]).expect("a picture");
        fs::write(root.join(".Plan.md.123-0.nib.tmp"), "half").expect("a temp file");
        fs::write(root.join("Thumbs.db"), "").expect("clutter");
        fs::write(root.join("~$Report.docx"), "").expect("an owner file");
        fs::write(root.join("Reading").join("Deep.md"), "").expect("a nested note");

        assert_eq!(
            rels(root),
            [
                PathBuf::from("Plan.md"),
                PathBuf::from("Reading"),
                Path::new("Reading").join("Deep.md"),
                PathBuf::from("shot.png"),
            ]
        );

        let all = everything(root).expect("a walk");
        let picture = all
            .iter()
            .find(|one| one.rel == Path::new("shot.png"))
            .expect("listed");
        assert_eq!(picture.size, 3);
        assert!(picture.mtime > 0);
        assert!(picture.id.is_some());
        assert!(all[1].dir && all[1].id.is_some());
    }

    #[test]
    fn a_link_is_not_followed_or_listed() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path().join("Space");
        let elsewhere = dir.path().join("Elsewhere");
        fs::create_dir_all(&root).expect("a space");
        fs::create_dir_all(&elsewhere).expect("somewhere else");
        fs::write(elsewhere.join("Other.md"), "").expect("a note elsewhere");
        fs::write(root.join("Plan.md"), "").expect("a note");
        if !link_to(&elsewhere, &root.join("out")) || !link_to(&root, &root.join("loop")) {
            return;
        }

        assert_eq!(rels(&root), [PathBuf::from("Plan.md")]);
    }

    #[test]
    fn a_space_larger_than_the_walk_says_so() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::write(root.join("a.md"), "").expect("a note");
        fs::write(root.join("b.md"), "").expect("a note");

        let mut left = 1;
        let refused = walk(root, Path::new(""), &mut left, &mut |_| {});
        assert!(refused.expect_err("too many").contains("files and folders"));
    }

    #[test]
    fn the_spaces_own_inbox_is_carried_and_no_other_hidden_file() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::write(root.join(".Inbox.md"), "- [ ] milk").expect("the inbox");
        fs::write(root.join(".other.md"), "").expect("another hidden note");
        fs::create_dir_all(root.join("Work")).expect("a folder");
        fs::write(root.join("Work").join(".Inbox.md"), "").expect("not it");
        fs::write(root.join("Plan.md"), "").expect("a note");

        assert_eq!(
            rels(root),
            [
                PathBuf::from(".Inbox.md"),
                PathBuf::from("Plan.md"),
                PathBuf::from("Work"),
            ]
        );
        assert!(!super::ignored_path(Path::new(".Inbox.md")));
        assert!(super::ignored_path(Path::new(".other.md")));
        assert!(super::ignored_path(&Path::new("Work").join(".Inbox.md")));
    }

    #[test]
    fn clutter_is_named_as_such() {
        for name in [
            ".DS_Store",
            "desktop.ini",
            "Thumbs.db",
            "~$Plan.docx",
            "Icon\r",
        ] {
            assert!(ignored(name), "{name:?}");
        }
        for name in ["Plan.md", "Icon.png", "thumbs.md", "a~$b"] {
            assert!(!ignored(name), "{name:?}");
        }
    }

    /// Permissions taken away for as long as it lives. Root reads through them, so a test
    /// run as root says nothing.
    #[cfg(unix)]
    struct Locked(PathBuf);

    #[cfg(unix)]
    impl Locked {
        fn up(folder: PathBuf) -> Option<Self> {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o000)).expect("locked");
            if fs::read_dir(&folder).is_ok() {
                fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).expect("opened");
                return None;
            }
            Some(Self(folder))
        }
    }

    #[cfg(unix)]
    impl Drop for Locked {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_will_not_list_says_so_and_the_walk_goes_on() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::create_dir_all(root.join("Shut")).expect("a folder");
        fs::write(root.join("Shut").join("Inside.md"), "words").expect("a note");
        fs::write(root.join("Open.md"), "words").expect("a note");
        let Some(_locked) = Locked::up(root.join("Shut")) else {
            return;
        };

        let all = everything(root).expect("the rest of the space");
        let shut = all
            .iter()
            .find(|one| one.rel == Path::new("Shut"))
            .expect("the folder itself");
        assert!(shut.unlisted, "it is not empty, it is unread");
        assert!(all.iter().any(|one| one.rel == Path::new("Open.md")));
        assert!(!all.iter().any(|one| one.rel.ends_with("Inside.md")));
        assert!(
            present(root, Path::new("Shut/Inside.md")),
            "nobody could look: that is not gone"
        );
        assert!(!present(root, Path::new("Open.md/Inside.md")));
        assert!(!present(root, Path::new("Never.md")));
    }

    #[cfg(unix)]
    #[test]
    fn a_space_that_will_not_list_is_an_error_not_an_empty_space() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path().join("Space");
        fs::create_dir_all(&root).expect("a space");
        let Some(_locked) = Locked::up(root.clone()) else {
            return;
        };
        assert!(everything(&root).is_err());
    }

    #[test]
    fn an_empty_folder_is_listed_and_one_past_the_limit_is_not() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        fs::create_dir(root.join("Empty")).expect("a folder");
        let deep = (0..crate::paths::MAX_DEPTH).fold(PathBuf::new(), |at, _| at.join("d"));
        fs::create_dir_all(root.join(&deep)).expect("deep folders");

        let all = everything(root).expect("a walk");
        let of = |rel: &Path| {
            all.iter()
                .find(|one| one.rel == rel)
                .expect("listed")
                .unlisted
        };
        assert!(!of(Path::new("Empty")));
        assert!(of(&deep));
    }
}
