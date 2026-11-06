use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths::{made, write_privately};

const LONGEST_NAME: usize = 60;

const KNOWN: [(&str, &str); 3] = [
    ("claude-code", "Claude Code"),
    ("claude-ai", "Claude Desktop"),
    ("codex-mcp-client", "Codex"),
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Client {
    pub key: String,
    pub name: String,
}

impl Client {
    pub fn from_info(info: &Value) -> Self {
        let said = |key: &str| {
            info.get(key)
                .and_then(Value::as_str)
                .map(|one| one.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|one| !one.is_empty())
        };
        let own = said("name");
        let key = own.as_deref().map(file_name).unwrap_or_default();
        let key = if key.is_empty() {
            "agent".to_owned()
        } else {
            key
        };
        let known = KNOWN
            .iter()
            .find(|(name, _)| own.as_deref() == Some(*name))
            .map(|(_, called)| (*called).to_owned());
        let name = said("title")
            .or(known)
            .or(own)
            .unwrap_or_else(|| "An agent".to_owned());
        Client {
            key,
            name: name.chars().take(LONGEST_NAME).collect(),
        }
    }
}

fn file_name(name: &str) -> String {
    let mut key = String::new();
    for one in name.chars().flat_map(char::to_lowercase) {
        if one.is_ascii_alphanumeric() {
            key.push(one);
        } else if !key.is_empty() && !key.ends_with('-') {
            key.push('-');
        }
        if key.len() >= 48 {
            break;
        }
    }
    key.trim_end_matches('-').to_owned()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    pub agent: String,
    pub token: String,
}

fn file(dir: &Path, client: &Client) -> PathBuf {
    dir.join("agents").join("clients").join(&client.key)
}

pub fn kept(dir: &Path, client: &Client) -> Option<Kept> {
    let text = std::fs::read_to_string(file(dir, client)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn keep(dir: &Path, client: &Client, kept: &Kept) -> Result<(), String> {
    let path = file(dir, client);
    if let Some(folder) = path.parent() {
        made(folder)?;
    }
    let text = serde_json::to_string(kept).map_err(|error| error.to_string())?;
    write_privately(&path, text.as_bytes())
}

pub fn forget(dir: &Path, client: &Client) {
    let _ = std::fs::remove_file(file(dir, client));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_client_is_called_what_it_calls_itself() {
        let claude = Client::from_info(&json!({ "name": "claude-code", "title": "Claude Code" }));
        assert_eq!(claude.key, "claude-code");
        assert_eq!(claude.name, "Claude Code");

        let codex = Client::from_info(&json!({ "name": "codex-mcp-client", "version": "1" }));
        assert_eq!(codex.key, "codex-mcp-client");
        assert_eq!(codex.name, "Codex");

        let other = Client::from_info(&json!({ "name": "My Tool (beta)" }));
        assert_eq!(other.key, "my-tool-beta");
        assert_eq!(other.name, "My Tool (beta)");
    }

    #[test]
    fn a_client_that_says_nothing_is_an_agent() {
        let nobody = Client::from_info(&json!({}));
        assert_eq!(nobody.key, "agent");
        assert_eq!(nobody.name, "An agent");
        let odd = Client::from_info(&json!({ "name": "日本", "title": "  " }));
        assert_eq!(odd.key, "agent");
        assert_eq!(odd.name, "日本");
    }

    #[test]
    fn a_long_name_is_cut_to_what_pairing_takes() {
        let long = Client::from_info(&json!({ "name": "x".repeat(200) }));
        assert_eq!(long.name.chars().count(), LONGEST_NAME);
        assert_eq!(long.key.len(), 48);
    }

    #[test]
    fn a_token_is_kept_forgotten_and_nobody_elses() {
        let dir = tempfile::tempdir().expect("a folder");
        let claude = Client::from_info(&json!({ "name": "claude-code" }));
        let codex = Client::from_info(&json!({ "name": "codex-mcp-client" }));
        assert_eq!(kept(dir.path(), &claude), None);

        let token = Kept {
            agent: "claude-code".into(),
            token: "t".repeat(64),
        };
        keep(dir.path(), &claude, &token).expect("kept");
        assert_eq!(kept(dir.path(), &claude), Some(token));
        assert_eq!(kept(dir.path(), &codex), None);
        assert!(dir
            .path()
            .join("agents")
            .join("clients")
            .join("claude-code")
            .is_file());

        forget(dir.path(), &claude);
        assert_eq!(kept(dir.path(), &claude), None);
    }
}
