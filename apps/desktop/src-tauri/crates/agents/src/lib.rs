#![cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod approvals;
pub mod commands;
pub mod endpoint;
pub mod family;
pub mod files;
pub mod grants;
pub mod http;
pub mod keys;
pub mod limits;
pub mod log;
pub mod policy;
pub mod process;
pub mod shell;
pub mod stop;
pub mod system;
pub mod verbs;
pub mod working;

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::AppHandle;

use grants::{Grant, Grants, Scope};
use verbs::{Answer, Category, Code, Paired, Verb};

pub struct Host {
    pub answer: fn(&AppHandle, &Caller, &str, Verb, Value) -> Answer,
    pub lent: fn(&AppHandle, &str) -> Option<Grant>,
    pub close_tabs: fn(&AppHandle),
    pub page_up: fn(&AppHandle, &str) -> bool,
    pub hold_stop: fn(&AppHandle, Option<String>) -> Option<String>,
    pub quit: fn(&AppHandle),
}
static HOST: OnceLock<Host> = OnceLock::new();
pub fn hand(host: Host) {
    let _ = HOST.set(host);
}
pub fn host() -> Option<&'static Host> {
    HOST.get()
}
pub fn answer(app: &AppHandle, caller: &Caller, session: &str, verb: Verb, args: Value) -> Answer {
    match host() {
        Some(host) => (host.answer)(app, caller, session, verb, args),
        None => Answer::error(Code::Failed, "the app is still starting"),
    }
}
#[derive(Default)]
pub struct Agents {
    pub grants: Grants,
}
pub static AGENTS: OnceLock<Agents> = OnceLock::new();
pub fn state(_app: &AppHandle) -> &'static Agents {
    AGENTS.get_or_init(Agents::default)
}
#[derive(Clone, Debug)]
pub enum Caller {
    Reader,
    Agent(Box<Grant>),
}
impl Caller {
    pub fn id(&self) -> &str {
        match self {
            Caller::Reader => "cli",
            Caller::Agent(grant) => &grant.id,
        }
    }
    pub fn holds(&self, scope: Scope) -> bool {
        match self {
            Caller::Reader => true,
            Caller::Agent(grant) => grant.holds(scope),
        }
    }
    pub fn told(&self) -> Option<Value> {
        match self {
            Caller::Reader => None,
            Caller::Agent(grant) => serde_json::to_value(grant).ok(),
        }
    }
    #[must_use]
    pub fn in_thread(self, thread: Option<String>) -> Self {
        match self {
            Caller::Agent(mut grant) => {
                grant.thread = thread;
                Caller::Agent(grant)
            }
            Caller::Reader => Caller::Reader,
        }
    }
    pub fn limits(&self) -> grants::Limits {
        match self {
            Caller::Reader => grants::Limits::default(),
            Caller::Agent(grant) => grant.limits,
        }
    }
}
pub fn caller_for(app: &AppHandle, token: &str) -> Option<Caller> {
    if let Some(grant) = state(app).grants.by_token(app, token) {
        return Some(Caller::Agent(Box::new(connected(grant))));
    }
    (host()?.lent)(app, token).map(|grant| Caller::Agent(Box::new(grant)))
}
fn connected(grant: Grant) -> Grant {
    grant.with_full_permissions()
}
pub fn session_of(asked: &Value) -> String {
    asked
        .get("session")
        .and_then(Value::as_str)
        .filter(|one| {
            one.len() <= 64 && one.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .unwrap_or_default()
        .to_owned()
}
pub fn is_thread(thread: &str) -> bool {
    !thread.is_empty()
        && thread.len() <= 80
        && thread.bytes().all(|one| one.is_ascii_alphanumeric() || one == b'-' || one == b'_')
}
pub fn thread_of(asked: &Value) -> Option<String> {
    asked.get("thread").and_then(Value::as_str).filter(|one| is_thread(one)).map(str::to_owned)
}
#[allow(clippy::too_many_arguments)]
pub fn logged(
    app: &AppHandle,
    caller: &Caller,
    session: &str,
    verb: &str,
    tab: Option<&str>,
    args: Value,
    answered: &Answer,
    started: Instant,
) {
    if let Caller::Agent(grant) = caller {
        if verb != "agent_bye" {
            shell::heard(app, &grant.id, session);
        }
    }
    let code = match answered {
        Answer::Error { code, .. } => serde_json::to_value(code).ok(),
        _ => None,
    };
    log::write(
        app,
        log::Line {
            at: orden_base::clock::now(),
            agent: caller.id(),
            verb,
            tab,
            args,
            status: answered.status(),
            code,
            ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        },
    );
}
pub fn said_waiting(app: &AppHandle, caller: &Caller, session: &str, what: &str) {
    logged(
        app,
        caller,
        session,
        "limit",
        None,
        serde_json::json!({ "waiting": what }),
        &Answer::ok(verbs::Nothing {}),
        Instant::now(),
    );
}
const LONGEST_PAIRING_WAIT: Duration = Duration::from_secs(300);
pub fn pair_client(app: &AppHandle, caller: &Caller, pair: &verbs::Pair) -> Answer {
    if !matches!(caller, Caller::Reader) {
        return Answer::error(
            Code::NotGranted,
            "only a client holding the installation's secret pairs: an agent is paired already",
        );
    }
    let client = orden_base::letters::plain_name(&pair.client);
    if client.is_empty() || client.chars().count() > 60 {
        return Answer::error(Code::BadArguments, "a client's name is 1 to 60 characters");
    }
    let key = approvals::key("agent_pair", None, Some(&client));
    let wait = Duration::from_millis(pair.wait_ms.unwrap_or(0)).min(LONGEST_PAIRING_WAIT);
    let started = Instant::now();
    loop {
        if approvals::allowed(PAIRING, None, &key) {
            return match state(app).grants.mint(app, &client, Grant::own) {
                Ok((grant, token)) => Answer::ok(Paired { agent: grant.id, token }),
                Err(why) => Answer::error(Code::Failed, why),
            };
        }
        let asked = approvals::ask(
            app,
            approvals::Asking {
                agent: PAIRING,
                name: &client,
                category: Category::Pairing,
                summary: client.clone(),
                site: None,
                tab: None,
                key: key.clone(),
                thread: None,
            },
        );
        if !matches!(asked, Answer::NeedsApproval { .. }) || started.elapsed() >= wait {
            return asked;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}
const PAIRING: &str = "";
pub fn may_ask_the_window(caller: &Caller, verb: &str) -> Result<(), String> {
    let Caller::Agent(_) = caller else {
        return Ok(());
    };
    if stop::stopped_for(caller.id()) {
        return Err("the reader pressed the stop: nothing runs until they resume".into());
    }
    let Some((_, needs)) = verbs::window::AGENT_VERBS.iter().find(|(name, _)| *name == verb) else {
        return Err(format!("{verb} is not a verb an agent may call"));
    };
    match needs {
        Some(scope) if !caller.holds(*scope) => Err(format!(
            "{verb} needs {}, which this agent was not granted",
            serde_json::to_value(scope)
                .ok()
                .and_then(|one| one.as_str().map(str::to_string))
                .unwrap_or_default()
        )),
        _ => Ok(()),
    }
}
pub fn question_category(id: &str) -> Option<(verbs::Category, Option<String>)> {
    approvals::any(id).map(|one| (one.category, one.site))
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_reaches_only_its_own_window_verbs() {
        let mut grant = Grant::own("a".into(), "A");
        grant.scopes.retain(|one| *one != Scope::NotesWrite);
        let agent = Caller::Agent(Box::new(grant));
        assert!(may_ask_the_window(&agent, "read_note").is_ok());
        assert!(may_ask_the_window(&agent, "edit_note").is_err());
        assert!(may_ask_the_window(&agent, "files.write").is_err());
        assert!(may_ask_the_window(&agent, "eval").is_err());
        assert!(may_ask_the_window(&agent, "list_spaces").is_ok());
        assert!(may_ask_the_window(&Caller::Reader, "files.write").is_ok());
    }
    #[test]
    fn a_client_connected_over_mcp_is_asked_nothing() {
        let mut kept = Grant::third_party("codex".into(), "Codex");
        kept.asks.insert(Category::Deleting, true);
        kept.sites.insert("bank.example".into(), grants::SiteRule::Deny);
        kept.spaces = grants::Spaces::Named(vec!["Work".into()]);
        let grant = connected(kept);
        for category in [
            Category::Paying,
            Category::Sending,
            Category::Publishing,
            Category::Deleting,
            Category::SigningIn,
            Category::Settings,
            Category::Terminal,
            Category::Files,
            Category::Writing,
            Category::Showing,
            Category::Takeover,
            Category::Tools,
        ] {
            assert!(!grant.asks(category), "{category:?}");
        }
        assert!(grant.asks_nothing());
        for scope in Scope::ALL {
            assert!(grant.holds(scope), "{scope:?}");
            assert!(grant.scopes.contains(&scope), "{scope:?} is held and not told");
        }
        let agent = Caller::Agent(Box::new(grant.clone()));
        assert!(may_ask_the_window(&agent, "write_setting").is_ok());
        assert!(
            policy::site_allowed(&grant, "https://bank.example/", verbs::Store::Reader).is_err()
        );
        assert!(!grant.spaces.reach("Home"));
    }
    #[test]
    fn the_command_line_is_filed_as_cli_with_every_scope() {
        assert_eq!(Caller::Reader.id(), "cli");
        assert!(Caller::Reader.holds(Scope::Terminal));
        assert!(Caller::Reader.told().is_none());
        let agent = Caller::Agent(Box::new(Grant::own("claude-code".into(), "Claude Code")));
        assert_eq!(agent.id(), "claude-code");
        assert!(!agent.holds(Scope::Settings));
        assert_eq!(agent.told().expect("told")["id"], "claude-code");
    }
}
