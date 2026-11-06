use std::ffi::OsString;
use std::path::PathBuf;

pub const IDENTIFIER: &str = env!("NIB_IDENTIFIER");

pub const VERSION: &str = env!("NIB_VERSION");

pub fn config_dir() -> Option<PathBuf> {
    base(|name| std::env::var_os(name)).map(|base| base.join(IDENTIFIER))
}

fn absolute(value: Option<OsString>) -> Option<PathBuf> {
    value.map(PathBuf::from).filter(|path| path.is_absolute())
}

#[cfg(windows)]
fn base(var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    absolute(var("APPDATA"))
        .or_else(|| absolute(var("USERPROFILE")).map(|home| home.join("AppData").join("Roaming")))
}

#[cfg(target_os = "macos")]
fn base(var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    absolute(var("HOME")).map(|home| home.join("Library").join("Application Support"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn base(var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    absolute(var("XDG_CONFIG_HOME"))
        .or_else(|| absolute(var("HOME")).map(|home| home.join(".config")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_build_said_who_this_is() {
        assert!(IDENTIFIER.contains('.'), "{IDENTIFIER}");
        assert!(!VERSION.is_empty());
    }

    #[test]
    fn the_folder_is_named_after_the_identifier() {
        if let Some(dir) = config_dir() {
            assert!(dir.ends_with(IDENTIFIER));
        }
    }

    #[test]
    fn a_relative_or_empty_variable_says_nothing() {
        assert_eq!(absolute(Some(OsString::from(""))), None);
        assert_eq!(absolute(Some(OsString::from("relative/folder"))), None);
        assert_eq!(absolute(None), None);
    }

    #[cfg(windows)]
    #[test]
    fn windows_reads_the_roaming_folder_first() {
        let said = |name: &str| match name {
            "APPDATA" => Some(OsString::from(r"C:\Users\a\AppData\Roaming")),
            "USERPROFILE" => Some(OsString::from(r"C:\Users\b")),
            _ => None,
        };
        assert_eq!(
            base(said),
            Some(PathBuf::from(r"C:\Users\a\AppData\Roaming"))
        );
        let without = |name: &str| (name == "USERPROFILE").then(|| OsString::from(r"C:\Users\b"));
        assert_eq!(
            base(without),
            Some(PathBuf::from(r"C:\Users\b\AppData\Roaming"))
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn linux_reads_the_xdg_folder_first() {
        let said = |name: &str| match name {
            "XDG_CONFIG_HOME" => Some(OsString::from("/x/config")),
            "HOME" => Some(OsString::from("/home/a")),
            _ => None,
        };
        assert_eq!(base(said), Some(PathBuf::from("/x/config")));
        let without = |name: &str| (name == "HOME").then(|| OsString::from("/home/a"));
        assert_eq!(base(without), Some(PathBuf::from("/home/a/.config")));
    }
}
