//! What this computer has installed, for New application's chooser (issue 1063, step 3).
//!
//! - **Linux**: the desktop entries of the XDG data folders (`applications/*.desktop`),
//!   read as the freedesktop.org Desktop Entry Specification says: the first folder that
//!   has an id wins, an entry that is hidden or not shown in menus is left out, and so is
//!   one that runs in a terminal or whose `TryExec` is not there. Its icon is looked up in
//!   the hicolor theme and in `pixmaps`, and sent as a small picture.
//! - **Windows**: the Start menu's shortcuts, the machine's and the reader's.
//! - **macOS**: the bundles in `/Applications` and `~/Applications`.
//!
//! An application is started by the id this module found and the command its entry
//! holds, never by a command line from the window; see `find`.

use std::path::Path;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::PathBuf;

use serde::Serialize;

/// The largest icon file read, in bytes: its data URL is at most `MOST_ICON` in
/// `@orden/online/apps`, 48 KiB, which base64 makes of about 36 KiB.
const MOST_ICON_BYTES: u64 = 35 * 1024;

/// One application, as the window lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Listed {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// One application, as it is started: its listing and the program with its arguments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub listed: Listed,
    pub argv: Vec<String>,
}

/// Everything installed, by name.
pub fn installed() -> Vec<Listed> {
    let mut all: Vec<Listed> = entries().into_iter().map(|one| one.listed).collect();
    all.sort_by_key(|one| one.name.to_lowercase());
    all
}

/// The application of this id, read afresh: a list from a minute ago is not what runs.
pub fn find(id: &str) -> Option<Entry> {
    entries().into_iter().find(|one| one.listed.id == id)
}

#[cfg(target_os = "linux")]
fn entries() -> Vec<Entry> {
    linux::entries(&linux::data_dirs())
}

#[cfg(target_os = "windows")]
fn entries() -> Vec<Entry> {
    let mut roots = Vec::new();
    for variable in ["ProgramData", "APPDATA"] {
        if let Some(base) = std::env::var_os(variable) {
            roots.push(PathBuf::from(base).join("Microsoft\\Windows\\Start Menu\\Programs"));
        }
    }
    let mut found = Vec::new();
    for root in roots {
        shortcuts(&root, 0, &mut found);
    }
    found
}

#[cfg(target_os = "windows")]
fn shortcuts(folder: &Path, depth: usize, found: &mut Vec<Entry>) {
    let Ok(read) = std::fs::read_dir(folder) else {
        return;
    };
    for item in read.flatten() {
        let path = item.path();
        if path.is_dir() && depth < 4 {
            shortcuts(&path, depth + 1, found);
        } else if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        {
            let Some(name) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            let id = path.to_string_lossy().into_owned();
            found.push(Entry {
                listed: Listed {
                    id: id.clone(),
                    name: name.to_owned(),
                    icon: None,
                },
                argv: vec![id],
            });
        }
    }
}

#[cfg(target_os = "macos")]
fn entries() -> Vec<Entry> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    let mut found = Vec::new();
    for root in roots {
        let Ok(read) = std::fs::read_dir(&root) else {
            continue;
        };
        for item in read.flatten() {
            let path = item.path();
            if path.extension().and_then(|one| one.to_str()) != Some("app") {
                continue;
            }
            let Some(name) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            let id = path.to_string_lossy().into_owned();
            found.push(Entry {
                listed: Listed {
                    id: id.clone(),
                    name: name.to_owned(),
                    icon: None,
                },
                argv: vec!["/usr/bin/open".to_owned(), "-a".to_owned(), id],
            });
        }
    }
    found
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn entries() -> Vec<Entry> {
    Vec::new()
}

/// Whether a program is there to run: a path that is a file, or a name on `PATH`.
pub fn on_path(program: &str) -> bool {
    let named = Path::new(program);
    if named.components().count() > 1 || named.is_absolute() {
        return named.is_file();
    }
    std::env::var_os("PATH").is_some_and(|path| {
        std::env::split_paths(&path).any(|folder| folder.join(program).is_file())
    })
}

/// What the Desktop Entry Specification reads out of one file: the `[Desktop Entry]`
/// group's keys, the plain ones (a translated `Name[de]` is not the name).
pub(crate) mod desktop {
    use std::collections::HashMap;

    pub fn keys(text: &str) -> HashMap<String, String> {
        let mut keys = HashMap::new();
        let mut inside = false;
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') {
                inside = line == "[Desktop Entry]";
                continue;
            }
            if !inside {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                if !key.contains('[') {
                    keys.entry(key.to_owned())
                        .or_insert_with(|| unescape(value.trim()));
                }
            }
        }
        keys
    }

    /// A string value's escapes: `\s`, `\n`, `\t`, `\r` and `\\`.
    fn unescape(value: &str) -> String {
        let mut out = String::with_capacity(value.len());
        let mut chars = value.chars();
        while let Some(one) = chars.next() {
            if one != '\\' {
                out.push(one);
                continue;
            }
            match chars.next() {
                Some('s') => out.push(' '),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => {
                    out.push('\\');
                    if other != '\\' {
                        out.push(other);
                    }
                }
                None => out.push('\\'),
            }
        }
        out
    }

    /// An `Exec` line as the program and its arguments: split where the line is not
    /// quoted, the quoted parts' `\"`, `` \` ``, `\$` and `\\` read as the characters,
    /// and the field codes taken out - nothing is opened with it, so `%f`, `%u` and the
    /// rest stand for nothing, `%c` is the name, `%k` the entry's own file and `%%` a
    /// percent sign. Null for a line that does not close its quotes.
    pub fn exec(line: &str, name: &str, file: &str) -> Option<Vec<String>> {
        let mut words: Vec<(String, bool)> = Vec::new();
        let mut word = String::new();
        let mut quoted = false;
        let mut started = false;
        let mut was_quoted = false;
        let mut chars = line.chars().peekable();
        while let Some(one) = chars.next() {
            match one {
                '"' => {
                    quoted = !quoted;
                    started = true;
                    was_quoted = true;
                }
                '\\' if quoted => match chars.next() {
                    Some(next @ ('"' | '`' | '$' | '\\')) => word.push(next),
                    Some(next) => {
                        word.push('\\');
                        word.push(next);
                    }
                    None => return None,
                },
                ' ' | '\t' if !quoted => {
                    if started {
                        words.push((std::mem::take(&mut word), was_quoted));
                        started = false;
                        was_quoted = false;
                    }
                }
                _ => {
                    word.push(one);
                    started = true;
                }
            }
        }
        if quoted {
            return None;
        }
        if started {
            words.push((word, was_quoted));
        }

        let mut argv = Vec::new();
        for (word, quoted) in words {
            if quoted {
                argv.push(word);
                continue;
            }
            match word.as_str() {
                "%f" | "%F" | "%u" | "%U" | "%d" | "%D" | "%n" | "%N" | "%v" | "%m" | "%i" => {}
                "%c" => argv.push(name.to_owned()),
                "%k" => argv.push(file.to_owned()),
                _ => argv.push(codes(&word, name, file)),
            }
        }
        (!argv.is_empty()).then_some(argv)
    }

    /// The field codes inside a word.
    fn codes(word: &str, name: &str, file: &str) -> String {
        let mut out = String::new();
        let mut chars = word.chars();
        while let Some(one) = chars.next() {
            if one != '%' {
                out.push(one);
                continue;
            }
            match chars.next() {
                Some('%') => out.push('%'),
                Some('c') => out.push_str(name),
                Some('k') => out.push_str(file),
                _ => {}
            }
        }
        out
    }

    /// Whether a boolean key says true.
    pub fn yes(keys: &HashMap<String, String>, key: &str) -> bool {
        keys.get(key).is_some_and(|value| value == "true")
    }
}

#[cfg(any(target_os = "linux", test))]
pub(crate) mod linux {
    use super::{desktop, on_path, Entry, Listed, Path, MOST_ICON_BYTES};
    use std::collections::HashSet;
    use std::path::PathBuf;

    /// A picture file as the data URL the window draws, where it is small enough to send.
    fn icon_url(path: &Path) -> Option<String> {
        use base64::Engine;
        let kind = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "png" => "image/png",
            "svg" => "image/svg+xml",
            _ => return None,
        };
        if std::fs::metadata(path).ok()?.len() > MOST_ICON_BYTES {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        Some(format!(
            "data:{kind};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    /// The XDG data folders, the reader's own first.
    #[cfg(target_os = "linux")]
    pub fn data_dirs() -> Vec<PathBuf> {
        let mut folders = Vec::new();
        match std::env::var_os("XDG_DATA_HOME").filter(|one| !one.is_empty()) {
            Some(home) => folders.push(PathBuf::from(home)),
            None => {
                if let Some(home) = dirs::home_dir() {
                    folders.push(home.join(".local/share"));
                }
            }
        }
        let system = std::env::var("XDG_DATA_DIRS")
            .ok()
            .filter(|one| !one.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".to_owned());
        folders.extend(
            system
                .split(':')
                .filter(|one| !one.is_empty())
                .map(PathBuf::from),
        );
        folders
    }

    /// Every desktop entry in these folders that is an application to offer.
    pub fn entries(folders: &[PathBuf]) -> Vec<Entry> {
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        for folder in folders {
            let root = folder.join("applications");
            let mut files = Vec::new();
            walk(&root, &root, 0, &mut files);
            files.sort();
            for (id, path) in files {
                // The first folder that has an id is the one that counts, shown or not:
                // a hidden copy in the reader's own folder hides the system's.
                if !seen.insert(id.clone()) {
                    continue;
                }
                if let Some(entry) = read(&id, &path, folders) {
                    found.push(entry);
                }
            }
        }
        found
    }

    /// The `.desktop` files under `root`, by their ids: the path below `applications/`
    /// with `/` written as `-`.
    fn walk(root: &Path, folder: &Path, depth: usize, files: &mut Vec<(String, PathBuf)>) {
        let Ok(read) = std::fs::read_dir(folder) else {
            return;
        };
        for item in read.flatten() {
            let path = item.path();
            if path.is_dir() {
                if depth < 4 {
                    walk(root, &path, depth + 1, files);
                }
                continue;
            }
            if path.extension().and_then(|one| one.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(below) = path.strip_prefix(root) else {
                continue;
            };
            let id = below.to_string_lossy().replace(['/', '\\'], "-");
            files.push((id, path));
        }
    }

    fn read(id: &str, path: &Path, folders: &[PathBuf]) -> Option<Entry> {
        let text = std::fs::read_to_string(path).ok()?;
        let keys = desktop::keys(&text);
        if keys.get("Type").map(String::as_str) != Some("Application")
            || desktop::yes(&keys, "Hidden")
            || desktop::yes(&keys, "NoDisplay")
            || desktop::yes(&keys, "Terminal")
        {
            return None;
        }
        if let Some(try_exec) = keys.get("TryExec") {
            if !on_path(try_exec) {
                return None;
            }
        }
        let name = keys.get("Name").filter(|one| !one.is_empty())?.clone();
        let file = path.to_string_lossy();
        let argv = desktop::exec(keys.get("Exec")?, &name, &file)?;
        let icon = keys
            .get("Icon")
            .and_then(|icon| icon_file(icon, folders))
            .and_then(|found| icon_url(&found));
        Some(Entry {
            listed: Listed {
                id: id.to_owned(),
                name,
                icon,
            },
            argv,
        })
    }

    /// The sizes looked in, the ones a chooser draws best first.
    const SIZES: [&str; 6] = ["48x48", "64x64", "32x32", "128x128", "256x256", "scalable"];

    /// An icon's file: a path as it is, or a name in the hicolor theme, then `pixmaps`.
    pub fn icon_file(icon: &str, folders: &[PathBuf]) -> Option<PathBuf> {
        let named = Path::new(icon);
        if named.is_absolute() {
            return named.is_file().then(|| named.to_path_buf());
        }
        for folder in folders {
            for size in SIZES {
                for extension in ["png", "svg"] {
                    let path = folder
                        .join("icons/hicolor")
                        .join(size)
                        .join("apps")
                        .join(format!("{icon}.{extension}"));
                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }
        for folder in folders {
            for extension in ["png", "svg"] {
                let path = folder.join("pixmaps").join(format!("{icon}.{extension}"));
                if path.is_file() {
                    return Some(path);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::desktop::{exec, keys};
    use super::linux;
    use std::path::PathBuf;

    #[test]
    fn reads_the_desktop_entry_group_and_its_plain_keys() {
        let read = keys(
            "# a comment\n[Desktop Entry]\nName=GIMP\nName[de]=GIMP-Bildbearbeitung\nExec=gimp %U\n\
             Comment=Edit\\simages\n[Desktop Action new]\nName=New window\n",
        );
        assert_eq!(read.get("Name").map(String::as_str), Some("GIMP"));
        assert_eq!(read.get("Exec").map(String::as_str), Some("gimp %U"));
        assert_eq!(read.get("Comment").map(String::as_str), Some("Edit images"));
    }

    #[test]
    fn splits_an_exec_line_and_takes_the_field_codes_out() {
        let argv = |line: &str| exec(line, "GIMP", "/x/gimp.desktop");
        assert_eq!(argv("gimp-2.10 %U"), Some(vec!["gimp-2.10".to_owned()]));
        assert_eq!(
            argv(r#""/opt/My App/run" --name=%c --file %k 100%%"#),
            Some(vec![
                "/opt/My App/run".to_owned(),
                "--name=GIMP".to_owned(),
                "--file".to_owned(),
                "/x/gimp.desktop".to_owned(),
                "100%".to_owned(),
            ])
        );
        assert_eq!(
            argv(r#"sh -c "echo \"hi\" \$HOME""#),
            Some(vec![
                "sh".to_owned(),
                "-c".to_owned(),
                r#"echo "hi" $HOME"#.to_owned()
            ])
        );
        assert_eq!(argv(r#"broken "quote"#), None);
        assert_eq!(argv("%f"), None);
    }

    fn folder(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("orden-apps-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("applications/kde")).unwrap();
        root
    }

    #[test]
    fn lists_what_is_shown_with_the_first_folder_winning() {
        let mine = folder("mine");
        let system = folder("system");
        let write = |root: &PathBuf, file: &str, text: &str| {
            std::fs::write(root.join("applications").join(file), text).unwrap();
        };
        let app = |name: &str, extra: &str| {
            format!("[Desktop Entry]\nType=Application\nName={name}\nExec={name} %f\n{extra}")
        };
        write(&system, "gimp.desktop", &app("gimp", "Icon=gimp\n"));
        write(&system, "kde/okular.desktop", &app("okular", ""));
        write(
            &system,
            "hidden.desktop",
            &app("hidden", "NoDisplay=true\n"),
        );
        write(&system, "htop.desktop", &app("htop", "Terminal=true\n"));
        write(
            &system,
            "gone.desktop",
            &app("gone", "TryExec=/no/such/program\n"),
        );
        write(
            &system,
            "link.desktop",
            "[Desktop Entry]\nType=Link\nName=Docs\nURL=x\n",
        );
        write(&mine, "okular.desktop", &app("mine", ""));
        // The reader's own copy hides the system's.
        write(&mine, "kde-okular.desktop", &app("okular", "Hidden=true\n"));
        std::fs::create_dir_all(system.join("icons/hicolor/48x48/apps")).unwrap();
        std::fs::write(system.join("icons/hicolor/48x48/apps/gimp.png"), b"png").unwrap();

        let found = linux::entries(&[mine.clone(), system.clone()]);
        let ids: Vec<&str> = found.iter().map(|one| one.listed.id.as_str()).collect();
        assert_eq!(ids, vec!["okular.desktop", "gimp.desktop"]);
        let gimp = &found[1];
        assert_eq!(gimp.argv, vec!["gimp".to_owned()]);
        assert_eq!(
            gimp.listed.icon.as_deref(),
            Some("data:image/png;base64,cG5n")
        );
        assert_eq!(found[0].listed.icon, None);

        let _ = std::fs::remove_dir_all(mine);
        let _ = std::fs::remove_dir_all(system);
    }
}
