#![cfg(not(any(target_os = "android", target_os = "ios")))]

pub mod browser;
pub mod capture;
pub mod cdp;
pub mod commands;
pub mod engines;
pub mod memory;
pub mod page;
pub mod quiet;
pub mod reader;
pub mod scripts;
pub mod tabs;
pub mod twin;

use std::time::Instant;

use serde_json::Value;
use tauri::AppHandle;

use orden_agents::verbs::{self, Answer, ApprovalState, Code, Verb};
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
