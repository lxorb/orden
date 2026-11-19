use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use orden_base::Held as _;
use serde_json::Value;

use crate::client::{Client, Heard};
use crate::exposed::exposed;
use crate::import::{self, Place};
use crate::kept;
use crate::types::{
    Found, Offered, Permission, Pick, Secrets, Server, ServerView, State, ToolInfo, Transport,
};

pub const CALLING: Duration = Duration::from_secs(120);
pub const FIRST_OFFER: Duration = Duration::from_secs(10);
pub const RESTARTING: Duration = Duration::from_secs(15);
const MOST_CRASHES: u32 = 5;
const STEADY: Duration = Duration::from_secs(60);
pub trait Host: Send + Sync + 'static {
    fn file(&self) -> Result<PathBuf, String>;
    fn secret(&self, name: &str) -> Result<Option<String>, String>;
    fn keep(&self, name: &str, secret: Option<&str>) -> Result<(), String>;
    fn said(&self, id: &str, state: State);
}
#[derive(Default)]
struct Run {
    state: Option<State>,
    error: Option<String>,
    tools: Vec<Value>,
    client: Option<Arc<Client>>,
    round: u64,
    crashes: u32,
    ready_at: Option<Instant>,
    offered: bool,
}
impl Run {
    fn now(&self) -> State {
        self.state.unwrap_or(State::Off)
    }
}
#[derive(Default)]
struct Live {
    run: Mutex<Run>,
    settled: Condvar,
}
impl Live {
    fn settled_within(&self, patience: Duration) -> MutexGuard<'_, Run> {
        let run = self.run.held();
        self.settled
            .wait_timeout_while(run, patience, |run| run.now() == State::Starting)
            .map_or_else(|error| error.into_inner().0, |(run, _)| run)
    }
}
pub struct Hub {
    host: Box<dyn Host>,
    editing: Mutex<()>,
    live: Mutex<BTreeMap<String, Arc<Live>>>,
    me: Weak<Hub>,
}
fn account(id: &str) -> String {
    format!("mcp-{id}")
}
fn backoff(crashes: u32) -> Duration {
    Duration::from_secs(1 << crashes.saturating_sub(1).min(5)).min(Duration::from_secs(30))
}
fn unique(names: &mut Vec<String>) {
    let mut seen = Vec::new();
    names.retain_mut(|name| {
        *name = name.trim().to_owned();
        let fresh = !name.is_empty() && !seen.contains(name);
        if fresh {
            seen.push(name.clone());
        }
        fresh
    });
}
impl Hub {
    pub fn new(host: impl Host) -> Arc<Self> {
        Arc::new_cyclic(|me| Self {
            host: Box::new(host),
            editing: Mutex::new(()),
            live: Mutex::new(BTreeMap::new()),
            me: me.clone(),
        })
    }
    pub fn wake_all(&self) {
        for server in self.servers().unwrap_or_default().into_iter().filter(|server| server.on) {
            self.start(&server.id, false);
        }
    }
    pub fn servers(&self) -> Result<Vec<Server>, String> {
        kept::read(&self.host.file()?)
    }
    fn server(&self, id: &str) -> Result<Server, String> {
        self.servers()?
            .into_iter()
            .find(|server| server.id == id)
            .ok_or_else(|| "that MCP server is not in the list".to_owned())
    }
    fn edit<T>(
        &self,
        change: impl FnOnce(&mut Vec<Server>) -> Result<T, String>,
    ) -> Result<T, String> {
        let _held = self.editing.held();
        let path = self.host.file()?;
        let mut servers = kept::read(&path)?;
        let done = change(&mut servers)?;
        kept::write(&path, &servers)?;
        Ok(done)
    }
    fn secrets(&self, id: &str) -> Secrets {
        self.host
            .secret(&account(id))
            .ok()
            .flatten()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }
    fn keep_secrets(&self, id: &str, secrets: &Secrets) -> Result<(), String> {
        if secrets.is_empty() {
            return self.host.keep(&account(id), None);
        }
        let text = serde_json::to_string(secrets).map_err(|error| error.to_string())?;
        self.host.keep(&account(id), Some(&text))
    }
    fn live(&self, id: &str) -> Arc<Live> {
        Arc::clone(self.live.held().entry(id.to_owned()).or_default())
    }
    pub fn view(&self, server: Server) -> ServerView {
        let secrets = self.secrets(&server.id);
        let held = secrets.for_transport(&server.transport);
        let secrets_set = server
            .transport
            .names()
            .iter()
            .filter(|name| held.contains_key(*name))
            .cloned()
            .collect();
        let live = self.live.held().get(&server.id).cloned();
        let (state, error, tools) = live.map_or((State::Off, None, Vec::new()), |live| {
            let run = live.run.held();
            (run.now(), run.error.clone(), run.tools.clone())
        });
        let listed = tools.iter().filter_map(|tool| ToolInfo::of(tool, &server.tools)).collect();
        ServerView { server, state, error, listed, secrets_set }
    }
    pub fn views(&self) -> Result<Vec<ServerView>, String> {
        Ok(self.servers()?.into_iter().map(|server| self.view(server)).collect())
    }
    pub fn save(&self, mut server: Server, secrets: Option<Secrets>) -> Result<ServerView, String> {
        let name = server.name.trim().to_owned();
        server.name = name;
        match &mut server.transport {
            Transport::Stdio { command, env, .. } => {
                *command = command.trim().to_owned();
                unique(env);
            }
            Transport::Http { url, headers } => {
                *url = url.trim().to_owned();
                unique(headers);
            }
        }
        let (server, old, changed) = self.edit(|servers| {
            if server.id.is_empty() {
                server.id = kept::new_id(&server.name, |id| servers.iter().any(|one| one.id == id));
            }
            kept::checked(&server)?;
            let before = self.secrets(&server.id);
            let after = before.clone().merged(secrets, &server.transport);
            let changed = after != before;
            if changed {
                self.keep_secrets(&server.id, &after)?;
            }
            let old = servers
                .iter_mut()
                .find(|one| one.id == server.id)
                .map(|one| std::mem::replace(one, server.clone()));
            if old.is_none() {
                servers.push(server.clone());
            }
            Ok((server, old, changed))
        })?;
        let moved = changed || old.is_none_or(|old| old.transport != server.transport);
        if !server.on {
            self.stop(&server.id);
        } else if moved {
            self.stop(&server.id);
            self.start(&server.id, true);
        } else {
            self.start(&server.id, true);
        }
        Ok(self.view(server))
    }
    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.edit(|servers| {
            servers.retain(|one| one.id != id);
            Ok(())
        })?;
        self.stop(id);
        self.live.held().remove(id);
        self.host.keep(&account(id), None)
    }
    pub fn switch(&self, id: &str, on: bool) -> Result<ServerView, String> {
        let server = self.edit(|servers| {
            let server = servers
                .iter_mut()
                .find(|one| one.id == id)
                .ok_or("that MCP server is not in the list")?;
            server.on = on;
            Ok(server.clone())
        })?;
        if on {
            self.start(id, true);
        } else {
            self.stop(id);
        }
        Ok(self.view(server))
    }
    pub fn permission(
        &self,
        id: &str,
        tool: &str,
        permission: Permission,
    ) -> Result<ServerView, String> {
        let server = self.edit(|servers| {
            let server = servers
                .iter_mut()
                .find(|one| one.id == id)
                .ok_or("that MCP server is not in the list")?;
            server.tools.insert(tool.to_owned(), permission);
            Ok(server.clone())
        })?;
        Ok(self.view(server))
    }
    pub fn restart(&self, id: &str) -> Result<ServerView, String> {
        let server = self.server(id)?;
        self.stop(id);
        if server.on {
            self.start(id, true);
            drop(self.live(id).settled_within(RESTARTING));
        }
        Ok(self.view(server))
    }
    pub fn wait(&self, id: &str, patience: Duration) -> State {
        self.live(id).settled_within(patience).now()
    }
    pub fn offered(&self) -> Vec<Offered> {
        let servers: Vec<Server> =
            self.servers().unwrap_or_default().into_iter().filter(|server| server.on).collect();
        for server in &servers {
            self.start(&server.id, false);
        }
        let until = Instant::now() + FIRST_OFFER;
        let mut all = Vec::new();
        for server in servers {
            let live = self.live(&server.id);
            let mut run = live.run.held();
            if !run.offered {
                drop(run);
                run = live.settled_within(until.saturating_duration_since(Instant::now()));
                run.offered = true;
            }
            if run.now() != State::Ready {
                continue;
            }
            for tool in run.tools.iter().filter_map(|tool| ToolInfo::of(tool, &server.tools)) {
                if tool.permission == Permission::Off {
                    continue;
                }
                all.push(Offered {
                    exposed: exposed(&server.id, &tool.name),
                    server: server.id.clone(),
                    server_name: server.name.clone(),
                    tool,
                });
            }
        }
        all
    }
    pub fn find(&self, exposed: &str) -> Option<Offered> {
        self.offered().into_iter().find(|one| one.exposed == exposed)
    }
    pub fn call(&self, id: &str, tool: &str, args: Value) -> Result<Value, String> {
        let server = self.server(id)?;
        if !server.on {
            return Err(format!("{} is switched off", server.name));
        }
        if server.tools.get(tool) == Some(&Permission::Off) {
            return Err(format!("{tool} from {} is switched off", server.name));
        }
        self.start(id, false);
        let live = self.live(id);
        let client = {
            let run = live.settled_within(FIRST_OFFER);
            match (run.now(), &run.client) {
                (State::Ready, Some(client)) => Arc::clone(client),
                _ => {
                    return Err(run
                        .error
                        .clone()
                        .unwrap_or_else(|| format!("{} is not running", server.name)))
                }
            }
        };
        let secrets = self.secrets(id);
        client.call(tool, args, CALLING).map_err(|why| secrets.hide(&why))
    }
    pub fn stop_all(&self) {
        let all: Vec<Arc<Live>> = self.live.held().values().cloned().collect();
        for live in all {
            let client = {
                let mut run = live.run.held();
                run.round += 1;
                run.state = Some(State::Off);
                run.client.take()
            };
            drop(client);
            live.settled.notify_all();
        }
    }
    pub fn scan(&self, places: &[Place], env: &dyn Fn(&str) -> Option<String>) -> Vec<Found> {
        let servers = self.servers().unwrap_or_default();
        let mut found = import::scan(places, env);
        for one in found.iter_mut().flat_map(|found| found.servers.iter_mut()) {
            one.already = servers.iter().any(|server| server.transport.same_place(&one.transport));
        }
        found
    }
    pub fn import(
        &self,
        places: &[Place],
        env: &dyn Fn(&str) -> Option<String>,
        picks: &[Pick],
    ) -> Result<Vec<ServerView>, String> {
        let mut views = Vec::new();
        for pick in picks {
            let entry = places
                .iter()
                .filter(|place| place.source == pick.source)
                .flat_map(|place| import::read(place, env))
                .find(|entry| entry.server.name == pick.name);
            let Some(entry) = entry else {
                continue;
            };
            let servers = self.servers()?;
            if entry.server.orden
                || servers.iter().any(|server| server.transport.same_place(&entry.server.transport))
            {
                continue;
            }
            let server = Server {
                id: String::new(),
                name: entry.server.name,
                on: entry.server.needs_input.is_empty(),
                transport: entry.server.transport,
                tools: BTreeMap::new(),
                from: Some(pick.source.clone()),
            };
            views.push(self.save(server, Some(entry.values))?);
        }
        Ok(views)
    }
    fn start(&self, id: &str, again: bool) {
        let live = self.live(id);
        let round = {
            let mut run = live.run.held();
            match run.now() {
                State::Starting | State::Ready => return,
                State::Failed if !again => return,
                _ => {}
            }
            run.round += 1;
            run.state = Some(State::Starting);
            run.error = None;
            run.round
        };
        live.settled.notify_all();
        self.host.said(id, State::Starting);
        self.bring_up_later(id, live, round, Duration::ZERO);
    }
    fn stop(&self, id: &str) {
        let Some(live) = self.live.held().get(id).cloned() else {
            return;
        };
        let client = {
            let mut run = live.run.held();
            run.round += 1;
            run.state = Some(State::Off);
            run.error = None;
            run.crashes = 0;
            run.offered = false;
            run.client.take()
        };
        drop(client);
        live.settled.notify_all();
        self.host.said(id, State::Off);
    }
    fn bring_up_later(&self, id: &str, live: Arc<Live>, round: u64, after: Duration) {
        let Some(hub) = self.me.upgrade() else {
            return;
        };
        let id = id.to_owned();
        std::thread::spawn(move || {
            if !after.is_zero() {
                std::thread::sleep(after);
            }
            hub.bring_up(&id, &live, round);
        });
    }
    fn bring_up(&self, id: &str, live: &Arc<Live>, round: u64) {
        if live.run.held().round != round {
            return;
        }
        let secrets = self.secrets(id);
        let reached = self.server(id).and_then(|server| {
            let (me, named) = (self.me.clone(), id.to_owned());
            let client = Client::connect(&server.transport, &secrets, move |heard| {
                if let Some(hub) = me.upgrade() {
                    hub.heard(&named, round, heard);
                }
            })?;
            let tools = client.tools()?;
            Ok((client, tools))
        });
        let mut run = live.run.held();
        if run.round != round {
            drop(run);
            drop(reached);
            return;
        }
        match reached {
            Ok((client, tools)) => {
                run.state = Some(State::Ready);
                run.tools = tools;
                run.client = Some(Arc::new(client));
                run.ready_at = Some(Instant::now());
                run.error = None;
            }
            Err(why) => {
                run.state = Some(State::Failed);
                run.error = Some(secrets.hide(&why));
            }
        }
        let state = run.now();
        drop(run);
        live.settled.notify_all();
        self.host.said(id, state);
    }
    fn heard(&self, id: &str, round: u64, heard: Heard) {
        let Some(live) = self.live.held().get(id).cloned() else {
            return;
        };
        match heard {
            Heard::ToolsChanged => {
                let Some(hub) = self.me.upgrade() else {
                    return;
                };
                let id = id.to_owned();
                std::thread::spawn(move || hub.relist(&id, &live, round));
            }
            Heard::Ended(why) => self.crashed(id, &live, round, &why),
        }
    }
    fn relist(&self, id: &str, live: &Live, round: u64) {
        let client = {
            let run = live.run.held();
            if run.round != round || run.now() != State::Ready {
                return;
            }
            run.client.clone()
        };
        let Some(Ok(tools)) = client.map(|client| client.tools()) else {
            return;
        };
        {
            let mut run = live.run.held();
            if run.round != round {
                return;
            }
            run.tools = tools;
        }
        self.host.said(id, State::Ready);
    }
    fn crashed(&self, id: &str, live: &Arc<Live>, round: u64, why: &str) {
        let secrets = self.secrets(id);
        let (client, next) = {
            let mut run = live.run.held();
            if run.round != round || run.now() != State::Ready {
                return;
            }
            if run.ready_at.is_some_and(|at| at.elapsed() >= STEADY) {
                run.crashes = 0;
            }
            run.crashes += 1;
            let client = run.client.take();
            if run.crashes > MOST_CRASHES {
                run.state = Some(State::Failed);
                run.error = Some(secrets.hide(why));
                (client, None)
            } else {
                run.round += 1;
                run.state = Some(State::Starting);
                run.error = None;
                (client, Some((run.round, backoff(run.crashes))))
            }
        };
        drop(client);
        live.settled.notify_all();
        match next {
            None => self.host.said(id, State::Failed),
            Some((round, after)) => {
                self.host.said(id, State::Starting);
                self.bring_up_later(id, Arc::clone(live), round, after);
            }
        }
    }
}
