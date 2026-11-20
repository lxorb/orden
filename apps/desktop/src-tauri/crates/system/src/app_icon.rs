use orden_base::Held as _;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use base64::Engine as _;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Source {
    pub path: Option<PathBuf>,
    pub class: Option<String>,
}
const MOST_KNOWN: usize = 256;
const SIDE: u32 = 64;
static SOURCES: LazyLock<Mutex<HashMap<String, Source>>> = LazyLock::new(Mutex::default);
static DRAWN: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Mutex::default);
pub fn seen(app: &str, source: Source) {
    let mut known = SOURCES.held();
    if known.get(app) == Some(&source) {
        return;
    }
    if known.len() >= MOST_KNOWN {
        known.clear();
    }
    known.insert(app.to_owned(), source);
    drop(known);
    DRAWN.held().remove(app);
}
#[tauri::command]
pub async fn app_icon(app: String) -> Option<String> {
    orden_base::lane::off_the_runtime(move || icon(&app)).await
}
fn icon(app: &str) -> Option<String> {
    if let Some(drawn) = DRAWN.held().get(app) {
        return drawn.clone();
    }
    let seen = SOURCES.held().get(app).cloned();
    let drawn = seen.or_else(|| platform::find(app)).and_then(|mut source| {
        source.path = source.path.map(resolved);
        platform::drawn(&source)
    });
    let mut cache = DRAWN.held();
    if cache.len() >= MOST_KNOWN {
        cache.clear();
    }
    cache.insert(app.to_owned(), drawn.clone());
    drawn
}
fn resolved(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).map_or(path, plain)
}
fn plain(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|one| one.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}
fn data_url(kind: &str, bytes: &[u8]) -> String {
    format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}
#[cfg(any(target_os = "linux", test))]
mod freedesktop {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    use super::{data_url, Source, SIDE};

    const MOST_PNG: u64 = 1024 * 1024;
    const MOST_SVG: u64 = 256 * 1024;
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Entry {
        stem: String,
        class: Option<String>,
        exec: Option<String>,
        icon: String,
    }
    fn groups(text: &str) -> Vec<(String, HashMap<String, String>)> {
        let mut groups: Vec<(String, HashMap<String, String>)> = Vec::new();
        for line in text.lines().map(str::trim) {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(name) = line.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
                groups.push((name.to_owned(), HashMap::new()));
            } else if let (Some((_, keys)), Some((key, value))) =
                (groups.last_mut(), line.split_once('='))
            {
                keys.entry(key.trim().to_owned()).or_insert_with(|| value.trim().to_owned());
            }
        }
        groups
    }
    fn entry(stem: &str, text: &str) -> Option<Entry> {
        let (_, keys) = groups(text).into_iter().find(|(name, _)| name == "Desktop Entry")?;
        let icon = keys.get("Icon").filter(|one| !one.is_empty())?.clone();
        let exec = keys.get("Exec").and_then(|line| {
            line.split_whitespace()
                .map(|one| one.trim_matches(['"', '\'']))
                .find(|one| *one != "env" && !one.contains('='))
                .and_then(|one| Path::new(one).file_name()?.to_str().map(str::to_lowercase))
        });
        Some(Entry {
            stem: stem.to_lowercase(),
            class: keys.get("StartupWMClass").map(|one| one.to_lowercase()),
            exec,
            icon,
        })
    }
    pub fn entries(folders: &[PathBuf]) -> Vec<Entry> {
        let mut found = Vec::new();
        let mut walk: Vec<(PathBuf, u8)> =
            folders.iter().rev().map(|one| (one.join("applications"), 0)).collect();
        while let Some((folder, depth)) = walk.pop() {
            let Ok(listed) = std::fs::read_dir(&folder) else {
                continue;
            };
            for one in listed.flatten() {
                let path = one.path();
                if path.is_dir() && depth < 2 {
                    walk.push((path, depth + 1));
                } else if path.extension().is_some_and(|ending| ending == "desktop") {
                    let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or_default();
                    if let Some(read) =
                        std::fs::read_to_string(&path).ok().and_then(|text| entry(stem, &text))
                    {
                        found.push(read);
                    }
                }
            }
        }
        found
    }
    pub fn chosen<'a>(entries: &'a [Entry], source: &Source) -> Option<&'a Entry> {
        let class = source.class.as_deref().map(str::to_lowercase);
        let exe = source
            .path
            .as_deref()
            .and_then(|path| path.file_name()?.to_str().map(str::to_lowercase));
        let rank = |entry: &Entry| -> Option<u8> {
            let class = class.as_deref();
            if class.is_some() && entry.class.as_deref() == class {
                return Some(0);
            }
            if let Some(class) = class {
                if entry.stem == class || entry.stem.ends_with(&format!(".{class}")) {
                    return Some(1);
                }
            }
            if exe.is_some() && entry.exec == exe {
                return Some(2);
            }
            (class.is_some() && entry.exec.as_deref() == class).then_some(3)
        };
        entries
            .iter()
            .filter_map(|one| Some((rank(one)?, one)))
            .min_by_key(|(rank, _)| *rank)
            .map(|(_, one)| one)
    }
    pub fn names(entry: Option<&Entry>, source: &Source) -> Vec<String> {
        let mut names: Vec<String> = entry.map(|one| one.icon.clone()).into_iter().collect();
        names.extend(source.class.iter().flat_map(|one| [one.clone(), one.to_lowercase()]));
        names.extend(
            source.path.as_deref().and_then(|path| path.file_name()?.to_str().map(str::to_owned)),
        );
        names.dedup();
        names
    }
    #[derive(Clone, Debug, PartialEq, Eq)]
    struct Dir {
        path: String,
        size: u32,
        scalable: bool,
    }
    pub struct Themes {
        bases: Vec<PathBuf>,
        chain: Vec<(String, Vec<Dir>)>,
        pixmaps: Vec<PathBuf>,
    }
    impl Themes {
        pub fn read(folders: &[PathBuf], home: Option<&Path>, theme: &str) -> Themes {
            let mut bases: Vec<PathBuf> = home.map(|one| one.join(".icons")).into_iter().collect();
            bases.extend(folders.iter().map(|one| one.join("icons")));
            let mut themes: Vec<(String, Vec<Dir>)> = Vec::new();
            let mut next = vec![theme.to_owned()];
            while let Some(name) = next.pop() {
                if name == "hicolor"
                    || themes.iter().any(|(one, _)| *one == name)
                    || themes.len() > 16
                {
                    continue;
                }
                let Some(index) = bases.iter().find_map(|base| {
                    std::fs::read_to_string(base.join(&name).join("index.theme")).ok()
                }) else {
                    continue;
                };
                let (dirs, inherits) = dirs_of(&index);
                next.extend(inherits.into_iter().rev());
                themes.push((name, dirs));
            }
            let hicolor = bases
                .iter()
                .find_map(|base| std::fs::read_to_string(base.join("hicolor/index.theme")).ok())
                .map_or_else(hicolor, |index| dirs_of(&index).0);
            themes.push(("hicolor".to_owned(), hicolor));
            let pixmaps = folders.iter().map(|one| one.join("pixmaps")).collect();
            Themes { bases, chain: themes, pixmaps }
        }
        pub fn find(&self, icon: &str) -> Option<String> {
            let path = Path::new(icon);
            if path.is_absolute() {
                return picture(path);
            }
            let icon =
                icon.strip_suffix(".png").or_else(|| icon.strip_suffix(".svg")).unwrap_or(icon);
            if icon.is_empty() || icon.contains('/') {
                return None;
            }
            let themed = self.chain.iter().flat_map(|(theme, dirs)| {
                dirs.iter().flat_map(move |dir| {
                    let endings: &[&str] =
                        if dir.scalable { &["svg", "png"] } else { &["png", "svg"] };
                    self.bases.iter().flat_map(move |base| {
                        endings.iter().map(move |ending| {
                            base.join(theme).join(&dir.path).join(format!("{icon}.{ending}"))
                        })
                    })
                })
            });
            let loose = self.pixmaps.iter().flat_map(|folder| {
                ["png", "svg"].map(|ending| folder.join(format!("{icon}.{ending}")))
            });
            themed.chain(loose).filter(|one| one.is_file()).find_map(|one| picture(&one))
        }
    }
    fn hicolor() -> Vec<Dir> {
        let mut dirs: Vec<Dir> = [64, 48, 96, 128, 256, 32, 24, 16]
            .iter()
            .map(|&size| Dir { path: format!("{size}x{size}/apps"), size, scalable: false })
            .collect();
        dirs.push(Dir { path: "scalable/apps".to_owned(), size: 0, scalable: true });
        sort(&mut dirs);
        dirs
    }
    fn dirs_of(index: &str) -> (Vec<Dir>, Vec<String>) {
        let groups = groups(index);
        let head = groups
            .iter()
            .find(|(name, _)| name == "Icon Theme")
            .map(|(_, keys)| keys.clone())
            .unwrap_or_default();
        let of: HashMap<&str, &HashMap<String, String>> =
            groups.iter().map(|(name, keys)| (name.as_str(), keys)).collect();
        let mut dirs: Vec<Dir> = ["Directories", "ScaledDirectories"]
            .iter()
            .filter_map(|key| head.get(*key))
            .flat_map(|one| one.split(','))
            .map(str::trim)
            .filter_map(|path| {
                let keys = of.get(path)?;
                let apps = keys.get("Context").is_some_and(|one| one == "Applications")
                    || path.split('/').any(|part| part == "apps");
                let size: u32 = keys.get("Size")?.parse().ok()?;
                let scale: u32 = keys.get("Scale").and_then(|one| one.parse().ok()).unwrap_or(1);
                let scalable = keys.get("Type").is_some_and(|one| one == "Scalable");
                apps.then(|| Dir { path: path.to_owned(), size: size * scale, scalable })
            })
            .collect();
        sort(&mut dirs);
        let inherits = head
            .get("Inherits")
            .map(|one| {
                one.split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        (dirs, inherits)
    }
    fn sort(dirs: &mut [Dir]) {
        dirs.sort_by_key(|one| {
            if one.scalable {
                (1, 0)
            } else if one.size >= SIDE {
                (0, one.size - SIDE)
            } else {
                (2, SIDE - one.size)
            }
        });
    }
    fn picture(path: &Path) -> Option<String> {
        let ending = path.extension()?.to_str()?.to_ascii_lowercase();
        let size = std::fs::metadata(path).ok()?.len();
        let kind = match ending.as_str() {
            "png" if size <= MOST_PNG => "image/png",
            "svg" if size <= MOST_SVG => "image/svg+xml",
            _ => return None,
        };
        Some(data_url(kind, &std::fs::read(path).ok()?))
    }
}
#[cfg(target_os = "linux")]
mod platform {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use super::freedesktop::{chosen, entries, names, Entry, Themes};
    use super::Source;

    fn data_dirs() -> Vec<PathBuf> {
        let home = dirs::home_dir();
        let mut folders: Vec<PathBuf> =
            match std::env::var_os("XDG_DATA_HOME").filter(|one| !one.is_empty()) {
                Some(own) => vec![PathBuf::from(own)],
                None => home.iter().map(|one| one.join(".local/share")).collect(),
            };
        let system = std::env::var("XDG_DATA_DIRS")
            .ok()
            .filter(|one| !one.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".to_owned());
        folders.extend(system.split(':').filter(|one| !one.is_empty()).map(PathBuf::from));
        let exports = home
            .iter()
            .map(|one| one.join(".local/share/flatpak/exports/share"))
            .chain(["/var/lib/flatpak/exports/share", "/var/lib/snapd/desktop"].map(PathBuf::from));
        for one in exports {
            if one.is_dir() && !folders.contains(&one) {
                folders.push(one);
            }
        }
        folders
    }
    fn theme() -> String {
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
            let name = String::from_utf8(out.stdout).ok()?.trim().trim_matches('\'').to_owned();
            (out.status.success() && !name.is_empty()).then_some(name)
        };
        let keyed = |file: &str, key: &str| {
            let text = std::fs::read_to_string(dirs::config_dir()?.join(file)).ok()?;
            text.lines()
                .find_map(|line| line.trim().strip_prefix(key)?.trim().strip_prefix('='))
                .map(|one| one.trim().to_owned())
                .filter(|one| !one.is_empty())
        };
        gnome()
            .or_else(|| keyed("gtk-4.0/settings.ini", "gtk-icon-theme-name"))
            .or_else(|| keyed("gtk-3.0/settings.ini", "gtk-icon-theme-name"))
            .or_else(|| keyed("kdeglobals", "Theme"))
            .unwrap_or_else(|| "hicolor".to_owned())
    }
    #[allow(clippy::unnecessary_wraps)]
    pub fn find(app: &str) -> Option<Source> {
        Some(Source { path: None, class: Some(app.to_owned()) })
    }
    pub fn drawn(source: &Source) -> Option<String> {
        static KNOWN: OnceLock<(Vec<Entry>, Themes)> = OnceLock::new();
        let (listed, themes) = KNOWN.get_or_init(|| {
            let folders = data_dirs();
            (entries(&folders), Themes::read(&folders, dirs::home_dir().as_deref(), &theme()))
        });
        names(chosen(listed, source), source).iter().find_map(|name| themes.find(name))
    }
}
#[cfg(windows)]
mod platform {
    use windows::core::HSTRING;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
    };
    use windows::Win32::UI::Shell::SHDefExtractIconW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    use super::{data_url, Source, SIDE};

    #[allow(unsafe_code)]
    fn pixels(bitmap: HBITMAP) -> Option<(Vec<u8>, u32, u32)> {
        let mut about = BITMAP::default();
        let size = i32::try_from(std::mem::size_of::<BITMAP>()).ok()?;
        if unsafe { GetObjectW(bitmap, size, Some((&raw mut about).cast())) } == 0 {
            return None;
        }
        let (width, height) = (about.bmWidth, about.bmHeight.abs());
        if width <= 0 || height <= 0 || width > 512 || height > 512 {
            return None;
        }
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).ok()?,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0_u8; usize::try_from(width * height * 4).ok()?];
        let lines = unsafe {
            let screen = GetDC(None);
            let lines = GetDIBits(
                screen,
                bitmap,
                0,
                u32::try_from(height).ok()?,
                Some(bgra.as_mut_ptr().cast()),
                &raw mut info,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, screen);
            lines
        };
        if lines == 0 {
            return None;
        }
        Some((bgra, u32::try_from(width).ok()?, u32::try_from(height).ok()?))
    }
    #[allow(unsafe_code)]
    fn rgba(icon: HICON) -> Option<(Vec<u8>, u32, u32)> {
        let mut info = ICONINFO::default();
        unsafe { GetIconInfo(icon, &raw mut info) }.ok()?;
        let color = (!info.hbmColor.is_invalid()).then(|| pixels(info.hbmColor)).flatten();
        let mask = (!info.hbmMask.is_invalid()).then(|| pixels(info.hbmMask)).flatten();
        unsafe {
            let _ = DeleteObject(info.hbmColor);
            let _ = DeleteObject(info.hbmMask);
        }
        let (bgra, width, height) = color?;
        let holes = mask.filter(|(_, w, h)| (*w, *h) == (width, height)).map(|(one, _, _)| one);
        Some((super::straight(&bgra, holes.as_deref()), width, height))
    }
    pub fn find(app: &str) -> Option<Source> {
        crate::win_apps::find(app)
    }
    #[allow(unsafe_code)]
    pub fn drawn(source: &Source) -> Option<String> {
        let file = source.path.as_deref()?;
        if file.extension().is_some_and(|ending| ending.eq_ignore_ascii_case("png")) {
            let size = std::fs::metadata(file).ok()?.len();
            return (size <= 1024 * 1024)
                .then(|| std::fs::read(file).ok())
                .flatten()
                .map(|bytes| data_url("image/png", &bytes));
        }
        let path = HSTRING::from(file.as_os_str());
        let mut icon = HICON::default();
        unsafe { SHDefExtractIconW(&path, 0, 0, Some(&raw mut icon), None, SIDE) }.ok().ok()?;
        if icon.is_invalid() {
            return None;
        }
        let read = rgba(icon);
        unsafe {
            let _ = DestroyIcon(icon);
        }
        let (rgba, width, height) = read?;
        Some(data_url("image/png", &super::png_of(&rgba, width, height)?))
    }
}
#[cfg(any(windows, test))]
fn straight(bgra: &[u8], holes: Option<&[u8]>) -> Vec<u8> {
    let pixels = bgra.as_chunks::<4>().0;
    let no_alpha = pixels.iter().all(|one| one[3] == 0);
    let premultiplied =
        !no_alpha && pixels.iter().all(|one| one[0].max(one[1]).max(one[2]) <= one[3]);
    let holes = holes.filter(|one| one.len() == bgra.len()).map(|one| one.as_chunks::<4>().0);
    let mut out = Vec::with_capacity(bgra.len());
    for (at, &[blue, green, red, alpha]) in pixels.iter().enumerate() {
        if no_alpha {
            let hole = holes.is_some_and(|one| one[at][0] > 127);
            out.extend_from_slice(&if hole { [0, 0, 0, 0] } else { [red, green, blue, u8::MAX] });
        } else if premultiplied && alpha > 0 && alpha < u8::MAX {
            let lift =
                |one: u8| u8::try_from(u32::from(one) * 255 / u32::from(alpha)).unwrap_or(u8::MAX);
            out.extend_from_slice(&[lift(red), lift(green), lift(blue), alpha]);
        } else {
            out.extend_from_slice(&[red, green, blue, alpha]);
        }
    }
    out
}
#[cfg(windows)]
fn png_of(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(rgba).ok()?;
    writer.finish().ok()?;
    Some(out)
}
#[cfg(target_os = "macos")]
mod platform {
    use objc2::AllocAnyThread as _;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace,
        NSGraphicsContext, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    use super::{data_url, Source, SIDE};

    #[allow(deprecated)]
    pub fn find(app: &str) -> Option<Source> {
        let workspace = NSWorkspace::sharedWorkspace();
        let running = workspace.runningApplications().iter().find_map(|one| {
            (one.localizedName()?.to_string() == app).then(|| one.bundleURL()?.path()).flatten()
        });
        let path = running
            .map(|path| std::path::PathBuf::from(path.to_string()))
            .or_else(|| {
                let found = workspace.fullPathForApplication(&NSString::from_str(app))?;
                Some(std::path::PathBuf::from(found.to_string()))
            })
            .or_else(|| {
                let home = dirs::home_dir().map(|one| one.join("Applications"));
                ["/Applications", "/System/Applications", "/System/Applications/Utilities"]
                    .into_iter()
                    .map(std::path::PathBuf::from)
                    .chain(home)
                    .map(|folder| folder.join(format!("{app}.app")))
                    .find(|one| one.is_dir())
            })?;
        Some(Source { path: Some(path), class: None })
    }
    #[allow(unsafe_code)]
    pub fn drawn(source: &Source) -> Option<String> {
        let path = NSString::from_str(source.path.as_deref()?.to_str()?);
        let image = NSWorkspace::sharedWorkspace().iconForFile(&path);
        let pixels = isize::try_from(SIDE).ok()?;
        let bitmap = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                std::ptr::null_mut(),
                pixels,
                pixels,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                pixels * 4,
                32,
            )
        }?;
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap)?;
        let side = f64::from(SIDE);
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        image.drawInRect_fromRect_operation_fraction(
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side, side)),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0)),
            NSCompositingOperation::SourceOver,
            1.0,
        );
        context.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        let data = unsafe {
            bitmap.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }?;
        let bytes = data.to_vec();
        (!bytes.is_empty()).then(|| data_url("image/png", &bytes))
    }
}
#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
mod platform {
    use super::Source;

    pub fn find(_app: &str) -> Option<Source> {
        None
    }
    pub fn drawn(_source: &Source) -> Option<String> {
        None
    }
}
#[cfg(test)]
mod tests {
    use super::freedesktop::{chosen, entries, names, Themes};
    use super::{data_url, plain, resolved, straight, Source};
    use std::path::{Path, PathBuf};

    fn put(root: &Path, path: &str, bytes: &[u8]) {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().expect("a folder")).expect("folders");
        std::fs::write(file, bytes).expect("a file");
    }
    fn source(class: Option<&str>, exe: Option<&str>) -> Source {
        Source { class: class.map(str::to_owned), path: exe.map(PathBuf::from) }
    }
    #[test]
    fn an_app_is_found_by_its_window_class_its_file_name_or_what_it_runs() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        put(
            root,
            "applications/firefox.desktop",
            b"[Desktop Entry]\nName=Firefox\nExec=firefox %u\nIcon=firefox\n",
        );
        put(
            root,
            "applications/code.desktop",
            b"[Desktop Entry]\nExec=/usr/share/code/code --unity-launch %F\nIcon=vscode\nStartupWMClass=Code\n[Desktop Action new]\nIcon=other\n",
        );
        put(
            root,
            "applications/org.gnome.Nautilus.desktop",
            b"[Desktop Entry]\nExec=nautilus\nIcon=org.gnome.Nautilus\n",
        );
        put(
            root,
            "applications/kde/term.desktop",
            b"[Desktop Entry]\nExec=env A=1 \"/opt/Term/term\"\nIcon=/opt/term.png\n",
        );
        put(root, "applications/plain.desktop", b"[Desktop Entry]\nExec=plain\n");
        let listed = entries(&[root.to_path_buf()]);
        assert_eq!(listed.len(), 4);
        let icon = |class: Option<&str>, exe: Option<&str>| {
            let source = source(class, exe);
            names(chosen(&listed, &source), &source).into_iter().next()
        };
        assert_eq!(icon(Some("Code"), Some("/usr/share/code/code")).as_deref(), Some("vscode"));
        assert_eq!(icon(Some("firefox"), None).as_deref(), Some("firefox"));
        assert_eq!(icon(Some("Nautilus"), None).as_deref(), Some("org.gnome.Nautilus"));
        assert_eq!(
            icon(Some("term-window"), Some("/opt/Term/term")).as_deref(),
            Some("/opt/term.png")
        );
        assert_eq!(icon(Some("Unknown"), None).as_deref(), Some("Unknown"));
        assert_eq!(icon(None, None), None);
    }
    #[test]
    fn an_icon_is_read_from_the_theme_its_parents_hicolor_and_pixmaps_nearest_to_its_size() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        put(
            root,
            "icons/Mine/index.theme",
            b"[Icon Theme]\nInherits=Parent\nDirectories=16x16/apps,256x256/apps,64x64/apps,48x48/mimetypes,scalable/apps\n\
              [16x16/apps]\nSize=16\nContext=Applications\n[256x256/apps]\nSize=256\nContext=Applications\n\
              [64x64/apps]\nSize=64\nContext=Applications\n[48x48/mimetypes]\nSize=48\nContext=MimeTypes\n\
              [scalable/apps]\nSize=64\nType=Scalable\nContext=Applications\n",
        );
        put(
            root,
            "icons/Parent/index.theme",
            b"[Icon Theme]\nDirectories=apps/48\n[apps/48]\nSize=48\nContext=Applications\n",
        );
        put(root, "icons/Mine/16x16/apps/sized.png", b"small");
        put(root, "icons/Mine/64x64/apps/sized.png", b"right");
        put(root, "icons/Mine/256x256/apps/sized.png", b"large");
        put(root, "icons/Mine/scalable/apps/drawn.svg", b"<svg/>");
        put(root, "icons/Mine/48x48/mimetypes/kind.png", b"kind");
        put(root, "icons/Parent/apps/48/inherited.svg", b"<svg id='p'/>");
        put(root, "icons/hicolor/48x48/apps/plain.png", b"plain");
        put(root, "pixmaps/loose.png", b"loose");
        put(root, "elsewhere/whole.png", b"whole");
        let themes = Themes::read(&[root.to_path_buf()], None, "Mine");
        let png = |bytes: &[u8]| Some(data_url("image/png", bytes));
        assert_eq!(themes.find("sized"), png(b"right"));
        assert_eq!(themes.find("drawn.svg"), Some(data_url("image/svg+xml", b"<svg/>")));
        assert_eq!(themes.find("inherited"), Some(data_url("image/svg+xml", b"<svg id='p'/>")));
        assert_eq!(themes.find("plain"), png(b"plain"));
        assert_eq!(themes.find("loose"), png(b"loose"));
        assert_eq!(themes.find(&root.join("elsewhere/whole.png").to_string_lossy()), png(b"whole"));
        assert_eq!(themes.find("kind"), None);
        assert_eq!(themes.find("../pixmaps/loose"), None);
        assert_eq!(themes.find("nothing"), None);
    }
    #[test]
    fn an_app_no_desktop_knows_has_no_icon() {
        assert_eq!(super::icon("never seen by the tracker"), None);
        super::seen("tested app", Source::default());
        assert_eq!(super::icon("tested app"), super::icon("tested app"));
    }
    #[test]
    fn an_app_reached_through_a_link_is_drawn_from_where_the_link_leads() {
        let dir = tempfile::tempdir().expect("a folder");
        let real = dir.path().join("Real.app");
        std::fs::create_dir(&real).expect("the app");
        #[cfg(unix)]
        {
            let link = dir.path().join("Link.app");
            std::os::unix::fs::symlink(&real, &link).expect("a link");
            assert_eq!(resolved(link), std::fs::canonicalize(&real).expect("the app's own path"));
        }
        let gone = dir.path().join("Gone.app");
        assert_eq!(resolved(gone.clone()), gone);
        assert_eq!(plain(PathBuf::from(r"\\?\C:\Apps\one.exe")), PathBuf::from(r"C:\Apps\one.exe"));
        assert_eq!(
            plain(PathBuf::from(r"\\?\UNC\host\one.exe")),
            PathBuf::from(r"\\?\UNC\host\one.exe")
        );
        assert_eq!(
            plain(PathBuf::from("/Applications/Safari.app")),
            PathBuf::from("/Applications/Safari.app")
        );
    }
    #[test]
    fn the_shells_pixels_are_read_straight_and_its_mask_cuts_the_holes() {
        assert_eq!(straight(&[128, 128, 128, 128], None), [255, 255, 255, 128]);
        assert_eq!(
            straight(&[1, 2, 3, 0, 4, 5, 6, 0], Some(&[0, 0, 0, 0, 255, 255, 255, 0])),
            [3, 2, 1, 255, 0, 0, 0, 0]
        );
    }
    #[cfg(windows)]
    #[test]
    fn explorer_has_an_icon() {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
        let source = Source { path: Some(PathBuf::from(root).join("explorer.exe")), class: None };
        assert!(super::platform::drawn(&source)
            .is_some_and(|one| one.starts_with("data:image/png;base64,")));
    }
    #[cfg(windows)]
    #[test]
    fn edge_is_found_by_its_name_without_being_seen() {
        let found = super::platform::find("msedge");
        assert!(found
            .and_then(|one| super::platform::drawn(&one))
            .is_some_and(|one| one.starts_with("data:image/png;base64,")));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn safari_is_found_by_its_name_without_being_seen() {
        let found = super::platform::find("Safari");
        assert!(found
            .and_then(|one| super::platform::drawn(&one))
            .is_some_and(|one| one.starts_with("data:image/png;base64,")));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn finder_has_an_icon() {
        let source = Source {
            path: Some(PathBuf::from("/System/Library/CoreServices/Finder.app")),
            class: None,
        };
        assert!(super::platform::drawn(&source)
            .is_some_and(|one| one.starts_with("data:image/png;base64,")));
    }
}
