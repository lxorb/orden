use std::path::{Path, PathBuf};

const SUFFIX: &str = ".icloud";

#[cfg(any(target_os = "macos", test))]
const DATALESS: u32 = 0x4000_0000;

#[cfg(any(target_os = "macos", test))]
fn flags_are_dataless(flags: u32) -> bool {
    flags & DATALESS != 0
}

#[cfg(target_os = "macos")]
pub fn is_dataless(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt as _;
    flags_are_dataless(meta.st_flags())
}

#[cfg(not(target_os = "macos"))]
pub fn is_dataless(_meta: &std::fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn arrived(target: &Path) -> bool {
    std::fs::symlink_metadata(target).is_ok_and(|meta| !is_dataless(&meta))
}

pub fn evicted_name(name: &str) -> Option<&str> {
    name.strip_prefix('.')?
        .strip_suffix(SUFFIX)
        .filter(|real| !real.is_empty())
}

pub fn placeholder_of(target: &Path) -> Option<PathBuf> {
    let name = target.file_name()?.to_str()?;
    Some(target.with_file_name(format!(".{name}{SUFFIX}")))
}

pub fn stands_for(bytes: &[u8], name: &str) -> bool {
    let holds =
        |needle: &[u8]| !needle.is_empty() && bytes.windows(needle.len()).any(|at| at == needle);
    let wide: Vec<u8> = name.encode_utf16().flat_map(u16::to_be_bytes).collect();
    bytes.starts_with(b"bplist") && (holds(name.as_bytes()) || holds(&wide))
}

pub fn evicted(target: &Path) -> bool {
    const LONGEST: u64 = 64 * 1024;

    if std::fs::symlink_metadata(target).is_ok() {
        return false;
    }
    let (Some(placeholder), Some(name)) = (
        placeholder_of(target),
        target.file_name().and_then(|one| one.to_str()),
    ) else {
        return false;
    };
    std::fs::File::open(placeholder).is_ok_and(|file| {
        use std::io::Read as _;
        let mut bytes = Vec::new();
        file.take(LONGEST).read_to_end(&mut bytes).is_ok() && stands_for(&bytes, name)
    })
}

#[cfg(target_os = "macos")]
pub fn fetched(app: &tauri::AppHandle, target: &Path) -> Result<(), String> {
    use std::time::{Duration, Instant};
    use tauri::Emitter as _;

    const PATIENCE: Duration = Duration::from_secs(120);

    let dataless = std::fs::symlink_metadata(target).is_ok_and(|meta| is_dataless(&meta));
    if !dataless {
        if target.exists() {
            return Ok(());
        }
        let Some(placeholder) = placeholder_of(target) else {
            return Ok(());
        };
        if !placeholder.exists() {
            return Ok(());
        }
    }

    let shown = target.to_string_lossy().to_string();
    let say = |done: bool| {
        let _ = app.emit(EVENT, Fetching { path: &shown, done });
    };

    say(false);
    if let Err(error) = download(target) {
        say(true);
        return if dataless { Ok(()) } else { Err(error) };
    }

    let deadline = Instant::now() + PATIENCE;
    while !arrived(target) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }

    say(true);
    if arrived(target) {
        Ok(())
    } else {
        Err(format!("{shown} is still downloading from iCloud"))
    }
}

#[cfg(target_os = "macos")]
const EVENT: &str = "orden://icloud";

#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct Fetching<'a> {
    path: &'a str,
    done: bool,
}

#[cfg(target_os = "macos")]
fn download(target: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let url = NSURL::fileURLWithPath(&NSString::from_str(&target.to_string_lossy()));
    NSFileManager::defaultManager()
        .startDownloadingUbiquitousItemAtURL_error(&url)
        .map_err(|error| {
            format!(
                "iCloud would not download {}: {}",
                target.display(),
                error.localizedDescription()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::{
        evicted, evicted_name, flags_are_dataless, is_dataless, placeholder_of, stands_for,
    };

    #[test]
    fn a_placeholder_is_a_property_list_with_the_name_in_it() {
        assert!(stands_for(
            b"bplist00\xd4NSURLNameKey_\x10\x07Plan.md",
            "Plan.md"
        ));
        let wide: Vec<u8> = "Pl\u{e4}n.md"
            .encode_utf16()
            .flat_map(u16::to_be_bytes)
            .collect();
        assert!(stands_for(
            &[b"bplist00".as_slice(), &wide].concat(),
            "Pl\u{e4}n.md"
        ));
        assert!(!stands_for(b"bplist00Other.md", "Plan.md"));
        assert!(!stands_for(b"Plan.md", "Plan.md"));
    }

    #[test]
    fn a_file_with_a_placeholder_is_evicted_and_one_without_is_gone() {
        let dir = tempfile::tempdir().expect("a folder");
        let note = dir.path().join("Plan.md");
        assert!(!evicted(&note));
        std::fs::write(dir.path().join(".Plan.md.icloud"), b"nothing").expect("written");
        assert!(!evicted(&note));
        std::fs::write(dir.path().join(".Plan.md.icloud"), b"bplist00Plan.md").expect("written");
        assert!(evicted(&note));
        std::fs::write(&note, "words").expect("written");
        assert!(!evicted(&note));
    }
    use std::path::{Path, PathBuf};

    #[test]
    fn a_file_with_its_data_elsewhere_says_so_in_its_flags() {
        assert!(flags_are_dataless(0x4000_0000));
        assert!(flags_are_dataless(0x4000_0040));
        assert!(!flags_are_dataless(0x40));
        assert!(!flags_are_dataless(0));
    }

    #[test]
    fn a_file_on_this_disk_is_not_dataless() {
        let file = tempfile_path();
        std::fs::write(&file, "# Here").unwrap();
        let meta = std::fs::symlink_metadata(&file).unwrap();
        assert!(!is_dataless(&meta));
        std::fs::remove_file(&file).unwrap();
    }

    fn tempfile_path() -> PathBuf {
        std::env::temp_dir().join(format!("nib-dataless-{}.md", std::process::id()))
    }

    #[test]
    fn a_placeholder_stands_for_the_name_inside_it() {
        assert_eq!(evicted_name(".Plan.md.icloud"), Some("Plan.md"));
        assert_eq!(
            evicted_name(".Über sicht.pdf.icloud"),
            Some("Über sicht.pdf")
        );
        assert_eq!(evicted_name("..hidden.md.icloud"), Some(".hidden.md"));
    }

    #[test]
    fn nothing_else_is_one() {
        assert_eq!(evicted_name("Plan.md"), None);
        assert_eq!(evicted_name(".DS_Store"), None);
        assert_eq!(evicted_name("Plan.md.icloud"), None);
        assert_eq!(evicted_name(".icloud"), None);
    }

    #[test]
    fn a_file_knows_where_its_placeholder_would_be() {
        assert_eq!(
            placeholder_of(Path::new("/s/ideas/Plan.md")),
            Some(PathBuf::from("/s/ideas/.Plan.md.icloud"))
        );
    }
}
