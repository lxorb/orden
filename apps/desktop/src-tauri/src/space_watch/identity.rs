use std::path::Path;

#[cfg(windows)]
pub fn identity(path: &Path) -> Option<String> {
    use file_id::FileId;

    Some(match file_id::get_file_id(path).ok()? {
        FileId::HighRes {
            volume_serial_number,
            file_id,
        } => format!("{volume_serial_number:x}:{file_id:x}"),
        FileId::LowRes {
            volume_serial_number,
            file_index,
        } => format!("{volume_serial_number:x}:{file_index:x}"),
        FileId::Inode {
            device_id,
            inode_number,
        } => format!("{device_id:x}:{inode_number:x}"),
    })
}

#[cfg(unix)]
pub fn identity(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;

    let meta = std::fs::symlink_metadata(path).ok()?;
    let born = meta
        .created()
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_nanos());

    let id = match born {
        Some(born) => format!("{:x}:{:x}:{born:x}", meta.dev(), meta.ino()),
        None => format!("{:x}:{:x}", meta.dev(), meta.ino()),
    };
    #[cfg(target_os = "linux")]
    let id = match generation(path) {
        Some(generation) => format!("{id}:{generation:x}"),
        None => id,
    };
    Some(id)
}

#[cfg(target_os = "linux")]
#[allow(unsafe_code, reason = "the generation is asked through an ioctl")]
fn generation(path: &Path) -> Option<libc::c_int> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
        .open(path)
        .ok()?;
    let mut generation: libc::c_int = 0;
    let asked = unsafe { libc::ioctl(file.as_raw_fd(), libc::FS_IOC_GETVERSION, &mut generation) };
    (asked == 0).then_some(generation)
}

#[cfg(test)]
mod tests {
    use super::identity;
    use std::fs;

    #[test]
    fn a_file_keeps_its_identity_through_a_rename_and_an_edit() {
        let dir = tempfile::tempdir().expect("a folder");
        let before = dir.path().join("Plan.md");
        fs::write(&before, "one").expect("a note");
        let id = identity(&before).expect("an identity");

        let after = dir.path().join("Renamed.md");
        fs::rename(&before, &after).expect("renamed");
        assert_eq!(identity(&after).as_ref(), Some(&id));
        assert_eq!(identity(&before), None, "nothing is there now");

        fs::write(&after, "two, written in place").expect("edited");
        assert_eq!(identity(&after).as_ref(), Some(&id));
    }

    #[test]
    fn a_move_to_another_folder_keeps_it_too() {
        let dir = tempfile::tempdir().expect("a folder");
        let before = dir.path().join("Plan.md");
        let deeper = dir.path().join("Projects").join("2026");
        fs::create_dir_all(&deeper).expect("folders");
        fs::write(&before, "one").expect("a note");
        let id = identity(&before).expect("an identity");

        let after = deeper.join("Plan.md");
        fs::rename(&before, &after).expect("moved");
        assert_eq!(identity(&after), Some(id));

        let folder = identity(&deeper).expect("a folder has one");
        let moved = dir.path().join("Archive");
        fs::rename(dir.path().join("Projects"), &moved).expect("a folder moved");
        assert_eq!(identity(&moved.join("2026")), Some(folder));
    }

    #[test]
    fn a_file_made_again_is_another_file() {
        let dir = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).expect("a folder");
        let path = dir.path().join("Plan.md");
        for _ in 0..200 {
            fs::write(&path, "one").expect("a note");
            let first = identity(&path).expect("an identity");

            fs::remove_file(&path).expect("deleted");
            fs::write(&path, "one").expect("made again");
            assert_ne!(identity(&path).expect("an identity"), first);
            fs::remove_file(&path).expect("deleted again");
        }
    }
}
