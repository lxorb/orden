use orden_base::Held as _;
use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::mcp::host;
use orden_agents::approvals::{self, Asking};
use orden_agents::grants::{
    fresh_token, hashed, same, Grant, Mode as GrantMode, Scope, BUILT_IN, BUILT_IN_BEFORE, SIDEBAR,
};
use orden_agents::verbs::{Answer, Category, Code};
use orden_agents::{state, Caller};
use orden_mcp_client::{Offered, Permission, ToolInfo};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Approve,
    Auto,
    #[serde(alias = "agent")]
    Full,
    Plan,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub reader_tabs: bool,
}
fn yes() -> bool {
    true
}
fn grant_id(provider: &str) -> Result<String, String> {
    grant_id_from(BUILT_IN, provider)
}
fn grant_id_from(prefix: &str, provider: &str) -> Result<String, String> {
    let fits = !provider.is_empty()
        && provider.len() <= 48
        && provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if fits {
        Ok(format!("{prefix}{provider}"))
    } else {
        Err(format!("{provider} is not a provider"))
    }
}
fn made(id: String, client: &str, builtin: &Builtin) -> Grant {
    let mut grant = Grant::own(id, client);
    grant.built_in = true;
    if !builtin.reader_tabs {
        grant.scopes.retain(|one| *one != Scope::BrowserReader);
    }
    grant
}
impl Mode {
    fn word(self) -> &'static str {
        match self {
            Mode::Approve => "approve",
            Mode::Auto => "auto",
            Mode::Full => "full",
            Mode::Plan => "plan",
        }
    }
}
fn supervised(mut grant: Grant, mode: Mode) -> Grant {
    match mode {
        Mode::Approve => {
            grant.mode = GrantMode::Confirm;
            grant.asks.clear();
        }
        Mode::Full => grant = grant.with_full_permissions(),
        Mode::Auto | Mode::Plan => {}
    }
    grant.chat_mode = Some(mode.word().to_owned());
    grant
}
pub fn grant_for(app: &AppHandle, builtin: &Builtin) -> Result<Grant, String> {
    let id = grant_id(&builtin.id)?;
    let grants = &state(app).grants;
    for one in [id.clone(), grant_id_from(BUILT_IN_BEFORE, &builtin.id)?] {
        if let Some(found) = grants.by_id(app, &one).filter(|grant| grant.built_in) {
            return Ok(found);
        }
    }
    let client = format!("{SIDEBAR}{}", builtin.name.trim());
    let (grant, _token) =
        grants.mint(app, &client, |_, client| made(id.clone(), client, builtin))?;
    Ok(grant)
}
struct Lent {
    grant: String,
    mode: Mode,
    token: String,
    hash: String,
}
static LENT: Mutex<Vec<Lent>> = Mutex::new(Vec::new());
fn lent_now() -> std::sync::MutexGuard<'static, Vec<Lent>> {
    LENT.held()
}
pub fn lend(app: &AppHandle, builtin: &Builtin, mode: Mode) -> Result<String, String> {
    let grant = grant_for(app, builtin)?.id;
    let mut all = lent_now();
    if let Some(one) = all.iter().find(|one| one.grant == grant && one.mode == mode) {
        return Ok(one.token.clone());
    }
    let token = fresh_token()?;
    all.push(Lent { grant, mode, hash: hashed(&token), token: token.clone() });
    Ok(token)
}
pub fn lent(app: &AppHandle, token: &str) -> Option<Grant> {
    let said = hashed(token);
    let (grant, mode) = {
        let all = lent_now();
        let mut found = None;
        for one in all.iter() {
            if same(&said, &one.hash) && found.is_none() {
                found = Some((one.grant.clone(), one.mode));
            }
        }
        found?
    };
    state(app).grants.by_id(app, &grant).map(|grant| supervised(grant, mode))
}
pub fn in_mode(mode: Mode, name: &str, reads_only: bool) -> bool {
    match mode {
        Mode::Plan => reads_only || name == "create_note" || name == "run_agent",
        Mode::Approve | Mode::Auto | Mode::Full => true,
    }
}
fn window_verbs(app: &AppHandle) -> Option<BTreeSet<String>> {
    let said = orden_agents::endpoint::ask(app, "verbs", json!({}), Duration::from_secs(2)).ok()?;
    Some(
        said.get("verbs")?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    )
}
fn listed(grant: &Grant, window: Option<&BTreeSet<String>>, mode: Mode) -> Vec<Value> {
    host::listed(&supervised(grant.clone(), mode), window)
        .into_iter()
        .filter(|tool| in_mode(mode, &tool.name, host::reads_only(tool)))
        .map(host::shown)
        .collect()
}
pub(crate) const OUTSIDE: &str = "mcp__";
trait Outside {
    fn offered(&self) -> Vec<Offered>;
    fn find(&self, exposed: &str) -> Option<Offered>;
    fn call(&self, server: &str, tool: &str, args: Value) -> Result<Value, String>;
    fn ask(&self, asking: Asking<'_>) -> Option<Answer>;
}
struct Live<'a>(&'a AppHandle);
impl Outside for Live<'_> {
    fn offered(&self) -> Vec<Offered> {
        orden_mcp_client::offered(self.0)
    }
    fn find(&self, exposed: &str) -> Option<Offered> {
        orden_mcp_client::find(self.0, exposed)
    }
    fn call(&self, server: &str, tool: &str, args: Value) -> Result<Value, String> {
        orden_mcp_client::call(self.0, server, tool, args)
    }
    fn ask(&self, asking: Asking<'_>) -> Option<Answer> {
        approvals::unless_allowed(self.0, asking)
    }
}
fn outside_in_mode(mode: Mode, offered: &Offered) -> bool {
    !matches!(offered.tool.permission, Permission::Off)
        && (mode != Mode::Plan || offered.tool.read_only)
}
fn outside_asks(mode: Mode, tool: &ToolInfo) -> bool {
    match mode {
        Mode::Full => false,
        Mode::Approve => true,
        Mode::Auto | Mode::Plan => matches!(tool.permission, Permission::Ask),
    }
}
fn outside_shown(offered: &Offered) -> Value {
    let tool = &offered.tool;
    let about =
        [tool.description.trim(), tool.title.as_deref().unwrap_or_default(), tool.name.as_str()]
            .into_iter()
            .find(|one| !one.is_empty())
            .unwrap_or_default();
    json!({
        "name": offered.exposed,
        "description": format!("{}: {about}", offered.server_name),
        "inputSchema": tool.input_schema,
        "annotations": { "readOnlyHint": tool.read_only },
    })
}
fn outside_listed(outside: &impl Outside, mode: Mode) -> (Vec<Value>, BTreeSet<String>) {
    let mut servers = BTreeSet::new();
    let tools = outside
        .offered()
        .iter()
        .filter(|one| one.exposed.starts_with(OUTSIDE) && outside_in_mode(mode, one))
        .map(|one| {
            servers.insert(one.server_name.clone());
            outside_shown(one)
        })
        .collect();
    (tools, servers)
}
fn instructions_with(servers: &BTreeSet<String>) -> String {
    if servers.is_empty() {
        return host::instructions().to_owned();
    }
    let names: Vec<&str> = servers.iter().map(String::as_str).collect();
    format!(
        "{}\n\nTools named {OUTSIDE}<server>__<tool> are not Orden's: they come from outside MCP servers the reader added ({}), and each one's description starts with its server's name.",
        host::instructions(),
        names.join(", ")
    )
}
fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(fields) => {
            let mut all: Vec<(&String, &Value)> = fields.iter().collect();
            all.sort_by(|one, other| one.0.cmp(other.0));
            Value::Object(all.into_iter().map(|(key, one)| (key.clone(), sorted(one))).collect())
        }
        Value::Array(all) => Value::Array(all.iter().map(sorted).collect()),
        other => other.clone(),
    }
}
fn outside_key(exposed: &str, args: &Value) -> String {
    let said = hashed(&sorted(args).to_string());
    format!("{exposed}:{}", &said[..said.len().min(32)])
}
fn piece(words: &str) -> Value {
    json!({ "type": "text", "text": words })
}
fn part(one: &Value) -> Option<Value> {
    let words = |from: &Value, key: &str| {
        from.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
    };
    let mime = |from: &Value| Some(words(from, "mimeType")).filter(|one| !one.is_empty());
    Some(match words(one, "type").as_str() {
        "text" => piece(&words(one, "text")),
        "image" => json!({
            "type": "image",
            "data": words(one, "data"),
            "mimeType": mime(one).unwrap_or_else(|| "image/png".to_owned()),
        }),
        "audio" => piece(&format!(
            "An audio clip ({}) that cannot be shown here.",
            mime(one).unwrap_or_else(|| "audio".to_owned())
        )),
        "resource" => {
            let resource = one.get("resource").unwrap_or(&Value::Null);
            let uri = words(resource, "uri");
            match resource.get("text").and_then(Value::as_str) {
                Some(text) => piece(&format!("{uri}\n{text}")),
                None => piece(&format!(
                    "{uri} ({}, not text)",
                    mime(resource).unwrap_or_else(|| "a file".to_owned())
                )),
            }
        }
        "resource_link" => {
            let name = words(one, "name");
            let about = words(one, "description");
            let link =
                format!("{}: {}", if name.is_empty() { "Link" } else { &name }, words(one, "uri"));
            piece(&if about.is_empty() { link } else { format!("{link}\n{about}") })
        }
        _ => return None,
    })
}
fn outside_result(offered: &Offered, called: Result<Value, String>) -> Value {
    let said = match called {
        Ok(said) => said,
        Err(why) => {
            return json!({
                "content": [piece(&format!("{} did not answer: {why}", offered.server_name))],
                "isError": true,
            })
        }
    };
    let mut content: Vec<Value> = said
        .get("content")
        .and_then(Value::as_array)
        .map(|all| all.iter().filter_map(part).collect())
        .unwrap_or_default();
    if content.is_empty() {
        let structured = said.get("structuredContent").filter(|one| !one.is_null());
        content.push(piece(
            &structured
                .map_or_else(|| "The tool answered with nothing.".to_owned(), Value::to_string),
        ));
    }
    json!({ "content": content, "isError": said.get("isError") == Some(&Value::Bool(true)) })
}
fn first_words(rendered: &Value) -> String {
    rendered.pointer("/content/0/text").and_then(Value::as_str).unwrap_or_default().to_owned()
}
fn outside_call(
    outside: &impl Outside,
    grant: &Grant,
    mode: Mode,
    exposed: &str,
    args: Value,
) -> Result<(Value, Answer), String> {
    let offered = outside
        .find(exposed)
        .filter(|one| one.exposed == exposed && outside_in_mode(mode, one))
        .ok_or_else(|| format!("{exposed} is not a tool in this mode"))?;
    let refused = |answer: Answer| {
        let body = serde_json::to_string(&answer).unwrap_or_default();
        let mut rendered = host::rendered(exposed, &args, 200, &body);
        host::categorized(&mut rendered, |_| Some((Category::Tools, None)));
        (rendered, answer)
    };
    if orden_agents::stop::stopped_for(&grant.id) {
        return Ok(refused(Answer::error(
            Code::Stopped,
            "the reader pressed the stop: nothing runs until they resume",
        )));
    }
    if outside_asks(mode, &offered.tool) {
        let summary = format!("Use {} from {}", offered.tool.name, offered.server_name);
        let key = outside_key(exposed, &args);
        if let Some(answer) = outside.ask(Asking::of(grant, Category::Tools, summary, key)) {
            return Ok(refused(answer));
        }
    }
    let rendered =
        outside_result(&offered, outside.call(&offered.server, &offered.tool.name, args));
    let answer = if rendered["isError"] == true {
        Answer::error(Code::Failed, first_words(&rendered))
    } else {
        Answer::ok(json!({}))
    };
    Ok((rendered, answer))
}
#[tauri::command]
pub async fn ai_agent_tools(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
    mode: Mode,
) -> Result<Value, String> {
    orden_base::lane::off_the_runtime(move || -> Result<Value, String> {
        orden_base::labels::from_the_app(&webview)?;
        let grant = grant_for(&app, &agent)?;
        let window = window_verbs(&app);
        let mut tools = listed(&grant, window.as_ref(), mode);
        let (outside, servers) = outside_listed(&Live(&app), mode);
        tools.extend(outside);
        Ok(json!({
            "instructions": instructions_with(&servers),
            "tools": tools,
        }))
    })
    .await
}
fn asked_for(tool: &str, args: &Value, thread: Option<&str>) -> Value {
    let mut asked = json!({ "verb": tool, "args": args, "rest": [] });
    if let Some(thread) = thread {
        asked["thread"] = json!(thread);
    }
    asked
}
#[tauri::command]
pub async fn ai_agent_call(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
    mode: Mode,
    tool: String,
    args: Value,
    thread: Option<String>,
) -> Result<Value, String> {
    orden_base::lane::off_the_runtime(move || -> Result<Value, String> {
        orden_base::labels::from_the_app(&webview)?;
        let mut grant = grant_for(&app, &agent)?;
        if tool.starts_with(OUTSIDE) {
            grant.thread = thread.filter(|one| orden_agents::is_thread(one));
            let started = Instant::now();
            let args = if args.is_object() { args } else { json!({}) };
            let (rendered, answered) =
                outside_call(&Live(&app), &grant, mode, &tool, args.clone())?;
            let caller = Caller::Agent(Box::new(supervised(grant, mode)));
            orden_agents::logged(&app, &caller, "", &tool, None, args, &answered, started);
            return Ok(rendered);
        }
        let window = window_verbs(&app);
        let shown = listed(&grant, window.as_ref(), mode);
        if !shown.iter().any(|one| one["name"] == tool.as_str()) {
            return Err(format!("{tool} is not a tool in this mode"));
        }
        let args = host::with_defaults(&tool, if args.is_object() { args } else { json!({}) });
        let asked = asked_for(&tool, &args, thread.as_deref());
        let caller = Caller::Agent(Box::new(supervised(grant, mode)));
        let (status, body) = orden_agents::endpoint::dispatch(&app, &caller, asked, false);
        let mut rendered = host::rendered(&tool, &args, status, &body);
        host::categorized(&mut rendered, orden_agents::question_category);
        Ok(rendered)
    })
    .await
}
const CONTEXT: &str = "get_context";
#[tauri::command]
pub async fn ai_agent_context(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
    thread: Option<String>,
) -> Result<Vec<Value>, String> {
    orden_base::lane::off_the_runtime(move || -> Result<Vec<Value>, String> {
        orden_base::labels::from_the_app(&webview)?;
        let grant = grant_for(&app, &agent)?;
        let window = window_verbs(&app);
        let reached: BTreeSet<String> = host::listed(&grant, window.as_ref())
            .into_iter()
            .map(|tool| tool.name.clone())
            .collect();
        let caller = Caller::Agent(Box::new(grant));
        Ok(Some(CONTEXT)
            .filter(|verb| reached.contains(*verb))
            .map(|verb| {
                let args = json!({});
                let asked = asked_for(verb, &args, thread.as_deref());
                let (status, body) = orden_agents::endpoint::dispatch(&app, &caller, asked, false);
                host::rendered(verb, &args, status, &body)
            })
            .into_iter()
            .collect())
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const ASKED: [Category; 14] = [
        Category::Paying,
        Category::Sending,
        Category::Publishing,
        Category::Deleting,
        Category::SigningIn,
        Category::Settings,
        Category::Terminal,
        Category::Files,
        Category::Writing,
        Category::Trashing,
        Category::Unread,
        Category::Showing,
        Category::Takeover,
        Category::Tools,
    ];
    #[test]
    fn a_call_says_the_thread_it_runs_for() {
        let args = json!({ "path": "a.md" });
        assert_eq!(asked_for("edit_note", &args, Some("thread-1"))["thread"], "thread-1");
        assert!(asked_for("edit_note", &args, None).get("thread").is_none());
    }
    fn builtin(reader_tabs: bool) -> Builtin {
        Builtin { id: "anthropic".into(), name: "Claude".into(), reader_tabs }
    }
    fn grant() -> Grant {
        made("orden-anthropic".into(), "Orden Claude", &builtin(true))
    }
    fn names(mode: Mode, grant: &Grant) -> BTreeSet<String> {
        let window: BTreeSet<String> = [
            "read_note",
            "search_notes",
            "edit_note",
            "create_note",
            "write_note",
            "get_context",
            "move_file",
            "trash_file",
            "create_folder",
            "edit_canvas",
            "workspace_tabs",
            "read_terminal",
            "type_terminal",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        listed(grant, Some(&window), mode)
            .iter()
            .filter_map(|one| one["name"].as_str().map(str::to_owned))
            .collect()
    }
    #[test]
    fn plan_adds_the_plans_own_note_and_nothing_else_that_writes() {
        let plan = names(Mode::Plan, &grant());
        assert!(plan.contains("create_note") && plan.contains("read_note"));
        assert!(plan.contains("browser_snapshot") && plan.contains("read_terminal"));
        assert!(!plan.contains("edit_note") && !plan.contains("write_note"));
        assert!(!plan.contains("browser_click") && !plan.contains("type_terminal"));
    }
    #[test]
    fn the_permission_modes_list_everything_the_grant_reaches_and_no_more() {
        let grant = grant();
        let agent = names(Mode::Auto, &grant);
        assert_eq!(names(Mode::Approve, &grant), agent);
        assert!(agent.contains("edit_note") && agent.contains("browser_click"));
        assert!(!agent.contains("browser_evaluate") && agent.contains("type_terminal"));
        assert!(names(Mode::Plan, &grant).is_subset(&agent));
        let full = names(Mode::Full, &grant);
        assert!(agent.is_subset(&full) && full.contains("browser_evaluate"));
        for verb in [
            "create_note",
            "create_folder",
            "edit_canvas",
            "move_file",
            "trash_file",
            "workspace_tabs",
            "get_context",
        ] {
            assert!(agent.contains(verb), "{verb}");
        }
    }
    #[test]
    fn full_permissions_never_ask_anything() {
        let mut stored = grant();
        stored.mode = GrantMode::Confirm;
        let agent = supervised(stored, Mode::Full);
        assert_eq!(agent.mode, GrantMode::Autonomous);
        assert!(agent.asks_nothing());
        for category in ASKED {
            assert!(!agent.asks(category), "{category:?}");
        }
        for scope in Scope::ALL {
            assert!(agent.holds(scope), "{scope:?}");
            assert!(agent.scopes.contains(&scope), "{scope:?} is held and not told");
        }
    }
    #[test]
    fn approve_asks_before_every_change_whatever_was_switched_off() {
        let mut stored = grant();
        stored.asks.insert(Category::Deleting, false);
        stored.asks.insert(Category::Terminal, false);
        let approve = supervised(stored, Mode::Approve);
        assert_eq!(approve.mode, GrantMode::Confirm);
        for category in ASKED {
            assert!(approve.asks(category), "{category:?}");
        }
    }
    #[test]
    fn auto_asks_where_the_readers_access_says_and_nowhere_else() {
        let mut stored = grant();
        stored.asks.insert(Category::Deleting, false);
        let auto = supervised(stored.clone(), Mode::Auto);
        assert_eq!(Grant { chat_mode: None, ..auto.clone() }, stored);
        assert_eq!(auto.mode, GrantMode::Unsupervised);
        for category in ASKED {
            assert_eq!(auto.asks(category), category != Category::Deleting, "{category:?}");
        }
    }
    #[test]
    fn the_three_permission_modes_ask_less_and_less() {
        let stored = grant();
        let count = |mode| {
            let laid = supervised(stored.clone(), mode);
            ASKED.iter().filter(|one| laid.asks(**one)).count()
        };
        let mut off = stored.clone();
        off.asks.insert(Category::Sending, false);
        assert!(supervised(off, Mode::Approve).asks(Category::Sending));
        assert!(count(Mode::Approve) >= count(Mode::Auto));
        assert!(count(Mode::Auto) > count(Mode::Full));
        assert_eq!(count(Mode::Full), 0);
        assert_eq!(supervised(stored.clone(), Mode::Approve).mode, GrantMode::Confirm);
    }
    #[test]
    fn a_mode_is_laid_over_a_call_as_the_grant_says() {
        let stored = grant();
        let plan = supervised(stored.clone(), Mode::Plan);
        assert_eq!(plan.chat_mode.as_deref(), Some("plan"));
        assert_eq!(Grant { chat_mode: None, ..plan }, stored);
        let laid = grant();
        assert_eq!(laid.mode, GrantMode::Unsupervised);
        assert!(laid.asks.is_empty());
        assert_eq!(CONTEXT, "get_context");
        assert!(made("orden-a".into(), "Orden A", &builtin(true)).holds(Scope::BrowserReader));
        assert!(!made("orden-a".into(), "Orden A", &builtin(false)).holds(Scope::BrowserReader));
    }
    #[test]
    fn a_lent_caller_tells_the_window_the_mode_of_its_chat() {
        for (mode, word) in [
            (Mode::Approve, "approve"),
            (Mode::Auto, "auto"),
            (Mode::Full, "full"),
            (Mode::Plan, "plan"),
        ] {
            let told = Caller::Agent(Box::new(supervised(grant(), mode))).told().expect("told");
            assert_eq!(told["chat_mode"], word, "{mode:?}");
            let read: Mode = serde_json::from_value(told["chat_mode"].clone()).expect("a mode");
            assert_eq!(read, mode);
            let threaded = Caller::Agent(Box::new(supervised(grant(), mode)))
                .in_thread(Some("thread-1".into()))
                .told()
                .expect("told");
            assert_eq!(threaded["chat_mode"], word, "{mode:?}");
        }
        let plain = Caller::Agent(Box::new(grant())).told().expect("told");
        assert!(plain.get("chat_mode").is_none());
    }
    #[test]
    fn a_provider_id_that_is_not_one_makes_no_grant() {
        assert_eq!(grant_id("anthropic").as_deref(), Ok("orden-anthropic"));
        assert_eq!(grant_id("compatible-2").as_deref(), Ok("orden-compatible-2"));
        assert_eq!(grant_id_from(BUILT_IN_BEFORE, "anthropic").as_deref(), Ok("nib-anthropic"));
        for bad in ["", "a b", "../x", &"x".repeat(49)] {
            assert!(grant_id(bad).is_err(), "{bad:?}");
        }
    }
    #[test]
    fn modes_read_as_the_window_names_them() {
        let read: Vec<Mode> =
            serde_json::from_str(r#"["approve","auto","full","plan","agent"]"#).expect("modes");
        assert_eq!(read, [Mode::Approve, Mode::Auto, Mode::Full, Mode::Plan, Mode::Full]);
        assert!(serde_json::from_str::<Mode>(r#""ask""#).is_err());
    }
    struct Fake {
        tools: Vec<(&'static str, bool, Permission)>,
        answer: Result<Value, String>,
        calls: RefCell<Vec<(String, String, Value)>>,
    }
    fn fake(tools: Vec<(&'static str, bool, Permission)>) -> Fake {
        Fake {
            tools,
            answer: Ok(json!({ "content": [{ "type": "text", "text": "done" }] })),
            calls: RefCell::new(Vec::new()),
        }
    }
    fn exposed(name: &str) -> String {
        format!("{OUTSIDE}fake__{}", name.replace('.', "_"))
    }
    fn offer(name: &str, read_only: bool, permission: Permission) -> Offered {
        Offered {
            server: "fake".into(),
            server_name: "Fake".into(),
            tool: ToolInfo {
                name: name.into(),
                title: None,
                description: format!("Does {name}"),
                input_schema: json!({ "type": "object" }),
                read_only,
                permission,
            },
            exposed: exposed(name),
        }
    }
    impl Outside for Fake {
        fn offered(&self) -> Vec<Offered> {
            self.tools
                .iter()
                .map(|(name, read_only, permission)| offer(name, *read_only, *permission))
                .collect()
        }
        fn find(&self, exposed: &str) -> Option<Offered> {
            self.offered().into_iter().find(|one| one.exposed == exposed)
        }
        fn call(&self, server: &str, tool: &str, args: Value) -> Result<Value, String> {
            self.calls.borrow_mut().push((server.into(), tool.into(), args));
            self.answer.clone()
        }
        fn ask(&self, asking: Asking<'_>) -> Option<Answer> {
            approvals::unless_allowed_telling(asking, |_| {})
        }
    }
    fn agent(id: &str) -> Grant {
        made(format!("orden-{id}"), "Orden Test", &builtin(true))
    }
    fn status(rendered: &Value) -> &str {
        rendered["_meta"][META]["status"].as_str().unwrap_or("ran")
    }
    const META: &str = "so.orden.Orden/answer";
    const MODES: [Mode; 4] = [Mode::Approve, Mode::Auto, Mode::Full, Mode::Plan];
    #[test]
    fn each_mode_lists_and_asks_for_outside_tools_as_their_permission_says() {
        let every = || {
            vec![
                ("look", true, Permission::Allow),
                ("peek", true, Permission::Ask),
                ("make", false, Permission::Allow),
                ("shout", false, Permission::Ask),
                ("never", true, Permission::Off),
            ]
        };
        for mode in MODES {
            let outside = fake(every());
            let (tools, _) = outside_listed(&outside, mode);
            let names: BTreeSet<String> =
                tools.iter().filter_map(|one| one["name"].as_str().map(str::to_owned)).collect();
            for (name, read_only, permission) in every() {
                let listed =
                    !matches!(permission, Permission::Off) && (mode != Mode::Plan || read_only);
                assert_eq!(names.contains(&exposed(name)), listed, "{mode:?} {name}");
                let grant = agent(&format!("table-{mode:?}-{name}"));
                let called =
                    outside_call(&outside, &grant, mode, &exposed(name), json!({ "n": 1 }));
                if !listed {
                    assert!(called.is_err(), "{mode:?} {name}");
                    continue;
                }
                let (rendered, answer) = called.expect("listed tools run");
                let asks = match mode {
                    Mode::Full => false,
                    Mode::Approve => true,
                    Mode::Auto | Mode::Plan => matches!(permission, Permission::Ask),
                };
                assert_eq!(status(&rendered) == "needs_approval", asks, "{mode:?} {name}");
                assert_eq!(matches!(answer, Answer::NeedsApproval { .. }), asks, "{mode:?} {name}");
                if asks {
                    assert_eq!(rendered["_meta"][META]["category"], "tools");
                }
            }
            let ran: Vec<String> = outside.calls.borrow().iter().map(|one| one.1.clone()).collect();
            let expected: Vec<&str> = match mode {
                Mode::Full => vec!["look", "peek", "make", "shout"],
                Mode::Approve => vec![],
                Mode::Auto => vec!["look", "make"],
                Mode::Plan => vec!["look"],
            };
            assert_eq!(ran, expected, "{mode:?}");
        }
    }
    #[test]
    fn an_allowed_call_runs_once_and_other_args_are_asked_again() {
        let outside = fake(vec![("shout", false, Permission::Ask)]);
        let grant = agent("allowing-outside");
        let call = |args: Value| {
            outside_call(&outside, &grant, Mode::Auto, &exposed("shout"), args).expect("a tool")
        };
        let (asked, _) = call(json!({ "a": 1, "b": [1, 2] }));
        let approval = asked["_meta"][META]["approval"].as_str().expect("approval").to_owned();
        assert!(approvals::any(&approval).is_some_and(|one| one.category == Category::Tools
            && one.summary == "Use shout from Fake"
            && one.verb == exposed("shout")));
        approvals::answer_telling(&approval, true, |_| {}).expect("answered");
        let (ran, answer) = call(json!({ "b": [1, 2], "a": 1 }));
        assert_eq!(status(&ran), "ran");
        assert!(matches!(answer, Answer::Ok { .. }));
        assert_eq!(outside.calls.borrow().len(), 1);
        assert_eq!(status(&call(json!({ "a": 1, "b": [1, 2] })).0), "needs_approval");
        assert_eq!(status(&call(json!({ "a": 2, "b": [1, 2] })).0), "needs_approval");
        assert_eq!(outside.calls.borrow().len(), 1);
        approvals::answer_telling(&approval, false, |_| {}).expect("answered");
        assert_ne!(
            outside_key("mcp__a__b", &json!({ "a": 1 })),
            outside_key("mcp__a__b", &json!({ "a": 2 }))
        );
        assert_ne!(
            outside_key("mcp__a__b", &json!({ "a": 1 })),
            outside_key("mcp__a__c", &json!({ "a": 1 }))
        );
        assert_eq!(
            outside_key("mcp__a__b", &json!({ "x": { "q": 1, "p": 2 } })),
            outside_key("mcp__a__b", &json!({ "x": { "p": 2, "q": 1 } }))
        );
    }
    #[test]
    fn one_threads_answer_is_not_another_threads() {
        let outside = fake(vec![("shout", false, Permission::Ask)]);
        let mut one = agent("threads-outside");
        one.thread = Some("thread-a".into());
        let mut other = one.clone();
        other.thread = Some("thread-b".into());
        let call = |grant: &Grant| {
            outside_call(&outside, grant, Mode::Auto, &exposed("shout"), json!({})).expect("a tool")
        };
        let (asked, _) = call(&one);
        let approval = asked["_meta"][META]["approval"].as_str().expect("approval").to_owned();
        assert!(
            approvals::any(&approval).is_some_and(|one| one.thread.as_deref() == Some("thread-a"))
        );
        approvals::answer_telling(&approval, true, |_| {}).expect("answered");
        let (elsewhere, _) = call(&other);
        assert_eq!(status(&elsewhere), "needs_approval");
        assert_ne!(elsewhere["_meta"][META]["approval"], approval.as_str());
        assert!(outside.calls.borrow().is_empty());
        assert_eq!(status(&call(&one).0), "ran");
    }
    #[test]
    fn a_denied_call_reaches_no_server() {
        let outside = fake(vec![("shout", false, Permission::Ask)]);
        let grant = agent("denying-outside");
        let (asked, _) =
            outside_call(&outside, &grant, Mode::Approve, &exposed("shout"), json!({}))
                .expect("a tool");
        let approval = asked["_meta"][META]["approval"].as_str().expect("approval").to_owned();
        approvals::answer_telling(&approval, false, |_| {}).expect("answered");
        let (denied, answer) =
            outside_call(&outside, &grant, Mode::Approve, &exposed("shout"), json!({}))
                .expect("a tool");
        assert_eq!(denied["isError"], true);
        assert!(matches!(answer, Answer::Error { code: Code::Denied, .. }));
        assert!(outside.calls.borrow().is_empty());
    }
    #[test]
    fn an_exposed_name_calls_its_server_by_the_tools_own_name() {
        let outside = fake(vec![("read.file", true, Permission::Allow)]);
        let grant = agent("finding-outside");
        let name = exposed("read.file");
        assert_eq!(name, "mcp__fake__read_file");
        outside_call(&outside, &grant, Mode::Auto, &name, json!({ "path": "a" })).expect("a tool");
        assert_eq!(
            outside.calls.borrow()[0],
            ("fake".to_owned(), "read.file".to_owned(), json!({ "path": "a" }))
        );
        assert!(
            outside_call(&outside, &grant, Mode::Auto, "mcp__fake__read_files", json!({})).is_err()
        );
        assert!(
            outside_call(&outside, &grant, Mode::Auto, "mcp__other__read_file", json!({})).is_err()
        );
        let (tools, servers) = outside_listed(&outside, Mode::Auto);
        assert_eq!(
            tools,
            [json!({
                "name": "mcp__fake__read_file",
                "description": "Fake: Does read.file",
                "inputSchema": { "type": "object" },
                "annotations": { "readOnlyHint": true },
            })]
        );
        assert!(instructions_with(&servers).starts_with(host::instructions()));
        assert!(instructions_with(&servers).contains("(Fake)"));
        assert_eq!(instructions_with(&BTreeSet::new()), host::instructions());
    }
    #[test]
    fn a_servers_answer_becomes_text_and_images_for_the_chat() {
        let said = |answer: Result<Value, String>| {
            outside_result(&offer("echo", true, Permission::Allow), answer)
        };
        let all = said(Ok(json!({
            "content": [
                { "type": "text", "text": "hello" },
                { "type": "image", "data": "AAAA", "mimeType": "image/jpeg" },
                { "type": "resource", "resource": { "uri": "file:///a.md", "mimeType": "text/markdown", "text": "# A" } },
                { "type": "resource", "resource": { "uri": "file:///b.bin", "mimeType": "application/zip", "blob": "AAAA" } },
                { "type": "resource_link", "uri": "file:///c.md", "name": "c.md", "description": "The c note" },
                { "type": "audio", "data": "AAAA", "mimeType": "audio/wav" },
                { "type": "unknown" },
            ],
        })));
        assert_eq!(all["isError"], false);
        assert_eq!(
            all["content"],
            json!([
                { "type": "text", "text": "hello" },
                { "type": "image", "data": "AAAA", "mimeType": "image/jpeg" },
                { "type": "text", "text": "file:///a.md\n# A" },
                { "type": "text", "text": "file:///b.bin (application/zip, not text)" },
                { "type": "text", "text": "c.md: file:///c.md\nThe c note" },
                { "type": "text", "text": "An audio clip (audio/wav) that cannot be shown here." },
            ])
        );
        let failed = said(Ok(
            json!({ "content": [{ "type": "text", "text": "no such file" }], "isError": true }),
        ));
        assert_eq!(failed["isError"], true);
        assert_eq!(first_words(&failed), "no such file");
        let gone = said(Err("timed out after 120 s".into()));
        assert_eq!(gone["isError"], true);
        assert_eq!(first_words(&gone), "Fake did not answer: timed out after 120 s");
        assert_eq!(
            first_words(&said(Ok(json!({ "content": [], "structuredContent": { "sum": 3 } })))),
            r#"{"sum":3}"#
        );
        assert_eq!(said(Ok(json!({})))["content"].as_array().map(Vec::len), Some(1));
        let mut outside = fake(vec![("echo", true, Permission::Allow)]);
        outside.answer =
            Ok(json!({ "content": [{ "type": "text", "text": "bad" }], "isError": true }));
        let (_, answer) = outside_call(
            &outside,
            &agent("failing-outside"),
            Mode::Full,
            &exposed("echo"),
            json!({}),
        )
        .expect("a tool");
        assert!(
            matches!(answer, Answer::Error { code: Code::Failed, ref message, .. } if message == "bad")
        );
    }
}
