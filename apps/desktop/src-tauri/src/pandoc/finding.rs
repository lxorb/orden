use std::ffi::OsStr;
use std::path::{Path, PathBuf};

const WELL_KNOWN: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/nix/var/nix/profiles/default/bin",
    "/run/current-system/sw/bin",
];

const IN_HOME: &[&str] = &[".local/bin", ".cabal/bin", ".ghcup/bin", ".nix-profile/bin"];

pub fn folders(path: Option<&OsStr>, home: Option<&Path>) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = path
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();

    found.extend(WELL_KNOWN.iter().map(PathBuf::from));
    if let Some(home) = home {
        found.extend(IN_HOME.iter().map(|inside| home.join(inside)));
    }

    found
}

pub fn first_in(folders: &[PathBuf], runs: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    folders
        .iter()
        .map(|folder| folder.join("pandoc"))
        .find(|program| runs(program))
}

pub fn shell_answer(printed: &str) -> Option<PathBuf> {
    let last = printed
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())?;
    last.starts_with('/').then(|| PathBuf::from(last))
}

#[cfg(all(test, unix))]
mod tests {
    use super::{first_in, folders, shell_answer};
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    #[test]
    fn looks_where_the_app_was_started_first_then_where_package_managers_put_it() {
        let found = folders(
            Some(OsStr::new("/usr/bin:/bin")),
            Some(Path::new("/Users/e")),
        );

        assert_eq!(found[0], PathBuf::from("/usr/bin"));
        assert_eq!(found[2], PathBuf::from("/opt/homebrew/bin"));
        assert!(found.contains(&PathBuf::from("/opt/local/bin")));
        assert!(found.contains(&PathBuf::from("/Users/e/.local/bin")));
    }

    #[test]
    fn still_looks_with_no_path_and_no_home() {
        let found = folders(None, None);
        assert_eq!(found[0], PathBuf::from("/opt/homebrew/bin"));
    }

    #[test]
    fn takes_the_first_folder_that_holds_a_program() {
        let found = folders(Some(OsStr::new("/usr/bin")), None);
        let held = first_in(&found, |program| program.starts_with("/usr/local"));

        assert_eq!(held, Some(PathBuf::from("/usr/local/bin/pandoc")));
        assert_eq!(first_in(&found, |_| false), None);
    }

    #[test]
    fn reads_the_last_line_a_login_shell_printed() {
        let printed = "Welcome back\n[oh-my-zsh] update available\n/opt/pandoc/bin/pandoc\n\n";
        assert_eq!(
            shell_answer(printed),
            Some(PathBuf::from("/opt/pandoc/bin/pandoc"))
        );
    }

    #[test]
    fn an_alias_or_nothing_is_no_answer() {
        assert_eq!(shell_answer("pandoc"), None);
        assert_eq!(shell_answer(""), None);
    }
}
