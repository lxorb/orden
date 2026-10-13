//! The themes Chrome and Firefox wear on this machine, as each browser holds them:
//! the `theme` of an extension's manifest, and Firefox's `userChrome.css` and
//! `userContent.css` with every sheet they import written into them. Chrome has had
//! no stylesheet of the reader's own since version 32, so a manifest is all there is
//! to read of it.
//!
//! Found by walking every folder either browser keeps profiles in, on every desktop
//! and in every packaging, rather than by asking which is installed: a folder that is
//! not there holds no themes. Read and never written; what a theme becomes is the
//! window's to say, in `lib/themes/browser.ts`.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};

/// One theme, in its browser's own words.
#[derive(Serialize)]
pub struct BrowserTheme {
    name: String,
    source: String,
    /// Whether `source` is a stylesheet rather than a manifest's `theme`.
    css: bool,
    /// What the profile's `userContent.css` says of pages, read as `source` is.
    pages: String,
}

/// Where Firefox keeps its profile folders, under the home folder or either of the
/// system's application-data folders: Linux's own, its XDG one, the Snap's and the
/// Flatpak's, then Windows' and a Mac's.
const FIREFOX: [&str; 6] = [
    ".mozilla/firefox",
    "mozilla/firefox",
    "snap/firefox/common/.mozilla/firefox",
    ".var/app/org.mozilla.firefox/.mozilla/firefox",
    "Mozilla/Firefox/Profiles",
    "Firefox/Profiles",
];

/// And Chrome and Chromium theirs, in the same order.
const CHROME: [&str; 9] = [
    "google-chrome",
    "chromium",
    "snap/chromium/common/chromium",
    ".var/app/com.google.Chrome/config/google-chrome",
    ".var/app/org.chromium.Chromium/config/chromium",
    "Google/Chrome/User Data",
    "Chromium/User Data",
    "Google/Chrome",
    "Chromium",
];

/// The themes one browser has, by name: Firefox's for `firefox`, else Chrome's.
#[tauri::command(async)]
pub fn browser_themes(browser: String) -> Vec<BrowserTheme> {
    let bases = [dirs::home_dir(), dirs::config_dir(), dirs::data_local_dir()];
    let bases: Vec<PathBuf> = bases.into_iter().flatten().collect();
    themes_under(&bases, browser == "firefox")
}

fn themes_under(bases: &[PathBuf], firefox: bool) -> Vec<BrowserTheme> {
    let homes: &[&str] = if firefox { &FIREFOX } else { &CHROME };
    let themes_in: fn(&Path) -> Vec<BrowserTheme> = if firefox {
        firefox_themes
    } else {
        chrome_themes
    };
    let mut found: Vec<BrowserTheme> = bases
        .iter()
        .flat_map(|base| homes.iter().map(move |home| base.join(home)))
        .flat_map(|home| entries(&home))
        .flat_map(|profile| themes_in(&profile))
        .collect();

    // One theme in two profiles, or one folder under two spellings, is one theme.
    found.sort_by(|a, b| (&a.name, &a.source).cmp(&(&b.name, &b.source)));
    found.dedup_by(|a, b| a.name == b.name && a.source == b.source);
    found
}

/// What a folder holds, which is nothing where there is no such folder.
fn entries(dir: &Path) -> Vec<PathBuf> {
    let read = fs::read_dir(dir).into_iter().flatten().flatten();
    read.map(|entry| entry.path()).collect()
}

/// A Firefox profile's: its `userChrome.css`, named for the profile once the salt
/// in front of the folder's name is gone, and every theme among its add-ons.
fn firefox_themes(profile: &Path) -> Vec<BrowserTheme> {
    let sheet = profile.join("chrome/userChrome.css");
    let folder = profile.file_name().unwrap_or_default().to_string_lossy();
    let name = folder.split_once('.').map_or(&*folder, |(_, name)| name);
    let prefs = ["prefs.js", "user.js"].map(|file| fs::read_to_string(profile.join(file)));
    let prefs = prefs.map(Result::unwrap_or_default).concat();
    let own = sheet.is_file().then(|| BrowserTheme {
        name: format!("userChrome ({name})"),
        source: inlined(&sheet, &prefs, 8),
        css: true,
        pages: inlined(&profile.join("chrome/userContent.css"), &prefs, 8),
    });

    let add_ons = entries(&profile.join("extensions"));
    let packed = add_ons
        .iter()
        .filter_map(|xpi| theme_of(&manifest_in(xpi)?));
    own.into_iter().chain(packed).collect()
}

/// A Chrome profile's: every version of every extension that is a theme.
fn chrome_themes(profile: &Path) -> Vec<BrowserTheme> {
    let extensions = entries(&profile.join("Extensions"));
    let manifests = extensions
        .iter()
        .flat_map(|one| entries(one))
        .map(|version| version.join("manifest.json"));
    manifests
        .filter_map(|manifest| theme_of(&fs::read_to_string(manifest).ok()?))
        .collect()
}

/// An extension's manifest as a theme, where it is one.
fn theme_of(manifest: &str) -> Option<BrowserTheme> {
    let read: Value = serde_json::from_str(manifest).ok()?;
    Some(BrowserTheme {
        name: read.get("name")?.as_str()?.to_string(),
        source: read.get("theme")?.to_string(),
        css: false,
        pages: String::new(),
    })
}

/// The manifest of an add-on, which Firefox keeps packed.
fn manifest_in(xpi: &Path) -> Option<String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(xpi).ok()?).ok()?;
    let mut packed = archive.by_name("manifest.json").ok()?;
    let mut manifest = String::new();
    packed.read_to_string(&mut manifest).ok()?;
    Some(manifest)
}

/// A stylesheet with its comments gone and every sheet it imports in the import's
/// place, as Firefox reads it: an import somebody commented out is not one, and one
/// behind a preference is one only where `prefs`, the profile's own, turn it on.
/// `depth` is what ends a sheet that imports itself.
fn inlined(sheet: &Path, prefs: &str, depth: u8) -> String {
    let mut css = fs::read_to_string(sheet).unwrap_or_default();
    while let Some(start) = css.find("/*") {
        let end = css[start..]
            .find("*/")
            .map_or(css.len(), |at| start + at + 2);
        css.replace_range(start..end, " ");
    }

    let imported = |line: &str| {
        let rest = line.trim().strip_prefix("@import").filter(|_| depth > 0)?;
        let behind = rest.split("-moz-bool-pref:").nth(1);
        let pref = behind.and_then(|said| said.split('"').nth(1));
        if pref.is_some_and(|name| !prefs.contains(&format!("\"{name}\", true"))) {
            return Some(String::new());
        }
        let mut parts = rest.split(['\'', '"', '(', ')']).map(str::trim);
        let is_css = |file: &&str| {
            Path::new(file)
                .extension()
                .is_some_and(|end| end.eq_ignore_ascii_case("css"))
        };
        let file = sheet.with_file_name(parts.find(is_css)?);
        Some(inlined(&file, prefs, depth - 1))
    };
    let lines = css
        .lines()
        .map(|line| imported(line).unwrap_or_else(|| line.to_string()));
    lines.collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::themes_under;
    use std::fs;
    use std::io::Write as _;
    use std::path::PathBuf;

    /// A home with a Firefox profile and a Chromium one in it: the stylesheet with
    /// what it imports and not what it commented out or left behind a preference that
    /// is off, the add-on that is a theme and not the one that is not, and each
    /// browser's own and never the other's.
    #[test]
    fn every_theme_of_a_browser_is_found_and_nothing_else() {
        let home = tempfile::tempdir().expect("a temp folder");
        let profile = home.path().join(".mozilla/firefox/x1.work");
        let version = home.path().join("chromium/Default/Extensions/abc/1.0_0");
        let write = |path: PathBuf, bytes: &[u8]| {
            fs::create_dir_all(path.parent().expect("a folder")).expect("a folder");
            fs::write(path, bytes).expect("a file");
        };
        let packed = |manifest: &str| {
            let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            let options = zip::write::SimpleFileOptions::default();
            archive
                .start_file("manifest.json", options)
                .expect("an entry");
            archive.write_all(manifest.as_bytes()).expect("a manifest");
            archive.finish().expect("an archive").into_inner()
        };

        write(
            profile.join("chrome/colors/dark.css"),
            b":root { --toolbar-bgcolor: #111; }",
        );
        write(
            profile.join("chrome/colors/light.css"),
            b":root { --toolbar-bgcolor: #fafafa; }",
        );
        let sheet = "/*\n@import url('colors/light.css');\n*/\n@import 'colors/light.css' (-moz-bool-pref: \"uc.light\");\n@import url('colors/dark.css') (-moz-bool-pref: \"uc.dark\");\n#nav-bar {}";
        write(profile.join("user.js"), br#"user_pref("uc.dark", true);"#);
        write(profile.join("chrome/userChrome.css"), sheet.as_bytes());
        write(
            profile.join("chrome/userContent.css"),
            b"body { color: red; }",
        );
        write(
            profile.join("extensions/fox.xpi"),
            &packed(r#"{"name":"Fox","theme":{"colors":{}}}"#),
        );
        write(
            profile.join("extensions/blocker.xpi"),
            &packed(r#"{"name":"Blocker"}"#),
        );
        write(
            version.join("manifest.json"),
            br#"{"name":"Black","theme":{"colors":{}}}"#,
        );

        let bases = [home.path().to_path_buf()];
        let pages = themes_under(&bases, true).into_iter().map(|one| one.pages);
        assert_eq!(pages.collect::<Vec<_>>(), ["", "body { color: red; }"]);
        let found = |firefox| {
            let themes = themes_under(&bases, firefox);
            themes
                .into_iter()
                .map(|one| (one.name, one.source))
                .collect::<Vec<_>>()
        };
        let colours = r#"{"colors":{}}"#.to_string();
        assert_eq!(found(false), [("Black".to_string(), colours.clone())]);

        let firefox = found(true);
        assert_eq!(firefox[0], ("Fox".to_string(), colours));
        assert_eq!(
            (firefox.len(), firefox[1].0.as_str()),
            (2, "userChrome (work)")
        );
        assert!(firefox[1].1.contains("#111") && firefox[1].1.contains("#nav-bar"));
        assert!(!firefox[1].1.contains("#fafafa") && !firefox[1].1.contains("@import"));
    }
}
