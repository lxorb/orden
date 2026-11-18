mod browser;
mod capture;
pub(crate) mod cdp;
pub mod engines;
mod memory;
mod page;
mod quiet;
mod reader;
mod scripts;
pub(crate) mod tabs;
mod twin;

use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use orden_agents::grants::Grant;
use orden_agents::verbs::{self, Answer, Approval, ApprovalState, Code, Verb};
use orden_agents::{
    approvals, files, http, limits, logged, pair_client, process, said_waiting, shell, state, stop,
    system, Caller,
};

pub fn answer(app: &AppHandle, caller: &Caller, session: &str, verb: Verb, args: Value) -> Answer {
    shell::start(app);
    let started = Instant::now();
    let name = verb.name();
    let tab = args.get("tab").and_then(Value::as_str).map(str::to_string);
    let answered = run(app, caller, session, verb);
    logged(
        app,
        caller,
        session,
        name,
        tab.as_deref(),
        args,
        &answered,
        started,
    );
    answered
}

fn run(app: &AppHandle, caller: &Caller, session: &str, verb: Verb) -> Answer {
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
            let agent = caller.id();
            if shell::bye(app, agent, session) {
                tabs::bye(agent);
                process::end_all(Some(agent));
            } else {
                process::end_session(agent, session);
            }
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
                Ok(true) => said_waiting(app, caller, session, "calls"),
                Ok(false) => {}
            }
            if let Verb::Files(asked) = &browsing {
                return files::answer(app, caller, asked);
            }
            if let Verb::Process(asked) = &browsing {
                return process::answer(app, caller, session, asked, since);
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

fn browse(app: &AppHandle, caller: &Caller, verb: Verb, since: u64) -> Answer {
    browser::answer(app, caller, verb, since)
}

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
    let tabs = tabs::of(&grant.id).iter().map(tabs::Tab::listed).collect();
    Answer::ok(verbs::Status {
        stopped: stop::stopped_for(&grant.id),
        tabs,
        approvals: approvals::pending(Some(&grant.id)),
        grant,
    })
}

#[tauri::command(async)]
pub fn agents_state(webview: tauri::Webview, app: AppHandle) -> Result<Overview, String> {
    orden_base::labels::from_the_app(&webview)?;
    let agents = state(&app).grants.all(&app)?;
    let tabs = agents
        .iter()
        .flat_map(|grant| {
            tabs::of(&grant.id)
                .into_iter()
                .map(|tab| (grant.id.clone(), tab.listed()))
                .collect::<Vec<_>>()
        })
        .collect();
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
pub fn agents_adopt(
    webview: tauri::Webview,
    app: AppHandle,
    agent_tab: String,
    tab: String,
) -> Result<(), String> {
    orden_base::labels::from_the_app(&webview)?;
    tabs::adopt(&app, &agent_tab, &tab)
}

#[tauri::command(async)]
pub fn agents_peek(
    webview: tauri::Webview,
    app: AppHandle,
    tab: String,
) -> Result<verbs::Picture, String> {
    orden_base::labels::from_the_app(&webview)?;
    browser::peek(&app, &tab)
}

#[tauri::command]
pub async fn agents_capture(
    webview: tauri::Webview,
    app: AppHandle,
    agent: Option<String>,
    tab: String,
    shape: verbs::CaptureAs,
    full_page: Option<bool>,
    page: Option<orden_documents::pdf::PdfPage>,
) -> Answer {
    orden_base::lane::off_the_runtime(move || -> Answer {
        if let Err(why) = orden_base::labels::from_the_app(&webview) {
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
