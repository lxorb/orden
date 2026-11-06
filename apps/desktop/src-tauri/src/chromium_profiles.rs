use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::browser_profiles::{once, Profile};
use crate::firefox_profiles::BROWSERS_DIR;
use crate::paths::folder_named;

pub(crate) const BROWSERS: [&str; 8] = [
    "chrome", "edge", "brave", "chromium", "vivaldi", "opera", "opera-gx", "arc",
];

const ARC_SIDEBAR: &str = "StorableSidebar.json";

const MOST_SIDEBAR_BYTES: u64 = 64 * 1024 * 1024;

const SESSIONS_KEPT: usize = 3;

pub(crate) fn profiles(browser: &str) -> Vec<Profile> {
    once(
        user_data_folders(browser)
            .iter()
            .flat_map(|home| profiles_in(home)),
    )
}

fn user_data_folders(browser: &str) -> Vec<PathBuf> {
    if let Some(named) = folder_named(std::env::var_os(BROWSERS_DIR).as_deref()) {
        return vec![named.join(browser)];
    }

    let mut found = Vec::new();
    #[cfg(target_os = "linux")]
    {
        let config: &[&str] = match browser {
            "chrome" => &["google-chrome"],
            "edge" => &["microsoft-edge"],
            "brave" => &["BraveSoftware/Brave-Browser"],
            "chromium" => &["chromium"],
            "vivaldi" => &["vivaldi"],
            "opera" => &["opera"],
            _ => &[],
        };
        let home: &[&str] = match browser {
            "chrome" => &[".var/app/com.google.Chrome/config/google-chrome"],
            "edge" => &[".var/app/com.microsoft.Edge/config/microsoft-edge"],
            "brave" => &[
                "snap/brave/current/.config/BraveSoftware/Brave-Browser",
                ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser",
            ],
            "chromium" => &[
                "snap/chromium/common/chromium",
                ".var/app/org.chromium.Chromium/config/chromium",
            ],
            "vivaldi" => &[".var/app/com.vivaldi.Vivaldi/config/vivaldi"],
            "opera" => &[
                "snap/opera/current/.config/opera",
                ".var/app/com.opera.Opera/config/opera",
            ],
            _ => &[],
        };
        if let Some(base) = dirs::config_dir() {
            found.extend(config.iter().map(|one| base.join(one)));
        }
        if let Some(base) = dirs::home_dir() {
            found.extend(home.iter().map(|one| base.join(one)));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(support) = dirs::config_dir() {
        let folder = match browser {
            "chrome" => "Google/Chrome",
            "edge" => "Microsoft Edge",
            "brave" => "BraveSoftware/Brave-Browser",
            "chromium" => "Chromium",
            "vivaldi" => "Vivaldi",
            "opera" => "com.operasoftware.Opera",
            "opera-gx" => "com.operasoftware.OperaGX",
            "arc" => "Arc/User Data",
            _ => return found,
        };
        found.push(support.join(folder));
    }
    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        let folder = match browser {
            "chrome" => "Google/Chrome/User Data",
            "edge" => "Microsoft/Edge/User Data",
            "brave" => "BraveSoftware/Brave-Browser/User Data",
            "chromium" => "Chromium/User Data",
            "vivaldi" => "Vivaldi/User Data",
            "arc" => return arc_homes(&local),
            _ => "",
        };
        if !folder.is_empty() {
            found.push(local.join(folder));
        }
    }
    #[cfg(windows)]
    if let Some(roaming) = dirs::data_dir() {
        match browser {
            "opera" => found.push(roaming.join("Opera Software/Opera Stable")),
            "opera-gx" => found.push(roaming.join("Opera Software/Opera GX Stable")),
            _ => {}
        }
    }

    found
}

#[cfg(windows)]
fn arc_homes(local: &Path) -> Vec<PathBuf> {
    fs::read_dir(local.join("Packages"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("TheBrowserCompany.Arc_"))
        })
        .map(|entry| entry.path().join("LocalCache/Local/Arc/User Data"))
        .collect()
}

#[tauri::command(async)]
pub fn read_arc_sidebar(profile: String) -> Result<String, String> {
    let listed = profiles("arc");
    let asked = crate::paths::folded(Path::new(&profile));
    let one = listed
        .iter()
        .find(|one| crate::paths::folded(Path::new(&one.path)) == asked)
        .ok_or_else(|| format!("{profile} is not a profile Arc lists"))?;
    let path = sidebar_of(Path::new(&one.path)).ok_or("Arc keeps no sidebar here")?;
    let size = fs::metadata(&path)
        .map_err(|error| format!("{ARC_SIDEBAR}: {error}"))?
        .len();
    if size > MOST_SIDEBAR_BYTES {
        return Err(format!("{ARC_SIDEBAR} is larger than any sidebar"));
    }
    fs::read_to_string(&path).map_err(|error| format!("{ARC_SIDEBAR} could not be read: {error}"))
}

fn sidebar_of(profile: &Path) -> Option<PathBuf> {
    let path = profile.parent()?.parent()?.join(ARC_SIDEBAR);
    path.is_file().then_some(path)
}

fn profiles_in(home: &Path) -> Vec<Profile> {
    let state = fs::read_to_string(home.join("Local State"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let named = state.as_ref().map_or_else(
        || vec![("Default".to_owned(), "Default".to_owned())],
        names_in,
    );

    let listed: Vec<Profile> = named
        .into_iter()
        .filter(|(folder, _)| is_profile_folder(folder))
        .filter_map(|(folder, name)| {
            let path = home.join(&folder);
            let files = files_of(&path);
            (!files.is_empty()).then(|| Profile {
                name,
                path: path.to_string_lossy().into_owned(),
                files,
            })
        })
        .collect();
    if !listed.is_empty() {
        return listed;
    }

    let files = files_of(home);
    if files.iter().any(|one| one != "Preferences") {
        return vec![Profile {
            name: "Default".into(),
            path: home.to_string_lossy().into_owned(),
            files,
        }];
    }
    Vec::new()
}

fn names_in(state: &Value) -> Vec<(String, String)> {
    let profile = &state["profile"];
    let Some(cache) = profile["info_cache"].as_object() else {
        return Vec::new();
    };

    let mut folders: Vec<&str> = profile["profiles_order"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|folder| cache.contains_key(*folder))
        .collect();
    let mut rest: Vec<&str> = cache
        .keys()
        .map(String::as_str)
        .filter(|folder| !folders.contains(folder))
        .collect();
    rest.sort_unstable();
    folders.extend(rest);

    folders
        .into_iter()
        .map(|folder| {
            let name = cache[folder]["name"]
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(folder);
            (folder.to_owned(), name.to_owned())
        })
        .collect()
}

fn is_profile_folder(folder: &str) -> bool {
    !folder.is_empty() && folder != "." && folder != ".." && !folder.contains(['/', '\\', ':'])
}

fn files_of(profile: &Path) -> Vec<String> {
    let mut found: Vec<String> = ["Bookmarks", "AccountBookmarks"]
        .into_iter()
        .filter(|name| profile.join(name).is_file())
        .map(str::to_owned)
        .collect();
    found.extend(newest(profile, "Sessions", SESSIONS_KEPT));
    found.extend(
        ["Current Session", "Last Session"]
            .into_iter()
            .filter(|name| profile.join(name).is_file())
            .map(str::to_owned),
    );
    found.extend(newest(profile, "Sessions_Encrypted", 1));
    found.extend(
        ["Preferences", "History", "Favicons"]
            .into_iter()
            .filter(|name| profile.join(name).is_file())
            .map(str::to_owned),
    );
    found
}

fn newest(profile: &Path, folder: &str, most: usize) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(profile.join(folder))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| {
            name.strip_prefix("Session_").is_some_and(|time| {
                !time.is_empty() && time.bytes().all(|one| one.is_ascii_digit())
            })
        })
        .collect();
    names.sort_unstable_by(|a, b| b.cmp(a));
    names
        .into_iter()
        .take(most)
        .map(|name| format!("{folder}/{name}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser_profiles::known;

    fn touch(at: &Path) {
        fs::create_dir_all(at.parent().expect("a folder")).expect("the folder");
        fs::write(at, b"SNSS").expect("a file");
    }

    const STATE: &str = r#"{"profile":{"info_cache":{
        "Default":{"name":"Person 1"},
        "Profile 2":{"name":"Work"},
        "Profile 3":{"name":"  "},
        "../../etc":{"name":"Elsewhere"}
      },"profiles_order":["Profile 2","Default","Gone"]}}"#;

    #[test]
    fn the_profiles_come_in_the_pickers_order_with_their_names() {
        let home = tempfile::tempdir().expect("a folder");
        fs::write(home.path().join("Local State"), STATE).expect("the state");
        touch(&home.path().join("Default/Bookmarks"));
        touch(
            &home
                .path()
                .join("Profile 2/Sessions/Session_13436813666016900"),
        );
        touch(&home.path().join("Profile 3/Bookmarks"));
        touch(&home.path().join("Profile 4/Bookmarks"));

        let found = profiles_in(home.path());
        let names: Vec<(&str, &str)> = found
            .iter()
            .map(|one| {
                let folder = Path::new(&one.path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                (folder, one.name.as_str())
            })
            .collect();
        assert_eq!(
            names,
            vec![
                ("Profile 2", "Work"),
                ("Default", "Person 1"),
                ("Profile 3", "Profile 3")
            ]
        );
    }

    #[test]
    fn a_profile_lists_both_bookmark_files_its_newest_sessions_and_its_newest_encrypted_one() {
        let home = tempfile::tempdir().expect("a folder");
        let profile = home.path().join("Default");
        for file in [
            "Bookmarks",
            "AccountBookmarks",
            "Sessions/Session_13436813600000000",
            "Sessions/Session_13436813666016900",
            "Sessions/Session_13436813611111111",
            "Sessions/Session_13436813500000000",
            "Sessions/Tabs_13436813671346718",
            "Sessions_Encrypted/Session_13436813666016901",
            "Sessions_Encrypted/Session_13436813600000001",
            "Current Session",
            "Cookies",
        ] {
            touch(&profile.join(file));
        }

        assert_eq!(
            files_of(&profile),
            vec![
                "Bookmarks",
                "AccountBookmarks",
                "Sessions/Session_13436813666016900",
                "Sessions/Session_13436813611111111",
                "Sessions/Session_13436813600000000",
                "Current Session",
                "Sessions_Encrypted/Session_13436813666016901",
            ]
        );
    }

    #[test]
    fn the_engine_and_the_databases_come_last() {
        let home = tempfile::tempdir().expect("a folder");
        let profile = home.path().join("Default");
        for file in [
            "Favicons",
            "History",
            "Preferences",
            "Bookmarks",
            "Login Data",
        ] {
            touch(&profile.join(file));
        }
        assert_eq!(
            files_of(&profile),
            vec!["Bookmarks", "Preferences", "History", "Favicons"]
        );
    }

    #[test]
    fn operas_first_profile_is_its_user_data_folder() {
        let home = tempfile::tempdir().expect("a folder");
        fs::write(home.path().join("Local State"), "{}").expect("the state");
        touch(&home.path().join("Bookmarks"));
        touch(&home.path().join("Preferences"));
        let found = profiles_in(home.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, home.path().to_string_lossy());
        assert_eq!(found[0].files, vec!["Bookmarks", "Preferences"]);

        let bare = tempfile::tempdir().expect("a folder");
        touch(&bare.path().join("Preferences"));
        assert!(profiles_in(bare.path()).is_empty());
    }

    #[test]
    fn arcs_sidebar_is_beside_its_user_data() {
        let arc = tempfile::tempdir().expect("a folder");
        let profile = arc.path().join("User Data/Default");
        touch(&profile.join("History"));
        assert_eq!(sidebar_of(&profile), None);
        touch(&arc.path().join(ARC_SIDEBAR));
        assert_eq!(sidebar_of(&profile), Some(arc.path().join(ARC_SIDEBAR)));
    }

    #[test]
    fn a_folder_without_local_state_has_its_default_profile() {
        let home = tempfile::tempdir().expect("a folder");
        touch(&home.path().join("Default/Bookmarks"));
        let found = profiles_in(home.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Default");
        assert!(profiles_in(&home.path().join("nowhere")).is_empty());
    }

    #[test]
    fn only_a_listed_file_of_a_listed_profile_is_read() {
        let listed = vec![Profile {
            name: "Person 1".into(),
            path: "/home/me/.config/google-chrome/Default".into(),
            files: vec!["Bookmarks".into()],
        }];
        let at = "/home/me/.config/google-chrome/Default";
        assert!(known("Chrome", at, "Bookmarks", &listed).is_ok());
        assert!(known("Chrome", at, "Login Data", &listed).is_err());
        assert!(known("Chrome", at, "../Local State", &listed).is_err());
    }
}
