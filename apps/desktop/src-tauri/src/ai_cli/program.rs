use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use super::args::Tool;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    pub exe: PathBuf,
    pub path: OsString,
}

fn names(tool: Tool) -> Vec<String> {
    let command = tool.command();
    if cfg!(windows) {
        vec![format!("{command}.exe"), format!("{command}.cmd")]
    } else {
        vec![command.to_owned()]
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
    found.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    if let Some(home) = home {
        for inside in [
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".local/share/mise/shims",
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

pub fn find(tool: Tool) -> Option<Program> {
    let path = search_path();
    let exe = named_outright(tool).or_else(|| {
        let home = dirs::home_dir();
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
        let mut folders: Vec<PathBuf> = std::env::split_paths(&path).collect();
        folders.extend(installed_in(home.as_deref(), appdata.as_deref()));
        first_in(&folders, &names(tool), Path::is_file)
    })?;
    let path = with_first(exe.parent(), &path);
    Some(Program { exe, path })
}

fn named_outright(tool: Tool) -> Option<PathBuf> {
    let name = match tool {
        Tool::ClaudeCode => "NIB_AI_CLAUDE_CODE",
        Tool::Codex => "NIB_AI_CODEX",
        Tool::Gemini => "NIB_AI_GEMINI",
    };
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
const MARK: &str = "__nib_path__=";

#[cfg(any(unix, test))]
pub fn marked_path(printed: &str) -> Option<&str> {
    printed
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(MARK))
        .filter(|path| !path.is_empty())
}

#[cfg(unix)]
fn ask_login_shell() -> Option<OsString> {
    let shell = std::env::var_os("SHELL")?;
    path_from_shell(&shell, std::time::Duration::from_secs(5))
}

#[cfg(unix)]
fn path_from_shell(shell: &OsStr, patience: std::time::Duration) -> Option<OsString> {
    use std::os::unix::ffi::OsStringExt as _;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let mut child = Command::new(shell)
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

        let dir = std::env::temp_dir().join(format!("nib-login-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder");
        let shell = dir.join("shell");
        std::fs::write(
            &shell,
            format!("#!/bin/sh\nsleep 30 &\nprintf '\\n{MARK}%s\\n' /from/the/shell\n"),
        )
        .expect("a shell");
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).expect("runnable");

        let started = std::time::Instant::now();
        let found = path_from_shell(shell.as_os_str(), std::time::Duration::from_secs(20));

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
        let names = names(Tool::ClaudeCode);
        let held = |path: &Path| path.starts_with("b");
        assert_eq!(
            first_in(&folders, &names, held),
            Some(PathBuf::from("b").join(&names[0]))
        );
        assert_eq!(first_in(&folders, &names, |_| false), None);
        if cfg!(windows) {
            assert_eq!(names, ["claude.exe", "claude.cmd"]);
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
        let printed = "Welcome\n[oh-my-zsh] update\n\n__nib_path__=/opt/homebrew/bin:/usr/bin\n";
        assert_eq!(marked_path(printed), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(marked_path("no mark here"), None);
        assert_eq!(marked_path("__nib_path__=\n"), None);
    }
}
