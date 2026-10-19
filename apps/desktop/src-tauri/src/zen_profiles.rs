//! The profiles Zen keeps on this machine, and the file of each that holds its
//! spaces and tabs.
//!
//! Zen is Firefox underneath, so it keeps a `profiles.ini` in its own folder - the
//! one Firefox keeps in `Mozilla/Firefox`, under the name Zen builds with, `zen` -
//! and a profile folder per profile. Arc's first run lists the browsers on the
//! machine by name; this lists Zen's profiles the same way, out of Zen's own list,
//! so nobody hunts for a folder called `x7k2.Default (release)`.
//!
//! The sidebar is in `zen-sessions.jsonlz4` in the profile, with backups beside it;
//! a profile from before that file holds the same lists in Firefox's own session,
//! `sessionstore-backups/recovery.jsonlz4`. Those few files, by those names, are all
//! this reads, and only out of a profile Zen lists: a narrow way past paths.rs, as
//! `obsidian_vaults.rs` is. Never written, and read while Zen runs: `fs::read` opens a
//! file sharing it for reading, writing and deleting, which is how Zen replaces it,
//! and the bytes are a copy the moment they are read. The unpacking is the app's;
//! see `import/mozlz4.ts`.
//!
//! Desktop only: a phone's Zen, where there is one, is somebody else's sandbox.

use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
use crate::browser_profiles::{entries_in, installed_defaults};
use crate::browser_profiles::{ini_profiles, once, read_listed, Profile};
use crate::paths::folder_named;

/// One profile, the way Zen's profile manager shows it.
pub type ZenProfile = Profile;

/// Where a drive keeps a Zen of its own, so a probe never reads the reader's: the
/// folder `profiles.ini` is in. The same rule as `NIB_SPACES_DIR`.
const ZEN_DIR: &str = "NIB_ZEN_DIR";

/// The session files, in the order they are worth reading: Zen's own, its last
/// clean copy, and Firefox's session, which carries the same lists on each window.
/// The newest of Zen's dated backups goes after its clean copy; see `files_of`.
const SESSIONS: [&str; 4] = [
    "zen-sessions.jsonlz4",
    "zen-sessions-backup/clean.jsonlz4",
    "sessionstore-backups/recovery.jsonlz4",
    "sessionstore.jsonlz4",
];

/// Where Zen keeps its dated backups, and what each is called.
const BACKUPS: &str = "zen-sessions-backup";
const BACKUP_PREFIX: &str = "zen-sessions-";
const BACKUP_SUFFIX: &str = ".jsonlz4";

/// The profiles on this machine that hold a session, the one Zen opens first in
/// front. None where Zen has never run.
#[tauri::command(async)]
pub fn zen_profiles() -> Vec<ZenProfile> {
    listed()
}

/// One session file of a profile Zen lists, as base64, which is how bytes cross the
/// bridge.
#[tauri::command(async)]
pub fn read_zen_file(profile: String, file: String) -> Result<String, String> {
    read_listed("Zen", &profile, &file, &listed())
}

fn listed() -> Vec<ZenProfile> {
    once(homes().iter().flat_map(|home| profiles_in(home)))
}

/// The folders Zen keeps `profiles.ini` in: its own folder in the system's
/// application data, and on Linux the dotted folder Firefox's lineage uses and the
/// Flatpak's own home.
fn homes() -> Vec<PathBuf> {
    if let Some(named) = folder_named(std::env::var_os(ZEN_DIR).as_deref()) {
        return vec![named];
    }

    let mut found = Vec::new();
    if let Some(config) = dirs::config_dir() {
        found.push(config.join("zen"));
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        found.push(home.join(".zen"));
        found.push(home.join(".var/app/app.zen_browser.zen/.zen"));
    }

    found
}

/// The profiles of one `profiles.ini` that hold a session: the one an install
/// opens first, then the one marked default, then the rest in the file's order.
fn profiles_in(home: &Path) -> Vec<ZenProfile> {
    ini_profiles(home, files_of)
}

/// The session files a profile holds, in the order they are worth reading.
fn files_of(profile: &Path) -> Vec<String> {
    let mut found: Vec<String> = SESSIONS
        .iter()
        .filter(|name| profile.join(name).is_file())
        .map(|name| (*name).to_owned())
        .collect();

    let newest = fs::read_dir(profile.join(BACKUPS))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX))
        .max();
    if let Some(name) = newest {
        let at = found
            .iter()
            .position(|one| one.starts_with("sessionstore"))
            .unwrap_or(found.len());
        found.insert(at, format!("{BACKUPS}/{name}"));
    }

    found
}

/// The file asked for, when the profile is one Zen lists and the file is one of the
/// session files that profile was listed with: never a path the caller made up.
#[cfg(test)]
fn known(profile: &str, file: &str, listed: &[ZenProfile]) -> Result<PathBuf, String> {
    crate::browser_profiles::known("Zen", profile, file, listed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Install6F193CCC56814779]\r\nDefault=Profiles/b2.Default (release)\r\nLocked=1\r\n\r\n[Profile1]\r\nName=Default Profile\r\nIsRelative=1\r\nPath=Profiles/a1.default\r\nDefault=1\r\n\r\n[Profile0]\r\nName=Default (release)\r\nIsRelative=1\r\nPath=Profiles/b2.Default (release)\r\n\r\n[Profile2]\r\nName=Work\r\nIsRelative=1\r\nPath=Profiles/c3.Work\r\n\r\n[General]\r\nStartWithLastProfile=1\r\nVersion=2\r\n";

    fn profile(home: &Path, path: &str, files: &[&str]) {
        for file in files {
            let at = home.join(path).join(file);
            fs::create_dir_all(at.parent().expect("a folder")).expect("the folder");
            fs::write(at, b"mozLz40\0").expect("a session");
        }
    }

    #[test]
    fn every_profile_of_the_file_is_read() {
        assert_eq!(
            entries_in(INI)
                .into_iter()
                .map(|one| (one.name, one.path, one.relative, one.default))
                .collect::<Vec<_>>(),
            vec![
                (
                    "Default Profile".into(),
                    "Profiles/a1.default".into(),
                    true,
                    true
                ),
                (
                    "Default (release)".into(),
                    "Profiles/b2.Default (release)".into(),
                    true,
                    false
                ),
                ("Work".into(), "Profiles/c3.Work".into(), true, false),
            ]
        );
        assert_eq!(
            installed_defaults(INI),
            vec!["Profiles/b2.Default (release)".to_owned()]
        );
    }

    #[test]
    fn the_profile_zen_opens_comes_first_and_one_without_a_session_not_at_all() {
        let here = tempfile::tempdir().expect("a folder");
        fs::write(here.path().join("profiles.ini"), INI).expect("the list");
        profile(
            here.path(),
            "Profiles/a1.default",
            &["sessionstore-backups/recovery.jsonlz4"],
        );
        profile(
            here.path(),
            "Profiles/b2.Default (release)",
            &["zen-sessions.jsonlz4"],
        );
        fs::create_dir_all(here.path().join("Profiles/c3.Work")).expect("an empty profile");

        let found = profiles_in(here.path());
        let names: Vec<&str> = found.iter().map(|one| one.name.as_str()).collect();
        assert_eq!(names, vec!["Default (release)", "Default Profile"]);
        assert_eq!(found[0].files, vec!["zen-sessions.jsonlz4".to_owned()]);
    }

    #[test]
    fn the_session_files_come_in_the_order_they_are_worth_reading() {
        let here = tempfile::tempdir().expect("a folder");
        profile(
            here.path(),
            "p",
            &[
                "sessionstore-backups/recovery.jsonlz4",
                "zen-sessions.jsonlz4",
                "zen-sessions-backup/clean.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-01-09.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-12-21.jsonlz4",
                "zen-sessions-backup/recovery.baklz4",
            ],
        );

        assert_eq!(
            files_of(&here.path().join("p")),
            vec![
                "zen-sessions.jsonlz4",
                "zen-sessions-backup/clean.jsonlz4",
                "zen-sessions-backup/zen-sessions-2026-10-12-21.jsonlz4",
                "sessionstore-backups/recovery.jsonlz4",
            ]
        );
    }

    #[test]
    fn only_a_listed_file_of_a_listed_profile_is_read() {
        let listed = vec![ZenProfile {
            name: "Default".into(),
            path: "/home/me/.zen/p".into(),
            files: vec!["zen-sessions.jsonlz4".into()],
        }];

        assert!(known("/home/me/.zen/p", "zen-sessions.jsonlz4", &listed).is_ok());
        assert!(known("/home/me/.zen/p/../q", "zen-sessions.jsonlz4", &listed).is_err());
        assert!(known("/home/me/.zen/p", "../../.ssh/id_ed25519", &listed).is_err());
        assert!(known("/home/me/.zen/p", "places.sqlite", &listed).is_err());
        assert!(known("/home/me/.zen/other", "zen-sessions.jsonlz4", &listed).is_err());
    }

    #[test]
    fn a_missing_or_broken_list_is_no_profiles() {
        let here = tempfile::tempdir().expect("a folder");
        assert!(profiles_in(here.path()).is_empty());
        fs::write(here.path().join("profiles.ini"), "not an ini\0\u{1}").expect("a list");
        assert!(profiles_in(here.path()).is_empty());
    }
}
