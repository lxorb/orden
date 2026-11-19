use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub on: bool,
    pub transport: Transport,
    #[serde(default)]
    pub tools: BTreeMap<String, Permission>,
    #[serde(default)]
    pub from: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Transport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        env: Vec<String>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: Vec<String>,
    },
}
impl Transport {
    pub fn names(&self) -> &[String] {
        match self {
            Self::Stdio { env, .. } => env,
            Self::Http { headers, .. } => headers,
        }
    }
    pub fn same_place(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::Stdio { command, args, .. },
                Self::Stdio { command: other_command, args: other_args, .. },
            ) => command == other_command && args == other_args,
            (Self::Http { url, .. }, Self::Http { url: other_url, .. }) => {
                url.trim_end_matches('/') == other_url.trim_end_matches('/')
            }
            _ => false,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Allow,
    Ask,
    Off,
}
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Secrets {
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}
impl Secrets {
    pub fn values(&self) -> impl Iterator<Item = &str> {
        self.env.values().chain(self.headers.values()).map(String::as_str)
    }
    pub fn is_empty(&self) -> bool {
        self.env.is_empty() && self.headers.is_empty()
    }
    pub fn for_transport(&self, transport: &Transport) -> &BTreeMap<String, String> {
        match transport {
            Transport::Stdio { .. } => &self.env,
            Transport::Http { .. } => &self.headers,
        }
    }
    #[must_use]
    pub fn merged(mut self, given: Option<Self>, transport: &Transport) -> Self {
        if let Some(given) = given {
            for (kept, more) in [(&mut self.env, given.env), (&mut self.headers, given.headers)] {
                for (name, value) in more {
                    if value.is_empty() {
                        kept.remove(&name);
                    } else {
                        kept.insert(name, value);
                    }
                }
            }
        }
        let (env, headers): (&[String], &[String]) = match transport {
            Transport::Stdio { env, .. } => (env, &[]),
            Transport::Http { headers, .. } => (&[], headers),
        };
        self.env.retain(|name, _| env.contains(name));
        self.headers.retain(|name, _| headers.contains(name));
        self
    }
    pub fn hide(&self, text: &str) -> String {
        let mut hidden = text.to_owned();
        for value in self.values().filter(|value| value.len() >= 3) {
            hidden = hidden.replace(value, "[hidden]");
        }
        hidden
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Off,
    Starting,
    Ready,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
    pub input_schema: Value,
    pub read_only: bool,
    pub permission: Permission,
}
impl ToolInfo {
    pub fn of(tool: &Value, chosen: &BTreeMap<String, Permission>) -> Option<Self> {
        let name = tool.get("name")?.as_str()?.to_owned();
        let notes = tool.get("annotations");
        let read_only = notes.and_then(|notes| notes.get("readOnlyHint")).and_then(Value::as_bool)
            == Some(true);
        let title = tool
            .get("title")
            .or_else(|| notes.and_then(|notes| notes.get("title")))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let permission = chosen.get(&name).copied().unwrap_or(if read_only {
            Permission::Allow
        } else {
            Permission::Ask
        });
        Some(Self {
            title,
            description: tool.get("description").and_then(Value::as_str).unwrap_or("").to_owned(),
            input_schema: tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({ "type": "object" })),
            read_only,
            permission,
            name,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    #[serde(flatten)]
    pub server: Server,
    pub state: State,
    pub error: Option<String>,
    pub listed: Vec<ToolInfo>,
    pub secrets_set: Vec<String>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Offered {
    pub server: String,
    pub server_name: String,
    pub tool: ToolInfo,
    pub exposed: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub source: String,
    pub source_name: String,
    pub path: String,
    pub servers: Vec<FoundServer>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundServer {
    pub name: String,
    pub transport: Transport,
    pub already: bool,
    pub orden: bool,
    pub needs_input: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub source: String,
    pub name: String,
}
