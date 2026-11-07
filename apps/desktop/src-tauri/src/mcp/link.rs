use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use super::app::{self, Endpoint};
use super::pairing::{self, Client, Kept};
use super::results::Outcome;
use crate::agents::grants::Grant;

const PAIRING_WAIT: Duration = Duration::from_secs(20);

const LOOK_EVERY: Duration = Duration::from_secs(2);

const PATIENCE: Duration = Duration::from_secs(150);

const APPROVAL_WAIT: Duration = Duration::from_secs(7 * 60);

const APPROVAL_LOOK: Duration = Duration::from_millis(400);

const HELPER_WAIT: Duration = Duration::from_secs(9 * 60);

const WINDOW_WAIT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Standing {
    Connecting,
    Asked,
    Refused,
    Removed,
    Unreachable(String),
    Paired,
}

#[derive(Clone, Debug)]
pub struct Seen {
    pub standing: Standing,
    pub grant: Option<Grant>,
    pub window: Option<BTreeSet<String>>,
}

enum Refusal {
    Unknown,
    Unreachable(String),
}

#[derive(Default)]
struct Held {
    standing: Option<Standing>,
    endpoint: Option<Endpoint>,
    kept: Option<Kept>,
    grant: Option<Grant>,
    window: Option<BTreeSet<String>>,
}

pub struct Link {
    dir: Option<PathBuf>,
    pub client: Client,
    held: Mutex<Held>,
    changed: Condvar,
    heard: Box<dyn Fn() + Send + Sync>,
}

impl Link {
    pub fn open(client: Client, heard: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        let link = Arc::new(Link {
            dir: super::home::config_dir(),
            client,
            held: Mutex::new(Held::default()),
            changed: Condvar::new(),
            heard: Box::new(heard),
        });
        let running = Arc::clone(&link);
        std::thread::spawn(move || running.run());
        link
    }

    fn held(&self) -> MutexGuard<'_, Held> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn seen_now(&self) -> Seen {
        let held = self.held();
        Seen {
            standing: held.standing.clone().unwrap_or(Standing::Connecting),
            grant: held.grant.clone(),
            window: held.window.clone(),
        }
    }

    pub fn seen(&self, patience: Duration, through_asking: bool) -> Seen {
        let started = Instant::now();
        let mut held = self.held();
        while match held.standing {
            None | Some(Standing::Connecting) => true,
            Some(Standing::Asked) => through_asking,
            Some(_) => false,
        } {
            let Some(left) = patience.checked_sub(started.elapsed()) else {
                break;
            };
            held = self
                .changed
                .wait_timeout(held, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        drop(held);
        self.seen_now()
    }

    fn change(&self, change: impl FnOnce(&mut Held)) {
        change(&mut self.held());
        self.changed.notify_all();
        (self.heard)();
    }

    fn settle(&self, standing: Standing) {
        self.change(|held| held.standing = Some(standing));
    }

    fn ended(&self, standing: Standing) -> bool {
        self.settle(standing);
        false
    }

    fn run(&self) {
        let Some(dir) = self.dir.clone() else {
            self.settle(Standing::Unreachable(
                "this machine does not say where Orden keeps its settings".to_owned(),
            ));
            return;
        };
        match app::running(&dir).map_or_else(|| app::start(&dir), Ok) {
            Ok(endpoint) => self.reach(&dir, endpoint),
            Err(why) => self.settle(Standing::Unreachable(why)),
        }
        self.watch(&dir);
    }

    fn reach(&self, dir: &Path, endpoint: Endpoint) {
        self.change(|held| {
            held.endpoint = Some(endpoint.clone());
            held.window = None;
        });
        if self.pair(dir, &endpoint) {
            self.ask_window(&endpoint, WINDOW_WAIT);
            self.settle(Standing::Paired);
        }
    }

    fn pair(&self, dir: &Path, endpoint: &Endpoint) -> bool {
        if let Some(token) = handed() {
            return self.prove_handed(endpoint, token);
        }
        loop {
            if let Some(kept) = pairing::kept(dir, &self.client) {
                match grant_of(endpoint, &kept.token) {
                    Ok(grant) => {
                        self.change(|held| {
                            held.kept = Some(kept);
                            held.grant = Some(grant);
                        });
                        return true;
                    }
                    Err(Refusal::Unknown) => pairing::forget(dir, &self.client),
                    Err(Refusal::Unreachable(why)) => {
                        return self.ended(Standing::Unreachable(why));
                    }
                }
            }

            let asked = json!({
                "verb": "agent_pair",
                "args": {
                    "client": self.client.name,
                    "wait_ms": u64::try_from(PAIRING_WAIT.as_millis()).unwrap_or(u64::MAX),
                },
            });
            let said = match app::post(
                endpoint,
                Some(&endpoint.secret),
                &asked,
                PAIRING_WAIT + Duration::from_secs(30),
            ) {
                Ok(said) => Outcome::from_endpoint(said.status, &said.body),
                Err(_) => {
                    return self.ended(Standing::Unreachable("Orden stopped answering".to_owned()))
                }
            };
            match said {
                Outcome::Done { result, .. } => {
                    let Ok(kept) = serde_json::from_value::<Kept>(json!({
                        "agent": result.get("agent"),
                        "token": result.get("token"),
                    })) else {
                        return self.ended(Standing::Unreachable(
                            "Orden paired this client without a token".to_owned(),
                        ));
                    };
                    if let Err(why) = pairing::keep(dir, &self.client, &kept) {
                        return self.ended(Standing::Unreachable(why));
                    }
                }
                Outcome::Asked { .. } => {
                    if self.seen_now().standing != Standing::Asked {
                        self.settle(Standing::Asked);
                    }
                }
                Outcome::Failed { code, .. } if code == "denied" => {
                    return self.ended(Standing::Refused)
                }
                Outcome::Failed { message, .. } => {
                    return self.ended(Standing::Unreachable(message))
                }
            }
        }
    }

    fn prove_handed(&self, endpoint: &Endpoint, token: String) -> bool {
        match grant_of(endpoint, &token) {
            Ok(grant) => {
                self.change(|held| {
                    held.kept = Some(Kept {
                        agent: grant.id.clone(),
                        token,
                    });
                    held.grant = Some(grant);
                });
                true
            }
            Err(Refusal::Unknown) => self.ended(Standing::Removed),
            Err(Refusal::Unreachable(why)) => self.ended(Standing::Unreachable(why)),
        }
    }

    fn ask_window(&self, endpoint: &Endpoint, patience: Duration) {
        let started = Instant::now();
        loop {
            let asked = json!({ "verb": "verbs", "args": {}, "rest": [] });
            let said = app::post(
                endpoint,
                Some(&endpoint.secret),
                &asked,
                Duration::from_secs(2),
            )
            .map(|said| Outcome::from_endpoint(said.status, &said.body));
            if let Ok(Outcome::Done { result, .. }) = said {
                let verbs: BTreeSet<String> = result
                    .get("verbs")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect();
                return self.change(|held| held.window = Some(verbs));
            }
            if started.elapsed() >= patience {
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    fn watch(&self, dir: &Path) {
        let automation = dir.join("automation.json");
        let grants = dir.join("agents.json");
        let mut launched = modified(&automation);
        let mut granted = modified(&grants);
        loop {
            std::thread::sleep(LOOK_EVERY);

            let now = modified(&automation);
            if now != launched {
                launched = now;
                self.relaunched(dir);
            }
            let now = modified(&grants);
            if now != granted {
                granted = now;
                self.regrant();
            }

            let seen = self.seen_now();
            if seen.standing == Standing::Paired && seen.window.is_none() {
                let endpoint = self.held().endpoint.clone();
                if let Some(endpoint) = endpoint {
                    self.ask_window(&endpoint, Duration::ZERO);
                }
            }
        }
    }

    fn relaunched(&self, dir: &Path) {
        let Some(now) = app::endpoint(dir) else {
            return;
        };
        if self.held().endpoint.as_ref() == Some(&now) || !app::answers(&now) {
            return;
        }
        match self.seen_now().standing {
            Standing::Refused | Standing::Removed => {}
            _ => self.reach(dir, now),
        }
    }

    fn regrant(&self) {
        let (endpoint, kept) = {
            let held = self.held();
            (held.endpoint.clone(), held.kept.clone())
        };
        let (Some(endpoint), Some(kept)) = (endpoint, kept) else {
            return;
        };
        match grant_of(&endpoint, &kept.token) {
            Ok(grant) => {
                if self.held().grant.as_ref() != Some(&grant) {
                    self.change(|held| held.grant = Some(grant));
                }
            }
            Err(Refusal::Unknown) => self.removed(),
            Err(Refusal::Unreachable(_)) => {}
        }
    }

    fn removed(&self) {
        if let (Some(dir), None) = (&self.dir, handed()) {
            pairing::forget(dir, &self.client);
        }
        self.change(|held| {
            held.kept = None;
            held.grant = None;
            held.standing = Some(Standing::Removed);
        });
    }

    pub fn call(&self, verb: &str, args: &Value) -> Outcome {
        let outcome = self.call_once(verb, args);
        if verb == "run_agent" || verb == "agent_result" {
            return self.helped(outcome);
        }
        let Outcome::Asked { approval, .. } = &outcome else {
            return outcome;
        };
        if handed().is_none() {
            return outcome;
        }
        match self.answered(approval) {
            Some(true) => self.call_once(verb, args),
            Some(false) => Outcome::failed("denied", "the reader said no"),
            None => outcome,
        }
    }

    fn helped(&self, mut outcome: Outcome) -> Outcome {
        let started = Instant::now();
        while let Some(agent) = super::results::still_working(&outcome) {
            if started.elapsed() >= HELPER_WAIT {
                break;
            }
            outcome = self.call_once("agent_result", &json!({ "agent": agent }));
        }
        outcome
    }

    fn answered(&self, approval: &str) -> Option<bool> {
        let started = Instant::now();
        while started.elapsed() < APPROVAL_WAIT {
            let asked = self.call_once("approval_status", &json!({ "id": approval }));
            let Outcome::Done { result, .. } = asked else {
                return None;
            };
            match result["approval"]["answer"].as_str() {
                Some("allowed" | "done") => return Some(true),
                Some("denied") => return Some(false),
                Some("pending") => std::thread::sleep(APPROVAL_LOOK),
                _ => return None,
            }
        }
        None
    }

    fn call_once(&self, verb: &str, args: &Value) -> Outcome {
        let (endpoint, kept) = {
            let held = self.held();
            (held.endpoint.clone(), held.kept.clone())
        };
        let (Some(endpoint), Some(kept)) = (endpoint, kept) else {
            return Outcome::failed("not_paired", self.sentence());
        };
        let mut asked = json!({ "verb": verb, "args": args, "rest": [] });
        if let (Some(thread), Some(_)) = (thread_handed(), handed()) {
            asked["thread"] = json!(thread);
        }
        let said = match app::post(&endpoint, Some(&kept.token), &asked, PATIENCE) {
            Ok(said) => said,
            Err(first) => {
                let again = self
                    .dir
                    .as_deref()
                    .and_then(app::running)
                    .filter(|now| *now != endpoint);
                let Some(now) = again else {
                    return Outcome::failed("unavailable", unreachable(&first));
                };
                self.change(|held| held.endpoint = Some(now.clone()));
                match app::post(&now, Some(&kept.token), &asked, PATIENCE) {
                    Ok(said) => said,
                    Err(second) => return Outcome::failed("unavailable", unreachable(&second)),
                }
            }
        };
        if said.status == 401 {
            self.removed();
            return Outcome::failed("not_paired", self.sentence());
        }
        Outcome::from_endpoint(said.status, &said.body)
    }

    pub fn bye(&self) {
        let (endpoint, kept) = {
            let held = self.held();
            (held.endpoint.clone(), held.kept.clone())
        };
        if let (Some(endpoint), Some(kept)) = (endpoint, kept) {
            let asked = json!({ "verb": "agent_bye", "args": {} });
            let _ = app::post(&endpoint, Some(&kept.token), &asked, Duration::from_secs(3));
        }
    }

    pub fn sentence(&self) -> String {
        let name = &self.client.name;
        match self.seen_now().standing {
            Standing::Connecting => "Orden is starting.".to_owned(),
            Standing::Asked => format!(
                "Orden is asking the reader whether {name} may work in it. Ask them to press Allow in Orden; its tools appear once they do."
            ),
            Standing::Refused => format!(
                "The reader did not allow {name} in Orden. Restart {name} to ask again."
            ),
            Standing::Removed => format!(
                "The reader removed {name} from Orden's agents. Restart {name} to ask again."
            ),
            Standing::Unreachable(why) => format!("Orden cannot be reached: {why}."),
            Standing::Paired => format!("{name} is paired with Orden."),
        }
    }
}

fn handed() -> Option<String> {
    std::env::var("NIB_MCP_TOKEN")
        .ok()
        .filter(|token| !token.is_empty() && token.bytes().all(|one| one.is_ascii_alphanumeric()))
}

fn thread_handed() -> Option<String> {
    std::env::var(THREAD_VAR).ok().filter(|thread| {
        !thread.is_empty()
            && thread.len() <= 80
            && thread
                .bytes()
                .all(|one| one.is_ascii_alphanumeric() || one == b'-' || one == b'_')
    })
}

const THREAD_VAR: &str = "NIB_MCP_THREAD";

fn grant_of(endpoint: &Endpoint, token: &str) -> Result<Grant, Refusal> {
    let asked = json!({ "verb": "agent_status", "args": {} });
    let said = app::post(endpoint, Some(token), &asked, Duration::from_secs(10))
        .map_err(|error| Refusal::Unreachable(unreachable(&error)))?;
    if said.status == 401 {
        return Err(Refusal::Unknown);
    }
    match Outcome::from_endpoint(said.status, &said.body) {
        Outcome::Done { result, .. } => result
            .get("grant")
            .cloned()
            .and_then(|grant| serde_json::from_value(grant).ok())
            .ok_or_else(|| Refusal::Unreachable("Orden answered no grant".to_owned())),
        Outcome::Failed { message, .. } => Err(Refusal::Unreachable(message)),
        Outcome::Asked { .. } => Err(Refusal::Unreachable("Orden asked instead".to_owned())),
    }
}

fn unreachable(error: &std::io::Error) -> String {
    format!("Orden is not running or did not answer ({error}); ask the reader to open Orden, then call again")
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|one| one.modified()).ok()
}
