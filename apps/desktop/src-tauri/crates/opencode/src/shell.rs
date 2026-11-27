use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::Path;
use std::process::{Command, ExitCode};

use crate::env::{Dirs, HOME_VAR, MOVED, SECRETS, UNSET_SUFFIX, USER_PREFIX, USER_SHELL_VAR};

const SETTLED: [(&str, &str); 2] = [
    ("package.json", "{\"dependencies\":{\"@opencode-ai/plugin\":\"*\"}}\n"),
    (
        "package-lock.json",
        "{\"packages\":{\"\":{\"dependencies\":{\"@opencode-ai/plugin\":\"*\"}}}}\n",
    ),
];
pub fn unix_wrapper() -> String {
    let mut out = String::from("#!/bin/sh\n");
    let _ = writeln!(out, "unset {} {HOME_VAR}", SECRETS.join(" "));
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
pub fn shell_env(get: impl Fn(&str) -> Option<String>) -> (Vec<String>, Vec<(String, String)>) {
    let mut gone: Vec<String> =
        SECRETS.iter().chain([&HOME_VAR, &USER_SHELL_VAR]).map(|one| (*one).to_owned()).collect();
    let mut set = Vec::new();
    for var in MOVED {
        let kept = format!("{USER_PREFIX}{var}");
        let unset = format!("{kept}{UNSET_SUFFIX}");
        if get(&unset).is_some() {
            gone.push(var.to_owned());
        } else if let Some(value) = get(&kept) {
            set.push((var.to_owned(), value));
        }
        gone.extend([kept, unset]);
    }
    (gone, set)
}
fn code_of(code: Option<i32>) -> u8 {
    match code {
        Some(0) => 0,
        Some(other) => u8::try_from(other).ok().filter(|one| *one != 0).unwrap_or(1),
        None => 1,
    }
}
pub fn wrapped() -> ExitCode {
    let get = |name: &str| std::env::var(name).ok();
    let Some(real) = get(USER_SHELL_VAR) else {
        eprintln!("orden-shell runs only the shell Orden's OpenCode names in {USER_SHELL_VAR}");
        return ExitCode::from(127);
    };
    let (gone, set) = shell_env(get);
    let mut command = Command::new(&real);
    command.args(std::env::args_os().skip(1));
    for name in gone {
        command.env_remove(name);
    }
    command.envs(set);
    match command.status() {
        Ok(done) => ExitCode::from(code_of(done.code())),
        Err(why) => {
            eprintln!("orden-shell could not run {real}: {why}");
            ExitCode::from(127)
        }
    }
}
pub fn prepare(dirs: &Dirs, real: &Path, wrapper: Option<&Path>) -> io::Result<()> {
    for var in MOVED {
        fs::create_dir_all(dirs.moved_to(var))?;
    }
    fs::create_dir_all(dirs.home())?;
    let own = dirs.own_config();
    if own.exists() {
        unlocked(&own)?;
    }
    fs::create_dir_all(own.join("node_modules"))?;
    for (name, text) in SETTLED {
        fs::write(own.join(name), text)?;
    }
    locked(&own)?;
    let shell = dirs.shell(real);
    if let Some(folder) = shell.parent() {
        fs::create_dir_all(folder)?;
    }
    if cfg!(windows) {
        let wrapper = wrapper.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "this build has no orden-shell to guard the agent's commands",
            )
        })?;
        if let Err(why) = fs::copy(wrapper, &shell) {
            if !shell.is_file() {
                return Err(why);
            }
        }
        Ok(())
    } else {
        fs::write(&shell, unix_wrapper())?;
        runnable(&shell)
    }
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
        prepare(&dirs, Path::new("/bin/sh"), None).expect("prepared");
        let env: Vec<(String, String)> = vec![
            ("OPENCODE_SERVER_PASSWORD".into(), "pw-secret".into()),
            ("OPENCODE_SERVER_USERNAME".into(), "orden".into()),
            ("OPENCODE_CONFIG_CONTENT".into(), "{\"config-secret\":1}".into()),
            ("OPENCODE_AUTH_CONTENT".into(), "{\"key\":\"sk-secret\"}".into()),
            ("ORDEN_MCP_TOKEN".into(), "token-secret".into()),
            ("OPENCODE_TEST_HOME".into(), "/orden/home-secret".into()),
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
        let said = std::process::Command::new(dirs.shell(Path::new("/bin/sh")))
            .args(["-c", "env"])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .envs(env)
            .output()
            .expect("ran");
        let said = String::from_utf8_lossy(&said.stdout);
        for secret in [
            "pw-secret",
            "config-secret",
            "sk-secret",
            "token-secret",
            "home-secret",
            "OPENCODE_SERVER_USERNAME",
        ] {
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
        prepare(&dirs, Path::new("/bin/sh"), None).expect("prepared");
        prepare(&dirs, Path::new("/bin/sh"), None).expect("prepared twice");
        assert!(fs::write(dirs.own_config().join("x.json"), "{}").is_err());
        assert!(fs::create_dir(dirs.own_config().join("plugins")).is_err());
        for var in MOVED {
            assert!(dirs.moved_to(var).is_dir(), "{var}");
        }
        assert!(fs::write(dirs.moved_to("XDG_DATA_HOME").join("x"), "x").is_ok());
        unlocked(&dirs.own_config()).expect("unlocked to clean up");
    }
    #[test]
    fn opencode_finds_its_one_dependency_settled_so_it_installs_nothing() {
        let dir = tempfile::tempdir().expect("a folder");
        let dirs = Dirs { root: dir.path().to_path_buf() };
        let wrapper = dir.path().join("wrapper");
        fs::write(&wrapper, "x").expect("a wrapper");
        prepare(&dirs, Path::new("/bin/sh"), Some(&wrapper)).expect("prepared");
        let own = dirs.own_config();
        assert!(own.join("node_modules").is_dir());
        let read = |name: &str| -> serde_json::Value {
            serde_json::from_str(&fs::read_to_string(own.join(name)).expect("read")).expect("json")
        };
        let wanted = read("package.json")["dependencies"].clone();
        let locked = read("package-lock.json")["packages"][""]["dependencies"].clone();
        assert!(wanted.get("@opencode-ai/plugin").is_some());
        for name in wanted.as_object().expect("deps").keys() {
            assert!(locked.get(name).is_some(), "{name}");
        }
        assert!(dirs.home().is_dir());
        unlocked(&own).expect("unlocked to clean up");
    }
    #[test]
    fn the_shell_guard_drops_every_secret_and_gives_back_the_users_own_folders() {
        let given = |name: &str| match name {
            "ORDEN_USER_XDG_CONFIG_HOME" => Some("/me/.config".to_owned()),
            "ORDEN_USER_XDG_DATA_HOME_UNSET" => Some("1".to_owned()),
            "ORDEN_USER_XDG_STATE_HOME" => Some("/me/.state".to_owned()),
            _ => None,
        };
        let (gone, set) = shell_env(given);
        for name in SECRETS.iter().chain([&HOME_VAR, &USER_SHELL_VAR]) {
            assert!(gone.iter().any(|one| one == name), "{name}");
        }
        assert!(gone.iter().any(|one| one == "XDG_DATA_HOME"));
        assert!(!gone.iter().any(|one| one == "XDG_CACHE_HOME"));
        assert!(gone.iter().any(|one| one == "ORDEN_USER_XDG_CONFIG_HOME"));
        assert_eq!(
            set,
            [
                ("XDG_CONFIG_HOME".to_owned(), "/me/.config".to_owned()),
                ("XDG_STATE_HOME".to_owned(), "/me/.state".to_owned())
            ]
        );
        assert_eq!(
            (code_of(Some(0)), code_of(Some(3)), code_of(Some(256)), code_of(None)),
            (0, 3, 1, 1)
        );
        let unix = unix_wrapper();
        assert!(unix.starts_with("#!/bin/sh\n") && unix.contains("exec \"$real\" \"$@\""));
        assert_eq!(
            Dirs { root: PathBuf::from("/r") }.own_config(),
            PathBuf::from("/r/config/opencode")
        );
    }
    #[cfg(windows)]
    #[test]
    fn without_its_guard_the_engine_does_not_start_on_windows() {
        let dir = tempfile::tempdir().expect("a folder");
        let dirs = Dirs { root: dir.path().to_path_buf() };
        let refused = prepare(&dirs, Path::new("pwsh.exe"), None).expect_err("refused");
        assert!(refused.to_string().contains("orden-shell"));
        unlocked(&dirs.own_config()).expect("unlocked to clean up");
    }
}
