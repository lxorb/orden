//! A Mac's applications: the bundles in the system's and the reader's Applications
//! folders and the folders inside them, as Launchpad shows them - by the name each
//! bundle gives itself, once each, and with the icon its bundle holds.
//!
//! The icon is the bundle's `CFBundleIconFile` in its Resources, an `icns`: a list of
//! pictures of one icon at many sizes, most of them PNGs since macOS 10.7. The smallest
//! PNG that is at least `SIDE` across is sent, made that size; a bundle whose icon is
//! only in an asset catalogue, or only in the old formats, goes without one.

#[cfg(target_os = "macos")]
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::icons;
#[cfg(target_os = "macos")]
use super::{Entry, Listed};

/// Where applications are kept: the reader's, the machine's and the system's own.
#[cfg(target_os = "macos")]
fn roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.insert(0, home.join("Applications"));
    }
    roots
}

/// Every application bundle in the Applications folders, the first of each bundle id.
#[cfg(target_os = "macos")]
pub fn entries(with_icons: bool) -> Vec<Entry> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for root in roots() {
        for path in bundles(&root) {
            let Some(bundle) = read(&path, with_icons) else {
                continue;
            };
            if !seen.insert(bundle.key.clone()) {
                continue;
            }
            let id = path.to_string_lossy().into_owned();
            found.push(Entry::program(
                Listed {
                    id: id.clone(),
                    name: bundle.name,
                    icon: bundle.icon,
                },
                vec!["/usr/bin/open".to_owned(), "-a".to_owned(), id],
            ));
        }
    }
    found
}

/// The `.app` bundles in a folder and in the folders inside it, two deep: Utilities, and
/// a suite's own folder. A bundle's insides are not looked in.
pub fn bundles(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut folders = vec![(root.to_path_buf(), 0)];
    while let Some((folder, depth)) = folders.pop() {
        let Ok(read) = std::fs::read_dir(&folder) else {
            continue;
        };
        let mut items: Vec<PathBuf> = read.flatten().map(|one| one.path()).collect();
        items.sort();
        for path in items {
            if path.extension().is_some_and(|one| one == "app") {
                found.push(path);
            } else if depth < 2 && path.is_dir() && !path.is_symlink() {
                folders.push((path, depth + 1));
            }
        }
    }
    found.sort();
    found
}

/// What a bundle's `Info.plist` says: what it is called, what it is known by, and its
/// icon.
pub struct Bundle {
    pub name: String,
    pub key: String,
    pub icon: Option<String>,
}

/// A bundle, unless it is one that runs in the background with nothing to show.
pub fn read(path: &Path, with_icons: bool) -> Option<Bundle> {
    let contents = path.join("Contents");
    let info = plist::Value::from_file(contents.join("Info.plist")).ok()?;
    let info = info.as_dictionary()?;
    let text = |key: &str| {
        info.get(key)
            .and_then(plist::Value::as_string)
            .map(str::trim)
            .filter(|one| !one.is_empty())
            .map(str::to_owned)
    };
    let yes = |key: &str| {
        info.get(key).is_some_and(|one| {
            one.as_boolean() == Some(true) || one.as_string().is_some_and(|said| said == "1")
        })
    };
    if yes("LSBackgroundOnly") || yes("LSUIElement") {
        return None;
    }
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let name = text("CFBundleDisplayName")
        .or_else(|| text("CFBundleName"))
        .unwrap_or_else(|| stem.clone());
    let key = text("CFBundleIdentifier").unwrap_or_else(|| path.to_string_lossy().into_owned());
    let icon = if with_icons {
        text("CFBundleIconFile").and_then(|file| {
            let resources = contents.join("Resources");
            let named = resources.join(&file);
            let path = if named.extension().is_some() {
                named
            } else {
                resources.join(format!("{file}.icns"))
            };
            let bytes = std::fs::read(path).ok()?;
            icns_icon(&bytes)
        })
    } else {
        None
    };
    Some(Bundle { name, key, icon })
}

/// The picture an `icns` sends: of the PNGs in it, the smallest at least `SIDE` across,
/// or the largest where none is, made `SIDE` across.
pub fn icns_icon(bytes: &[u8]) -> Option<String> {
    if bytes.get(..4)? != b"icns" {
        return None;
    }
    let mut pngs: Vec<(u32, &[u8])> = Vec::new();
    let mut at = 8;
    while at + 8 <= bytes.len() {
        let length =
            usize::try_from(u32::from_be_bytes(bytes[at + 4..at + 8].try_into().ok()?)).ok()?;
        if length < 8 || at + length > bytes.len() {
            break;
        }
        let data = &bytes[at + 8..at + length];
        if let Some((width, _)) = icons::png_size(data) {
            pngs.push((width, data));
        }
        at += length;
    }
    let side = icons::SIDE;
    let best = pngs
        .iter()
        .filter(|(width, _)| *width >= side)
        .min_by_key(|(width, _)| *width)
        .or_else(|| pngs.iter().max_by_key(|(width, _)| *width))?;
    icons::png_url(best.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(side: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, side, side);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let pixels = [9, 8, 7, 255].repeat(usize::try_from(side * side).unwrap());
        writer.write_image_data(&pixels).unwrap();
        writer.finish().unwrap();
        out
    }

    fn icns(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut body = Vec::new();
        for (kind, data) in chunks {
            body.extend_from_slice(*kind);
            body.extend_from_slice(&u32::try_from(data.len() + 8).unwrap().to_be_bytes());
            body.extend_from_slice(data);
        }
        let mut out = b"icns".to_vec();
        out.extend_from_slice(&u32::try_from(body.len() + 8).unwrap().to_be_bytes());
        out.extend(body);
        out
    }

    #[test]
    fn takes_the_smallest_png_of_an_icns_that_is_large_enough() {
        let small = png(16);
        let right = png(32);
        let large = png(128);
        let file = icns(&[
            (b"icp4", small.clone()),
            (b"ic07", large),
            (b"it32", vec![0; 40]),
            (b"icp5", right.clone()),
        ]);
        assert_eq!(icns_icon(&file), Some(icons::data_url("image/png", &right)));
        // Only small ones: the largest of them.
        assert_eq!(
            icns_icon(&icns(&[(b"icp4", small.clone())])),
            Some(icons::data_url("image/png", &small))
        );
        assert_eq!(icns_icon(&icns(&[(b"it32", vec![0; 40])])), None);
        assert_eq!(icns_icon(b"not an icns"), None);
    }

    #[test]
    fn reads_a_bundle_by_its_own_name_and_leaves_out_one_with_nothing_to_show() {
        let root = std::env::temp_dir().join(format!("orden-bundles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bundle = |path: &str, info: &str| {
            let contents = root.join(path).join("Contents");
            std::fs::create_dir_all(contents.join("Resources")).unwrap();
            std::fs::write(
                contents.join("Info.plist"),
                format!(
                    "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict>{info}</dict></plist>"
                ),
            )
            .unwrap();
            contents.join("Resources")
        };
        let resources = bundle(
            "Utilities/Terminal.app",
            "<key>CFBundleDisplayName</key><string>Terminal</string>\
             <key>CFBundleIdentifier</key><string>com.apple.Terminal</string>\
             <key>CFBundleIconFile</key><string>Terminal</string>",
        );
        std::fs::write(resources.join("Terminal.icns"), icns(&[(b"icp5", png(32))])).unwrap();
        bundle(
            "Helper.app",
            "<key>CFBundleName</key><string>Helper</string><key>LSUIElement</key><true/>",
        );
        bundle("Plain.app", "");

        let found = bundles(&root);
        let names: Vec<String> = found
            .iter()
            .filter_map(|path| read(path, true))
            .map(|one| one.name)
            .collect();
        assert_eq!(names, vec!["Plain", "Terminal"]);
        let terminal = read(&root.join("Utilities/Terminal.app"), true).unwrap();
        assert_eq!(terminal.key, "com.apple.Terminal");
        assert_eq!(terminal.icon, Some(icons::data_url("image/png", &png(32))));
        assert!(read(&root.join("Utilities/Terminal.app"), false)
            .unwrap()
            .icon
            .is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
