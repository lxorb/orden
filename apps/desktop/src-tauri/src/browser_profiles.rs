//! What every browser's import shares on this side: a profile as the import lists it,
//! the `profiles.ini` Firefox and everything built on it keep, and the one narrow way
//! a listed file of a listed profile is read. Zen's row is the first to use it; see
//! `zen_profiles.rs`. Read and never written: `fs::read` opens a file sharing it for
//! reading, writing and deleting, which is how a running browser replaces it, and the
//! bytes are a copy the moment they are read.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::folded;

/// One profile, the way the browser's own profile manager shows it.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Profile {
    pub name: String,
    pub path: String,
    /// The files of it the import reads, the one to read first in front.
    pub files: Vec<String>,
}

/// More than any session or bookmark file is. A file past it is not one, and the app
/// holds what it reads whole.
const MOST_BYTES: u64 = 128 * 1024 * 1024;

/// One listed file of a listed profile, as base64, which is how bytes cross the
/// bridge.
pub(crate) fn read_listed(
    browser: &str,
    profile: &str,
    file: &str,
    listed: &[Profile],
) -> Result<String, String> {
    let path = known(browser, profile, file, listed)?;
    let size = fs::metadata(&path)
        .map_err(|error| format!("{file}: {error}"))?
        .len();
    if size > MOST_BYTES {
        return Err(format!("{file} is larger than any session"));
    }
    let bytes = fs::read(&path).map_err(|error| format!("{file} could not be read: {error}"))?;
    Ok(BASE64.encode(bytes))
}

/// Each profile once, the first place it was found winning: one folder reached under
/// two spellings is one profile.
pub(crate) fn once(all: impl IntoIterator<Item = Profile>) -> Vec<Profile> {
    all.into_iter().fold(Vec::new(), |mut kept, one| {
        if !kept.iter().any(|held: &Profile| held.path == one.path) {
            kept.push(one);
        }
        kept
    })
}

/// The profiles of one `profiles.ini` that hold something `files_of` finds: the one
/// an install opens first, then the one marked default, then the rest in the file's
/// order.
pub(crate) fn ini_profiles(home: &Path, files_of: impl Fn(&Path) -> Vec<String>) -> Vec<Profile> {
    let Ok(text) = fs::read_to_string(home.join("profiles.ini")) else {
        return Vec::new();
    };

    let mut found: Vec<(u8, Profile)> = Vec::new();
    let opened = installed_defaults(&text);
    for entry in entries_in(&text) {
        let folder = if entry.relative {
            home.join(&entry.path)
        } else {
            PathBuf::from(&entry.path)
        };
        let files = files_of(&folder);
        if files.is_empty() {
            continue;
        }
        let rank = if opened.contains(&entry.path) {
            0
        } else if entry.default {
            1
        } else {
            2
        };
        found.push((
            rank,
            Profile {
                name: entry.name,
                path: folder.to_string_lossy().into_owned(),
                files,
            },
        ));
    }

    found.sort_by_key(|(rank, _)| *rank);
    found.into_iter().map(|(_, one)| one).collect()
}

/// A `[ProfileN]` section.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Entry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) relative: bool,
    pub(crate) default: bool,
}

/// The sections of an INI file as `(section, key, value)` rows, keys and sections
/// compared without case the way Firefox's own parser compares them.
fn rows(text: &str) -> Vec<(String, String, String)> {
    let mut section = String::new();
    let mut found = Vec::new();

    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            name.trim().clone_into(&mut section);
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            found.push((
                section.clone(),
                key.trim().to_ascii_lowercase(),
                value.trim().to_owned(),
            ));
        }
    }

    found
}

/// Every profile the file names, in its order.
pub(crate) fn entries_in(text: &str) -> Vec<Entry> {
    let rows = rows(text);
    let mut sections: Vec<&str> = Vec::new();
    for (section, _, _) in &rows {
        if section.to_ascii_lowercase().starts_with("profile")
            && !sections.contains(&section.as_str())
        {
            sections.push(section);
        }
    }

    sections
        .into_iter()
        .filter_map(|section| {
            let value = |key: &str| {
                rows.iter()
                    .find(|(one, name, _)| one == section && name == key)
                    .map(|(_, _, value)| value.clone())
            };
            let path = value("path").filter(|one| !one.is_empty())?;
            Some(Entry {
                name: value("name")
                    .filter(|one| !one.is_empty())
                    .unwrap_or_else(|| path.clone()),
                relative: value("isrelative").as_deref() != Some("0"),
                default: value("default").as_deref() == Some("1"),
                path,
            })
        })
        .collect()
}

/// The profile each install opens first: `[InstallXXXX]` sections, one per copy of
/// the browser on the machine, each with `Default=` the profile's `Path`.
pub(crate) fn installed_defaults(text: &str) -> Vec<String> {
    rows(text)
        .into_iter()
        .filter(|(section, key, _)| {
            section.to_ascii_lowercase().starts_with("install") && key == "default"
        })
        .map(|(_, _, value)| value)
        .collect()
}

/// The file asked for, when the profile is one `browser` lists and the file is one
/// of the files that profile was listed with: never a path the caller made up.
pub(crate) fn known(
    browser: &str,
    profile: &str,
    file: &str,
    listed: &[Profile],
) -> Result<PathBuf, String> {
    let asked = folded(Path::new(profile));
    let one = listed
        .iter()
        .find(|one| folded(Path::new(&one.path)) == asked)
        .ok_or_else(|| format!("{profile} is not a profile {browser} lists"))?;
    if !one.files.iter().any(|name| name == file) {
        return Err(format!("{file} is not a file of that profile"));
    }
    Ok(Path::new(&one.path).join(file))
}
