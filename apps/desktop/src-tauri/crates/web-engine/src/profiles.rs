use std::fmt;
use std::path::{Path, PathBuf};

use orden_contracts::{Failure, FailureKind, Outcome};

use crate::MODULE;

pub const ROOT: &str = "chromium";

pub const APP_PROFILE: &str = "app";

pub const STORE_PROFILE: &str = "store-";

pub const LONGEST_STORE_NAME: usize = 160;

const STORE_PREFIXES: [&str; 3] = ["note_", "space_", "site_"];

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct StoreName(String);

impl StoreName {
    pub fn parse(asked: Option<&str>) -> Outcome<Option<Self>> {
        let Some(name) = asked.filter(|one| !one.is_empty()) else {
            return Ok(None);
        };
        let fine = name.len() <= LONGEST_STORE_NAME
            && STORE_PREFIXES
                .iter()
                .any(|prefix| name.starts_with(prefix) && name.len() > prefix.len())
            && name.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'.' | b'-' | b'_')
            })
            && !name.ends_with('_');
        if fine {
            Ok(Some(Self(name.to_owned())))
        } else {
            Err(Failure::new(
                MODULE,
                FailureKind::Invalid,
                "that is not a store a web tab can be in",
            ))
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for StoreName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Profiles {
    root: PathBuf,
}

impl Profiles {
    #[must_use]
    pub fn under(config: &Path) -> Self {
        Self {
            root: config.join(ROOT),
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn app(&self) -> PathBuf {
        self.root.join(APP_PROFILE)
    }

    #[must_use]
    pub fn of(&self, store: Option<&StoreName>) -> PathBuf {
        match store {
            None => self.root.clone(),
            Some(name) => self.root.join(format!("{STORE_PROFILE}{name}")),
        }
    }
}
