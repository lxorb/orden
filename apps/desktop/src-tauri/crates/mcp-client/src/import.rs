use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::types::{Found, FoundServer, Secrets, Transport};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    McpServers,
    Servers,
    Settings,
    Codex,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub source: &'static str,
    pub source_name: &'static str,
    pub path: PathBuf,
    pub shape: Shape,
}
pub struct Entry {
    pub server: FoundServer,
    pub values: Secrets,
}
pub fn places(home: &Path, config: &Path, codex: Option<&Path>) -> Vec<Place> {
    let code = config.join("Code").join("User");
    let codex = codex.map_or_else(|| home.join(".codex"), Path::to_path_buf);
    [
        (
            "claude-desktop",
            "Claude Desktop",
            config.join("Claude").join("claude_desktop_config.json"),
            Shape::McpServers,
        ),
        ("claude-code", "Claude Code", home.join(".claude.json"), Shape::McpServers),
        ("cursor", "Cursor", home.join(".cursor").join("mcp.json"), Shape::McpServers),
        ("vscode", "VS Code", code.join("mcp.json"), Shape::Servers),
        ("vscode", "VS Code", code.join("settings.json"), Shape::Settings),
        ("codex", "Codex", codex.join("config.toml"), Shape::Codex),
        (
            "windsurf",
            "Windsurf",
            home.join(".codeium").join("windsurf").join("mcp_config.json"),
            Shape::McpServers,
        ),
        ("gemini", "Gemini CLI", home.join(".gemini").join("settings.json"), Shape::McpServers),
    ]
    .into_iter()
    .map(|(source, source_name, path, shape)| Place { source, source_name, path, shape })
    .collect()
}
pub fn here() -> Vec<Place> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let config = dirs::config_dir().unwrap_or_else(|| home.join(".config"));
    let codex = std::env::var_os("CODEX_HOME").filter(|one| !one.is_empty()).map(PathBuf::from);
    places(&home, &config, codex.as_deref())
}
pub fn scan(places: &[Place], env: &dyn Fn(&str) -> Option<String>) -> Vec<Found> {
    places
        .iter()
        .filter_map(|place| {
            let servers: Vec<FoundServer> =
                read(place, env).into_iter().map(|entry| entry.server).collect();
            (!servers.is_empty()).then(|| Found {
                source: place.source.to_owned(),
                source_name: place.source_name.to_owned(),
                path: place.path.to_string_lossy().into_owned(),
                servers,
            })
        })
        .collect()
}
pub fn read(place: &Place, env: &dyn Fn(&str) -> Option<String>) -> Vec<Entry> {
    std::fs::read_to_string(&place.path)
        .ok()
        .and_then(|text| entries(place.shape, &text, env).ok())
        .unwrap_or_default()
}
pub fn entries(
    shape: Shape,
    text: &str,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Vec<Entry>, String> {
    let whole: Value = match shape {
        Shape::Codex => {
            let table: toml::Table = toml::from_str(text).map_err(|error| error.to_string())?;
            serde_json::to_value(table).map_err(|error| error.to_string())?
        }
        _ => serde_json::from_str(&plain(text)).map_err(|error| error.to_string())?,
    };
    let servers = match shape {
        Shape::McpServers => whole.get("mcpServers"),
        Shape::Servers => whole.get("servers"),
        Shape::Settings => {
            whole.get("mcp").and_then(|mcp| mcp.get("servers")).or_else(|| whole.get("mcp.servers"))
        }
        Shape::Codex => whole.get("mcp_servers"),
    };
    let Some(servers) = servers.and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    Ok(servers
        .iter()
        .filter_map(|(name, entry)| {
            let entry = entry.as_object()?;
            if shape == Shape::Codex {
                codex_entry(name, entry, env)
            } else {
                entry_of(name, entry)
            }
        })
        .collect())
}
fn text_of(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(yes) => Some(yes.to_string()),
        _ => None,
    }
}
fn texts(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|all| all.iter().filter_map(text_of).collect())
        .unwrap_or_default()
}
fn pairs(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|all| {
            all.iter().filter_map(|(name, value)| Some((name.clone(), text_of(value)?))).collect()
        })
        .unwrap_or_default()
}
fn asks(value: &str) -> bool {
    value.contains("${")
}
fn filled(
    given: BTreeMap<String, String>,
    names: &mut Vec<String>,
    needs: &mut Vec<String>,
) -> BTreeMap<String, String> {
    let mut kept = BTreeMap::new();
    for (name, value) in given {
        if !names.contains(&name) {
            names.push(name.clone());
        }
        if asks(&value) {
            needs.push(name);
        } else {
            kept.insert(name, value);
        }
    }
    kept
}
fn found(name: &str, transport: Transport, needs_input: Vec<String>, values: Secrets) -> Entry {
    let orden = is_orden(&transport);
    Entry {
        server: FoundServer {
            name: name.to_owned(),
            transport,
            already: false,
            orden,
            needs_input,
        },
        values,
    }
}
fn entry_of(name: &str, entry: &Map<String, Value>) -> Option<Entry> {
    let kind =
        entry.get("type").or_else(|| entry.get("transport")).and_then(Value::as_str).unwrap_or("");
    let url = ["url", "serverUrl", "httpUrl"]
        .iter()
        .find_map(|key| entry.get(*key).and_then(Value::as_str));
    let command =
        entry.get("command").and_then(Value::as_str).filter(|command| !command.is_empty());
    let remote = matches!(kind, "sse" | "http" | "streamable-http" | "streamableHttp");
    let mut needs = Vec::new();
    match (command, url) {
        (Some(command), _) if !remote || url.is_none() => {
            let mut env = Vec::new();
            let values = filled(pairs(entry.get("env")), &mut env, &mut needs);
            let transport = Transport::Stdio {
                command: command.to_owned(),
                args: texts(entry.get("args")),
                cwd: entry.get("cwd").and_then(Value::as_str).map(str::to_owned),
                env,
            };
            Some(found(name, transport, needs, Secrets { env: values, headers: BTreeMap::new() }))
        }
        (_, Some(url)) => {
            let mut headers = Vec::new();
            let values = filled(pairs(entry.get("headers")), &mut headers, &mut needs);
            let transport = Transport::Http { url: url.to_owned(), headers };
            Some(found(name, transport, needs, Secrets { env: BTreeMap::new(), headers: values }))
        }
        _ => None,
    }
}
fn codex_entry(
    name: &str,
    entry: &Map<String, Value>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Option<Entry> {
    let Some(url) = entry.get("url").and_then(Value::as_str) else {
        return entry_of(name, entry);
    };
    let mut given = pairs(entry.get("http_headers"));
    let mut needs = Vec::new();
    let mut headers = Vec::new();
    let mut wanted: Vec<(String, &str, String)> = pairs(entry.get("env_http_headers"))
        .into_iter()
        .map(|(header, var)| (header, "", var))
        .collect();
    if let Some(var) = entry.get("bearer_token_env_var").and_then(Value::as_str) {
        wanted.push(("Authorization".to_owned(), "Bearer ", var.to_owned()));
    }
    for (header, prefix, var) in wanted {
        headers.push(header.clone());
        if let Some(value) = env(&var).filter(|value| !value.is_empty()) {
            given.insert(header, format!("{prefix}{value}"));
        } else {
            given.remove(&header);
            needs.push(header);
        }
    }
    let values = filled(given, &mut headers, &mut needs);
    let transport = Transport::Http { url: url.to_owned(), headers };
    Some(found(name, transport, needs, Secrets { env: BTreeMap::new(), headers: values }))
}
pub fn is_orden(transport: &Transport) -> bool {
    let Transport::Stdio { command, args, .. } = transport else {
        return false;
    };
    let file = command.rsplit(['/', '\\']).next().unwrap_or(command);
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    stem.eq_ignore_ascii_case("orden") && args.len() == 1 && args[0] == "mcp"
}
fn plain(text: &str) -> String {
    let text: Vec<char> = text.trim_start_matches('\u{feff}').chars().collect();
    let mut out = String::with_capacity(text.len());
    let (mut at, mut quoted) = (0, false);
    while at < text.len() {
        let one = text[at];
        let next = text.get(at + 1).copied();
        if quoted {
            out.push(one);
            if one == '\\' {
                out.extend(next);
                at += 1;
            } else if one == '"' {
                quoted = false;
            }
            at += 1;
            continue;
        }
        match (one, next) {
            ('"', _) => {
                quoted = true;
                out.push(one);
            }
            ('/', Some('/')) => {
                while at < text.len() && text[at] != '\n' {
                    at += 1;
                }
                continue;
            }
            ('/', Some('*')) => {
                at += 2;
                while at < text.len() && !(text[at] == '*' && text.get(at + 1) == Some(&'/')) {
                    at += 1;
                }
                at += 2;
                continue;
            }
            (',', _) => {
                let after = text[at + 1..].iter().find(|one| !one.is_whitespace());
                if !matches!(after, Some('}' | ']')) {
                    out.push(one);
                }
            }
            _ => out.push(one),
        }
        at += 1;
    }
    out
}
#[cfg(test)]
mod tests {
    use super::plain;

    #[test]
    fn comments_and_trailing_commas_are_left_out_but_not_inside_strings() {
        let text = "\u{feff}{\n// a note\n\"a\": \"http://x/*y*/\", /* gone */ \"b\": [1, 2,],\n}";
        let value: serde_json::Value = serde_json::from_str(&plain(text)).expect("plain JSON");
        assert_eq!(value, serde_json::json!({ "a": "http://x/*y*/", "b": [1, 2] }));
    }
}
