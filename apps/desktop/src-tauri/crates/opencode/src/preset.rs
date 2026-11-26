use std::path::{Path, PathBuf};

use orden_ai::ai_agent::{Mode, ENGINE_KEPT_OUT};
use orden_ai::mcp::host::{hints, Hint, KEPT_OUT_VAR};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::env::MCP_TOKEN_VAR;

pub const SERVER: &str = "orden";
const TOOL_MS: u64 = 600_000;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Approve,
    Auto,
    Full,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Orden {
    pub program: PathBuf,
    pub grant: String,
    pub preset: Preset,
}
impl Preset {
    pub fn mode(self) -> Mode {
        match self {
            Preset::Approve => Mode::Approve,
            Preset::Auto => Mode::Auto,
            Preset::Full => Mode::Full,
        }
    }
}
fn named(tool: &str) -> String {
    format!("{SERVER}_{tool}")
}
fn offered() -> Vec<Hint> {
    hints().into_iter().filter(|one| !ENGINE_KEPT_OUT.contains(&one.name)).collect()
}
fn rules(pairs: Vec<(String, Value)>) -> Value {
    Value::Object(pairs.into_iter().collect::<Map<String, Value>>())
}
pub fn permission(preset: Preset) -> Value {
    let mut pairs: Vec<(String, Value)> = match preset {
        Preset::Approve => vec![
            ("*".into(), json!("allow")),
            ("edit".into(), json!("ask")),
            (
                "bash".into(),
                json!({ "*": "ask", "ls *": "allow", "git status*": "allow", "git diff*": "allow", "git log*": "allow" }),
            ),
            ("webfetch".into(), json!("ask")),
            ("external_directory".into(), json!("ask")),
        ],
        Preset::Auto => vec![
            ("*".into(), json!("allow")),
            (
                "bash".into(),
                json!({ "*": "allow", "rm *": "ask", "sudo *": "ask", "git push*": "ask", "git reset --hard*": "ask", "curl *| *sh*": "ask" }),
            ),
            ("external_directory".into(), json!("ask")),
        ],
        Preset::Full => vec![("*".into(), json!("allow"))],
    };
    for tool in offered() {
        let action = match preset {
            _ if tool.reads_only => "allow",
            Preset::Approve => "ask",
            Preset::Auto if tool.destructive => "ask",
            Preset::Auto | Preset::Full => "allow",
        };
        pairs.push((named(tool.name), json!(action)));
    }
    for tool in ENGINE_KEPT_OUT {
        pairs.push((named(tool), json!("deny")));
    }
    rules(pairs)
}
pub fn plan() -> Value {
    let mut pairs =
        vec![("edit".to_owned(), json!({ "*": "deny", ".opencode/plans/*.md": "allow" }))];
    for tool in hints().into_iter().filter(|one| !one.reads_only) {
        pairs.push((named(tool.name), json!("deny")));
    }
    rules(pairs)
}
pub fn server(program: &Path) -> Value {
    json!({
        "type": "local",
        "command": [program.to_string_lossy(), "mcp"],
        "environment": {
            MCP_TOKEN_VAR: format!("{{env:{MCP_TOKEN_VAR}}}"),
            KEPT_OUT_VAR: ENGINE_KEPT_OUT.join(","),
        },
        "timeout": TOOL_MS,
    })
}
pub fn joined(config: &mut Map<String, Value>, orden: &Orden) {
    config.insert("permission".into(), permission(orden.preset));
    let mcp = config.entry("mcp").or_insert_with(|| json!({}));
    if !mcp.is_object() {
        *mcp = json!({});
    }
    mcp[SERVER] = server(&orden.program);
    let agents = config.entry("agent").or_insert_with(|| json!({}));
    if !agents.is_object() {
        *agents = json!({});
    }
    if !agents["plan"].is_object() {
        agents["plan"] = json!({});
    }
    agents["plan"]["permission"] = plan();
}
#[cfg(test)]
mod tests {
    use super::*;

    fn action(rules: &Value, tool: &str) -> Value {
        rules[named(tool)].clone()
    }
    #[test]
    fn orden_s_tools_are_allowed_asked_or_denied_by_their_hints_and_the_preset() {
        let all = hints();
        let read = all.iter().find(|one| one.reads_only).expect("a read tool").name;
        let write =
            all.iter().find(|one| !one.reads_only && !one.destructive).expect("a write").name;
        let risky = all.iter().find(|one| one.destructive).expect("a destructive tool").name;
        let (approve, auto, full) =
            (permission(Preset::Approve), permission(Preset::Auto), permission(Preset::Full));
        for rules in [&approve, &auto, &full] {
            assert_eq!(action(rules, read), "allow");
            for kept in ENGINE_KEPT_OUT {
                assert_eq!(action(rules, kept), "deny");
            }
            let keys: Vec<&String> = rules.as_object().expect("rules").keys().collect();
            assert_eq!(keys.first().map(|one| one.as_str()), Some("*"));
        }
        assert_eq!(
            (action(&approve, write), action(&approve, risky)),
            (json!("ask"), json!("ask"))
        );
        assert_eq!((action(&auto, write), action(&auto, risky)), (json!("allow"), json!("ask")));
        assert_eq!((action(&full, write), action(&full, risky)), (json!("allow"), json!("allow")));
        assert_eq!(approve["edit"], "ask");
        assert_eq!(auto["bash"]["rm *"], "ask");
        let plan = plan();
        assert_eq!(plan["edit"]["*"], "deny");
        assert_eq!(action(&plan, write), "deny");
        assert_eq!(action(&plan, risky), "deny");
        assert!(plan.get(named(read)).is_none());
    }
    #[test]
    fn orden_is_one_local_server_told_its_token_by_reference_and_overrides_what_the_settings_said()
    {
        let orden = Orden {
            program: PathBuf::from("/opt/Orden/orden"),
            grant: "built-in:opencode".into(),
            preset: Preset::Full,
        };
        let mut config = json!({
            "permission": { "*": "deny" },
            "mcp": { "orden": { "type": "remote", "url": "http://evil" }, "other": { "type": "local" } },
            "agent": { "plan": { "model": "x/y", "permission": { "edit": "allow" } } },
        })
        .as_object()
        .cloned()
        .expect("object");
        joined(&mut config, &orden);
        let server = &config["mcp"]["orden"];
        assert_eq!(server["type"], "local");
        assert_eq!(server["command"], json!(["/opt/Orden/orden", "mcp"]));
        assert_eq!(server["environment"][MCP_TOKEN_VAR], "{env:ORDEN_MCP_TOKEN}");
        assert_eq!(server["environment"][KEPT_OUT_VAR], "run_agent,agent_result");
        assert!(config["mcp"]["other"].is_object());
        assert_eq!(config["permission"], permission(Preset::Full));
        assert_eq!(config["agent"]["plan"]["model"], "x/y");
        assert_eq!(config["agent"]["plan"]["permission"], plan());
        let mut odd = json!({ "mcp": "x", "agent": 3 }).as_object().cloned().expect("object");
        joined(&mut odd, &orden);
        assert_eq!(odd["mcp"]["orden"]["type"], "local");
        assert_eq!(odd["agent"]["plan"]["permission"], plan());
        assert_eq!(Preset::Approve.mode(), Mode::Approve);
        assert_eq!(serde_json::from_value::<Preset>(json!("auto")).expect("preset"), Preset::Auto);
    }
}
