use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::preset::{self, Orden};

pub const USERNAME: &str = "orden";
pub const PASSWORD_VAR: &str = "OPENCODE_SERVER_PASSWORD";
pub const USERNAME_VAR: &str = "OPENCODE_SERVER_USERNAME";
pub const CONFIG_VAR: &str = "OPENCODE_CONFIG_CONTENT";
pub const AUTH_VAR: &str = "OPENCODE_AUTH_CONTENT";
pub const MCP_TOKEN_VAR: &str = "ORDEN_MCP_TOKEN";
pub const SECRETS: [&str; 5] = [PASSWORD_VAR, USERNAME_VAR, CONFIG_VAR, AUTH_VAR, MCP_TOKEN_VAR];
pub const HOME_VAR: &str = "OPENCODE_TEST_HOME";
pub const FLAGS: [(&str, &str); 3] = [
    ("OPENCODE_DISABLE_PROJECT_CONFIG", "1"),
    ("OPENCODE_DISABLE_AUTOUPDATE", "1"),
    ("OPENCODE_DISABLE_CLAUDE_CODE", "1"),
];
pub const MOVED: [&str; 4] =
    ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];
pub const USER_PREFIX: &str = "ORDEN_USER_";
pub const UNSET_SUFFIX: &str = "_UNSET";
pub const USER_SHELL_VAR: &str = "ORDEN_USER_SHELL";
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dirs {
    pub root: PathBuf,
}
impl Dirs {
    pub fn moved_to(&self, var: &str) -> PathBuf {
        let part = match var {
            "XDG_CONFIG_HOME" => "config",
            "XDG_DATA_HOME" => "data",
            "XDG_STATE_HOME" => "state",
            _ => "cache",
        };
        self.root.join(part)
    }
    pub fn own_config(&self) -> PathBuf {
        self.moved_to("XDG_CONFIG_HOME").join("opencode")
    }
    pub fn home(&self) -> PathBuf {
        self.root.join("home")
    }
    pub fn shell(&self, real: &Path) -> PathBuf {
        let name = shell_name(real);
        self.root.join("bin").join(if cfg!(windows) { format!("{name}.exe") } else { name })
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Launch {
    pub binary: PathBuf,
    pub dirs: Dirs,
    pub config: Value,
    pub auth: Option<Value>,
    pub orden: Option<Orden>,
    pub wrapper: Option<PathBuf>,
}
pub fn config_of(given: &Value, shell: &Path, orden: Option<&Orden>) -> Value {
    let mut config = given.as_object().cloned().unwrap_or_default();
    config.insert("autoupdate".into(), json!(false));
    config.insert("share".into(), json!("disabled"));
    config.insert("shell".into(), json!(shell.to_string_lossy()));
    if let Some(orden) = orden {
        preset::joined(&mut config, orden);
    }
    Value::Object(config)
}
pub fn shell_name(shell: &Path) -> String {
    shell.file_stem().map_or_else(|| "sh".to_owned(), |one| one.to_string_lossy().to_lowercase())
}
fn on_path(path: Option<&str>, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path?).map(|folder| folder.join(name)).find(|one| one.is_file())
}
pub fn real_shell(user: &impl Fn(&str) -> Option<String>) -> PathBuf {
    let given = user("SHELL").filter(|one| !one.trim().is_empty()).map(PathBuf::from);
    let path = user("PATH");
    let found = |name: &str| on_path(path.as_deref(), name);
    if cfg!(windows) {
        given
            .filter(|one| one.is_absolute() && one.is_file())
            .or_else(|| found("pwsh.exe"))
            .or_else(|| found("powershell.exe"))
            .or_else(|| {
                let git = found("git.exe")?;
                Some(git.parent()?.parent()?.join("bin").join("bash.exe"))
                    .filter(|one| one.is_file())
            })
            .unwrap_or_else(|| {
                PathBuf::from(user("COMSPEC").unwrap_or_else(|| "cmd.exe".to_owned()))
            })
    } else {
        given
            .filter(|one| !matches!(shell_name(one).as_str(), "fish" | "nu"))
            .or_else(|| found("bash"))
            .unwrap_or_else(|| PathBuf::from("/bin/sh"))
    }
}
pub fn env_of(
    launch: &Launch,
    password: &str,
    real: &Path,
    user: impl Fn(&str) -> Option<String>,
) -> Vec<(String, String)> {
    let dirs = &launch.dirs;
    let mut env = vec![
        (
            CONFIG_VAR.to_owned(),
            config_of(&launch.config, &dirs.shell(real), launch.orden.as_ref()).to_string(),
        ),
        (PASSWORD_VAR.to_owned(), password.to_owned()),
        (USERNAME_VAR.to_owned(), USERNAME.to_owned()),
    ];
    if let Some(auth) = &launch.auth {
        env.push((AUTH_VAR.to_owned(), auth.to_string()));
    }
    env.extend(FLAGS.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())));
    env.push((HOME_VAR.to_owned(), dirs.home().to_string_lossy().into_owned()));
    for var in MOVED {
        match user(var) {
            Some(kept) => env.push((format!("{USER_PREFIX}{var}"), kept)),
            None => env.push((format!("{USER_PREFIX}{var}{UNSET_SUFFIX}"), "1".to_owned())),
        }
        env.push((var.to_owned(), dirs.moved_to(var).to_string_lossy().into_owned()));
    }
    env.push((USER_SHELL_VAR.to_owned(), real.to_string_lossy().into_owned()));
    env
}
#[cfg(test)]
mod tests {
    use super::*;

    fn launch() -> Launch {
        Launch {
            binary: PathBuf::from("/opt/opencode"),
            dirs: Dirs { root: PathBuf::from("/data/opencode") },
            config: json!({ "enabled_providers": ["anthropic"], "share": "manual", "autoupdate": true }),
            auth: Some(json!({ "anthropic": { "type": "api", "key": "sk-1" } })),
            orden: None,
            wrapper: None,
        }
    }
    fn named(env: &[(String, String)], name: &str) -> Option<String> {
        env.iter().find(|(one, _)| one == name).map(|(_, value)| value.clone())
    }
    #[test]
    fn the_server_is_told_everything_in_its_env_and_nothing_from_the_users_files() {
        let user = |var: &str| match var {
            "XDG_CONFIG_HOME" => Some("/home/me/.config".to_owned()),
            "SHELL" => Some("/bin/zsh".to_owned()),
            _ => None,
        };
        let env = env_of(&launch(), "secret", Path::new("/bin/zsh"), user);
        let config: Value =
            serde_json::from_str(&named(&env, CONFIG_VAR).expect("config")).expect("json");
        assert_eq!(config["enabled_providers"], json!(["anthropic"]));
        assert_eq!(config["autoupdate"], false);
        assert_eq!(config["share"], "disabled");
        assert_eq!(
            config["shell"],
            Dirs { root: PathBuf::from("/data/opencode") }
                .shell(Path::new("/bin/zsh"))
                .to_string_lossy()
                .as_ref()
        );
        assert!(!config.to_string().contains("secret"));
        assert_eq!(named(&env, PASSWORD_VAR).as_deref(), Some("secret"));
        assert_eq!(named(&env, USERNAME_VAR).as_deref(), Some(USERNAME));
        assert!(named(&env, AUTH_VAR).is_some_and(|auth| auth.contains("sk-1")));
        for (flag, on) in FLAGS {
            assert_eq!(named(&env, flag).as_deref(), Some(on), "{flag}");
        }
        assert_eq!(
            named(&env, HOME_VAR).map(PathBuf::from),
            Some(PathBuf::from("/data/opencode/home"))
        );
        let root = PathBuf::from("/data/opencode");
        for (var, part) in [
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_STATE_HOME", "state"),
            ("XDG_CACHE_HOME", "cache"),
        ] {
            assert_eq!(named(&env, var).map(PathBuf::from), Some(root.join(part)), "{var}");
        }
        assert_eq!(named(&env, "ORDEN_USER_XDG_CONFIG_HOME").as_deref(), Some("/home/me/.config"));
        assert_eq!(named(&env, "ORDEN_USER_XDG_DATA_HOME_UNSET").as_deref(), Some("1"));
        assert!(named(&env, "ORDEN_USER_XDG_DATA_HOME").is_none());
        assert_eq!(named(&env, USER_SHELL_VAR).as_deref(), Some("/bin/zsh"));
        let bare = env_of(&Launch { auth: None, ..launch() }, "x", Path::new("/bin/sh"), |_| None);
        assert!(named(&bare, AUTH_VAR).is_none());
        assert_eq!(config_of(&json!("nonsense"), Path::new("/s"), None)["shell"], "/s");
    }
    #[test]
    fn the_agent_s_shell_is_the_one_opencode_itself_would_pick_and_named_so() {
        let dir = tempfile::tempdir().expect("a folder");
        let made = |name: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, "").expect("made");
            path
        };
        let path = std::env::join_paths([dir.path()]).expect("path").to_string_lossy().into_owned();
        let with = |shell: Option<&str>| {
            let (shell, path) = (shell.map(str::to_owned), path.clone());
            move |var: &str| match var {
                "SHELL" => shell.clone(),
                "PATH" => Some(path.clone()),
                _ => None,
            }
        };
        if cfg!(windows) {
            assert_eq!(real_shell(&with(None)), PathBuf::from("cmd.exe"));
            let powershell = made("powershell.exe");
            assert_eq!(real_shell(&with(None)), powershell);
            let pwsh = made("pwsh.exe");
            assert_eq!(real_shell(&with(Some("/usr/bin/bash"))), pwsh);
            let given = made("nu.exe");
            assert_eq!(real_shell(&with(Some(&given.to_string_lossy()))), given);
            assert_eq!(
                Dirs { root: PathBuf::from(r"C:\o") }.shell(&pwsh),
                PathBuf::from(r"C:\o\bin\pwsh.exe")
            );
        } else {
            assert_eq!(real_shell(&with(None)), PathBuf::from("/bin/sh"));
            let bash = made("bash");
            assert_eq!(real_shell(&with(None)), bash);
            assert_eq!(real_shell(&with(Some("/usr/bin/fish"))), bash);
            assert_eq!(real_shell(&with(Some("/bin/zsh"))), PathBuf::from("/bin/zsh"));
            assert_eq!(
                Dirs { root: PathBuf::from("/o") }.shell(Path::new("/bin/zsh")),
                PathBuf::from("/o/bin/zsh")
            );
        }
        assert_eq!(shell_name(Path::new("C:/Program Files/PowerShell/7/PWSH.EXE")), "pwsh");
    }
}
