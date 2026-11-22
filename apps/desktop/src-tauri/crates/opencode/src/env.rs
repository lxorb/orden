use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const USERNAME: &str = "orden";
pub const PASSWORD_VAR: &str = "OPENCODE_SERVER_PASSWORD";
pub const USERNAME_VAR: &str = "OPENCODE_SERVER_USERNAME";
pub const CONFIG_VAR: &str = "OPENCODE_CONFIG_CONTENT";
pub const AUTH_VAR: &str = "OPENCODE_AUTH_CONTENT";
pub const MCP_TOKEN_VAR: &str = "ORDEN_MCP_TOKEN";
pub const SECRETS: [&str; 5] = [PASSWORD_VAR, USERNAME_VAR, CONFIG_VAR, AUTH_VAR, MCP_TOKEN_VAR];
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
    pub fn shell(&self) -> PathBuf {
        self.root.join("bin").join(if cfg!(windows) { "orden-shell.cmd" } else { "orden-shell" })
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Launch {
    pub binary: PathBuf,
    pub dirs: Dirs,
    pub config: Value,
    pub auth: Option<Value>,
}
pub fn config_of(given: &Value, shell: &Path) -> Value {
    let mut config = given.as_object().cloned().unwrap_or_default();
    config.insert("autoupdate".into(), json!(false));
    config.insert("share".into(), json!("disabled"));
    config.insert("shell".into(), json!(shell.to_string_lossy()));
    Value::Object(config)
}
pub fn user_shell(found: Option<String>) -> String {
    found.filter(|one| !one.trim().is_empty()).unwrap_or_else(|| {
        if cfg!(windows) {
            "bash".to_owned()
        } else {
            "/bin/sh".to_owned()
        }
    })
}
pub fn env_of(
    launch: &Launch,
    password: &str,
    user: impl Fn(&str) -> Option<String>,
) -> Vec<(String, String)> {
    let dirs = &launch.dirs;
    let mut env = vec![
        (CONFIG_VAR.to_owned(), config_of(&launch.config, &dirs.shell()).to_string()),
        (PASSWORD_VAR.to_owned(), password.to_owned()),
        (USERNAME_VAR.to_owned(), USERNAME.to_owned()),
    ];
    if let Some(auth) = &launch.auth {
        env.push((AUTH_VAR.to_owned(), auth.to_string()));
    }
    env.extend(FLAGS.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())));
    for var in MOVED {
        match user(var) {
            Some(kept) => env.push((format!("{USER_PREFIX}{var}"), kept)),
            None => env.push((format!("{USER_PREFIX}{var}{UNSET_SUFFIX}"), "1".to_owned())),
        }
        env.push((var.to_owned(), dirs.moved_to(var).to_string_lossy().into_owned()));
    }
    env.push((USER_SHELL_VAR.to_owned(), user_shell(user("SHELL"))));
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
        let env = env_of(&launch(), "secret", user);
        let config: Value =
            serde_json::from_str(&named(&env, CONFIG_VAR).expect("config")).expect("json");
        assert_eq!(config["enabled_providers"], json!(["anthropic"]));
        assert_eq!(config["autoupdate"], false);
        assert_eq!(config["share"], "disabled");
        assert_eq!(
            config["shell"],
            Dirs { root: PathBuf::from("/data/opencode") }.shell().to_string_lossy().as_ref()
        );
        assert!(!config.to_string().contains("secret"));
        assert_eq!(named(&env, PASSWORD_VAR).as_deref(), Some("secret"));
        assert_eq!(named(&env, USERNAME_VAR).as_deref(), Some(USERNAME));
        assert!(named(&env, AUTH_VAR).is_some_and(|auth| auth.contains("sk-1")));
        for (flag, on) in FLAGS {
            assert_eq!(named(&env, flag).as_deref(), Some(on), "{flag}");
        }
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
        let bare = env_of(&Launch { auth: None, ..launch() }, "x", |_| None);
        assert!(named(&bare, AUTH_VAR).is_none());
        assert!(named(&bare, USER_SHELL_VAR).is_some_and(|shell| !shell.is_empty()));
        assert_eq!(config_of(&json!("nonsense"), Path::new("/s"))["shell"], "/s");
    }
}
