use std::collections::HashSet;
use std::path::{Path, PathBuf};

use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, IEnumShellItems, IShellItem, IShellItem2, IShellItemImageFactory, IShellLinkW,
    SHCreateItemFromParsingName, ShellLink, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
    SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};

use super::{icons, Entry, Listed};

pub const PACKAGED: &str = "shell:AppsFolder\\";

const FILE_DESCRIPTION: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0x0cef_7d53_fa64_11d1_a203_0000_f81f_edee),
    pid: 3,
};

pub fn entries(with_icons: bool) -> Vec<Entry> {
    std::thread::spawn(move || {
        let _com = Com::start();
        gather(with_icons)
    })
    .join()
    .unwrap_or_default()
}

struct Com(bool);

impl Com {
    #[allow(unsafe_code, reason = "COM is started on a thread by a Win32 call")]
    fn start() -> Com {
        Com(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
    }
}

impl Drop for Com {
    #[allow(unsafe_code, reason = "COM is ended on its thread by a Win32 call")]
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

#[derive(Default)]
struct Seen {
    programs: HashSet<String>,
    names: HashSet<String>,
}

impl Seen {
    fn first(&mut self, program: &str, args: &str, name: &str) -> bool {
        let program = format!(
            "{}\u{0}{}",
            program.to_lowercase(),
            args.trim().to_lowercase()
        );
        let name = name.to_lowercase();
        if self.programs.contains(&program) || self.names.contains(&name) {
            return false;
        }
        self.programs.insert(program);
        self.names.insert(name);
        true
    }
}

fn gather(with_icons: bool) -> Vec<Entry> {
    let mut seen = Seen::default();
    let mut found = Vec::new();
    let mut links = Vec::new();
    for root in start_menus() {
        shortcuts(&root, 0, &mut links);
    }
    links.sort();
    for link in links {
        let Some(entry) = shortcut(&link, with_icons) else {
            continue;
        };
        let args = entry.argv.get(1..).unwrap_or_default().join(" ");
        if seen.first(&entry.argv[0], &args, &entry.listed.name) {
            found.push(entry);
        }
    }
    for entry in packaged(with_icons) {
        if seen.first(&entry.listed.id, "", &entry.listed.name) {
            found.push(entry);
        }
    }
    for entry in app_paths(with_icons) {
        if seen.first(&entry.argv[0], "", &entry.listed.name) {
            found.push(entry);
        }
    }
    found
}

fn start_menus() -> Vec<PathBuf> {
    ["ProgramData", "APPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| PathBuf::from(base).join("Microsoft\\Windows\\Start Menu\\Programs"))
        .collect()
}

fn shortcuts(folder: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(folder) else {
        return;
    };
    for item in read.flatten() {
        let path = item.path();
        if path.is_dir() {
            if depth < 4 {
                shortcuts(&path, depth + 1, found);
            }
        } else if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        {
            found.push(path);
        }
    }
}

pub fn not_an_application(name: &str, program: &str) -> bool {
    const NAMES: [&str; 8] = [
        "uninstall",
        "deinstall",
        "désinstaller",
        "desinstalar",
        "disinstalla",
        "verwijderen",
        "readme",
        "release notes",
    ];
    const PROGRAMS: [&str; 4] = ["au_.exe", "setup.exe", "install.exe", "msiexec.exe"];
    const STARTS: [&str; 2] = ["unins", "uninst"];
    let name = name.to_lowercase();
    let file = Path::new(program)
        .file_name()
        .map(|one| one.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    NAMES.iter().any(|one| name.contains(one))
        || PROGRAMS.contains(&file.as_str())
        || STARTS.iter().any(|one| file.starts_with(one))
}

fn is_program(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        && path.is_file()
}

#[allow(
    unsafe_code,
    reason = "a string COM handed over is read and freed with Win32 calls"
)]
fn taken(text: PWSTR) -> Option<String> {
    if text.is_null() {
        return None;
    }
    let read = unsafe { text.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(text.0 as *const _)) };
    read.filter(|one| !one.is_empty())
}

fn written(buffer: &[u16]) -> String {
    let end = buffer
        .iter()
        .position(|&one| one == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

#[allow(
    unsafe_code,
    reason = "a shortcut is read with the shell's IShellLink, a COM call"
)]
fn shortcut(link: &Path, with_icons: bool) -> Option<Entry> {
    let shell: IShellLinkW =
        unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }.ok()?;
    let file: IPersistFile = shell.cast().ok()?;
    let path = HSTRING::from(link.as_os_str());
    unsafe { file.Load(&path, STGM_READ) }.ok()?;
    let mut target = [0_u16; 1024];
    let mut said = [0_u16; 4096];
    let mut folder = [0_u16; 1024];
    unsafe {
        shell.GetPath(&mut target, std::ptr::null_mut(), 0).ok()?;
        let _ = shell.GetArguments(&mut said);
        let _ = shell.GetWorkingDirectory(&mut folder);
    }
    let program = written(&target);
    if !is_program(Path::new(&program)) {
        return None;
    }
    let item = shell_item(link)?;
    let name = display_name(&item).or_else(|| {
        link.file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
    })?;
    if not_an_application(&name, &program) {
        return None;
    }
    let folder = written(&folder);
    let mut argv = vec![program];
    argv.extend(arguments(&written(&said)));
    Some(Entry {
        listed: Listed {
            id: link.to_string_lossy().into_owned(),
            name,
            icon: if with_icons { icon(&item) } else { None },
        },
        argv,
        cwd: (!folder.is_empty()).then_some(folder),
        packaged: false,
    })
}

#[allow(
    unsafe_code,
    reason = "a command line is split by the shell's CommandLineToArgvW"
)]
pub fn arguments(line: &str) -> Vec<String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::UI::Shell::CommandLineToArgvW;

    if line.trim().is_empty() {
        return Vec::new();
    }
    let line = HSTRING::from(format!("x {line}"));
    let mut count = 0;
    let list = unsafe { CommandLineToArgvW(&line, &raw mut count) };
    if list.is_null() {
        return Vec::new();
    }
    let count = usize::try_from(count).unwrap_or(0);
    let words = (1..count)
        .filter_map(|at| unsafe { (*list.add(at)).to_string() }.ok())
        .collect();
    unsafe {
        let _ = LocalFree(HLOCAL(list.cast()));
    }
    words
}

#[allow(unsafe_code, reason = "a shell item is made by a Win32 call")]
fn shell_item(path: &Path) -> Option<IShellItem> {
    let path = HSTRING::from(path.as_os_str());
    unsafe { SHCreateItemFromParsingName(&path, None) }.ok()
}

#[allow(unsafe_code, reason = "a shell item's name is a COM call")]
fn display_name(item: &IShellItem) -> Option<String> {
    taken(unsafe { item.GetDisplayName(SIGDN_NORMALDISPLAY) }.ok()?)
}

#[allow(
    unsafe_code,
    reason = "a shell item's picture is drawn by COM and read with GDI"
)]
fn icon(item: &IShellItem) -> Option<String> {
    let factory: IShellItemImageFactory = item.cast().ok()?;
    let side = i32::try_from(icons::SIDE).ok()?;
    let bitmap = unsafe {
        factory.GetImage(
            SIZE { cx: side, cy: side },
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
        )
    }
    .ok()?;
    let read = bitmap_rgba(bitmap);
    unsafe {
        let _ = DeleteObject(bitmap);
    }
    let (rgba, width, height) = read?;
    Some(icons::data_url(
        "image/png",
        &icons::rgba_png(&rgba, width, height)?,
    ))
}

#[allow(unsafe_code, reason = "a bitmap's pixels are read with GDI")]
fn bitmap_rgba(bitmap: HBITMAP) -> Option<(Vec<u8>, u32, u32)> {
    let mut about = BITMAP::default();
    let size = i32::try_from(std::mem::size_of::<BITMAP>()).ok()?;
    if unsafe { GetObjectW(bitmap, size, Some((&raw mut about).cast())) } == 0 {
        return None;
    }
    let (width, height) = (about.bmWidth, about.bmHeight.abs());
    if width <= 0 || height <= 0 || width > 1024 || height > 1024 {
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
    let (w, h) = (usize::try_from(width).ok()?, usize::try_from(height).ok()?);
    let mut bgra = vec![0_u8; w * h * 4];
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
    Some((
        straight(&bgra),
        u32::try_from(width).ok()?,
        u32::try_from(height).ok()?,
    ))
}

pub fn straight(bgra: &[u8]) -> Vec<u8> {
    let pixels = bgra.as_chunks::<4>().0;
    let no_alpha = pixels.iter().all(|one| one[3] == 0);
    let premultiplied = !no_alpha
        && pixels
            .iter()
            .all(|one| one[0].max(one[1]).max(one[2]) <= one[3]);
    let mut out = Vec::with_capacity(bgra.len());
    for &[blue, green, red, alpha] in pixels {
        if no_alpha {
            out.extend_from_slice(&[red, green, blue, u8::MAX]);
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

#[allow(
    unsafe_code,
    reason = "the Apps folder is walked with the shell's COM objects"
)]
fn packaged(with_icons: bool) -> Vec<Entry> {
    let mut found = Vec::new();
    let Some(folder) = shell_item(Path::new("shell:AppsFolder")) else {
        return found;
    };
    let Ok(items) = (unsafe { folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) })
    else {
        return found;
    };
    loop {
        let mut one = [None];
        let mut fetched = 0;
        if unsafe { items.Next(&mut one, Some(&raw mut fetched)) }.is_err() || fetched == 0 {
            break;
        }
        let Some(item) = one[0].take() else {
            break;
        };
        let Some(id) = taken(
            unsafe { item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING) }.unwrap_or(PWSTR::null()),
        ) else {
            continue;
        };
        if !is_package_id(&id) {
            continue;
        }
        let Some(name) = display_name(&item) else {
            continue;
        };
        if not_an_application(&name, "") {
            continue;
        }
        found.push(Entry {
            listed: Listed {
                id: format!("{PACKAGED}{id}"),
                name,
                icon: if with_icons { icon(&item) } else { None },
            },
            argv: Vec::new(),
            cwd: None,
            packaged: true,
        });
    }
    found
}

pub fn is_package_id(id: &str) -> bool {
    id.split_once('!').is_some_and(|(family, app)| {
        family.contains('_') && !app.is_empty() && !family.contains('\\') && !family.contains('{')
    })
}

fn app_paths(with_icons: bool) -> Vec<Entry> {
    const KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths";
    let system = std::env::var("SystemRoot")
        .ok()
        .map(|one| one.to_lowercase());
    let mut found = Vec::new();
    for root in [
        windows_registry::LOCAL_MACHINE,
        windows_registry::CURRENT_USER,
    ] {
        let Ok(paths) = root.open(KEY) else {
            continue;
        };
        let Ok(names) = paths.keys() else {
            continue;
        };
        let mut names: Vec<String> = names.collect();
        names.sort();
        for name in names {
            let Some(program) = paths
                .open(&name)
                .ok()
                .and_then(|key| key.get_hstring("").ok())
                .map(|one| expanded(one.to_string_lossy().trim().trim_matches('"')))
            else {
                continue;
            };
            let path = PathBuf::from(&program);
            if !is_program(&path) || system.as_ref().is_some_and(|root| inside(&program, root)) {
                continue;
            }
            let Some(item) = shell_item(&path) else {
                continue;
            };
            let Some(title) = description(&item) else {
                continue;
            };
            if not_an_application(&title, &program) {
                continue;
            }
            found.push(Entry {
                listed: Listed {
                    id: program.clone(),
                    name: title,
                    icon: if with_icons { icon(&item) } else { None },
                },
                argv: vec![program],
                cwd: None,
                packaged: false,
            });
        }
    }
    found
}

pub fn inside(path: &str, folder: &str) -> bool {
    let path = path.to_lowercase().replace('/', "\\");
    let folder = folder.to_lowercase().replace('/', "\\");
    let folder = folder.trim_end_matches('\\');
    path.strip_prefix(folder)
        .is_some_and(|rest| rest.starts_with('\\'))
}

#[allow(unsafe_code, reason = "a property of a shell item is a COM call")]
fn description(item: &IShellItem) -> Option<String> {
    let item: IShellItem2 = item.cast().ok()?;
    taken(unsafe { item.GetString(&FILE_DESCRIPTION) }.ok()?)
}

pub fn expanded(path: &str) -> String {
    let mut out = String::new();
    let mut rest = path;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = &after[..end];
        match std::env::var(name) {
            Ok(value) if !name.is_empty() => out.push_str(&value),
            _ => {
                out.push('%');
                out.push_str(name);
                out.push('%');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_out_uninstallers_setups_and_help() {
        assert!(not_an_application(
            "Uninstall GIMP",
            "C:\\GIMP\\unins000.exe"
        ));
        assert!(not_an_application("GIMP", "C:\\GIMP\\uninst.exe"));
        assert!(not_an_application("Deinstallieren", "C:\\x\\app.exe"));
        assert!(not_an_application("Setup", "C:\\x\\setup.exe"));
        assert!(!not_an_application(
            "GIMP 2.10",
            "C:\\GIMP\\bin\\gimp-2.10.exe"
        ));
        assert!(!not_an_application(
            "Installer Helper",
            "C:\\x\\installer.exe"
        ));
    }

    #[test]
    fn knows_a_path_inside_a_folder_whatever_its_case() {
        assert!(inside("C:\\Windows\\System32\\wabmig.exe", "c:\\windows"));
        assert!(inside("c:/windows/x.exe", "C:\\Windows\\"));
        assert!(!inside("C:\\WindowsApps\\x.exe", "C:\\Windows"));
        assert!(!inside("D:\\Tools\\x.exe", "C:\\Windows"));
    }

    #[test]
    fn knows_a_package_id_from_a_desktop_programs() {
        assert!(is_package_id(
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        ));
        assert!(!is_package_id("Microsoft.Windows.Explorer"));
        assert!(!is_package_id(
            "{6D809377-6AF0-444B-8957-A3773F02200E}\\GIMP\\gimp.exe"
        ));
        assert!(!is_package_id("Chrome"));
    }

    #[test]
    fn splits_a_shortcuts_arguments_as_windows_does() {
        assert_eq!(
            arguments(r#"--profile "My Profile" -x C:\a\ b"#),
            vec!["--profile", "My Profile", "-x", "C:\\a\\", "b"]
        );
        assert!(arguments("  ").is_empty());
    }

    #[test]
    fn expands_the_environment_in_a_path() {
        let root = std::env::var("SystemRoot").unwrap();
        assert_eq!(
            expanded("%SystemRoot%\\notepad.exe"),
            format!("{root}\\notepad.exe")
        );
        assert_eq!(expanded("%NOT_SET_HERE_1063%\\x"), "%NOT_SET_HERE_1063%\\x");
        assert_eq!(expanded("100% sure"), "100% sure");
    }

    #[test]
    fn reads_the_shells_pixels_straight() {
        assert_eq!(straight(&[128, 128, 128, 128]), vec![255, 255, 255, 128]);
        assert_eq!(straight(&[1, 2, 3, 0]), vec![3, 2, 1, 255]);
        assert_eq!(
            straight(&[200, 0, 0, 100, 0, 0, 0, 255]),
            vec![0, 0, 200, 100, 0, 0, 0, 255]
        );
    }

    #[test]
    fn lists_this_computers_applications_once_each_with_icons() {
        let found = entries(true);
        let names: Vec<&str> = found.iter().map(|one| one.listed.name.as_str()).collect();
        eprintln!("{} applications: {names:?}", found.len());
        assert!(!found.is_empty(), "no application found");
        let mut ids = HashSet::new();
        for one in &found {
            assert!(
                ids.insert(one.listed.id.clone()),
                "listed twice: {}",
                one.listed.id
            );
            assert!(!not_an_application(
                &one.listed.name,
                one.argv.first().map_or("", String::as_str)
            ));
            if !one.packaged {
                assert!(
                    is_program(Path::new(&one.argv[0])),
                    "not a program: {:?}",
                    one.argv
                );
            }
        }
        let with = found.iter().filter(|one| one.listed.icon.is_some()).count();
        assert!(
            with * 2 >= found.len(),
            "only {with} of {} have icons",
            found.len()
        );
        assert!(entries(false).iter().all(|one| one.listed.icon.is_none()));
    }
}
