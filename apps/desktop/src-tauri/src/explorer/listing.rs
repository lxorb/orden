use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager as _};

use super::reach::{judged, Explored, Fences, Use};

const MOST_LISTED: usize = 100_000;

const MOST_PEEKED: u64 = 48 * 1024 * 1024;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
    Link,
}

#[derive(Serialize, Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub kind: Kind,
    pub folder: bool,
    pub size: u64,
    pub modified: u64,
    pub hidden: bool,
}

#[derive(Serialize)]
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<Entry>,
    pub own: bool,
    pub spaces: bool,
    pub cut: bool,
}

pub(super) fn millis(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH).map_or(0, |since| {
        u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
    })
}

fn is_hidden(name: &str, meta: &fs::Metadata) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt as _;
        const UF_HIDDEN: u32 = 0x8000;
        meta.st_flags() & UF_HIDDEN != 0
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = meta;
        false
    }
}

pub(super) fn entry(path: &Path) -> Option<Entry> {
    let meta = fs::symlink_metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    let link = meta.file_type().is_symlink();
    let folder = if link {
        fs::metadata(path).is_ok_and(|to| to.is_dir())
    } else {
        meta.is_dir()
    };
    let kind = if link {
        Kind::Link
    } else if folder {
        Kind::Folder
    } else {
        Kind::File
    };
    Some(Entry {
        hidden: is_hidden(&name, &meta),
        name,
        kind,
        folder,
        size: if kind == Kind::File { meta.len() } else { 0 },
        modified: meta.modified().map_or(0, millis),
    })
}

pub(super) fn entries(folder: &Path, most: usize) -> Result<(Vec<Entry>, bool), String> {
    let mut out = Vec::new();
    for one in fs::read_dir(folder)
        .map_err(|why| format!("{}: {why}", folder.display()))?
        .flatten()
    {
        if out.len() >= most {
            return Ok((out, true));
        }
        if let Some(found) = entry(&one.path()) {
            out.push(found);
        }
    }
    Ok((out, false))
}

pub(super) fn real(path: &Path) -> PathBuf {
    crate::agents::files::real(path)
}

pub(super) fn asked(app: &AppHandle, path: &str, using: Use) -> Result<PathBuf, String> {
    let explored = app.state::<Explored>();
    judged(
        &Fences::of(app),
        &|one| explored.seen(one),
        &real,
        path,
        using,
    )
}

#[tauri::command(async)]
pub fn explorer_list(app: AppHandle, path: String) -> Result<Listing, String> {
    let folder = asked(&app, &path, Use::List)?;
    let (entries, cut) = entries(&folder, MOST_LISTED)?;
    app.state::<Explored>().saw(&folder);
    let fences = Fences::of(&app);
    Ok(Listing {
        path: folder.display().to_string(),
        parent: folder.parent().map(|one| one.display().to_string()),
        entries,
        own: fences.in_own(&folder, &real),
        spaces: fences.in_spaces(&folder),
        cut,
    })
}

#[derive(Serialize)]
pub struct Place {
    pub kind: &'static str,
    pub path: String,
    pub name: Option<String>,
}

#[tauri::command(async)]
pub fn explorer_places(app: AppHandle) -> Vec<Place> {
    let paths = app.path();
    let mut out: Vec<Place> = [
        ("home", paths.home_dir().ok()),
        ("desktop", paths.desktop_dir().ok()),
        ("documents", paths.document_dir().ok()),
        ("downloads", paths.download_dir().ok()),
        ("pictures", paths.picture_dir().ok()),
        ("music", paths.audio_dir().ok()),
        ("videos", paths.video_dir().ok()),
        ("spaces", crate::paths::spaces_dir(&app).ok()),
    ]
    .into_iter()
    .filter_map(|(kind, path)| {
        let path = path.filter(|one| one.is_dir())?;
        Some(Place {
            kind,
            path: path.display().to_string(),
            name: None,
        })
    })
    .collect();
    if cfg!(unix) {
        out.push(Place {
            kind: "root",
            path: "/".to_owned(),
            name: None,
        });
    }
    out.extend(disks().into_iter().map(|path| {
        Place {
            kind: "disk",
            name: path
                .file_name()
                .map(|one| one.to_string_lossy().into_owned())
                .or_else(|| Some(path.display().to_string())),
            path: path.display().to_string(),
        }
    }));
    out
}

fn disks() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        (b'A'..=b'Z')
            .map(|letter| PathBuf::from(format!("{}:\\", char::from(letter))))
            .filter(|drive| fs::metadata(drive).is_ok())
            .collect()
    }
    #[cfg(not(windows))]
    {
        let user = std::env::var("USER").unwrap_or_default();
        let folders: Vec<PathBuf> = if cfg!(target_os = "macos") {
            vec![PathBuf::from("/Volumes")]
        } else {
            vec![
                PathBuf::from("/media").join(&user),
                PathBuf::from("/run/media").join(&user),
                PathBuf::from("/mnt"),
            ]
        };
        let mut found: Vec<PathBuf> = folders
            .iter()
            .filter_map(|folder| fs::read_dir(folder).ok())
            .flat_map(|inside| inside.flatten().map(|one| one.path()))
            .filter(|one| fs::symlink_metadata(one).is_ok_and(|meta| meta.is_dir()))
            .collect();
        found.sort();
        found
    }
}

#[derive(Serialize)]
pub struct Facts {
    #[serde(flatten)]
    pub entry: Entry,
    pub path: String,
    pub created: Option<u64>,
    pub accessed: Option<u64>,
    pub readonly: bool,
    pub mode: Option<String>,
    pub link: Option<String>,
}

#[tauri::command(async)]
pub fn explorer_facts(app: AppHandle, path: String) -> Result<Facts, String> {
    let path = asked(&app, &path, Use::Look)?;
    let meta = fs::symlink_metadata(&path).map_err(|why| format!("{}: {why}", path.display()))?;
    let entry = entry(&path).ok_or_else(|| format!("{} is gone", path.display()))?;
    #[cfg(unix)]
    let mode = Some(letters(&meta));
    #[cfg(not(unix))]
    let mode = None;
    Ok(Facts {
        entry,
        path: path.display().to_string(),
        created: meta.created().ok().map(millis),
        accessed: meta.accessed().ok().map(millis),
        readonly: meta.permissions().readonly(),
        mode,
        link: fs::read_link(&path).ok().map(|to| to.display().to_string()),
    })
}

#[cfg(unix)]
fn letters(meta: &fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt as _;
    let mode = meta.permissions().mode();
    (0..9)
        .map(|bit| {
            let on = mode & (0o400 >> bit) != 0;
            match (on, bit % 3) {
                (false, _) => '-',
                (true, 0) => 'r',
                (true, 1) => 'w',
                (true, _) => 'x',
            }
        })
        .collect()
}

#[tauri::command(async)]
pub fn explorer_peek(app: AppHandle, path: String, most: u64) -> Result<Response, String> {
    use std::io::Read as _;
    let path = asked(&app, &path, Use::Look)?;
    let file = fs::File::open(&path).map_err(|why| format!("{}: {why}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(most.min(MOST_PEEKED) + 1)
        .read_to_end(&mut bytes)
        .map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(Response::new(peeked(bytes, most.min(MOST_PEEKED))))
}

fn peeked(mut bytes: Vec<u8>, most: u64) -> Vec<u8> {
    let cut = bytes.len() as u64 > most;
    bytes.truncate(usize::try_from(most).unwrap_or(usize::MAX));
    bytes.push(u8::from(cut));
    bytes
}

#[tauri::command(async)]
pub fn explorer_open(app: AppHandle, path: String) -> Result<(), String> {
    let path = asked(&app, &path, Use::Look)?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|why| why.to_string())
}

#[tauri::command(async)]
pub fn explorer_reveal(app: AppHandle, path: String) -> Result<(), String> {
    let path = asked(&app, &path, Use::Look)?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|why| why.to_string())
}

#[cfg(test)]
mod tests {
    use super::{entries, peeked, Kind};
    use std::fs;

    #[test]
    fn a_peek_is_the_bytes_and_one_last_byte_that_says_whether_more_were_there() {
        assert_eq!(peeked(b"four".to_vec(), 8), b"four\0");
        assert_eq!(peeked(b"four".to_vec(), 4), b"four\0");
        assert_eq!(peeked(b"fours".to_vec(), 4), b"four\x01");
        assert_eq!(peeked(Vec::new(), 4), b"\0");
    }

    #[test]
    fn a_folder_lists_what_it_holds_and_says_what_each_is() {
        let dir = tempfile::tempdir().expect("a folder");
        fs::write(dir.path().join("a.txt"), "four").expect("a file");
        fs::write(dir.path().join(".hidden"), "").expect("a hidden file");
        fs::create_dir(dir.path().join("sub")).expect("a folder in it");
        let (mut found, cut) = entries(dir.path(), 10).expect("listed");
        found.sort_by(|one, other| one.name.cmp(&other.name));
        assert!(!cut);
        let names: Vec<&str> = found.iter().map(|one| one.name.as_str()).collect();
        assert_eq!(names, [".hidden", "a.txt", "sub"]);
        assert!(found[0].hidden);
        assert_eq!(
            (found[1].kind, found[1].size, found[1].folder),
            (Kind::File, 4, false)
        );
        assert_eq!((found[2].kind, found[2].folder), (Kind::Folder, true));
    }

    #[test]
    fn a_listing_past_its_bound_says_so() {
        let dir = tempfile::tempdir().expect("a folder");
        for one in 0..5 {
            fs::write(dir.path().join(format!("{one}.txt")), "").expect("a file");
        }
        let (found, cut) = entries(dir.path(), 3).expect("listed");
        assert_eq!(found.len(), 3);
        assert!(cut);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_a_link_and_says_where_it_leads() {
        use super::entry;

        let dir = tempfile::tempdir().expect("a folder");
        fs::create_dir(dir.path().join("real")).expect("a folder");
        std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("to")).expect("a link");
        let found = entry(&dir.path().join("to")).expect("an entry");
        assert_eq!((found.kind, found.folder), (Kind::Link, true));
    }
}
