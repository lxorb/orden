#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
mod icons;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows", test))]
pub(crate) mod kinds;
#[cfg(any(target_os = "macos", test))]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(all(target_os = "windows", test))]
pub use windows::arguments;

use std::path::Path;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Listed {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub listed: Listed,
    pub argv: Vec<String>,
    pub cwd: Option<String>,
    pub packaged: bool,
}

impl Entry {
    #[cfg(any(target_os = "linux", target_os = "macos", test))]
    fn program(listed: Listed, argv: Vec<String>) -> Entry {
        Entry {
            listed,
            argv,
            cwd: None,
            packaged: false,
        }
    }
}

pub fn installed() -> Vec<Listed> {
    let mut all: Vec<Listed> = entries(true).into_iter().map(|one| one.listed).collect();
    all.sort_by_key(|one| one.name.to_lowercase());
    all
}

pub fn find(id: &str) -> Option<Entry> {
    entries(false).into_iter().find(|one| one.listed.id == id)
}

#[cfg(target_os = "linux")]
fn entries(icons: bool) -> Vec<Entry> {
    let folders = linux::data_dirs();
    let reading = linux::Reading::here(&folders, icons);
    linux::entries(&folders, &reading)
}

#[cfg(target_os = "windows")]
fn entries(icons: bool) -> Vec<Entry> {
    windows::entries(icons)
}

#[cfg(target_os = "macos")]
fn entries(icons: bool) -> Vec<Entry> {
    macos::entries(icons)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn entries(_icons: bool) -> Vec<Entry> {
    Vec::new()
}

pub fn program_of(path: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let named = Path::new(path);
        let bundle = named
            .extension()
            .is_some_and(|one| one.eq_ignore_ascii_case("app"));
        if bundle && named.is_dir() {
            return macos::program(named);
        }
    }
    on_path(path).then(|| path.to_owned())
}

pub fn on_path(program: &str) -> bool {
    which(program).is_some()
}

pub fn which(program: &str) -> Option<std::path::PathBuf> {
    let named = Path::new(program);
    let candidates = |at: std::path::PathBuf| {
        let mut all = vec![at.clone()];
        if cfg!(windows) && at.extension().is_none() {
            all.push(at.with_extension("exe"));
        }
        all
    };
    if named.components().count() > 1 || named.is_absolute() {
        return candidates(named.to_path_buf())
            .into_iter()
            .find(|one| one.is_file());
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|folder| candidates(folder.join(program)))
        .find(|one| one.is_file())
}

#[cfg(any(target_os = "linux", test))]
pub(crate) mod desktop {
    use std::collections::HashMap;

    pub fn keys(text: &str) -> HashMap<String, String> {
        groups(text)
            .into_iter()
            .find(|(name, _)| name == "Desktop Entry")
            .map(|(_, keys)| keys)
            .unwrap_or_default()
    }

    pub fn groups(text: &str) -> Vec<(String, HashMap<String, String>)> {
        let mut groups: Vec<(String, HashMap<String, String>)> = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(name) = line
                .strip_prefix('[')
                .and_then(|rest| rest.strip_suffix(']'))
            {
                groups.push((name.to_owned(), HashMap::new()));
                continue;
            }
            let Some((_, keys)) = groups.last_mut() else {
                continue;
            };
            if let Some((key, value)) = line.split_once('=') {
                keys.entry(key.trim().to_owned())
                    .or_insert_with(|| unescape(value.trim()));
            }
        }
        groups
    }

    pub fn localized<'a>(
        keys: &'a HashMap<String, String>,
        key: &str,
        languages: &[String],
    ) -> Option<&'a String> {
        languages
            .iter()
            .find_map(|one| keys.get(&format!("{key}[{one}]")))
            .or_else(|| keys.get(key))
            .filter(|one| !one.is_empty())
    }

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

    pub fn yes(keys: &HashMap<String, String>, key: &str) -> bool {
        keys.get(key).is_some_and(|value| value == "true")
    }
}

#[cfg(any(target_os = "linux", test))]
pub(crate) mod linux {
    use super::{desktop, icons, on_path, Entry, Listed, Path};
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;

    #[cfg(target_os = "linux")]
    pub fn data_dirs() -> Vec<PathBuf> {
        let mut folders = Vec::new();
        let home = dirs::home_dir();
        match std::env::var_os("XDG_DATA_HOME").filter(|one| !one.is_empty()) {
            Some(own) => folders.push(PathBuf::from(own)),
            None => {
                if let Some(home) = &home {
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
        let mut exports = vec![
            PathBuf::from("/var/lib/flatpak/exports/share"),
            PathBuf::from("/var/lib/snapd/desktop"),
        ];
        if let Some(home) = &home {
            exports.insert(0, home.join(".local/share/flatpak/exports/share"));
        }
        for one in exports {
            if one.is_dir() && !folders.contains(&one) {
                folders.push(one);
            }
        }
        folders
    }

    pub struct Reading {
        pub desktops: Vec<String>,
        pub languages: Vec<String>,
        pub icons: Option<Icons>,
    }

    impl Reading {
        #[cfg(target_os = "linux")]
        pub fn here(folders: &[PathBuf], icons: bool) -> Reading {
            let desktops = std::env::var("XDG_CURRENT_DESKTOP")
                .unwrap_or_default()
                .split(':')
                .filter(|one| !one.is_empty())
                .map(str::to_owned)
                .collect();
            let locale = ["LC_ALL", "LC_MESSAGES", "LANG"]
                .iter()
                .find_map(|one| std::env::var(one).ok().filter(|value| !value.is_empty()))
                .unwrap_or_default();
            Reading {
                desktops,
                languages: languages(&locale),
                icons: icons.then(|| Icons::new(folders, &current_theme())),
            }
        }
    }

    pub fn languages(locale: &str) -> Vec<String> {
        let bare = locale.split(['.', '@']).next().unwrap_or_default();
        if bare.is_empty() || bare == "C" || bare == "POSIX" {
            return Vec::new();
        }
        let mut all = vec![bare.to_owned()];
        if let Some((language, _)) = bare.split_once('_') {
            all.push(language.to_owned());
        }
        all
    }

    #[cfg(target_os = "linux")]
    pub fn current_theme() -> String {
        let config = dirs::config_dir();
        let read = |path: Option<PathBuf>, group: &str, key: &str| {
            let text = std::fs::read_to_string(path?).ok()?;
            desktop::groups(&text)
                .into_iter()
                .find(|(name, _)| name == group)
                .and_then(|(_, keys)| keys.get(key).cloned())
                .filter(|one| !one.is_empty())
        };
        let kde = || {
            read(
                config.as_ref().map(|one| one.join("kdeglobals")),
                "Icons",
                "Theme",
            )
        };
        let gnome = || {
            let out = crate::printed::output(
                std::process::Command::new("gsettings").args([
                    "get",
                    "org.gnome.desktop.interface",
                    "icon-theme",
                ]),
                std::time::Duration::from_secs(3),
            )
            .ok()?;
            let said = String::from_utf8(out.stdout).ok()?;
            let name = said.trim().trim_matches('\'').to_owned();
            (out.status.success() && !name.is_empty()).then_some(name)
        };
        let gtk = || {
            read(
                config.as_ref().map(|one| one.join("gtk-3.0/settings.ini")),
                "Settings",
                "gtk-icon-theme-name",
            )
        };
        let on_kde = std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|one| one.contains("KDE"));
        let found = if on_kde {
            kde().or_else(gnome).or_else(gtk)
        } else {
            gnome().or_else(gtk).or_else(kde)
        };
        found.unwrap_or_else(|| "hicolor".to_owned())
    }

    #[derive(Clone, Debug, PartialEq)]
    struct ThemeDir {
        path: String,
        size: u32,
        scalable: bool,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Context {
        Apps,
        Kinds,
    }

    impl Context {
        fn holds(self, context: &str, path: &str) -> bool {
            match self {
                Context::Apps => {
                    matches!(context, "Applications" | "Apps") || path.contains("apps")
                }
                Context::Kinds => context == "MimeTypes" || path.contains("mimetypes"),
            }
        }

        fn folder(self) -> &'static str {
            match self {
                Context::Apps => "apps",
                Context::Kinds => "mimetypes",
            }
        }
    }

    pub struct Icons {
        bases: Vec<PathBuf>,
        themes: Vec<(String, Vec<ThemeDir>)>,
        pixmaps: Vec<PathBuf>,
        side: u32,
    }

    impl Icons {
        pub fn new(folders: &[PathBuf], theme: &str) -> Icons {
            Icons::within(folders, &[theme], Context::Apps, icons::SIDE)
        }

        pub fn kinds(folders: &[PathBuf], theme: &str) -> Icons {
            Icons::within(
                folders,
                &[theme, "Adwaita"],
                Context::Kinds,
                icons::KIND_SIDE,
            )
        }

        fn within(folders: &[PathBuf], named: &[&str], context: Context, side: u32) -> Icons {
            let mut bases: Vec<PathBuf> = Vec::new();
            if let Some(home) = dirs::home_dir() {
                bases.push(home.join(".icons"));
            }
            bases.extend(folders.iter().map(|one| one.join("icons")));
            let pixmaps = if context == Context::Apps {
                folders.iter().map(|one| one.join("pixmaps")).collect()
            } else {
                Vec::new()
            };
            let mut themes: Vec<(String, Vec<ThemeDir>)> = Vec::new();
            let mut next: Vec<String> = named.iter().rev().map(|one| (*one).to_owned()).collect();
            while let Some(name) = next.pop() {
                if themes.iter().any(|(one, _)| one == &name) || themes.len() > 16 {
                    continue;
                }
                let index = bases
                    .iter()
                    .map(|base| base.join(&name).join("index.theme"))
                    .find_map(|path| std::fs::read_to_string(path).ok());
                let Some(index) = index else {
                    continue;
                };
                let (dirs, inherits) = theme_dirs(&index, context, side);
                next.extend(inherits.into_iter().rev());
                themes.push((name, dirs));
            }
            if !themes.iter().any(|(one, _)| one == "hicolor") {
                let index = bases.iter().find_map(|base| {
                    std::fs::read_to_string(base.join("hicolor/index.theme")).ok()
                });
                let dirs = index.map_or_else(
                    || hicolor_fallback(context, side),
                    |one| theme_dirs(&one, context, side).0,
                );
                themes.push(("hicolor".to_owned(), dirs));
            }
            Icons {
                bases,
                themes,
                pixmaps,
                side,
            }
        }

        pub fn find(&self, icon: &str) -> Option<String> {
            let named = Path::new(icon);
            if named.is_absolute() {
                return picture(named, self.side);
            }
            let name = icon
                .strip_suffix(".png")
                .or_else(|| icon.strip_suffix(".svg"))
                .or_else(|| icon.strip_suffix(".xpm"))
                .unwrap_or(icon);
            for (theme, dirs) in &self.themes {
                for dir in dirs {
                    let extensions: &[&str] = if dir.scalable {
                        &["svg", "png"]
                    } else {
                        &["png", "svg"]
                    };
                    for base in &self.bases {
                        let folder = base.join(theme).join(&dir.path);
                        for extension in extensions {
                            let path = folder.join(format!("{name}.{extension}"));
                            if path.is_file() {
                                if let Some(found) = picture(&path, self.side) {
                                    return Some(found);
                                }
                            }
                        }
                    }
                }
            }
            self.pixmaps.iter().find_map(|folder| {
                ["png", "svg"]
                    .iter()
                    .map(|extension| folder.join(format!("{name}.{extension}")))
                    .find(|path| path.is_file())
                    .and_then(|path| picture(&path, self.side))
            })
        }
    }

    fn hicolor_fallback(context: Context, side: u32) -> Vec<ThemeDir> {
        let folder = context.folder();
        let mut dirs: Vec<ThemeDir> = [32, 48, 64, 128, 256, 24, 16]
            .iter()
            .map(|&size| ThemeDir {
                path: format!("{size}x{size}/{folder}"),
                size,
                scalable: false,
            })
            .collect();
        dirs.push(ThemeDir {
            path: format!("scalable/{folder}"),
            size: 0,
            scalable: true,
        });
        sort_dirs(&mut dirs, side);
        dirs
    }

    fn theme_dirs(index: &str, context: Context, fit: u32) -> (Vec<ThemeDir>, Vec<String>) {
        let groups = desktop::groups(index);
        let head = groups
            .iter()
            .find(|(name, _)| name == "Icon Theme")
            .map(|(_, keys)| keys.clone())
            .unwrap_or_default();
        let listed: Vec<String> = ["Directories", "ScaledDirectories"]
            .iter()
            .filter_map(|key| head.get(*key))
            .flat_map(|one| one.split(','))
            .map(|one| one.trim().to_owned())
            .filter(|one| !one.is_empty())
            .collect();
        let of: HashMap<&str, &HashMap<String, String>> = groups
            .iter()
            .map(|(name, keys)| (name.as_str(), keys))
            .collect();
        let read = |path: &String| {
            let keys = of.get(path.as_str())?;
            let size: u32 = keys.get("Size")?.parse().ok()?;
            let scale: u32 = keys
                .get("Scale")
                .and_then(|one| one.parse().ok())
                .unwrap_or(1);
            let scalable = keys.get("Type").is_some_and(|one| one == "Scalable");
            let named = keys.get("Context").map(String::as_str).unwrap_or_default();
            let apps = context.holds(named, path);
            Some((
                ThemeDir {
                    path: path.clone(),
                    size: size * scale,
                    scalable,
                },
                apps,
            ))
        };
        let all: Vec<(ThemeDir, bool)> = listed.iter().filter_map(read).collect();
        let mut dirs: Vec<ThemeDir> = if all.iter().any(|(_, apps)| *apps) {
            all.into_iter()
                .filter(|(_, apps)| *apps)
                .map(|(one, _)| one)
                .collect()
        } else {
            all.into_iter().map(|(one, _)| one).collect()
        };
        sort_dirs(&mut dirs, fit);
        let inherits = head
            .get("Inherits")
            .map(|one| {
                one.split(',')
                    .map(|name| name.trim().to_owned())
                    .filter(|name| !name.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        (dirs, inherits)
    }

    fn sort_dirs(dirs: &mut [ThemeDir], side: u32) {
        dirs.sort_by_key(|one| {
            if one.scalable {
                (1, 0)
            } else if one.size >= side {
                (0, one.size - side)
            } else {
                (2, side - one.size)
            }
        });
    }

    fn picture(path: &Path, side: u32) -> Option<String> {
        let kind = path.extension()?.to_str()?.to_ascii_lowercase();
        if std::fs::metadata(path).ok()?.len() > icons::MOST_FILE {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        match kind.as_str() {
            "png" => icons::png_url_within(&bytes, side),
            "svg" if bytes.len() <= icons::MOST_SVG => {
                Some(icons::data_url("image/svg+xml", &bytes))
            }
            _ => None,
        }
    }

    pub fn entries(folders: &[PathBuf], reading: &Reading) -> Vec<Entry> {
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        for folder in folders {
            let root = folder.join("applications");
            let mut files = Vec::new();
            walk(&root, &root, 0, &mut files);
            files.sort();
            for (id, path) in files {
                if !seen.insert(id.clone()) {
                    continue;
                }
                if let Some(entry) = read(&id, &path, reading) {
                    found.push(entry);
                }
            }
        }
        found
    }

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

    fn shown_here(keys: &HashMap<String, String>, desktops: &[String]) -> bool {
        let names = |key: &str| -> Vec<String> {
            keys.get(key)
                .map(|one| {
                    one.split(';')
                        .filter(|name| !name.is_empty())
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default()
        };
        let only = names("OnlyShowIn");
        if keys.contains_key("OnlyShowIn") && !only.iter().any(|one| desktops.contains(one)) {
            return false;
        }
        !names("NotShowIn").iter().any(|one| desktops.contains(one))
    }

    fn read(id: &str, path: &Path, reading: &Reading) -> Option<Entry> {
        let text = std::fs::read_to_string(path).ok()?;
        let keys = desktop::keys(&text);
        if keys.get("Type").map(String::as_str) != Some("Application")
            || desktop::yes(&keys, "Hidden")
            || desktop::yes(&keys, "NoDisplay")
            || desktop::yes(&keys, "Terminal")
            || !shown_here(&keys, &reading.desktops)
        {
            return None;
        }
        if let Some(try_exec) = keys.get("TryExec") {
            if !on_path(try_exec) {
                return None;
            }
        }
        let plain = keys.get("Name").filter(|one| !one.is_empty())?;
        let name = desktop::localized(&keys, "Name", &reading.languages).unwrap_or(plain);
        let file = path.to_string_lossy();
        let argv = desktop::exec(keys.get("Exec")?, name, &file)?;
        let icon = reading
            .icons
            .as_ref()
            .zip(keys.get("Icon").filter(|one| !one.is_empty()))
            .and_then(|(icons, icon)| icons.find(icon));
        Some(Entry::program(
            Listed {
                id: id.to_owned(),
                name: name.clone(),
                icon,
            },
            argv,
        ))
    }

    #[cfg(test)]
    pub(super) fn dirs_of(index: &str) -> (Vec<(String, u32, bool)>, Vec<String>) {
        let (dirs, inherits) = theme_dirs(index, Context::Apps, icons::SIDE);
        (
            dirs.into_iter()
                .map(|one| (one.path, one.size, one.scalable))
                .collect(),
            inherits,
        )
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

    fn tiny_png() -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[1, 2, 3, 255]).unwrap();
        writer.finish().unwrap();
        out
    }

    #[test]
    fn reads_the_readers_languages_off_the_locale() {
        assert_eq!(linux::languages("de_CH.UTF-8@euro"), vec!["de_CH", "de"]);
        assert_eq!(linux::languages("fr"), vec!["fr"]);
        assert!(linux::languages("C.UTF-8").is_empty());
        assert!(linux::languages("").is_empty());
    }

    #[test]
    fn finds_an_icon_in_the_readers_theme_the_ones_it_inherits_and_hicolor() {
        let root = folder("themes");
        let theme = |name: &str, index: &str| {
            std::fs::create_dir_all(root.join("icons").join(name)).unwrap();
            std::fs::write(root.join("icons").join(name).join("index.theme"), index).unwrap();
        };
        let icon = |path: &str, bytes: &[u8]| {
            let file = root.join("icons").join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, bytes).unwrap();
        };
        theme(
            "Mine",
            "[Icon Theme]\nName=Mine\nInherits=Parent\nDirectories=16x16/apps,48x48/apps,scalable/apps,48x48/mimetypes\n\
             [16x16/apps]\nSize=16\nContext=Applications\n[48x48/apps]\nSize=48\nContext=Applications\n\
             [scalable/apps]\nSize=48\nType=Scalable\nContext=Applications\n\
             [48x48/mimetypes]\nSize=48\nContext=MimeTypes\n",
        );
        theme(
            "Parent",
            "[Icon Theme]\nName=Parent\nDirectories=32x32/apps\n[32x32/apps]\nSize=32\nContext=Applications\n",
        );
        let (dirs, inherits) =
            linux::dirs_of(&std::fs::read_to_string(root.join("icons/Mine/index.theme")).unwrap());
        assert_eq!(inherits, vec!["Parent"]);
        assert_eq!(
            dirs,
            vec![
                ("48x48/apps".to_owned(), 48, false),
                ("scalable/apps".to_owned(), 48, true),
                ("16x16/apps".to_owned(), 16, false),
            ]
        );

        let png = tiny_png();
        icon("Mine/16x16/apps/both.png", &png);
        icon("Mine/scalable/apps/both.svg", b"<svg/>");
        icon("Mine/16x16/apps/small.png", &png);
        icon("Parent/32x32/apps/inherited.png", &png);
        icon("hicolor/48x48/apps/plain.png", &png);
        icon("Mine/48x48/mimetypes/text.png", &png);
        let icons = linux::Icons::new(std::slice::from_ref(&root), "Mine");
        let svg = super::icons::data_url("image/svg+xml", b"<svg/>");
        let picture = super::icons::data_url("image/png", &png);
        assert_eq!(icons.find("both"), Some(svg));
        assert_eq!(icons.find("small").as_deref(), Some(picture.as_str()));
        assert_eq!(
            icons.find("inherited.png").as_deref(),
            Some(picture.as_str())
        );
        assert_eq!(icons.find("plain").as_deref(), Some(picture.as_str()));
        assert_eq!(icons.find("text"), None);
        assert_eq!(icons.find("nothing"), None);
        let kinds = linux::Icons::kinds(std::slice::from_ref(&root), "Mine");
        assert_eq!(kinds.find("text").as_deref(), Some(picture.as_str()));
        assert_eq!(kinds.find("both"), None);
        let _ = std::fs::remove_dir_all(root);
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
        write(
            &system,
            "gimp.desktop",
            &app("gimp", "Icon=gimp\nName[de]=GIMP-Bildbearbeitung\n"),
        );
        write(&system, "kcalc.desktop", &app("kcalc", "OnlyShowIn=KDE;\n"));
        write(
            &system,
            "gedit.desktop",
            &app("gedit", "NotShowIn=KDE;GNOME;\n"),
        );
        write(
            &system,
            "files.desktop",
            &app("files", "OnlyShowIn=X-Cinnamon;GNOME;\n"),
        );
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
        write(&mine, "kde-okular.desktop", &app("okular", "Hidden=true\n"));
        std::fs::create_dir_all(system.join("icons/hicolor/48x48/apps")).unwrap();
        std::fs::write(system.join("icons/hicolor/48x48/apps/gimp.png"), tiny_png()).unwrap();

        let folders = [mine.clone(), system.clone()];
        let reading = linux::Reading {
            desktops: vec!["GNOME".to_owned()],
            languages: linux::languages("de_CH.UTF-8"),
            icons: Some(linux::Icons::new(&folders, "hicolor")),
        };
        let found = linux::entries(&folders, &reading);
        let ids: Vec<&str> = found.iter().map(|one| one.listed.id.as_str()).collect();
        assert_eq!(ids, vec!["okular.desktop", "files.desktop", "gimp.desktop"]);
        let gimp = &found[2];
        assert_eq!(gimp.argv, vec!["gimp".to_owned()]);
        assert_eq!(gimp.listed.name, "GIMP-Bildbearbeitung");
        assert_eq!(
            gimp.listed.icon.as_deref(),
            Some(super::icons::data_url("image/png", &tiny_png()).as_str())
        );
        assert_eq!(found[0].listed.icon, None);

        let _ = std::fs::remove_dir_all(mine);
        let _ = std::fs::remove_dir_all(system);
    }
}
