use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::paths::{cannot, made};

#[derive(Clone, Copy)]
enum Links {
    Followed,
    Kept,
}

pub fn copy_whole(source: &Path, target: &Path) -> Result<(), String> {
    copy_or_nothing(source, target, Links::Followed)
}

pub fn move_whole(source: &Path, target: &Path, verb: &str) -> Result<(), String> {
    moved_by(
        source,
        target,
        verb,
        |from, to| fs::rename(from, to),
        taken_away,
    )
}

fn moved_by(
    source: &Path,
    target: &Path,
    verb: &str,
    rename: impl FnOnce(&Path, &Path) -> io::Result<()>,
    take_away: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), String> {
    match rename(source, target) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(cannot(verb, source, &error)),
    }

    copy_or_nothing(source, target, Links::Kept)?;

    if let Err(error) = take_away(source) {
        if put_back(target, source).is_ok() {
            let _ = taken_away(target);
        }
        return Err(cannot(verb, source, &error));
    }

    Ok(())
}

fn copy_or_nothing(source: &Path, target: &Path, links: Links) -> Result<(), String> {
    if fs::symlink_metadata(target).is_ok() {
        return Err("something already lives there".into());
    }

    copy_all(source, target, links).inspect_err(|_| {
        let _ = taken_away(target);
    })
}

fn copy_all(source: &Path, target: &Path, links: Links) -> Result<(), String> {
    let kind = fs::symlink_metadata(source).map_err(|error| cannot("read", source, &error))?;

    if kind.is_symlink() {
        match links {
            Links::Kept => {
                let points = fs::read_link(source);
                return relinked(source, target, points);
            }
            Links::Followed if !source.is_file() => {
                let points = fs::canonicalize(source).or_else(|_| fs::read_link(source));
                return relinked(source, target, points);
            }
            Links::Followed => {}
        }
    }

    if kind.is_dir() {
        made(target)?;
        let entries = fs::read_dir(source).map_err(|error| cannot("read", source, &error))?;
        for entry in entries {
            let entry = entry.map_err(|error| cannot("read", source, &error))?;
            copy_all(&entry.path(), &target.join(entry.file_name()), links)?;
        }
        return Ok(());
    }

    fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| cannot("copy", source, &error))
}

fn relinked(source: &Path, target: &Path, points: io::Result<PathBuf>) -> Result<(), String> {
    let points = points.map_err(|error| cannot("read", source, &error))?;

    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&points, target);
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::FileTypeExt as _;

        let folder =
            fs::symlink_metadata(source).is_ok_and(|kind| kind.file_type().is_symlink_dir());
        if folder {
            std::os::windows::fs::symlink_dir(&points, target)
        } else {
            std::os::windows::fs::symlink_file(&points, target)
        }
    };

    linked.map_err(|error| cannot("copy", source, &error))
}

fn put_back(copy: &Path, source: &Path) -> Result<(), String> {
    let kind = fs::symlink_metadata(copy).map_err(|error| cannot("read", copy, &error))?;

    if kind.is_dir() {
        made(source)?;
        let entries = fs::read_dir(copy).map_err(|error| cannot("read", copy, &error))?;
        for entry in entries {
            let entry = entry.map_err(|error| cannot("read", copy, &error))?;
            put_back(&entry.path(), &source.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if fs::symlink_metadata(source).is_ok() {
        return Ok(());
    }

    copy_all(copy, source, Links::Kept)
}

fn taken_away(path: &Path) -> io::Result<()> {
    let kind = fs::symlink_metadata(path)?;

    if kind.is_dir() || (kind.is_symlink() && path.is_dir()) {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(all(test, windows))]
pub(crate) fn unreadable(path: &Path) -> Option<Unreadable> {
    use std::os::windows::fs::OpenOptionsExt as _;

    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
        .ok()?;
    Some(Unreadable { _handle: handle })
}

#[cfg(all(test, unix))]
pub(crate) fn unreadable(path: &Path) -> Option<Unreadable> {
    use std::os::unix::fs::PermissionsExt as _;

    fs::set_permissions(path, fs::Permissions::from_mode(0o000)).ok()?;
    let held = Unreadable {
        path: path.to_path_buf(),
    };
    fs::File::open(path).is_err().then_some(held)
}

#[cfg(test)]
pub(crate) struct Unreadable {
    #[cfg(windows)]
    _handle: fs::File,
    #[cfg(unix)]
    path: std::path::PathBuf,
}

#[cfg(all(test, unix))]
impl Drop for Unreadable {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt as _;

        let _ = fs::set_permissions(&self.path, fs::Permissions::from_mode(0o644));
    }
}

#[cfg(test)]
mod tests {
    use super::{copy_whole, move_whole, moved_by, taken_away, unreadable};
    use crate::paths::link_to;
    use std::fs;
    use std::io;
    use std::path::Path;

    fn across(_: &Path, _: &Path) -> io::Result<()> {
        Err(io::ErrorKind::CrossesDevices.into())
    }

    fn trip(dir: &Path) -> std::path::PathBuf {
        let trip = dir.join("Trip");
        fs::create_dir_all(trip.join("assets")).expect("the folders");
        fs::write(trip.join("Trip.md"), "# Trip").expect("a note");
        fs::write(trip.join("assets").join("map.png"), "map").expect("a picture");
        trip
    }

    fn whole_trip(at: &Path) {
        assert_eq!(
            fs::read_to_string(at.join("Trip.md")).expect("the note"),
            "# Trip"
        );
        assert_eq!(
            fs::read_to_string(at.join("assets").join("map.png")).expect("the picture"),
            "map"
        );
    }

    #[test]
    fn a_move_on_one_disk_is_a_rename() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let target = dir.path().join("Moved");

        move_whole(&source, &target, "move").expect("the move");
        whole_trip(&target);
        assert!(!source.exists());
    }

    #[test]
    fn a_move_across_disks_is_a_copy_and_then_a_removal() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let target = dir.path().join("Moved");

        moved_by(&source, &target, "delete", across, taken_away).expect("the move");
        whole_trip(&target);
        assert!(!source.exists(), "the folder is still where it was");
    }

    #[test]
    fn a_file_moves_across_disks_too() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = dir.path().join("Idea.md");
        fs::write(&source, "an idea").expect("a note");
        let target = dir.path().join("Idea moved.md");

        moved_by(&source, &target, "delete", across, taken_away).expect("the move");
        assert_eq!(fs::read_to_string(&target).expect("the note"), "an idea");
        assert!(!source.exists());
    }

    #[test]
    fn a_rename_refused_for_another_reason_moves_nothing() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let target = dir.path().join("Moved");

        let refused = moved_by(
            &source,
            &target,
            "delete",
            |_, _| Err(io::ErrorKind::PermissionDenied.into()),
            taken_away,
        );
        assert!(refused.is_err_and(|said| said.starts_with("could not delete")));
        assert!(!target.exists());
        whole_trip(&source);
    }

    #[test]
    fn a_copy_across_disks_that_stops_leaves_the_folder_where_it_was() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let held = source.join("assets").join("scan.png");
        fs::write(&held, "scan").expect("a picture nobody may read");
        let Some(_held) = unreadable(&held) else {
            return;
        };
        let target = dir.path().join("Moved");

        assert!(moved_by(&source, &target, "delete", across, taken_away).is_err());
        assert!(!target.exists(), "half a copy was left behind");
        whole_trip(&source);
    }

    #[test]
    fn a_removal_that_stops_half_way_puts_back_what_it_took() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let target = dir.path().join("Moved");

        let refused = moved_by(&source, &target, "delete", across, |from| {
            fs::remove_file(from.join("assets").join("map.png"))?;
            fs::remove_dir(from.join("assets"))?;
            Err(io::ErrorKind::PermissionDenied.into())
        });

        assert!(refused.is_err());
        whole_trip(&source);
        assert!(!target.exists(), "the copy stayed as well");
    }

    #[test]
    fn a_link_that_moves_is_still_a_link() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let elsewhere = dir.path().join("Elsewhere");
        fs::create_dir_all(&elsewhere).expect("somewhere else");
        fs::write(elsewhere.join("Other.md"), "other").expect("a note elsewhere");
        if !link_to(&elsewhere, &source.join("out")) {
            return;
        }
        let target = dir.path().join("Moved");

        if moved_by(&source, &target, "delete", across, taken_away).is_ok() {
            let kind = fs::symlink_metadata(target.join("out")).expect("the link");
            assert!(kind.is_symlink(), "the link became a copy");
            assert!(!source.exists());
        } else {
            assert!(!target.exists());
            whole_trip(&source);
        }
        assert_eq!(
            fs::read_to_string(elsewhere.join("Other.md")).expect("untouched"),
            "other"
        );
    }

    #[test]
    fn a_copy_carries_a_link_to_a_folder_as_a_link() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let elsewhere = dir.path().join("Elsewhere");
        fs::create_dir_all(&elsewhere).expect("somewhere else");
        fs::write(elsewhere.join("Other.md"), "other").expect("a note elsewhere");
        if !link_to(&elsewhere, &source.join("out")) {
            return;
        }
        let target = dir.path().join("Deeper").join("Trip copy");
        fs::create_dir_all(dir.path().join("Deeper")).expect("a folder to copy into");

        if copy_whole(&source, &target).is_ok() {
            whole_trip(&target);
            let kind = fs::symlink_metadata(target.join("out")).expect("the link");
            assert!(kind.is_symlink(), "the folder it leads to was copied");
            assert_eq!(
                fs::read_to_string(target.join("out").join("Other.md")).expect("through it"),
                "other"
            );
        } else {
            assert!(!target.exists(), "half a copy was left behind");
        }
    }

    #[test]
    fn a_linked_folder_copied_is_not_nothing() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let elsewhere = trip(dir.path());
        let linked = dir.path().join("Linked");
        if !link_to(&elsewhere, &linked) {
            return;
        }
        let target = dir.path().join("Linked copy");

        if copy_whole(&linked, &target).is_ok() {
            whole_trip(&target);
        } else {
            assert!(!target.exists());
        }
    }

    #[test]
    fn a_copy_never_writes_over_anything() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let source = trip(dir.path());
        let target = dir.path().join("Taken");
        fs::create_dir_all(&target).expect("something already there");
        fs::write(target.join("Mine.md"), "mine").expect("a note of its own");

        assert!(copy_whole(&source, &target).is_err());
        assert_eq!(
            fs::read_to_string(target.join("Mine.md")).expect("still there"),
            "mine"
        );
        assert!(!target.join("Trip.md").exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_move_between_two_real_disks_lands_whole() {
        use std::os::unix::fs::MetadataExt as _;

        let Ok(memory) = tempfile::tempdir_in("/dev/shm") else {
            return;
        };
        let disk = tempfile::tempdir().expect("a temp folder");
        let device = |path: &Path| fs::metadata(path).map(|data| data.dev()).ok();
        if device(memory.path()) == device(disk.path()) {
            return;
        }

        let source = trip(memory.path());
        let target = disk.path().join("Trip");
        move_whole(&source, &target, "delete").expect("the move");

        whole_trip(&target);
        assert!(!source.exists());
    }
}
