use std::fmt::Write as _;
use std::fs;
use std::io;

use crate::env::{Dirs, MOVED, SECRETS, UNSET_SUFFIX, USER_PREFIX, USER_SHELL_VAR};

pub fn unix_wrapper() -> String {
    let mut out = String::from("#!/bin/sh\n");
    let _ = writeln!(out, "unset {}", SECRETS.join(" "));
    for var in MOVED {
        let kept = format!("{USER_PREFIX}{var}");
        let gone = format!("{kept}{UNSET_SUFFIX}");
        let _ = writeln!(
            out,
            "if [ -n \"${{{gone}-}}\" ]; then unset {var}; else export {var}=\"${{{kept}-}}\"; fi\nunset {kept} {gone}"
        );
    }
    let _ = writeln!(
        out,
        "real=\"${{{USER_SHELL_VAR}:-/bin/sh}}\"\nunset {USER_SHELL_VAR}\nexec \"$real\" \"$@\""
    );
    out
}
pub fn windows_wrapper() -> String {
    let mut out = String::from("@echo off\r\nsetlocal\r\n");
    for secret in SECRETS {
        let _ = write!(out, "set {secret}=\r\n");
    }
    for var in MOVED {
        let kept = format!("{USER_PREFIX}{var}");
        let gone = format!("{kept}{UNSET_SUFFIX}");
        let _ = write!(
            out,
            "if defined {gone} (set {var}=) else (set \"{var}=%{kept}%\")\r\nset {kept}=\r\nset {gone}=\r\n"
        );
    }
    let _ = write!(
        out,
        "set \"real=%{USER_SHELL_VAR}%\"\r\nset {USER_SHELL_VAR}=\r\n\"%real%\" %*\r\n"
    );
    out
}
pub fn prepare(dirs: &Dirs) -> io::Result<()> {
    for var in MOVED {
        fs::create_dir_all(dirs.moved_to(var))?;
    }
    let own = dirs.own_config();
    if own.exists() {
        unlocked(&own)?;
    }
    fs::create_dir_all(&own)?;
    locked(&own)?;
    let shell = dirs.shell();
    if let Some(folder) = shell.parent() {
        fs::create_dir_all(folder)?;
    }
    let text = if cfg!(windows) { windows_wrapper() } else { unix_wrapper() };
    fs::write(&shell, text)?;
    runnable(&shell)
}
#[cfg(unix)]
fn locked(dir: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o555))
}
#[cfg(unix)]
fn unlocked(dir: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o755))
}
#[cfg(unix)]
fn runnable(file: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(file, fs::Permissions::from_mode(0o700))
}
#[cfg(not(unix))]
fn locked(dir: &std::path::Path) -> io::Result<()> {
    let mut permissions = fs::metadata(dir)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(dir, permissions)
}
#[cfg(not(unix))]
#[allow(clippy::permissions_set_readonly_false)]
fn unlocked(dir: &std::path::Path) -> io::Result<()> {
    let mut permissions = fs::metadata(dir)?.permissions();
    permissions.set_readonly(false);
    fs::set_permissions(dir, permissions)
}
#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn runnable(_: &std::path::Path) -> io::Result<()> {
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[cfg(unix)]
    #[test]
    fn the_agents_shell_gets_none_of_the_servers_secrets_and_the_users_own_folders() {
        let dir = tempfile::tempdir().expect("a folder");
        let dirs = Dirs { root: dir.path().to_path_buf() };
        prepare(&dirs).expect("prepared");
        let env: Vec<(String, String)> = vec![
            ("OPENCODE_SERVER_PASSWORD".into(), "pw-secret".into()),
            ("OPENCODE_SERVER_USERNAME".into(), "orden".into()),
            ("OPENCODE_CONFIG_CONTENT".into(), "{\"config-secret\":1}".into()),
            ("OPENCODE_AUTH_CONTENT".into(), "{\"key\":\"sk-secret\"}".into()),
            ("ORDEN_MCP_TOKEN".into(), "token-secret".into()),
            ("XDG_CONFIG_HOME".into(), "/orden/config".into()),
            ("XDG_DATA_HOME".into(), "/orden/data".into()),
            ("XDG_STATE_HOME".into(), "/orden/state".into()),
            ("XDG_CACHE_HOME".into(), "/orden/cache".into()),
            ("ORDEN_USER_XDG_CONFIG_HOME".into(), "/home/me/.config".into()),
            ("ORDEN_USER_XDG_DATA_HOME_UNSET".into(), "1".into()),
            ("ORDEN_USER_XDG_STATE_HOME".into(), "/home/me/.local/state".into()),
            ("ORDEN_USER_XDG_CACHE_HOME_UNSET".into(), "1".into()),
            ("ORDEN_USER_SHELL".into(), "/bin/sh".into()),
        ];
        let said = std::process::Command::new(dirs.shell())
            .args(["-c", "env"])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .envs(env)
            .output()
            .expect("ran");
        let said = String::from_utf8_lossy(&said.stdout);
        for secret in
            ["pw-secret", "config-secret", "sk-secret", "token-secret", "OPENCODE_SERVER_USERNAME"]
        {
            assert!(!said.contains(secret), "{secret} reached the shell: {said}");
        }
        assert!(said.lines().any(|line| line == "XDG_CONFIG_HOME=/home/me/.config"), "{said}");
        assert!(said.lines().any(|line| line == "XDG_STATE_HOME=/home/me/.local/state"), "{said}");
        assert!(!said.contains("XDG_DATA_HOME=") && !said.contains("XDG_CACHE_HOME="), "{said}");
        assert!(!said.contains("ORDEN_USER_"), "{said}");
        assert!(
            !said.lines().any(|line| line.starts_with("XDG_") && line.contains("/orden/")),
            "{said}"
        );
    }
    #[cfg(unix)]
    #[test]
    fn opencodes_own_config_folder_cannot_be_written_into() {
        let dir = tempfile::tempdir().expect("a folder");
        let dirs = Dirs { root: dir.path().to_path_buf() };
        prepare(&dirs).expect("prepared");
        prepare(&dirs).expect("prepared twice");
        assert!(fs::write(dirs.own_config().join("package.json"), "{}").is_err());
        assert!(fs::create_dir(dirs.own_config().join("node_modules")).is_err());
        for var in MOVED {
            assert!(dirs.moved_to(var).is_dir(), "{var}");
        }
        assert!(fs::write(dirs.moved_to("XDG_DATA_HOME").join("x"), "x").is_ok());
        unlocked(&dirs.own_config()).expect("unlocked to clean up");
    }
    #[test]
    fn the_windows_wrapper_clears_the_same_names() {
        let said = windows_wrapper();
        for secret in SECRETS {
            assert!(said.contains(&format!("set {secret}=\r\n")), "{secret}");
        }
        for var in MOVED {
            assert!(said.contains(&format!("if defined ORDEN_USER_{var}_UNSET")), "{var}");
        }
        assert!(said.ends_with("\"%real%\" %*\r\n"));
        let unix = unix_wrapper();
        assert!(unix.starts_with("#!/bin/sh\n") && unix.contains("exec \"$real\" \"$@\""));
        assert_eq!(
            Dirs { root: PathBuf::from("/r") }.own_config(),
            PathBuf::from("/r/config/opencode")
        );
    }
}
