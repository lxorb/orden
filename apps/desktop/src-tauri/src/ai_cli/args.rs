use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

pub use crate::ai_agent::Mode;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tool {
    ClaudeCode,
    Codex,
    Gemini,
}

impl Tool {
    pub fn command(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
        }
    }
}

pub const SYSTEM: &str = "You are the assistant inside Orden, a markdown notes app. \
The message starts with the app's instructions for this request; follow them exactly. \
You have no tools: answer in words only.";

pub fn session_system(mode: Option<Mode>) -> &'static str {
    match mode {
        None => SYSTEM,
        Some(Mode::Approve) => {
            "You are the reader's agent inside Orden, their notes app and web browser. \
Do what they ask with the Orden tools; the reader approves each change before it is made, so \
a call may wait for them. Name the note or page a claim comes from as a [[wikilink]] or its \
address. Change part of a note with edit_note rather than write_note, since they may be \
typing in it. Reply in the language of the request, in markdown, briefly."
        }
        Some(Mode::Plan) => {
            "You are the reader's assistant inside Orden, their notes app and web \
browser. Plan mode: read what you need with the Orden tools, then write the plan as one new \
note with create_note, a task per step, and change nothing else. Reply in the language of \
the request, briefly."
        }
        Some(Mode::Auto) => {
            "You are the reader's agent inside Orden, their notes app and web browser. \
Do what they ask with the nib tools: most changes are made at once and shown to them to keep \
or undo, and a call that sends, deletes or publishes may wait for their approval. Name the \
note or page a claim comes from as a [[wikilink]] or its address. Change part of a note with \
edit_note rather than write_note, since they may be typing in it. Reply in the language of \
the request, briefly, saying what you did."
        }
        Some(Mode::Full) => {
            "You are the reader's agent inside Orden, their notes app and web browser. \
Do what they ask with the Orden tools, without asking: every change you make is shown to them \
to keep or undo. Nothing is asked of them or handed back: sign in with what their password \
manager filled, and pay, send, delete or change a setting yourself where the task needs it, \
never browser_takeover. Name the note or page a claim comes from as a [[wikilink]] or its address. \
Change part of a note with edit_note rather than write_note, since they may be typing in it. \
Reply in the language of the request, briefly, saying what you did."
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    pub fn word(self, tool: Tool) -> Result<&'static str, String> {
        Ok(match (self, tool) {
            (Self::Off | Self::Minimal, Tool::ClaudeCode) | (_, Tool::Gemini) => {
                return Err(format!("{} has no such effort", tool.command()))
            }
            (Self::Off, Tool::Codex) => "none",
            (Self::Minimal, Tool::Codex) => "minimal",
            (Self::Low, _) => "low",
            (Self::Medium, _) => "medium",
            (Self::High, _) => "high",
            (Self::Xhigh, _) => "xhigh",
            (Self::Max, _) => "max",
        })
    }
}

#[derive(Deserialize)]
struct Row {
    name: String,
    #[serde(default)]
    annotations: Value,
}

pub fn tools_of(mode: Mode, without: &[String]) -> (Vec<String>, Vec<String>) {
    let table: Vec<Row> =
        serde_json::from_str(include_str!("../mcp/tools.json")).unwrap_or_default();
    let (listed, left): (Vec<Row>, Vec<Row>) = table.into_iter().partition(|row| {
        let reads = row.annotations["readOnlyHint"].as_bool() == Some(true);
        crate::ai_agent::in_mode(mode, &row.name, reads) && !without.contains(&row.name)
    });
    let names = |rows: Vec<Row>| rows.into_iter().map(|row| row.name).collect();
    (names(listed), names(left))
}

pub const SERVER: &str = "orden";

pub const TOKEN_VAR: &str = "NIB_MCP_TOKEN";

pub const THREAD_VAR: &str = "NIB_MCP_THREAD";

pub fn with_thread(params: &mut Value, thread: &str) {
    params["config"][format!("mcp_servers.{SERVER}.env")] = json!({ THREAD_VAR: thread });
}

const TOOL_SECONDS: u64 = 600;

pub const CLAUDE_SESSION_ENV: [(&str, &str); 2] = [
    ("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1"),
    ("MCP_TOOL_TIMEOUT", "600000"),
];

pub fn mcp_config(nib: &Path) -> Value {
    json!({
        "mcpServers": {
            SERVER: { "type": "stdio", "command": nib, "args": ["mcp"] }
        }
    })
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Shape<'a> {
    pub mode: Option<Mode>,
    pub model: Option<&'a str>,
    pub effort: Option<Effort>,
    pub without: &'a [String],
}

pub fn model_ok(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 100
        && !model.starts_with('-')
        && model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'[' | b']')
        })
}

pub fn checked_model(model: Option<&str>) -> Result<Option<&str>, String> {
    match model {
        Some(model) if !model_ok(model) => Err(format!("{model:?} is not a model name")),
        other => Ok(other),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Caps {
    flags: Vec<String>,
}

impl Caps {
    pub fn from_help(help: &str) -> Self {
        let mut flags: Vec<String> = help
            .split(|one: char| !(one.is_ascii_alphanumeric() || one == '-'))
            .filter(|word| word.len() > 2 && word.starts_with("--"))
            .map(str::to_owned)
            .collect();
        flags.sort_unstable();
        flags.dedup();
        Self { flags }
    }

    fn has(&self, flag: &str) -> bool {
        self.flags
            .binary_search_by(|one| one.as_str().cmp(flag))
            .is_ok()
    }
}

fn claude_base(input: bool, partial: bool) -> Vec<String> {
    let mut args = vec!["-p".to_owned()];
    if input {
        args.extend(["--input-format".to_owned(), "stream-json".to_owned()]);
    }
    args.extend(
        ["--output-format", "stream-json", "--verbose"]
            .map(str::to_owned)
            .to_vec(),
    );
    if partial {
        args.push("--include-partial-messages".to_owned());
    }
    args.extend(
        ["--tools", "", "--strict-mcp-config"]
            .map(str::to_owned)
            .to_vec(),
    );
    args
}

fn present(caps: &Caps, flags: &[&str]) -> Vec<String> {
    flags
        .iter()
        .filter(|flag| caps.has(flag))
        .map(|flag| (*flag).to_owned())
        .collect()
}

pub fn ask(model: Option<&str>, caps: &Caps) -> Result<Vec<String>, String> {
    let model = checked_model(model)?;
    let mut args = claude_base(false, true);
    args.extend(["--system-prompt".to_owned(), SYSTEM.to_owned()]);
    args.extend(present(caps, &["--no-session-persistence", "--safe-mode"]));
    if caps.has("--permission-prompts") {
        args.extend(["--permission-prompts".to_owned(), "none".to_owned()]);
    }
    if let Some(model) = model {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    Ok(args)
}

pub fn claude_session(shape: Shape, caps: &Caps, config: &Path) -> Result<Vec<String>, String> {
    if !caps.has("--input-format") {
        return Err("out of date".to_owned());
    }
    let model = checked_model(shape.model)?;
    let effort = shape
        .effort
        .map(|one| one.word(Tool::ClaudeCode))
        .transpose()?;

    let mut args = claude_base(true, true);
    if let Some(mode) = shape.mode {
        let (listed, left) = tools_of(mode, shape.without);
        let named = |names: &[String]| {
            names
                .iter()
                .map(|name| format!("mcp__{SERVER}__{name}"))
                .collect::<Vec<_>>()
                .join(",")
        };
        args.extend([
            "--mcp-config".to_owned(),
            config.to_string_lossy().into_owned(),
            "--allowedTools".to_owned(),
            if left.is_empty() {
                format!("mcp__{SERVER}")
            } else {
                named(&listed)
            },
        ]);
        if !left.is_empty() {
            args.extend(["--disallowedTools".to_owned(), named(&left)]);
        }
    }
    if caps.has("--permission-mode") {
        args.extend(["--permission-mode".to_owned(), "dontAsk".to_owned()]);
    }
    if caps.has("--permission-prompts") {
        args.extend(["--permission-prompts".to_owned(), "none".to_owned()]);
    }
    args.extend([
        "--system-prompt".to_owned(),
        session_system(shape.mode).to_owned(),
    ]);
    args.extend(present(caps, &["--no-session-persistence", "--restricted"]));
    if let Some(model) = model {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    if let (Some(effort), true) = (effort, caps.has("--effort")) {
        args.extend(["--effort".to_owned(), effort.to_owned()]);
    }
    Ok(args)
}

pub fn claude_listing(caps: &Caps) -> Vec<String> {
    let mut args = claude_base(true, false);
    args.extend(["--system-prompt".to_owned(), SYSTEM.to_owned()]);
    args.extend(present(caps, &["--no-session-persistence", "--safe-mode"]));
    args
}

pub fn codex_server() -> Vec<String> {
    let mut args = vec!["app-server".to_owned()];
    for setting in [
        "features.shell_tool=false",
        "web_search='disabled'",
        "tools.web_search=false",
        "mcp_servers={}",
        "project_doc_max_bytes=0",
        "history.persistence='none'",
        "sandbox_mode='read-only'",
        "approval_policy='never'",
    ] {
        args.extend(["-c".to_owned(), setting.to_owned()]);
    }
    args
}

pub fn codex_thread(
    mode: Option<Mode>,
    model: Option<&str>,
    without: &[String],
    nib: &Path,
    folder: &Path,
) -> Value {
    let mut config = serde_json::Map::new();
    if let Some(mode) = mode {
        let (listed, left) = tools_of(mode, without);
        let key = |name: &str| format!("mcp_servers.{SERVER}.{name}");
        config.insert(key("command"), json!(nib));
        config.insert(key("args"), json!(["mcp"]));
        config.insert(key("env_vars"), json!([TOKEN_VAR]));
        config.insert(key("startup_timeout_sec"), json!(30));
        config.insert(key("tool_timeout_sec"), json!(TOOL_SECONDS));
        if !left.is_empty() {
            config.insert(key("enabled_tools"), json!(listed));
        }
    }
    let mut params = json!({
        "cwd": folder,
        "sandbox": "read-only",
        "approvalPolicy": "never",
        "ephemeral": true,
        "baseInstructions": session_system(mode),
        "config": config,
    });
    if let Some(model) = model {
        params["model"] = json!(model);
    }
    params
}

pub const GEMINI_SYSTEM_VAR: &str = "GEMINI_SYSTEM_MD";

pub const GEMINI_SETTINGS_VAR: &str = "GEMINI_CLI_SYSTEM_SETTINGS_PATH";

pub const GEMINI_TRUST_VAR: &str = "GEMINI_CLI_TRUST_WORKSPACE";

const GEMINI_BUILTINS: [&str; 14] = [
    "run_shell_command",
    "write_file",
    "replace",
    "read_file",
    "read_many_files",
    "list_directory",
    "glob",
    "search_file_content",
    "grep_search",
    "web_fetch",
    "google_web_search",
    "save_memory",
    "write_todos",
    "activate_skill",
];

pub fn gemini_settings(mode: Option<Mode>, without: &[String], nib: &Path) -> Value {
    let mut settings = json!({
        "tools": { "exclude": GEMINI_BUILTINS },
        "skills": { "enabled": false },
        "hooksConfig": { "enabled": false },
        "general": { "disableAutoUpdate": true },
    });
    if let Some(mode) = mode {
        let (listed, left) = tools_of(mode, without);
        let mut server = json!({
            "command": nib,
            "args": ["mcp"],
            "env": {
                TOKEN_VAR: format!("${{{TOKEN_VAR}}}"),
                THREAD_VAR: format!("${{{THREAD_VAR}}}"),
            },
            "timeout": TOOL_SECONDS * 1000,
            "trust": true,
        });
        if !left.is_empty() {
            server["includeTools"] = json!(listed);
        }
        settings["mcpServers"] = json!({ SERVER: server });
    }
    settings
}

pub fn gemini_turn(
    model: Option<&str>,
    resume: Option<&str>,
    caps: &Caps,
) -> Result<Vec<String>, String> {
    if !caps.has("--output-format") {
        return Err("out of date".to_owned());
    }
    let model = checked_model(model)?;
    let mut args: Vec<String> = [
        "--output-format",
        "stream-json",
        "--allowed-mcp-server-names",
        SERVER,
    ]
    .map(str::to_owned)
    .to_vec();
    args.extend(present(caps, &["--skip-trust"]));
    if let Some(model) = model {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    if let Some(resume) = resume {
        if !session_ok(resume) {
            return Err(format!("{resume:?} is not a session"));
        }
        args.extend(["--resume".to_owned(), resume.to_owned()]);
    }
    Ok(args)
}

fn session_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && !id.starts_with('-')
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub fn status(tool: Tool) -> &'static [&'static str] {
    match tool {
        Tool::ClaudeCode => &["auth", "status", "--json"],
        Tool::Codex => &["login", "status"],
        Tool::Gemini => &["--version"],
    }
}

pub fn logout(tool: Tool) -> &'static [&'static str] {
    match tool {
        Tool::ClaudeCode => &["auth", "logout"],
        Tool::Codex => &["logout"],
        Tool::Gemini => &[],
    }
}

pub const HELP: [&str; 1] = ["--help"];

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const CLAUDE_HELP: &str = "  --safe-mode   Start with all customizations disabled\n  \
        --no-session-persistence  Disable session persistence\n  \
        --permission-prompts <target>  Who answers\n  --input-format <format>\n  \
        --effort <level>\n  --restricted\n  --permission-mode <mode>";

    fn config() -> PathBuf {
        PathBuf::from("ai").join("nib-mcp.json")
    }

    fn value_of<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let at = args.iter().position(|one| one == flag)?;
        args.get(at + 1).map(String::as_str)
    }

    #[test]
    fn claude_runs_with_no_tools_no_servers_and_nib_s_prompt() {
        let args = ask(None, &Caps::default()).expect("args");
        assert_eq!(value_of(&args, "--tools"), Some(""));
        assert!(args.contains(&"--strict-mcp-config".to_owned()));
        assert!(args.contains(&"-p".to_owned()));
        assert!(!args.iter().any(|one| one == "--mcp-config"));
        assert!(!args.iter().any(|one| one.contains("skip-permissions")));
        assert_eq!(value_of(&args, "--system-prompt"), Some(SYSTEM));
    }

    #[test]
    fn every_fixed_argument_survives_cmd() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let mut all = ask(None, &caps).expect("args");
        all.extend(codex_server());
        all.extend(claude_listing(&caps));
        for mode in [
            None,
            Some(Mode::Approve),
            Some(Mode::Plan),
            Some(Mode::Auto),
            Some(Mode::Full),
        ] {
            let shape = Shape {
                mode,
                model: Some("opus[1m]"),
                effort: Some(Effort::Xhigh),
                without: &[],
            };
            all.extend(claude_session(shape, &caps, &config()).expect("session"));
        }
        for arg in all {
            assert!(
                !arg.contains(['"', '%', '\n', '\r', '^', '&', '|', '<', '>']),
                "{arg}"
            );
        }
    }

    #[test]
    fn optional_flags_only_where_the_help_names_them() {
        let bare = ask(None, &Caps::default()).expect("args");
        assert!(!bare.contains(&"--safe-mode".to_owned()));

        let caps = Caps::from_help(CLAUDE_HELP);
        let full = ask(None, &caps).expect("args");
        assert!(full.contains(&"--safe-mode".to_owned()));
        assert!(full.contains(&"--no-session-persistence".to_owned()));
        assert_eq!(value_of(&full, "--permission-prompts"), Some("none"));
    }

    #[test]
    fn a_session_lists_only_nib_and_only_its_mode_s_tools() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let shape = |mode| Shape {
            mode: Some(mode),
            ..Shape::default()
        };

        let plan = claude_session(shape(Mode::Plan), &caps, &config()).expect("plan");
        assert_eq!(value_of(&plan, "--tools"), Some(""));
        assert_eq!(
            value_of(&plan, "--mcp-config"),
            Some(config().to_string_lossy().as_ref())
        );
        let allowed = value_of(&plan, "--allowedTools").expect("allowed");
        assert!(allowed.contains("mcp__orden__read_note"));
        assert!(allowed.contains("mcp__orden__create_note"));
        assert!(!allowed.contains("edit_note") && !allowed.contains("write_note"));
        assert!(allowed
            .split(',')
            .all(|one| one.starts_with("mcp__orden__")));
        let denied = value_of(&plan, "--disallowedTools").expect("denied");
        assert!(denied.contains("mcp__orden__edit_note"));
        assert!(denied.contains("mcp__orden__run_terminal"));
        assert!(!plan.contains(&"--safe-mode".to_owned()));
        assert!(plan.contains(&"--restricted".to_owned()));
        assert_eq!(value_of(&plan, "--permission-mode"), Some("dontAsk"));
        assert_eq!(value_of(&plan, "--input-format"), Some("stream-json"));

        for mode in [Mode::Approve, Mode::Auto, Mode::Full] {
            let all = claude_session(shape(mode), &caps, &config()).expect("all");
            assert_eq!(value_of(&all, "--allowedTools"), Some("mcp__orden"));
            assert!(!all.contains(&"--disallowedTools".to_owned()));
            assert_eq!(value_of(&all, "--permission-mode"), Some("dontAsk"));
            assert_eq!(value_of(&all, "--tools"), Some(""));
            assert!(all.contains(&"--strict-mcp-config".to_owned()));
            assert!(!all.iter().any(|one| one.contains("skip-permissions")));
            assert!(!all.iter().any(|one| one == "bypassPermissions"));
        }

        let words = claude_session(Shape::default(), &caps, &config()).expect("words");
        assert!(!words.contains(&"--mcp-config".to_owned()));
        assert!(!words.contains(&"--allowedTools".to_owned()));
    }

    #[test]
    fn a_thread_s_tools_left_out_are_never_shown() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let without = ["browser_navigate".to_owned(), "write_note".to_owned()];
        let auto = Shape {
            mode: Some(Mode::Auto),
            without: &without,
            ..Shape::default()
        };
        let args = claude_session(auto, &caps, &config()).expect("auto");
        let allowed = value_of(&args, "--allowedTools").expect("allowed");
        assert!(allowed.contains("mcp__orden__update_task"));
        assert!(!allowed.contains("browser_navigate") && !allowed.contains("write_note"));
        let denied = value_of(&args, "--disallowedTools").expect("denied");
        assert!(denied.contains("mcp__orden__browser_navigate"));
        assert!(denied.contains("mcp__orden__write_note"));

        let nib = PathBuf::from("nib");
        let folder = PathBuf::from("ai");
        let thread = codex_thread(Some(Mode::Auto), None, &without, &nib, &folder);
        let enabled = thread["config"]["mcp_servers.orden.enabled_tools"]
            .as_array()
            .expect("enabled")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        assert!(enabled.contains(&"update_task"));
        assert!(!enabled.contains(&"browser_navigate") && !enabled.contains(&"write_note"));

        let unknown = ["no_such_tool".to_owned()];
        assert_eq!(tools_of(Mode::Full, &unknown), tools_of(Mode::Full, &[]));
    }

    #[test]
    fn a_session_takes_its_model_and_effort_as_values() {
        let caps = Caps::from_help(CLAUDE_HELP);
        let shape = Shape {
            mode: Some(Mode::Plan),
            model: Some("sonnet[1m]"),
            effort: Some(Effort::Max),
            without: &[],
        };
        let args = claude_session(shape, &caps, &config()).expect("args");
        assert_eq!(value_of(&args, "--model"), Some("sonnet[1m]"));
        assert_eq!(value_of(&args, "--effort"), Some("max"));

        let off = Shape {
            effort: Some(Effort::Off),
            ..shape
        };
        assert!(claude_session(off, &caps, &config()).is_err());
        let older = Caps::from_help("--input-format");
        let args = claude_session(shape, &older, &config()).expect("args");
        assert!(!args.contains(&"--effort".to_owned()));
        assert!(claude_session(shape, &Caps::default(), &config()).is_err());
    }

    #[test]
    fn the_effort_scale_as_each_program_spells_it() {
        assert_eq!(Effort::Off.word(Tool::Codex), Ok("none"));
        assert_eq!(Effort::Xhigh.word(Tool::ClaudeCode), Ok("xhigh"));
        assert!(Effort::Minimal.word(Tool::ClaudeCode).is_err());
        let parsed: Effort = serde_json::from_str("\"xhigh\"").expect("effort");
        assert_eq!(parsed, Effort::Xhigh);
        assert!(serde_json::from_str::<Effort>("\"--max\"").is_err());
        assert!(serde_json::from_str::<Mode>("\"yolo\"").is_err());
    }

    #[test]
    fn codex_serves_read_only_asking_nobody_with_its_tools_off() {
        let args = codex_server();
        assert_eq!(args[0], "app-server");
        for setting in [
            "features.shell_tool=false",
            "mcp_servers={}",
            "sandbox_mode='read-only'",
            "approval_policy='never'",
            "project_doc_max_bytes=0",
        ] {
            assert!(args.contains(&setting.to_owned()), "{setting}");
        }
    }

    #[test]
    fn a_codex_thread_adds_nib_alone_with_its_mode_s_tools() {
        let nib = PathBuf::from("nib.exe");
        let folder = PathBuf::from("ai");
        let plan = codex_thread(Some(Mode::Plan), Some("gpt-5.1-codex"), &[], &nib, &folder);
        assert_eq!(plan["sandbox"], "read-only");
        assert_eq!(plan["approvalPolicy"], "never");
        assert_eq!(plan["ephemeral"], true);
        assert_eq!(plan["model"], "gpt-5.1-codex");
        let config = &plan["config"];
        assert_eq!(config["mcp_servers.orden.args"], json!(["mcp"]));
        assert_eq!(config["mcp_servers.orden.env_vars"], json!([TOKEN_VAR]));
        let enabled = config["mcp_servers.orden.enabled_tools"]
            .as_array()
            .expect("enabled");
        assert!(enabled.contains(&json!("read_note")));
        assert!(!enabled.contains(&json!("edit_note")));
        assert!(config
            .as_object()
            .expect("config")
            .keys()
            .all(|key| key.starts_with("mcp_servers.orden.")));

        let agent = codex_thread(Some(Mode::Full), None, &[], &nib, &folder);
        assert!(agent["config"]["mcp_servers.orden.enabled_tools"].is_null());
        let approve = codex_thread(Some(Mode::Approve), None, &[], &nib, &folder);
        assert!(approve["config"]["mcp_servers.orden.enabled_tools"].is_null());
        assert_eq!(approve["approvalPolicy"], "never");
        assert_eq!(agent["approvalPolicy"], "never");
        let auto = codex_thread(Some(Mode::Auto), None, &[], &nib, &folder);
        assert_eq!(auto["approvalPolicy"], "never");
        assert_eq!(auto["sandbox"], "read-only");
        assert!(auto["config"]["mcp_servers.orden.enabled_tools"].is_null());
        assert!(agent.get("model").is_none());
        let words = codex_thread(None, None, &[], &nib, &folder);
        assert_eq!(words["config"], json!({}));

        let mut helped = codex_thread(Some(Mode::Full), None, &[], &nib, &folder);
        with_thread(&mut helped, "nib-thread-1");
        assert_eq!(
            helped["config"]["mcp_servers.orden.env"],
            json!({ THREAD_VAR: "nib-thread-1" })
        );
    }

    #[test]
    fn the_mcp_config_names_orden_alone_and_no_token() {
        let config = mcp_config(Path::new("nib.exe"));
        let servers = config["mcpServers"].as_object().expect("servers");
        assert_eq!(servers.len(), 1);
        assert_eq!(servers["orden"]["args"], json!(["mcp"]));
        assert!(servers["orden"].get("env").is_none());
    }

    #[test]
    fn a_model_is_a_value_and_never_a_flag() {
        for good in [
            "opus",
            "claude-opus-4-5",
            "sonnet[1m]",
            "gpt-5.1-codex",
            "o3:high",
        ] {
            assert!(model_ok(good), "{good} was refused");
        }
        for bad in [
            "",
            "--dangerously-skip-permissions",
            "-p",
            "opus sonnet",
            "a\"b",
            "x%PATH%",
            &"m".repeat(101),
        ] {
            assert!(!model_ok(bad), "{bad:?} was taken");
            assert!(ask(Some(bad), &Caps::default()).is_err());
            let shape = Shape {
                model: Some(bad),
                ..Shape::default()
            };
            assert!(claude_session(shape, &Caps::from_help(CLAUDE_HELP), &config()).is_err());
        }
    }

    #[test]
    fn the_status_questions_are_the_programs_own() {
        assert_eq!(status(Tool::ClaudeCode), ["auth", "status", "--json"]);
        assert_eq!(status(Tool::Codex), ["login", "status"]);
        assert_eq!(status(Tool::Gemini), ["--version"]);
        assert!(logout(Tool::Gemini).is_empty());
    }

    #[test]
    fn gemini_has_no_effort_to_spell() {
        for effort in [Effort::Off, Effort::Low, Effort::Max] {
            assert!(effort.word(Tool::Gemini).is_err());
        }
    }

    #[test]
    fn a_gemini_turn_streams_with_orden_alone_and_resumes_its_session() {
        let caps = Caps::from_help("--output-format --skip-trust --resume --model");
        let args = gemini_turn(Some("flash"), Some("5a7c-91"), &caps).expect("args");
        let line = args.join(" ");
        assert!(line.contains("--output-format stream-json"), "{line}");
        assert!(line.contains("--allowed-mcp-server-names orden"), "{line}");
        assert!(line.contains("--model flash"), "{line}");
        assert!(line.contains("--resume 5a7c-91"), "{line}");
        assert!(line.contains("--skip-trust"), "{line}");
        assert!(!line.contains("yolo"), "{line}");

        let older = Caps::from_help("--output-format");
        let first = gemini_turn(None, None, &older).expect("args");
        assert!(!first
            .iter()
            .any(|one| one == "--skip-trust" || one == "--resume"));
        assert!(gemini_turn(None, None, &Caps::default()).is_err());
        assert!(gemini_turn(Some("--yolo"), None, &caps).is_err());
        assert!(gemini_turn(None, Some("--yolo"), &caps).is_err());
        assert!(gemini_turn(None, Some("a b"), &caps).is_err());
    }

    #[test]
    fn gemini_s_settings_lend_orden_by_name_with_its_mode_s_tools_and_no_token() {
        let nib = PathBuf::from("nib.exe");
        let plan = gemini_settings(Some(Mode::Plan), &[], &nib);
        let orden = &plan["mcpServers"]["orden"];
        assert_eq!(orden["args"], json!(["mcp"]));
        assert_eq!(orden["trust"], true);
        assert_eq!(orden["env"][TOKEN_VAR], "${NIB_MCP_TOKEN}");
        assert_eq!(orden["env"][THREAD_VAR], "${NIB_MCP_THREAD}");
        let included = orden["includeTools"].as_array().expect("included");
        assert!(included.contains(&json!("read_note")));
        assert!(!included.contains(&json!("edit_note")));
        assert_eq!(plan["mcpServers"].as_object().expect("servers").len(), 1);
        let excluded = plan["tools"]["exclude"].as_array().expect("excluded");
        assert!(excluded.contains(&json!("run_shell_command")));
        assert!(excluded.contains(&json!("write_file")));

        let full = gemini_settings(Some(Mode::Full), &[], &nib);
        assert!(full["mcpServers"]["orden"]["includeTools"].is_null());
        let words = gemini_settings(None, &[], &nib);
        assert!(words.get("mcpServers").is_none());
        assert!(!words.to_string().contains("nib.exe"));
    }
}
