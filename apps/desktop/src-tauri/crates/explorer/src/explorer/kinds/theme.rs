use super::icons;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
    folders.extend(system.split(':').filter(|one| !one.is_empty()).map(PathBuf::from));
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
pub fn current_theme() -> String {
    let config = dirs::config_dir();
    let read = |path: Option<PathBuf>, group: &str, key: &str| {
        let text = std::fs::read_to_string(path?).ok()?;
        groups(&text)
            .into_iter()
            .find(|(name, _)| name == group)
            .and_then(|(_, keys)| keys.get(key).cloned())
            .filter(|one| !one.is_empty())
    };
    let kde = || read(config.as_ref().map(|one| one.join("kdeglobals")), "Icons", "Theme");
    let gnome = || {
        let out = orden_base::printed::output(
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
    let found =
        if on_kde { kde().or_else(gnome).or_else(gtk) } else { gnome().or_else(gtk).or_else(kde) };
    found.unwrap_or_else(|| "hicolor".to_owned())
}
fn groups(text: &str) -> Vec<(String, HashMap<String, String>)> {
    let mut groups: Vec<(String, HashMap<String, String>)> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
            groups.push((name.to_owned(), HashMap::new()));
            continue;
        }
        let Some((_, keys)) = groups.last_mut() else {
            continue;
        };
        if let Some((key, value)) = line.split_once('=') {
            keys.entry(key.trim().to_owned()).or_insert_with(|| value.trim().to_owned());
        }
    }
    groups
}
#[derive(Clone, Debug, PartialEq)]
struct ThemeDir {
    path: String,
    size: u32,
    scalable: bool,
}
pub struct Icons {
    bases: Vec<PathBuf>,
    themes: Vec<(String, Vec<ThemeDir>)>,
}
impl Icons {
    pub fn kinds(folders: &[PathBuf], theme: &str) -> Icons {
        let mut bases: Vec<PathBuf> = Vec::new();
        if let Some(home) = dirs::home_dir() {
            bases.push(home.join(".icons"));
        }
        bases.extend(folders.iter().map(|one| one.join("icons")));
        let mut themes: Vec<(String, Vec<ThemeDir>)> = Vec::new();
        let mut next: Vec<String> = vec!["Adwaita".to_owned(), theme.to_owned()];
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
            let (dirs, inherits) = theme_dirs(&index);
            next.extend(inherits.into_iter().rev());
            themes.push((name, dirs));
        }
        if !themes.iter().any(|(one, _)| one == "hicolor") {
            let index = bases
                .iter()
                .find_map(|base| std::fs::read_to_string(base.join("hicolor/index.theme")).ok());
            let dirs = index.map_or_else(hicolor_fallback, |one| theme_dirs(&one).0);
            themes.push(("hicolor".to_owned(), dirs));
        }
        Icons { bases, themes }
    }
    pub fn find(&self, icon: &str) -> Option<String> {
        for (theme, dirs) in &self.themes {
            for dir in dirs {
                let extensions: &[&str] =
                    if dir.scalable { &["svg", "png"] } else { &["png", "svg"] };
                for base in &self.bases {
                    let folder = base.join(theme).join(&dir.path);
                    for extension in extensions {
                        let path = folder.join(format!("{icon}.{extension}"));
                        if path.is_file() {
                            if let Some(found) = picture(&path) {
                                return Some(found);
                            }
                        }
                    }
                }
            }
        }
        None
    }
}
fn hicolor_fallback() -> Vec<ThemeDir> {
    let mut dirs: Vec<ThemeDir> = [32, 48, 64, 128, 256, 24, 16]
        .iter()
        .map(|&size| ThemeDir { path: format!("{size}x{size}/mimetypes"), size, scalable: false })
        .collect();
    dirs.push(ThemeDir { path: "scalable/mimetypes".to_owned(), size: 0, scalable: true });
    sort_dirs(&mut dirs);
    dirs
}
fn theme_dirs(index: &str) -> (Vec<ThemeDir>, Vec<String>) {
    let groups = groups(index);
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
    let of: HashMap<&str, &HashMap<String, String>> =
        groups.iter().map(|(name, keys)| (name.as_str(), keys)).collect();
    let read = |path: &String| {
        let keys = of.get(path.as_str())?;
        let size: u32 = keys.get("Size")?.parse().ok()?;
        let scale: u32 = keys.get("Scale").and_then(|one| one.parse().ok()).unwrap_or(1);
        let scalable = keys.get("Type").is_some_and(|one| one == "Scalable");
        let kinds =
            keys.get("Context").is_some_and(|one| one == "MimeTypes") || path.contains("mimetypes");
        Some((ThemeDir { path: path.clone(), size: size * scale, scalable }, kinds))
    };
    let all: Vec<(ThemeDir, bool)> = listed.iter().filter_map(read).collect();
    let mut dirs: Vec<ThemeDir> = if all.iter().any(|(_, kinds)| *kinds) {
        all.into_iter().filter(|(_, kinds)| *kinds).map(|(one, _)| one).collect()
    } else {
        all.into_iter().map(|(one, _)| one).collect()
    };
    sort_dirs(&mut dirs);
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
fn sort_dirs(dirs: &mut [ThemeDir]) {
    let side = icons::KIND_SIDE;
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
fn picture(path: &Path) -> Option<String> {
    let kind = path.extension()?.to_str()?.to_ascii_lowercase();
    if std::fs::metadata(path).ok()?.len() > icons::MOST_FILE {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    match kind.as_str() {
        "png" => icons::png_url_within(&bytes, icons::KIND_SIDE),
        "svg" if bytes.len() <= icons::MOST_SVG => Some(icons::data_url("image/svg+xml", &bytes)),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::{icons, Icons};

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
    fn finds_a_kind_s_icon_in_the_readers_theme_the_ones_it_inherits_and_hicolor() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
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
            "[Icon Theme]\nName=Mine\nInherits=Parent\nDirectories=48x48/apps,16x16/mimetypes,scalable/mimetypes,64x64/mimetypes\n\
             [48x48/apps]\nSize=48\nContext=Applications\n[16x16/mimetypes]\nSize=16\nContext=MimeTypes\n\
             [scalable/mimetypes]\nSize=64\nType=Scalable\nContext=MimeTypes\n\
             [64x64/mimetypes]\nSize=64\nContext=MimeTypes\n",
        );
        theme(
            "Parent",
            "[Icon Theme]\nName=Parent\nDirectories=32x32/mimetypes\n[32x32/mimetypes]\nSize=32\nContext=MimeTypes\n",
        );
        let png = tiny_png();
        icon("Mine/48x48/apps/text.png", &png);
        icon("Mine/16x16/mimetypes/both.png", &png);
        icon("Mine/scalable/mimetypes/both.svg", b"<svg/>");
        icon("Mine/64x64/mimetypes/sharp.png", &png);
        icon("Parent/32x32/mimetypes/inherited.png", &png);
        icon("hicolor/48x48/mimetypes/plain.png", &png);
        let kinds = Icons::kinds(&[root.to_path_buf()], "Mine");
        let svg = icons::data_url("image/svg+xml", b"<svg/>");
        let picture = icons::data_url("image/png", &png);
        assert_eq!(kinds.find("both"), Some(svg));
        assert_eq!(kinds.find("sharp").as_deref(), Some(picture.as_str()));
        assert_eq!(kinds.find("inherited").as_deref(), Some(picture.as_str()));
        assert_eq!(kinds.find("plain").as_deref(), Some(picture.as_str()));
        assert_eq!(kinds.find("text"), None);
        assert_eq!(kinds.find("nothing"), None);
    }
}
