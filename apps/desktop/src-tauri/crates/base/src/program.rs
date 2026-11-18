use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    pub exe: PathBuf,
    pub path: OsString,
}

pub fn endings(command: &str) -> Vec<String> {
    if cfg!(windows) && Path::new(command).extension().is_none() {
        [".exe", ".cmd", ".bat", ".com"]
            .iter()
            .map(|ending| format!("{command}{ending}"))
            .collect()
    } else {
        vec![command.to_owned()]
    }
}

pub fn runnable(file: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::metadata(file)
            .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        file.is_file()
    }
}

pub fn installed_in(home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(home) = home {
        found.push(home.join(".local").join("bin"));
    }
    if cfg!(windows) {
        if let Some(appdata) = appdata {
            found.push(appdata.join("npm"));
        }
        return found;
    }
    found.extend(
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
            "/nix/var/nix/profiles/default/bin",
            "/run/current-system/sw/bin",
        ]
        .map(PathBuf::from),
    );
    if let Some(home) = home {
        for inside in [
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".local/share/mise/shims",
            ".cabal/bin",
            ".ghcup/bin",
            ".nix-profile/bin",
        ] {
            found.push(home.join(inside));
        }
    }
    found
}

pub fn first_in(
    folders: &[PathBuf],
    names: &[String],
    is_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    folders
        .iter()
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| is_file(candidate))
}

pub fn with_first(folder: Option<&Path>, path: &OsStr) -> OsString {
    let mut folders: Vec<PathBuf> = folder.map(Path::to_path_buf).into_iter().collect();
    folders.extend(std::env::split_paths(path));
    std::env::join_paths(folders).unwrap_or_else(|_| path.to_owned())
}

pub fn find(command: &str, outright: &str) -> Option<Program> {
    let path = search_path();
    let exe = named_outright(outright).or_else(|| on(command, &path))?;
    let path = with_first(exe.parent(), &path);
    Some(Program { exe, path })
}

pub fn which(command: &str) -> Option<PathBuf> {
    on(command, &search_path())
}

fn on(command: &str, path: &OsStr) -> Option<PathBuf> {
    let home = dirs::home_dir();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let mut folders: Vec<PathBuf> = std::env::split_paths(path).collect();
    folders.extend(installed_in(home.as_deref(), appdata.as_deref()));
    first_in(&folders, &endings(command), runnable)
}

fn named_outright(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

pub fn search_path() -> OsString {
    let own = std::env::var_os("PATH").unwrap_or_default();
    #[cfg(unix)]
    if let Some(shell) = login_path() {
        let mut both: Vec<PathBuf> = std::env::split_paths(&own).collect();
        both.extend(std::env::split_paths(shell));
        if let Ok(joined) = std::env::join_paths(both) {
            return joined;
        }
    }
    own
}

#[cfg(unix)]
fn login_path() -> Option<&'static OsStr> {
    static ASKED: std::sync::OnceLock<Option<OsString>> = std::sync::OnceLock::new();
    ASKED.get_or_init(ask_login_shell).as_deref()
}

#[cfg(any(unix, test))]
const MARK: &str = "__orden_path__=";

#[cfg(any(unix, test))]
fn marked_path(printed: &str) -> Option<&str> {
    printed
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(MARK))
        .filter(|path| !path.is_empty())
}

#[cfg(unix)]
fn ask_login_shell() -> Option<OsString> {
    let shell = std::env::var_os("SHELL")?;
    path_from_shell(
        std::process::Command::new(shell),
        std::time::Duration::from_secs(5),
    )
}

#[cfg(unix)]
fn path_from_shell(
    mut shell: std::process::Command,
    patience: std::time::Duration,
) -> Option<OsString> {
    use std::os::unix::ffi::OsStringExt as _;
    use std::process::Stdio;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let mut child = shell
        .args(["-ilc", &format!("printf '\\n{MARK}%s\\n' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let heard = crate::printed::chunks(child.stdout.take()?);

    let started = Instant::now();
    let mut printed = Vec::new();
    let found = loop {
        let Some(left) = patience.checked_sub(started.elapsed()) else {
            break None;
        };
        match heard.recv_timeout(left.min(Duration::from_millis(20))) {
            Ok(more) => printed.extend(more),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break marked_path(&String::from_utf8_lossy(&printed)).map(str::to_owned);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let text = String::from_utf8_lossy(&printed);
        if let Some(at) = text.find(MARK) {
            if text[at..].contains('\n') {
                break marked_path(&text).map(str::to_owned);
            }
        }
    };
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }
    found.map(|path| OsString::from_vec(path.into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn a_login_shell_that_leaves_something_holding_its_output_is_not_waited_for() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = std::env::temp_dir().join(format!("orden-login-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder");
        let shell = dir.join("shell");
        std::fs::write(
            &shell,
            format!("#!/bin/sh\nsleep 30 &\nprintf '\\n{MARK}%s\\n' /from/the/shell\n"),
        )
        .expect("a shell");
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).expect("runnable");

        let started = std::time::Instant::now();
        let found = path_from_shell(
            std::process::Command::new(&shell),
            std::time::Duration::from_secs(20),
        );

        assert_eq!(found.as_deref(), Some(OsStr::new("/from/the/shell")));
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_path_first_then_where_installers_put_it() {
        let home = Path::new("/home/e");
        let found = installed_in(Some(home), Some(Path::new("/roaming")));
        assert_eq!(found[0], home.join(".local").join("bin"));
        if cfg!(windows) {
            assert_eq!(found[1], Path::new("/roaming").join("npm"));
        } else {
            assert!(found.contains(&PathBuf::from("/opt/homebrew/bin")));
            assert!(found.contains(&home.join(".local/share/mise/shims")));
        }
    }

    #[test]
    fn the_first_folder_that_holds_one_wins_and_an_exe_before_npm_s_cmd() {
        let folders = [PathBuf::from("a"), PathBuf::from("b")];
        let names = endings("claude");
        let held = |path: &Path| path.starts_with("b");
        assert_eq!(
            first_in(&folders, &names, held),
            Some(PathBuf::from("b").join(&names[0]))
        );
        assert_eq!(first_in(&folders, &names, |_| false), None);
        if cfg!(windows) {
            assert_eq!(
                names,
                ["claude.exe", "claude.cmd", "claude.bat", "claude.com"]
            );
            assert_eq!(endings("claude.cmd"), ["claude.cmd"]);
        }
    }

    #[test]
    fn the_program_s_own_folder_goes_first_on_its_path() {
        let path = std::env::join_paths([PathBuf::from("x"), PathBuf::from("y")]).expect("joined");
        let joined = with_first(Some(Path::new("here")), &path);
        let folders: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(
            folders,
            [
                PathBuf::from("here"),
                PathBuf::from("x"),
                PathBuf::from("y")
            ]
        );
    }

    #[test]
    fn the_login_shell_s_path_is_the_marked_line() {
        let printed = "Welcome\n[oh-my-zsh] update\n\n__orden_path__=/opt/homebrew/bin:/usr/bin\n";
        assert_eq!(marked_path(printed), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(marked_path("no mark here"), None);
        assert_eq!(marked_path("__orden_path__=\n"), None);
    }

    #[cfg(unix)]
    fn home_with_rc(rc: &str) -> PathBuf {
        let home =
            std::env::temp_dir().join(format!("orden-rc-{}-{}", std::process::id(), rc.len()));
        std::fs::create_dir_all(home.join("tools").join("bin")).expect("a folder");
        for name in [".zshrc", ".zprofile", ".zlogin", ".bash_profile", ".bashrc"] {
            std::fs::write(home.join(name), rc).expect("an rc file");
        }
        home
    }

    #[cfg(unix)]
    fn login_shells() -> Vec<&'static str> {
        ["/bin/zsh", "/bin/bash"]
            .into_iter()
            .filter(|shell| Path::new(shell).exists())
            .collect()
    }

    #[cfg(unix)]
    fn asked(shell: &str, home: &Path, patience: std::time::Duration) -> Option<OsString> {
        let mut command = std::process::Command::new(shell);
        command
            .env("HOME", home)
            .env_remove("ZDOTDIR")
            .env_remove("BASH_ENV");
        path_from_shell(command, patience)
    }

    #[cfg(unix)]
    #[test]
    fn a_real_login_shell_says_the_path_its_rc_sets_up() {
        let home = home_with_rc(
            "echo \"Welcome back, $USER\"\n\
             echo '[oh-my-zsh] Would you like to update? [Y/n]' >&2\n\
             export PATH=\"$HOME/tools/bin:$PATH\"\n\
             alias ll='ls -l'\n",
        );
        let shells = login_shells();
        assert!(!shells.is_empty(), "no login shell to ask");
        for shell in shells {
            let found = asked(shell, &home, std::time::Duration::from_secs(20)).expect("a path");
            assert!(
                std::env::split_paths(&found).any(|folder| folder == home.join("tools/bin")),
                "{shell} did not say the path its rc set up"
            );
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_login_shell_whose_rc_hangs_is_given_up_on() {
        let home = home_with_rc("export PATH=\"$HOME/tools/bin:$PATH\"\nsleep 30\n");
        for shell in login_shells() {
            let started = std::time::Instant::now();
            let found = asked(shell, &home, std::time::Duration::from_secs(1));
            assert_eq!(found, None, "{shell}");
            assert!(
                started.elapsed() < std::time::Duration::from_secs(5),
                "{shell}"
            );
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_command_is_looked_for_with_every_ending_windows_runs() {
        if cfg!(windows) {
            assert_eq!(
                endings("pandoc"),
                ["pandoc.exe", "pandoc.cmd", "pandoc.bat", "pandoc.com"]
            );
            assert_eq!(endings("pandoc.exe"), ["pandoc.exe"]);
        } else {
            assert_eq!(endings("pandoc"), ["pandoc"]);
        }
    }

    #[test]
    fn the_folders_package_managers_use_are_all_looked_in() {
        let home = Path::new("/home/e");
        let found = installed_in(Some(home), None);
        if !cfg!(windows) {
            for one in [
                "/opt/homebrew/bin",
                "/opt/local/bin",
                "/nix/var/nix/profiles/default/bin",
            ] {
                assert!(found.contains(&PathBuf::from(one)), "{one}");
            }
            for inside in [".cabal/bin", ".ghcup/bin", ".nix-profile/bin", ".bun/bin"] {
                assert!(found.contains(&home.join(inside)), "{inside}");
            }
        }
    }
}
