const SIDE: u32 = 64;
const LOGO_SIDE: u32 = 44;
pub(crate) fn hosted(frame: u32, children: &[u32]) -> Option<u32> {
    children.iter().copied().find(|one| *one != 0 && *one != frame)
}
pub(crate) fn named(display: Option<&str>, description: Option<&str>, exe: &str) -> String {
    [display, description]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|one| !one.is_empty() && !one.starts_with("ms-resource:"))
        .unwrap_or(exe)
        .to_owned()
}
pub(crate) fn resource(display: &str, package: &str) -> Option<String> {
    let key = display.strip_prefix("ms-resource:")?;
    let family = package.split('_').next().unwrap_or(package);
    Some(if key.starts_with("//") {
        format!("ms-resource:{key}")
    } else if let Some(path) = key.strip_prefix('/') {
        format!("ms-resource://{family}/{path}")
    } else if key.contains('/') {
        format!("ms-resource://{family}/{key}")
    } else {
        format!("ms-resource://{family}/Resources/{key}")
    })
}
fn attribute(tag: &str, name: &str) -> Option<String> {
    let at = tag.find(&format!(" {name}=\""))? + name.len() + 3;
    let rest = &tag[at..];
    Some(rest[..rest.find('"')?].to_owned())
}
fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let start = text.find(&format!("<{name} "))?;
    let rest = &text[start..];
    Some(&rest[..rest.find('>')?])
}
pub(crate) fn manifest_app(
    xml: &str,
    app: Option<&str>,
) -> Option<(Option<String>, Option<String>)> {
    let mut at = 0;
    let mut first = None;
    while let Some(found) = xml[at..].find("<Application ") {
        let start = at + found;
        let end = xml[start..].find("</Application>").map_or(xml.len(), |one| start + one);
        let body = &xml[start..end];
        let head = &body[..body.find('>').unwrap_or(body.len())];
        let visual = tag(body, "uap:VisualElements").or_else(|| tag(body, "VisualElements"));
        let read = (
            visual.and_then(|one| attribute(one, "DisplayName")),
            visual.and_then(|one| attribute(one, "Square44x44Logo")),
        );
        if app.is_some() && attribute(head, "Id").as_deref() == app {
            return Some(read);
        }
        first.get_or_insert(read);
        at = end;
    }
    let logo = xml
        .find("<Logo>")
        .and_then(|one| Some(xml[one + 6..][..xml[one + 6..].find("</Logo>")?].trim().to_owned()));
    match first {
        Some((display, None)) => Some((display, logo)),
        Some(found) => Some(found),
        None => logo.map(|one| (None, Some(one))),
    }
}
fn rank(stem: &str, file: &str) -> Option<(u8, u32)> {
    let lower = file.to_lowercase();
    let rest = lower.strip_prefix(&stem.to_lowercase())?.strip_suffix(".png")?;
    if rest.is_empty() {
        return Some((3, 0));
    }
    let mut size = None;
    let mut unplated = false;
    for one in rest.strip_prefix('.')?.split('_') {
        if one.starts_with("contrast-") || one == "altform-lightunplated" {
            return None;
        }
        if let Some(px) = one.strip_prefix("targetsize-").and_then(|n| n.parse::<u32>().ok()) {
            size = Some((px, true));
        } else if let Some(scale) = one.strip_prefix("scale-").and_then(|n| n.parse::<u32>().ok()) {
            size = Some((LOGO_SIDE * scale / 100, false));
        } else if one == "altform-unplated" {
            unplated = true;
        }
    }
    let (px, target) = size?;
    let distance = if px >= SIDE { px - SIDE } else { 1000 + SIDE - px };
    let class = match (target, unplated) {
        (true, true) => 0,
        (true, false) => 1,
        (false, _) => 2,
    };
    Some((class, distance))
}
pub(crate) fn drawn_side(header: &[u8]) -> Option<u32> {
    if header.get(..8)? != b"\x89PNG\r\n\x1a\n" || header.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(header.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(header.get(20..24)?.try_into().ok()?);
    Some(width.min(height))
}
pub(crate) fn best_logo<'a>(stem: &str, files: &'a [String]) -> Option<&'a String> {
    files
        .iter()
        .filter_map(|one| Some((rank(stem, one)?, one)))
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, one)| one)
}
#[cfg(windows)]
mod native {
    use orden_base::Held as _;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::{LazyLock, Mutex};

    use windows::core::{Interface as _, HSTRING, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM};
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows::Win32::Storage::Packaging::Appx::{
        GetApplicationUserModelId, GetPackageFullName, GetPackagePathByFullName,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::System::ProcessStatus::K32EnumProcesses;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, SHLoadIndirectString, ShellLink};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetWindowTextW, GetWindowThreadProcessId,
    };

    use super::{best_logo, drawn_side, hosted, manifest_app, named, resource};
    use crate::app_icon::Source;

    #[derive(Clone)]
    struct Packaged {
        name: Option<String>,
        logo: Option<PathBuf>,
    }
    static PACKAGES: LazyLock<Mutex<HashMap<String, Packaged>>> = LazyLock::new(Mutex::default);
    fn wide(buffer: &[u16], length: u32) -> String {
        let length = usize::try_from(length).unwrap_or(0).min(buffer.len());
        String::from_utf16_lossy(&buffer[..length]).trim_end_matches('\0').to_owned()
    }
    #[allow(unsafe_code)]
    fn read_process<T>(pid: u32, read: impl FnOnce(HANDLE) -> Option<T>) -> Option<T> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let found = read(handle);
        unsafe {
            let _ = CloseHandle(handle);
        }
        found
    }
    #[allow(unsafe_code)]
    fn exe_of(handle: HANDLE) -> Option<String> {
        let mut buffer = [0u16; 1024];
        let mut length = u32::try_from(buffer.len()).ok()?;
        unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &raw mut length,
            )
        }
        .ok()?;
        Some(wide(&buffer, length))
    }
    #[allow(unsafe_code)]
    fn package_of(handle: HANDLE) -> Option<(String, Option<String>)> {
        let mut buffer = [0u16; 256];
        let mut length = u32::try_from(buffer.len()).ok()?;
        let read =
            unsafe { GetPackageFullName(handle, &raw mut length, PWSTR(buffer.as_mut_ptr())) };
        if read.is_err() {
            return None;
        }
        let full = wide(&buffer, length);
        let mut model = [0u16; 512];
        let mut modelled = u32::try_from(model.len()).ok()?;
        let app = unsafe {
            GetApplicationUserModelId(handle, &raw mut modelled, PWSTR(model.as_mut_ptr()))
        }
        .is_ok()
        .then(|| wide(&model, modelled))
        .and_then(|one| one.split_once('!').map(|(_, id)| id.to_owned()));
        Some((full, app))
    }
    #[allow(unsafe_code)]
    fn package_folder(full: &str) -> Option<PathBuf> {
        let name = HSTRING::from(full);
        let mut buffer = vec![0u16; 1024];
        let mut length = u32::try_from(buffer.len()).ok()?;
        let read =
            unsafe { GetPackagePathByFullName(&name, &raw mut length, PWSTR(buffer.as_mut_ptr())) };
        if read.is_err() {
            return None;
        }
        Some(PathBuf::from(wide(&buffer, length)))
    }
    #[allow(unsafe_code)]
    fn indirect(source: &str) -> Option<String> {
        let mut buffer = [0u16; 512];
        unsafe { SHLoadIndirectString(&HSTRING::from(source), &mut buffer, None) }.ok()?;
        let end = buffer.iter().position(|one| *one == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end])).filter(|one| !one.trim().is_empty())
    }
    fn logo_in(folder: &Path, logo: &str) -> Option<PathBuf> {
        let wanted = folder.join(logo.replace('\\', "/"));
        let dir = wanted.parent()?;
        let stem = wanted.file_stem()?.to_str()?.to_owned();
        let files: Vec<String> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .filter_map(|one| one.file_name().to_str().map(str::to_owned))
            .collect();
        let chosen = dir.join(best_logo(&stem, &files)?);
        let mut header = [0u8; 24];
        std::io::Read::read_exact(&mut std::fs::File::open(&chosen).ok()?, &mut header).ok()?;
        drawn_side(&header).filter(|side| *side >= 16).map(|_| chosen)
    }
    fn packaged(full: &str, app: Option<&str>) -> Packaged {
        let key = format!("{full}!{}", app.unwrap_or_default());
        if let Some(known) = PACKAGES.held().get(&key) {
            return known.clone();
        }
        let folder = package_folder(full);
        let read = folder.as_deref().and_then(|one| {
            let xml = std::fs::read_to_string(one.join("AppxManifest.xml")).ok()?;
            manifest_app(&xml, app)
        });
        let (display, logo) = read.unwrap_or((None, None));
        let name = display.and_then(|one| match resource(&one, full) {
            Some(uri) => indirect(&format!("@{{{full}?{uri}}}")),
            None => Some(one),
        });
        let logo = folder.zip(logo).and_then(|(folder, logo)| logo_in(&folder, &logo));
        let found = Packaged { name, logo };
        let mut known = PACKAGES.held();
        if known.len() >= 128 {
            known.clear();
        }
        known.insert(key, found.clone());
        found
    }
    #[allow(unsafe_code)]
    fn description(exe: &str) -> Option<String> {
        let path = HSTRING::from(exe);
        let size = unsafe { GetFileVersionInfoSizeW(&path, None) };
        if size == 0 {
            return None;
        }
        let mut block = vec![0u8; usize::try_from(size).ok()?];
        unsafe { GetFileVersionInfoW(&path, 0, size, block.as_mut_ptr().cast()) }.ok()?;
        let mut pointer = std::ptr::null_mut();
        let mut length = 0u32;
        let found = unsafe {
            VerQueryValueW(
                block.as_ptr().cast(),
                &HSTRING::from(r"\VarFileInfo\Translation"),
                &raw mut pointer,
                &raw mut length,
            )
        };
        if !found.as_bool() || length < 4 || pointer.is_null() {
            return None;
        }
        let (language, page) = unsafe {
            let pair = pointer.cast::<u16>();
            (pair.read_unaligned(), pair.add(1).read_unaligned())
        };
        let key =
            HSTRING::from(format!(r"\StringFileInfo\{language:04x}{page:04x}\FileDescription"));
        let found = unsafe {
            VerQueryValueW(block.as_ptr().cast(), &key, &raw mut pointer, &raw mut length)
        };
        if !found.as_bool() || length == 0 || pointer.is_null() {
            return None;
        }
        let text = unsafe {
            std::slice::from_raw_parts(pointer.cast::<u16>(), usize::try_from(length).ok()?)
        };
        Some(wide(text, length)).filter(|one| !one.trim().is_empty())
    }
    fn stem(exe: &str) -> String {
        let file = exe.rsplit(['/', '\\']).next().unwrap_or(exe);
        file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_owned()
    }
    fn app_of(pid: u32) -> Option<(String, Source)> {
        read_process(pid, |handle| {
            let exe = exe_of(handle)?;
            let Some((full, app)) = package_of(handle) else {
                return Some((exe.clone(), Source { path: Some(exe.into()), class: None }));
            };
            let found = packaged(&full, app.as_deref());
            let described = found.name.is_none().then(|| description(&exe)).flatten();
            let name = named(found.name.as_deref(), described.as_deref(), &stem(&exe));
            Some((name, Source { path: found.logo.or_else(|| Some(exe.into())), class: None }))
        })
    }
    #[allow(unsafe_code)]
    unsafe extern "system" fn listed(window: HWND, into: LPARAM) -> BOOL {
        let mut process = 0u32;
        unsafe { GetWindowThreadProcessId(window, Some(&raw mut process)) };
        let pids = unsafe { &mut *(into.0 as *mut Vec<u32>) };
        pids.push(process);
        BOOL(1)
    }
    #[allow(unsafe_code)]
    fn title(window: HWND) -> Option<String> {
        let mut buffer = [0u16; 256];
        let length = unsafe { GetWindowTextW(window, &mut buffer) };
        Some(wide(&buffer, u32::try_from(length).ok()?)).filter(|one| !one.trim().is_empty())
    }
    #[allow(unsafe_code)]
    pub fn front(window: HWND, pid: u32) -> Option<(String, Source)> {
        let (exe, source) = app_of(pid)?;
        if !stem(&exe).eq_ignore_ascii_case("ApplicationFrameHost") {
            return Some((exe, source));
        }
        let mut pids: Vec<u32> = Vec::new();
        unsafe {
            let _ = EnumChildWindows(
                window,
                Some(listed),
                LPARAM(std::ptr::addr_of_mut!(pids) as isize),
            );
        }
        match hosted(pid, &pids).and_then(app_of) {
            Some(found) => Some(found),
            None => Some((title(window)?, Source::default())),
        }
    }
    #[allow(unsafe_code)]
    fn running(name: &str) -> Option<Source> {
        let mut pids = vec![0u32; 4096];
        let mut used = 0u32;
        let room = u32::try_from(pids.len() * 4).ok()?;
        if !unsafe { K32EnumProcesses(pids.as_mut_ptr(), room, &raw mut used) }.as_bool() {
            return None;
        }
        pids.truncate(usize::try_from(used / 4).ok()?);
        pids.into_iter().filter(|one| *one != 0).find_map(|pid| {
            let (found, source) = app_of(pid)?;
            (found.eq_ignore_ascii_case(name) || stem(&found).eq_ignore_ascii_case(name))
                .then_some(source)
        })
    }
    fn registered(name: &str) -> Option<Source> {
        let key = format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{name}.exe");
        [windows_registry::CURRENT_USER, windows_registry::LOCAL_MACHINE].into_iter().find_map(
            |root| {
                let path = root.open(&key).ok()?.get_string("").ok()?;
                let path = PathBuf::from(path.trim().trim_matches('"'));
                path.is_file().then_some(Source { path: Some(path), class: None })
            },
        )
    }
    fn links(folder: &Path, depth: u8, into: &mut Vec<PathBuf>) {
        let Ok(listed) = std::fs::read_dir(folder) else {
            return;
        };
        for one in listed.flatten() {
            let path = one.path();
            if path.is_dir() && depth < 4 {
                links(&path, depth + 1, into);
            } else if path.extension().is_some_and(|ending| ending.eq_ignore_ascii_case("lnk")) {
                into.push(path);
            }
        }
    }
    #[allow(unsafe_code)]
    fn target(link: &Path) -> Option<PathBuf> {
        let shell: IShellLinkW =
            unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }.ok()?;
        let file: IPersistFile = shell.cast().ok()?;
        unsafe { file.Load(&HSTRING::from(link.as_os_str()), STGM_READ) }.ok()?;
        let mut buffer = [0u16; 1024];
        unsafe { shell.GetPath(&mut buffer, std::ptr::null_mut(), 0) }.ok()?;
        let end = buffer.iter().position(|one| *one == 0).unwrap_or(buffer.len());
        let path = PathBuf::from(String::from_utf16_lossy(&buffer[..end]));
        path.is_file().then_some(path)
    }
    #[allow(unsafe_code)]
    fn started(name: &str) -> Option<Source> {
        let mut found = Vec::new();
        for root in ["ProgramData", "APPDATA"] {
            if let Some(base) = std::env::var_os(root) {
                let folder = PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs");
                links(&folder, 0, &mut found);
            }
        }
        found.truncate(600);
        let opened = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
        let named_so = |link: &PathBuf| {
            link.file_stem()
                .and_then(|one| one.to_str())
                .is_some_and(|one| one.eq_ignore_ascii_case(name))
        };
        let path =
            found.iter().filter(|one| named_so(one)).find_map(|one| target(one)).or_else(|| {
                found.iter().find_map(|one| {
                    let path = target(one)?;
                    let file = path.file_stem()?.to_str()?;
                    file.eq_ignore_ascii_case(name).then_some(path)
                })
            });
        if opened {
            unsafe { CoUninitialize() };
        }
        path.map(|path| Source { path: Some(path), class: None })
    }
    pub fn find(name: &str) -> Option<Source> {
        let known = PACKAGES.held().values().find(|one| one.name.as_deref() == Some(name)).cloned();
        if let Some(Packaged { logo: Some(logo), .. }) = known {
            return Some(Source { path: Some(logo), class: None });
        }
        running(name).or_else(|| registered(name)).or_else(|| started(name))
    }
}
#[cfg(windows)]
pub(crate) use native::{find, front};
#[cfg(test)]
mod tests {
    use super::{best_logo, drawn_side, hosted, manifest_app, named, resource};

    #[test]
    fn a_logo_too_small_to_draw_is_told_by_its_header() {
        let mut header = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        header.extend_from_slice(&64u32.to_be_bytes());
        header.extend_from_slice(&48u32.to_be_bytes());
        assert_eq!(drawn_side(&header), Some(48));
        assert_eq!(drawn_side(b"GIF89a"), None);
    }
    #[test]
    fn a_frame_hosts_the_first_child_of_another_process() {
        assert_eq!(hosted(10, &[10, 10, 42, 7]), Some(42));
        assert_eq!(hosted(10, &[10, 0]), None);
        assert_eq!(hosted(10, &[]), None);
    }
    #[test]
    fn a_store_app_is_named_by_its_package_then_its_file_then_its_exe() {
        assert_eq!(named(Some("Calculator"), Some("calc"), "CalculatorApp"), "Calculator");
        assert_eq!(
            named(Some("ms-resource:AppName"), Some("Windows Calculator"), "CalculatorApp"),
            "Windows Calculator"
        );
        assert_eq!(named(Some(" "), None, "CalculatorApp"), "CalculatorApp");
        assert_eq!(named(None, None, "CalculatorApp"), "CalculatorApp");
    }
    #[test]
    fn a_package_resource_is_read_from_its_own_package() {
        let package = "Microsoft.WindowsCalculator_11.2405.2.0_x64__8wekyb3d8bbwe";
        assert_eq!(
            resource("ms-resource:AppName", package).as_deref(),
            Some("ms-resource://Microsoft.WindowsCalculator/Resources/AppName")
        );
        assert_eq!(
            resource("ms-resource:/Strings/Title", package).as_deref(),
            Some("ms-resource://Microsoft.WindowsCalculator/Strings/Title")
        );
        assert_eq!(
            resource("ms-resource:Resources/AppStoreName", package).as_deref(),
            Some("ms-resource://Microsoft.WindowsCalculator/Resources/AppStoreName")
        );
        assert_eq!(
            resource("ms-resource://Other/Resources/Name", package).as_deref(),
            Some("ms-resource://Other/Resources/Name")
        );
        assert_eq!(resource("Calculator", package), None);
    }
    #[test]
    fn the_manifest_names_the_application_that_runs_and_its_list_logo() {
        let xml = r#"<Package><Properties><DisplayName>ms-resource:AppStoreName</DisplayName><Logo>Assets\StoreLogo.png</Logo></Properties>
            <Applications>
              <Application Id="Other" Executable="other.exe"><uap:VisualElements DisplayName="Other" Square44x44Logo="Assets\Other.png" /></Application>
              <Application Id="App" Executable="CalculatorApp.exe"><uap:VisualElements DisplayName="ms-resource:AppName" Square150x150Logo="Assets\Big.png" Square44x44Logo="Assets\CalculatorAppList.png"></uap:VisualElements></Application>
            </Applications></Package>"#;
        assert_eq!(
            manifest_app(xml, Some("App")),
            Some((
                Some("ms-resource:AppName".to_owned()),
                Some(r"Assets\CalculatorAppList.png".to_owned())
            ))
        );
        assert_eq!(
            manifest_app(xml, None),
            Some((Some("Other".to_owned()), Some(r"Assets\Other.png".to_owned())))
        );
        let bare = "<Package><Properties><Logo>Assets\\StoreLogo.png</Logo></Properties></Package>";
        assert_eq!(
            manifest_app(bare, None),
            Some((None, Some(r"Assets\StoreLogo.png".to_owned())))
        );
    }
    #[test]
    fn the_logo_is_the_unplated_one_nearest_the_size_shown() {
        let files: Vec<String> = [
            "CalculatorAppList.scale-200.png",
            "CalculatorAppList.targetsize-48_altform-unplated.png",
            "CalculatorAppList.targetsize-64.png",
            "CalculatorAppList.targetsize-64_altform-unplated.png",
            "CalculatorAppList.targetsize-64_altform-lightunplated.png",
            "CalculatorAppList.contrast-black_targetsize-64.png",
            "CalculatorAppList.targetsize-256_altform-unplated.png",
            "Other.targetsize-64_altform-unplated.png",
        ]
        .map(str::to_owned)
        .to_vec();
        assert_eq!(
            best_logo("CalculatorAppList", &files).map(String::as_str),
            Some("CalculatorAppList.targetsize-64_altform-unplated.png")
        );
        let scaled: Vec<String> =
            ["Logo.scale-100.png", "Logo.scale-200.png", "Logo.scale-400.png"]
                .map(str::to_owned)
                .to_vec();
        assert_eq!(best_logo("Logo", &scaled).map(String::as_str), Some("Logo.scale-200.png"));
        assert_eq!(
            best_logo("Logo", &["Logo.png".to_owned()]).map(String::as_str),
            Some("Logo.png")
        );
        assert_eq!(best_logo("Logo", &["Else.png".to_owned()]), None);
    }
}
