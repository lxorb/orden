use std::collections::BTreeSet;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::agents::grants::{
    fresh_token, hashed, same, Grant, Mode as GrantMode, Scope, BUILT_IN, BUILT_IN_BEFORE, SIDEBAR,
};
use crate::agents::{state, Caller};
use crate::mcp::host;

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

fn supervised(mut grant: Grant, mode: Mode) -> Grant {
    match mode {
        Mode::Approve => {
            grant.mode = GrantMode::Confirm;
            grant.asks.clear();
        }
        Mode::Full => {
            grant.mode = GrantMode::Autonomous;
            grant.scopes = Scope::ALL.into_iter().collect();
        }
        Mode::Auto | Mode::Plan => {}
    }
    grant
}

pub(crate) fn grant_for(app: &AppHandle, builtin: &Builtin) -> Result<Grant, String> {
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
    LENT.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn lend(app: &AppHandle, builtin: &Builtin, mode: Mode) -> Result<String, String> {
    let grant = grant_for(app, builtin)?.id;
    let mut all = lent_now();
    if let Some(one) = all
        .iter()
        .find(|one| one.grant == grant && one.mode == mode)
    {
        return Ok(one.token.clone());
    }
    let token = fresh_token()?;
    all.push(Lent {
        grant,
        mode,
        hash: hashed(&token),
        token: token.clone(),
    });
    Ok(token)
}

pub(crate) fn lent(app: &AppHandle, token: &str) -> Option<Grant> {
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
    state(app)
        .grants
        .by_id(app, &grant)
        .map(|grant| supervised(grant, mode))
}

pub(crate) fn in_mode(mode: Mode, name: &str, reads_only: bool) -> bool {
    match mode {
        Mode::Plan => reads_only || name == "create_note" || name == "run_agent",
        Mode::Approve | Mode::Auto | Mode::Full => true,
    }
}

fn window_verbs(app: &AppHandle) -> Option<BTreeSet<String>> {
    let said = crate::endpoint::ask(app, "verbs", json!({}), Duration::from_secs(2)).ok()?;
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

#[tauri::command]
pub async fn ai_agent_tools(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Builtin,
    mode: Mode,
) -> Result<Value, String> {
    crate::lane::off_the_runtime(move || -> Result<Value, String> {
        crate::agents::from_the_app(&webview)?;
        let grant = grant_for(&app, &agent)?;
        let window = window_verbs(&app);
        Ok(json!({
            "instructions": host::instructions(),
            "tools": listed(&grant, window.as_ref(), mode),
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
    crate::lane::off_the_runtime(move || -> Result<Value, String> {
        crate::agents::from_the_app(&webview)?;
        let grant = grant_for(&app, &agent)?;
        let window = window_verbs(&app);
        let shown = listed(&grant, window.as_ref(), mode);
        if !shown.iter().any(|one| one["name"] == tool.as_str()) {
            return Err(format!("{tool} is not a tool in this mode"));
        }
        let args = host::with_defaults(&tool, if args.is_object() { args } else { json!({}) });
        let asked = asked_for(&tool, &args, thread.as_deref());
        let caller = Caller::Agent(Box::new(supervised(grant, mode)));
        let (status, body) = crate::endpoint::dispatch(&app, &caller, asked, false);
        let mut rendered = host::rendered(&tool, &args, status, &body);
        host::categorized(&mut rendered, crate::agents::question_category);
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
    crate::lane::off_the_runtime(move || -> Result<Vec<Value>, String> {
        crate::agents::from_the_app(&webview)?;
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
                let (status, body) = crate::endpoint::dispatch(&app, &caller, asked, false);
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
    use crate::agents::verbs::Category;

    const ASKED: [Category; 13] = [
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
    ];

    #[test]
    fn a_call_says_the_thread_it_runs_for() {
        let args = json!({ "path": "a.md" });
        assert_eq!(
            asked_for("edit_note", &args, Some("thread-1"))["thread"],
            "thread-1"
        );
        assert!(asked_for("edit_note", &args, None).get("thread").is_none());
    }

    fn builtin(reader_tabs: bool) -> Builtin {
        Builtin {
            id: "anthropic".into(),
            name: "Claude".into(),
            reader_tabs,
        }
    }

    fn grant() -> Grant {
        made("orden-anthropic".into(), "Orden · Claude", &builtin(true))
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
        assert_eq!(auto, stored);
        assert_eq!(auto.mode, GrantMode::Unsupervised);
        for category in ASKED {
            assert_eq!(
                auto.asks(category),
                category != Category::Deleting,
                "{category:?}"
            );
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
        assert_eq!(
            supervised(stored.clone(), Mode::Approve).mode,
            GrantMode::Confirm
        );
    }

    #[test]
    fn plan_is_supervised_as_the_grant_says() {
        let stored = grant();
        assert_eq!(supervised(stored.clone(), Mode::Plan), stored);
    }

    #[test]
    fn a_mode_is_laid_over_a_call_never_over_the_grant() {
        let made = grant();
        assert_eq!(made.mode, GrantMode::Unsupervised);
        assert!(made.asks.is_empty());
    }

    #[test]
    fn every_turn_asks_where_the_reader_is_once() {
        assert_eq!(CONTEXT, "get_context");
    }

    #[test]
    fn the_readers_tabs_are_in_reach_or_not() {
        assert!(made("orden-a".into(), "Orden · A", &builtin(true)).holds(Scope::BrowserReader));
        assert!(!made("orden-a".into(), "Orden · A", &builtin(false)).holds(Scope::BrowserReader));
    }

    #[test]
    fn a_provider_id_that_is_not_one_makes_no_grant() {
        assert_eq!(grant_id("anthropic").as_deref(), Ok("orden-anthropic"));
        assert_eq!(
            grant_id("compatible-2").as_deref(),
            Ok("orden-compatible-2")
        );
        assert_eq!(
            grant_id_from(BUILT_IN_BEFORE, "anthropic").as_deref(),
            Ok("nib-anthropic")
        );
        for bad in ["", "a b", "../x", &"x".repeat(49)] {
            assert!(grant_id(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn modes_read_as_the_window_names_them() {
        let read: Vec<Mode> =
            serde_json::from_str(r#"["approve","auto","full","plan","agent"]"#).expect("modes");
        assert_eq!(
            read,
            [
                Mode::Approve,
                Mode::Auto,
                Mode::Full,
                Mode::Plan,
                Mode::Full
            ]
        );
        assert!(serde_json::from_str::<Mode>(r#""ask""#).is_err());
    }
}
