#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs reads a grant's spaces"
    )
)]
pub mod grants;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "most answers are given by an engine with agent tabs"
    )
)]
pub mod verbs;

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "only an engine with agent tabs asks about a tab")
)]
mod approvals;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs reads a page to capture"
    )
)]
mod capture;
pub(crate) mod files;
mod http;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs presses keys into a page"
    )
)]
mod keys;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "only an engine with agent tabs opens agent tabs")
)]
mod limits;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "only an engine with agent tabs types into a page")
)]
mod log;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has a page to judge"
    )
)]
mod policy;
mod process;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has a tree to write"
    )
)]
mod snapshot;
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs has a call to stop"
    )
)]
pub(crate) mod stop;
mod system;

#[cfg(any(windows, feature = "cef", target_os = "macos"))]
pub mod engines;
pub mod shell;

#[cfg(any(windows, feature = "cef", target_os = "macos"))]
mod browser;
#[cfg(any(windows, feature = "cef"))]
pub(crate) mod cdp;
#[cfg(any(windows, feature = "cef", target_os = "macos"))]
mod memory;
#[cfg(any(windows, feature = "cef"))]
mod page;
#[cfg(any(windows, feature = "cef", target_os = "macos"))]
#[cfg_attr(
    all(target_os = "macos", not(feature = "cef")),
    allow(
        dead_code,
        reason = "WKWebView's dialogs, windows and downloads are built in #1092's next steps"
    )
)]
mod quiet;
#[cfg(any(windows, feature = "cef", target_os = "macos"))]
mod reader;
#[cfg(any(windows, feature = "cef", target_os = "macos"))]
#[cfg_attr(
    any(windows, feature = "cef"),
    allow(
        dead_code,
        reason = "the DevTools page runs its own copies of the reads the hunt hardened (page.rs); WKWebView runs these"
    )
)]
mod scripts;
#[cfg(any(windows, feature = "cef", target_os = "macos"))]
#[cfg_attr(
    all(target_os = "macos", not(feature = "cef")),
    allow(
        dead_code,
        reason = "WKWebView's agent pages are built in #1092's next steps"
    )
)]
mod tabs;
#[cfg(any(windows, feature = "cef"))]
mod twin;
pub(crate) mod working;

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use grants::{Grant, Grants, Scope};
use verbs::{Answer, Approval, ApprovalAnswer, ApprovalState, Category, Code, Paired, Verb};

#[derive(Default)]
pub struct Agents {
    pub grants: Grants,
}

pub(crate) static AGENTS: OnceLock<Agents> = OnceLock::new();

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

    fn limits(&self) -> grants::Limits {
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
    crate::ai_agent::lent(app, token).map(|grant| Caller::Agent(Box::new(grant)))
}

fn connected(mut grant: Grant) -> Grant {
    grant.mode = grants::Mode::Autonomous;
    grant
}

pub fn answer(app: &AppHandle, caller: &Caller, verb: Verb, args: Value) -> Answer {
    shell::start(app);
    let started = Instant::now();
    let name = verb.name();
    let tab = args.get("tab").and_then(Value::as_str).map(str::to_string);
    let answered = run(app, caller, verb);
    logged(app, caller, name, tab.as_deref(), args, &answered, started);
    answered
}

pub fn logged(
    app: &AppHandle,
    caller: &Caller,
    verb: &str,
    tab: Option<&str>,
    args: Value,
    answered: &Answer,
    started: Instant,
) {
    if let Caller::Agent(grant) = caller {
        if verb != "agent_bye" {
            shell::heard(app, &grant.id);
        }
    }
    let code = match answered {
        Answer::Error { code, .. } => serde_json::to_value(code).ok(),
        _ => None,
    };
    log::write(
        app,
        log::Line {
            at: crate::clock::now(),
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

fn run(app: &AppHandle, caller: &Caller, verb: Verb) -> Answer {
    #[cfg(any(windows, feature = "cef", target_os = "macos"))]
    tabs::back(caller.id());
    match verb {
        Verb::Status(_) => status(app, caller),
        Verb::ApprovalStatus(asked) => {
            let found = match caller {
                Caller::Reader => approvals::any(&asked.id),
                Caller::Agent(grant) => approvals::status(&grant.id, &asked.id),
            };
            match found {
                Some(approval) => Answer::ok(ApprovalState { approval }),
                None => Answer::error(Code::BadArguments, "there is no such question"),
            }
        }
        Verb::Pair(pair) => pair_client(app, caller, &pair),
        Verb::Bye(_) => {
            #[cfg(any(windows, feature = "cef", target_os = "macos"))]
            tabs::bye(caller.id());
            shell::bye(app, caller.id());
            process::end_all(Some(caller.id()));
            Answer::ok(verbs::Nothing {})
        }
        browsing => {
            if stop::stopped_for(caller.id()) {
                return Answer::error(
                    Code::Stopped,
                    "the reader pressed the stop: nothing runs until they resume",
                );
            }
            let since = stop::generation();
            match limits::wait_for_room(
                caller.id(),
                limits::Counted::Calls,
                caller.limits().calls,
                || stop::cancelled(since),
            ) {
                Err(()) => return Answer::error(Code::Stopped, "the reader pressed the stop"),
                Ok(true) => said_waiting(app, caller, "calls"),
                Ok(false) => {}
            }
            if let Verb::Files(asked) = &browsing {
                return files::answer(app, caller, asked);
            }
            if let Verb::Process(asked) = &browsing {
                return process::answer(app, caller, asked, since);
            }
            if let Verb::Http(asked) = &browsing {
                return http::answer(app, caller, asked, since);
            }
            if let Verb::System(asked) = &browsing {
                return system::answer(app, caller, asked);
            }
            browse(app, caller, browsing, since)
        }
    }
}

#[cfg(any(windows, feature = "cef", target_os = "macos"))]
fn browse(app: &AppHandle, caller: &Caller, verb: Verb, since: u64) -> Answer {
    browser::answer(app, caller, verb, since)
}

#[cfg(not(any(windows, feature = "cef", target_os = "macos")))]
fn browse(_app: &AppHandle, _caller: &Caller, verb: Verb, _since: u64) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        format!(
            "{} is not available here: an agent's browser runs on a desktop",
            verb.name()
        ),
    )
}

#[cfg_attr(
    not(any(windows, feature = "cef", target_os = "macos")),
    allow(
        dead_code,
        reason = "only an engine with agent tabs navigates an agent's page"
    )
)]
fn count_navigation(caller: &Caller, since: u64) -> Result<(), Answer> {
    match limits::wait_for_room(
        caller.id(),
        limits::Counted::Navigations,
        caller.limits().navigations,
        || stop::cancelled(since),
    ) {
        Err(()) => Err(Answer::error(Code::Stopped, "the reader pressed the stop")),
        Ok(_) => Ok(()),
    }
}

fn said_waiting(app: &AppHandle, caller: &Caller, what: &str) {
    logged(
        app,
        caller,
        "limit",
        None,
        serde_json::json!({ "waiting": what }),
        &Answer::ok(verbs::Nothing {}),
        Instant::now(),
    );
}

fn status(app: &AppHandle, caller: &Caller) -> Answer {
    let Caller::Agent(grant) = caller else {
        return Answer::error(
            Code::BadArguments,
            "agent_status is an agent's question: the command line has no grant",
        );
    };
    let grant = state(app)
        .grants
        .by_id(app, &grant.id)
        .unwrap_or_else(|| grant.as_ref().clone());
    #[cfg(any(windows, feature = "cef", target_os = "macos"))]
    let tabs = tabs::of(&grant.id).iter().map(tabs::Tab::listed).collect();
    #[cfg(not(any(windows, feature = "cef", target_os = "macos")))]
    let tabs = Vec::new();
    Answer::ok(verbs::Status {
        stopped: stop::stopped_for(&grant.id),
        tabs,
        approvals: approvals::pending(Some(&grant.id)),
        grant,
    })
}

const LONGEST_PAIRING_WAIT: Duration = Duration::from_secs(300);

fn pair_client(app: &AppHandle, caller: &Caller, pair: &verbs::Pair) -> Answer {
    if !matches!(caller, Caller::Reader) {
        return Answer::error(
            Code::NotGranted,
            "only a client holding the installation's secret pairs: an agent is paired already",
        );
    }
    let client = crate::downloads::plain_name(&pair.client);
    if client.is_empty() || client.chars().count() > 60 {
        return Answer::error(Code::BadArguments, "a client's name is 1 to 60 characters");
    }
    let key = approvals::key("agent_pair", None, Some(&client));
    let wait = Duration::from_millis(pair.wait_ms.unwrap_or(0)).min(LONGEST_PAIRING_WAIT);
    let started = Instant::now();
    loop {
        if approvals::allowed(PAIRING, &key) {
            return match state(app).grants.mint(app, &client, Grant::own) {
                Ok((grant, token)) => Answer::ok(Paired {
                    agent: grant.id,
                    token,
                }),
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
    let Some((_, needs)) = verbs::window::AGENT_VERBS
        .iter()
        .find(|(name, _)| *name == verb)
    else {
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

pub(crate) fn from_the_app(webview: &tauri::Webview) -> Result<(), String> {
    if crate::launch::is_document_window(webview.label()) {
        Ok(())
    } else {
        Err("only Orden's own window may ask that".into())
    }
}

#[tauri::command]
pub fn agents_stop(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<bool, String> {
    from_the_app(&webview)?;
    Ok(match agent {
        Some(agent) => {
            stop::halt(&app, &agent);
            false
        }
        None => stop::stop(&app),
    })
}

#[tauri::command]
pub fn agents_resume(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<(), String> {
    from_the_app(&webview)?;
    stop::resume(&app, agent.as_deref());
    Ok(())
}

#[tauri::command]
pub async fn agents_dialog_path(
    webview: tauri::Webview,
    app: AppHandle,
    agent: String,
    path: String,
    write: bool,
) -> Answer {
    crate::lane::off_the_runtime(move || -> Answer {
        if let Err(why) = from_the_app(&webview) {
            return Answer::error(Code::NotGranted, why);
        }
        let Some(grant) = state(&app).grants.by_id(&app, &agent) else {
            return Answer::error(Code::NotGranted, "there is no such agent");
        };
        let op = if write {
            verbs::FilesOp::Write
        } else {
            verbs::FilesOp::Read
        };
        match files::reachable(&app, &Caller::Agent(Box::new(grant)), &path, op) {
            Ok(path) => {
                crate::paths::picked_for_an_agent(&app, &files::pick_reach(&app, &path));
                Answer::ok(serde_json::json!({ "path": path.display().to_string() }))
            }
            Err(answer) => answer,
        }
    })
    .await
}

#[tauri::command(async)]
pub fn agents_answer(
    webview: tauri::Webview,
    app: AppHandle,
    id: String,
    allow: bool,
    always: bool,
) -> Result<Approval, String> {
    from_the_app(&webview)?;
    let approval = approvals::answer(&app, &id, allow)?;
    if always && approval.answer == ApprovalAnswer::Allowed {
        if let Some(site) = approval.site.clone() {
            let category = approval.category;
            let _ = state(&app).grants.change(&app, &approval.agent, |grant| {
                let kept = grant.always.entry(site).or_default();
                if !kept.contains(&category) {
                    kept.push(category);
                }
            });
        }
    }
    Ok(approval)
}

pub fn question_category(id: &str) -> Option<(verbs::Category, Option<String>)> {
    approvals::any(id).map(|one| (one.category, one.site))
}

#[tauri::command(async)]
pub fn agents_ask(
    webview: tauri::Webview,
    app: AppHandle,
    agent: String,
    category: Category,
    summary: String,
    key: String,
    site: Option<String>,
) -> Answer {
    if let Err(why) = from_the_app(&webview) {
        return Answer::error(Code::NotGranted, why);
    }
    if approvals::allowed(&agent, &key) {
        return Answer::ok(verbs::Nothing {});
    }
    let Some(grant) = state(&app).grants.by_id(&app, &agent) else {
        return Answer::error(Code::NotGranted, "there is no such agent");
    };
    if !grant.asks(category)
        || site
            .as_deref()
            .is_some_and(|site| grant.always(site, category))
    {
        return Answer::ok(verbs::Nothing {});
    }
    approvals::ask(
        &app,
        approvals::Asking {
            agent: &grant.id,
            name: &grant.name,
            category,
            summary,
            site,
            tab: None,
            key,
        },
    )
}

#[tauri::command(async)]
pub fn agents_state(webview: tauri::Webview, app: AppHandle) -> Result<Overview, String> {
    from_the_app(&webview)?;
    let agents = state(&app).grants.all(&app)?;
    #[cfg(any(windows, feature = "cef", target_os = "macos"))]
    let tabs = agents
        .iter()
        .flat_map(|grant| {
            tabs::of(&grant.id)
                .into_iter()
                .map(|tab| (grant.id.clone(), tab.listed()))
                .collect::<Vec<_>>()
        })
        .collect();
    #[cfg(not(any(windows, feature = "cef", target_os = "macos")))]
    let tabs = Vec::new();
    Ok(Overview {
        agents,
        tabs,
        approvals: approvals::pending(None),
        stopped: stop::stopped(),
        halted: stop::halted(),
        connected: shell::connected(),
    })
}

#[derive(Serialize)]
pub struct Overview {
    pub agents: Vec<Grant>,
    pub tabs: Vec<(String, verbs::AgentTab)>,
    pub approvals: Vec<Approval>,
    pub stopped: bool,
    pub halted: Vec<String>,
    pub connected: Vec<String>,
}

#[tauri::command(async)]
pub fn agents_log(
    webview: tauri::Webview,
    app: AppHandle,
    day: String,
) -> Result<Vec<Value>, String> {
    from_the_app(&webview)?;
    Ok(log::read_day(&app, &day))
}

#[tauri::command(async)]
pub fn agents_log_after(
    webview: tauri::Webview,
    app: AppHandle,
    day: String,
    from: u64,
) -> Result<log::After, String> {
    from_the_app(&webview)?;
    Ok(log::read_after(&app, &day, from))
}

#[tauri::command(async)]
pub fn agents_log_days(webview: tauri::Webview, app: AppHandle) -> Result<Vec<String>, String> {
    from_the_app(&webview)?;
    Ok(log::days(&app))
}

#[tauri::command(async)]
pub fn agents_log_clear(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
) -> Result<(), String> {
    from_the_app(&webview)?;
    log::clear(&app, agent.as_deref())
}

#[tauri::command(async)]
pub fn agents_adopt(
    webview: tauri::Webview,
    app: AppHandle,
    agent_tab: String,
    tab: String,
) -> Result<(), String> {
    from_the_app(&webview)?;
    #[cfg(all(windows, not(feature = "cef")))]
    if !shell::hosts(&app, &webview.window()) {
        return Err(
            "an agent's page lives in Orden's first window: this one loads its address".into(),
        );
    }
    #[cfg(any(windows, feature = "cef", target_os = "macos"))]
    return tabs::adopt(&app, &agent_tab, &tab);
    #[cfg(not(any(windows, feature = "cef", target_os = "macos")))]
    {
        let _ = (app, agent_tab, tab);
        Err("agent tabs are not available on this engine yet".into())
    }
}

#[tauri::command(async)]
pub fn agents_peek(
    webview: tauri::Webview,
    app: AppHandle,
    tab: String,
) -> Result<verbs::Picture, String> {
    from_the_app(&webview)?;
    #[cfg(any(windows, feature = "cef", target_os = "macos"))]
    return browser::peek(&app, &tab);
    #[cfg(not(any(windows, feature = "cef", target_os = "macos")))]
    {
        let _ = (app, tab);
        Err("agent tabs are not available on this engine yet".into())
    }
}

#[tauri::command]
pub async fn agents_capture(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
    tab: String,
    shape: verbs::CaptureAs,
    full_page: Option<bool>,
    page: Option<crate::pdf::PdfPage>,
) -> Answer {
    crate::lane::off_the_runtime(move || -> Answer {
        if let Err(why) = from_the_app(&webview) {
            return Answer::error(Code::NotGranted, why);
        }
        let caller = match agent {
            None => Caller::Reader,
            Some(id) => match state(&app).grants.by_id(&app, &id) {
                Some(grant) => Caller::Agent(Box::new(grant)),
                None => return Answer::error(Code::NotGranted, "there is no such agent"),
            },
        };
        capture::answer(
            &app,
            &caller,
            &tab,
            capture::Asked {
                shape,
                full_page: full_page.unwrap_or(false),
                paper: page,
            },
        )
    })
    .await
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
        kept.sites
            .insert("bank.example".into(), grants::SiteRule::Deny);
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
        ] {
            assert!(!grant.asks(category), "{category:?}");
        }
        assert!(grant.asks_nothing());
        for scope in Scope::ALL {
            assert!(grant.holds(scope), "{scope:?}");
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
