use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[cfg(any(target_os = "windows", target_os = "macos"))]
use super::icons;

pub fn icon(ending: &str) -> Option<String> {
    static KNOWN: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let ending = ending.to_ascii_lowercase();
    if !sane(&ending) {
        return None;
    }
    let known = KNOWN.get_or_init(Mutex::default);
    if let Some(found) = known.lock().ok()?.get(&ending) {
        return found.clone();
    }
    let found = drawn(&ending);
    known.lock().ok()?.insert(ending, found.clone());
    found
}

fn sane(ending: &str) -> bool {
    ending.len() <= 16
        && ending
            .bytes()
            .all(|one| one.is_ascii_alphanumeric() || matches!(one, b'_' | b'-' | b'+'))
}

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "a kind's icon is asked of the shell, and its pixels are read with GDI"
)]
fn drawn(ending: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
        SHGFI_SYSICONINDEX, SHGFI_USEFILEATTRIBUTES, SHIL_EXTRALARGE,
    };
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    let _com = super::windows::Com::start();
    let named = if ending.is_empty() {
        "file".to_owned()
    } else {
        format!("file.{ending}")
    };
    let name = HSTRING::from(named.as_str());
    let size = u32::try_from(std::mem::size_of::<SHFILEINFOW>()).ok()?;
    let mut info = SHFILEINFOW::default();
    let listed = unsafe {
        SHGetFileInfoW(
            &name,
            FILE_ATTRIBUTE_NORMAL,
            Some(&raw mut info),
            size,
            SHGFI_SYSICONINDEX | SHGFI_USEFILEATTRIBUTES,
        )
    };
    let large = if listed == 0 {
        None
    } else {
        let list = i32::try_from(SHIL_EXTRALARGE).ok()?;
        unsafe { SHGetImageList::<IImageList>(list) }
            .and_then(|images| unsafe { images.GetIcon(info.iIcon, ILD_TRANSPARENT.0) })
            .ok()
            .filter(|one| !one.is_invalid())
    };
    let icon = if let Some(one) = large {
        one
    } else {
        let mut info = SHFILEINFOW::default();
        let found = unsafe {
            SHGetFileInfoW(
                &name,
                FILE_ATTRIBUTE_NORMAL,
                Some(&raw mut info),
                size,
                SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
            )
        };
        if found == 0 || info.hIcon.is_invalid() {
            return None;
        }
        info.hIcon
    };
    let read = icon_rgba(icon);
    unsafe {
        let _ = DestroyIcon(icon);
    }
    let (rgba, width, height) = read?;
    Some(icons::data_url(
        "image/png",
        &icons::rgba_png_within(&rgba, width, height, icons::KIND_SIDE)?,
    ))
}

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "an icon's bitmaps are taken out of it by Win32 calls"
)]
fn icon_rgba(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<(Vec<u8>, u32, u32)> {
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let mut info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &raw mut info) }.ok()?;
    let color = (!info.hbmColor.is_invalid())
        .then(|| super::windows::bitmap_rgba(info.hbmColor))
        .flatten();
    let mask = (!info.hbmMask.is_invalid())
        .then(|| super::windows::bitmap_rgba(info.hbmMask))
        .flatten();
    unsafe {
        let _ = DeleteObject(info.hbmColor);
        let _ = DeleteObject(info.hbmMask);
    }
    let (mut rgba, width, height) = color?;
    if let Some((holes, mask_width, mask_height)) = mask {
        masked(
            &mut rgba,
            (width, height),
            &holes,
            (mask_width, mask_height),
        );
    }
    Some((rgba, width, height))
}

#[cfg(any(target_os = "windows", test))]
fn masked(rgba: &mut [u8], size: (u32, u32), holes: &[u8], hole_size: (u32, u32)) {
    if size != hole_size || rgba.len() != holes.len() {
        return;
    }
    if !rgba.as_chunks::<4>().0.iter().all(|one| one[3] == u8::MAX) {
        return;
    }
    for (pixel, hole) in rgba
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(holes.as_chunks::<4>().0)
    {
        if hole[0] > 127 {
            *pixel = [0, 0, 0, 0];
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "a kind's icon is drawn by AppKit into a bitmap made through its Objective-C interface"
)]
fn drawn(ending: &str) -> Option<String> {
    use objc2::AllocAnyThread as _;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace,
        NSGraphicsContext, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    let kind = NSString::from_str(if ending.is_empty() {
        "public.data"
    } else {
        ending
    });
    #[allow(
        deprecated,
        reason = "the content type it is replaced by needs a framework this app does not link for a name ending"
    )]
    let image = NSWorkspace::sharedWorkspace().iconForFileType(&kind);
    let pixels = isize::try_from(icons::KIND_SIDE).ok()?;
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
    let side = f64::from(icons::KIND_SIDE);
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
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    let bytes = data.to_vec();
    (!bytes.is_empty()).then(|| icons::data_url("image/png", &bytes))
}

#[cfg(target_os = "linux")]
fn drawn(ending: &str) -> Option<String> {
    static FOUND: OnceLock<(Mime, super::linux::Icons)> = OnceLock::new();
    let (mime, icons) = FOUND.get_or_init(|| {
        let folders = super::linux::data_dirs();
        let read = |file: &str| -> Vec<String> {
            folders
                .iter()
                .filter_map(|folder| std::fs::read_to_string(folder.join("mime").join(file)).ok())
                .collect()
        };
        let mime = Mime::read(&read("globs2"), &read("icons"), &read("generic-icons"));
        let icons = super::linux::Icons::kinds(&folders, &super::linux::current_theme());
        (mime, icons)
    });
    mime.names(ending).iter().find_map(|name| icons.find(name))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn drawn(_ending: &str) -> Option<String> {
    None
}

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
struct Mime {
    globs: HashMap<String, (u32, String)>,
    icons: HashMap<String, String>,
    generic: HashMap<String, String>,
}

#[cfg(any(target_os = "linux", test))]
impl Mime {
    fn read(globs: &[String], icons: &[String], generic: &[String]) -> Mime {
        let mut mime = Mime::default();
        for text in globs {
            for line in text.lines().filter(|one| !one.starts_with('#')) {
                let mut parts = line.splitn(4, ':');
                let (Some(weight), Some(kind), Some(glob)) =
                    (parts.next(), parts.next(), parts.next())
                else {
                    continue;
                };
                let Ok(weight) = weight.parse::<u32>() else {
                    continue;
                };
                let Some(ending) = glob.strip_prefix("*.") else {
                    continue;
                };
                if ending.contains(['*', '?', '[', '.']) || ending.is_empty() {
                    continue;
                }
                let exact = parts
                    .next()
                    .is_some_and(|flags| flags.split(',').any(|one| one == "cs"));
                if exact && ending.bytes().any(|one| one.is_ascii_uppercase()) {
                    continue;
                }
                let ending = ending.to_ascii_lowercase();
                if mime
                    .globs
                    .get(&ending)
                    .is_none_or(|(before, _)| weight > *before)
                {
                    mime.globs.insert(ending, (weight, kind.to_owned()));
                }
            }
        }
        let pairs = |texts: &[String]| {
            let mut out = HashMap::new();
            for line in texts.iter().flat_map(|one| one.lines()) {
                if let Some((kind, name)) = line.split_once(':') {
                    out.entry(kind.to_owned())
                        .or_insert_with(|| name.trim().to_owned());
                }
            }
            out
        };
        mime.icons = pairs(icons);
        mime.generic = pairs(generic);
        mime
    }

    fn names(&self, ending: &str) -> Vec<String> {
        let kind = self
            .globs
            .get(ending)
            .map_or("application/octet-stream", |(_, kind)| kind.as_str());
        let mut names = Vec::new();
        if let Some(one) = self.icons.get(kind) {
            names.push(one.clone());
        }
        names.push(kind.replace('/', "-"));
        if let Some(one) = self.generic.get(kind) {
            names.push(one.clone());
        }
        if let Some((media, _)) = kind.split_once('/') {
            names.push(format!("{media}-x-generic"));
        }
        names.push("application-x-generic".to_owned());
        let mut seen = std::collections::HashSet::new();
        names.retain(|one| seen.insert(one.clone()));
        names
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_ending_that_is_no_kind_is_never_asked_about() {
        assert!(sane(""));
        assert!(sane("docx"));
        assert!(sane("c++"));
        assert!(!sane("with space"));
        assert!(!sane("../etc"));
        assert!(!sane("averyveryverylongending"));
        assert_eq!(icon("a/b"), None);
    }

    #[test]
    fn a_kind_is_found_by_its_ending_with_the_heaviest_glob_winning() {
        let globs =
            "# comment\n50:text/x-python:*.py\n50:text/x-c++src:*.C:cs\n50:text/x-csrc:*.c\n\
                     10:application/x-zerosize:*.py\n60:application/x-tar:*.tar.gz\n\
                     55:application/vnd.ms-excel:*.XLS\n";
        let own = "80:text/x-mine:*.py\n";
        let mime = Mime::read(
            &[own.to_owned(), globs.to_owned()],
            &["text/x-python:my-python\n".to_owned()],
            &["text/x-python:text-x-script\n".to_owned()],
        );
        assert_eq!(
            mime.globs.get("py").map(|one| one.1.as_str()),
            Some("text/x-mine")
        );
        assert_eq!(
            mime.globs.get("c").map(|one| one.1.as_str()),
            Some("text/x-csrc")
        );
        assert_eq!(
            mime.globs.get("xls").map(|one| one.1.as_str()),
            Some("application/vnd.ms-excel")
        );
        assert!(!mime.globs.contains_key("gz"));
        let python = Mime::read(
            &[globs.to_owned()],
            &["text/x-python:my-python\n".to_owned()],
            &["text/x-python:text-x-script\n".to_owned()],
        );
        assert_eq!(
            python.names("py"),
            [
                "my-python",
                "text-x-python",
                "text-x-script",
                "text-x-generic",
                "application-x-generic"
            ]
        );
        assert_eq!(
            python.names("nothing"),
            ["application-octet-stream", "application-x-generic"]
        );
        assert_eq!(
            python.names(""),
            ["application-octet-stream", "application-x-generic"]
        );
    }

    #[test]
    fn an_old_icon_without_alpha_is_cut_out_by_its_mask() {
        let mut solid = [10, 20, 30, 255, 40, 50, 60, 255].to_vec();
        masked(
            &mut solid,
            (2, 1),
            &[255, 255, 255, 255, 0, 0, 0, 255],
            (2, 1),
        );
        assert_eq!(solid, [0, 0, 0, 0, 40, 50, 60, 255]);

        let mut soft = [10, 20, 30, 128, 40, 50, 60, 255].to_vec();
        masked(
            &mut soft,
            (2, 1),
            &[255, 255, 255, 255, 0, 0, 0, 255],
            (2, 1),
        );
        assert_eq!(soft, [10, 20, 30, 128, 40, 50, 60, 255]);
    }
}
