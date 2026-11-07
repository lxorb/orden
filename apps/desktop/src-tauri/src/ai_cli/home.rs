use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

use super::Tool;

const CLAUDE_OVERRIDES: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];
const CODEX_OVERRIDES: [&str; 2] = ["OPENAI_API_KEY", "CODEX_API_KEY"];
const GEMINI_OVERRIDES: [&str; 2] = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];

#[cfg(not(target_os = "macos"))]
const CODEX_CONFIG: &str = "cli_auth_credentials_store = \"keyring\"\n";
#[cfg(target_os = "macos")]
const CODEX_CONFIG: &str = "cli_auth_credentials_store = \"file\"\n";

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
const CODEX_CONFIG_BEFORE: &str = "cli_auth_credentials_store = \"keyring\"\n";

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn config_now(held: Option<&str>, now: &str) -> Option<&'static str> {
    match held {
        None => Some(CODEX_CONFIG),
        Some(text) if text == CODEX_CONFIG_BEFORE && now != CODEX_CONFIG_BEFORE => {
            Some(CODEX_CONFIG)
        }
        Some(_) => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Home {
    tool: Tool,
    dir: PathBuf,
}

impl Home {
    pub fn variable(&self) -> &'static str {
        match self.tool {
            Tool::ClaudeCode => "CLAUDE_CONFIG_DIR",
            Tool::Codex => "CODEX_HOME",
            Tool::Gemini => "GEMINI_CLI_HOME",
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn apply(&self, command: &mut Command) {
        let overrides: &[&str] = match self.tool {
            Tool::ClaudeCode => &CLAUDE_OVERRIDES,
            Tool::Codex => &CODEX_OVERRIDES,
            Tool::Gemini => &GEMINI_OVERRIDES,
        };
        for name in overrides {
            command.env_remove(name);
        }
        command.env(self.variable(), &self.dir);
    }

    fn made(&self) -> Result<(), String> {
        crate::paths::made(&self.dir)?;
        if self.tool == Tool::Codex {
            let config = self.dir.join("config.toml");
            let held = std::fs::read_to_string(&config).ok();
            if let Some(text) = config_now(held.as_deref(), CODEX_CONFIG) {
                std::fs::write(&config, text).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
}

fn kind_of(tool: Tool) -> &'static str {
    match tool {
        Tool::ClaudeCode => "claude-code",
        Tool::Codex => "codex",
        Tool::Gemini => "gemini-cli",
    }
}

pub fn under(root: &Path, tool: Tool, account: Option<&str>) -> Result<Option<Home>, String> {
    let Some(id) = account else {
        return Ok(None);
    };
    if !crate::ai_accounts::has_own_home(root, id, kind_of(tool))? {
        return Ok(None);
    }
    let home = Home {
        tool,
        dir: crate::ai_accounts::home_dir(root, id)?,
    };
    home.made()?;
    Ok(Some(home))
}

pub fn of(app: &AppHandle, tool: Tool, account: Option<&str>) -> Result<Option<Home>, String> {
    under(&crate::ai_accounts::root(app)?, tool, account)
}

pub fn removed(home: &Home) -> Result<(), String> {
    match std::fs::remove_dir_all(&home.dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove that sign-in: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orden-ai-homes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::ai_accounts::write(
            &dir,
            r#"{"accounts":[
                {"id":"claude-code","kind":"claude-code","name":"","model":""},
                {"id":"claude-code-2","kind":"claude-code","name":"","model":"","own":true},
                {"id":"codex-2","kind":"codex","name":"","model":"","own":true}
            ]}"#,
            "",
        )
        .expect("accounts");
        dir
    }

    #[test]
    fn the_first_account_is_the_readers_own_home() {
        let dir = root("first");
        assert_eq!(under(&dir, Tool::ClaudeCode, Some("claude-code")), Ok(None));
        assert_eq!(under(&dir, Tool::ClaudeCode, None), Ok(None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_one_is_a_folder_of_ordens_made_on_first_use() {
        let dir = root("second");
        let home = under(&dir, Tool::ClaudeCode, Some("claude-code-2"))
            .expect("read")
            .expect("a home");
        assert_eq!(home.dir(), dir.join("homes").join("claude-code-2"));
        assert!(home.dir().is_dir());
        assert_eq!(home.variable(), "CLAUDE_CONFIG_DIR");

        let codex = under(&dir, Tool::Codex, Some("codex-2"))
            .expect("read")
            .expect("a home");
        let config = std::fs::read_to_string(codex.dir().join("config.toml")).expect("config");
        assert_eq!(config, CODEX_CONFIG);
        removed(&codex).expect("removed");
        assert!(!codex.dir().exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_codex_home_keeps_its_login_out_of_a_macs_keychain() {
        assert_eq!(config_now(None, CODEX_CONFIG), Some(CODEX_CONFIG));
        let file = "cli_auth_credentials_store = \"file\"\n";
        assert_eq!(
            config_now(Some(CODEX_CONFIG_BEFORE), file),
            Some(CODEX_CONFIG)
        );
        assert_eq!(
            config_now(Some(CODEX_CONFIG_BEFORE), CODEX_CONFIG_BEFORE),
            None
        );
        assert_eq!(config_now(Some("model = \"o3\"\n"), file), None);
        #[cfg(target_os = "macos")]
        assert_eq!(CODEX_CONFIG, file);
    }

    #[test]
    fn a_program_is_started_with_its_home_and_no_key_from_the_shell() {
        let home = Home {
            tool: Tool::ClaudeCode,
            dir: PathBuf::from("homes").join("claude-code-2"),
        };
        let mut command = Command::new("claude");
        command.env("ANTHROPIC_API_KEY", "from-the-shell");
        home.apply(&mut command);
        let envs: Vec<_> = command.get_envs().collect();
        assert!(envs.contains(&(
            std::ffi::OsStr::new("CLAUDE_CONFIG_DIR"),
            Some(home.dir().as_os_str())
        )));
        assert!(envs.contains(&(std::ffi::OsStr::new("ANTHROPIC_API_KEY"), None)));
        for name in CLAUDE_OVERRIDES {
            assert!(envs.contains(&(std::ffi::OsStr::new(name), None)), "{name}");
        }
    }
}
