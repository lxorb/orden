use std::fs;
use std::path::{Path, PathBuf};

use super::identity::identity;
use crate::clock;
use crate::paths::MAX_DEPTH;
use crate::tree::MAX_ENTRIES;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub rel: PathBuf,
    pub dir: bool,
    pub size: u64,
    pub mtime: u64,
    pub stamp: u128,
    pub id: Option<String>,
    pub unlisted: bool,
}

pub fn ignored(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with("~$")
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
        || name == "Icon\r"
}

const CARRIED: &str = ".Inbox.md";

fn carried(rel: &Path) -> bool {
    rel.as_os_str() == CARRIED
}

pub fn ignored_path(rel: &Path) -> bool {
    if carried(rel) {
        return false;
    }
    rel.components()
        .any(|part| part.as_os_str().to_str().is_none_or(ignored))
}

pub fn found(root: &Path, rel: &Path) -> Option<Found> {
    looked(root, rel).ok().flatten()
}

fn looked(root: &Path, rel: &Path) -> std::io::Result<Option<Found>> {
    if rel.as_os_str().is_empty() || ignored_path(rel) {
        return Ok(None);
    }
    let path = root.join(rel);
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) if says_gone(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    if meta.file_type().is_symlink() {
        return Ok(None);
    }

    Ok(Some(Found {
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
    }))
}

pub fn says_gone(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound
            | std::io::ErrorKind::NotADirectory
            | std::io::ErrorKind::InvalidFilename
    )
}

pub fn present(root: &Path, rel: &Path) -> bool {
    !rel.as_os_str().is_empty()
        && !ignored_path(rel)
        && match fs::symlink_metadata(root.join(rel)) {
            Ok(meta) => !meta.file_type().is_symlink(),
            Err(error) => !says_gone(&error),
        }
}

struct Listing {
    found: Vec<Found>,
    whole: bool,
}

fn listed_in(root: &Path, rel: &Path) -> std::io::Result<Listing> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root.join(rel))? {
        if let Ok(name) = entry?.file_name().into_string() {
            if !ignored(&name) || carried(&rel.join(&name)) {
                names.push(name);
            }
        }
    }
    names.sort_unstable();

    let mut listing = Listing {
        found: Vec::with_capacity(names.len()),
        whole: true,
    };
    for name in names {
        match looked(root, &rel.join(name)) {
            Ok(Some(one)) => listing.found.push(one),
            Ok(None) => {}
            Err(_) => listing.whole = false,
        }
    }
    Ok(listing)
}

pub fn walk(
    root: &Path,
    rel: &Path,
    left: &mut usize,
    visit: &mut dyn FnMut(Found),
) -> Result<(), String> {
    if rel.components().count() >= MAX_DEPTH {
        return Ok(());
    }
    match listed_in(root, rel) {
        Ok(listing) => walk_listing(root, listing, left, visit),
        Err(error) if says_gone(&error) => Ok(()),
        Err(error) => Err(format!(
            "{} would not list: {error}",
            root.join(rel).display()
        )),
    }
}

fn walk_listing(
    root: &Path,
    listing: Listing,
    left: &mut usize,
    visit: &mut dyn FnMut(Found),
) -> Result<(), String> {
    for mut one in listing.found {
        *left = left
            .checked_sub(1)
            .ok_or_else(|| format!("this space holds more than {MAX_ENTRIES} files and folders"))?;

        let child = one.rel.clone();
        let inside =
            (one.dir && child.components().count() < MAX_DEPTH).then(|| listed_in(root, &child));
        one.unlisted = one.dir
            && match &inside {
                None => true,
                Some(Err(error)) => !says_gone(error),
                Some(Ok(listing)) => !listing.whole,
            };
        visit(one);
        if let Some(Ok(listing)) = inside {
            walk_listing(root, listing, left, visit)?;
        }
    }

    Ok(())
}

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
    fn a_folder_whose_children_will_not_stat_is_unlisted_too() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        let half = root.join("Half");
        fs::create_dir_all(&half).expect("a folder");
        fs::write(half.join("Inside.md"), "words").expect("a note");
        fs::set_permissions(&half, fs::Permissions::from_mode(0o444)).expect("half shut");
        if fs::symlink_metadata(half.join("Inside.md")).is_ok() {
            fs::set_permissions(&half, fs::Permissions::from_mode(0o755)).expect("opened");
            return;
        }

        let all = everything(root).expect("a walk");
        fs::set_permissions(&half, fs::Permissions::from_mode(0o755)).expect("opened");
        let folder = all
            .iter()
            .find(|one| one.rel == Path::new("Half"))
            .expect("the folder itself");
        assert!(folder.unlisted);
        assert!(!all.iter().any(|one| one.rel.ends_with("Inside.md")));
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
