use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter as _, Url};

use super::cdp;
use super::engines::{self, View};
use super::quiet::{self, Owner};
use super::verbs::{AgentTab, Answer, Code, Event, Store, EVENT};

pub const LABEL: &str = "agent-";

pub const WIDTH: u32 = 1280;
pub const HEIGHT: u32 = 800;

pub const PARKED: &str =
    "that tab's page was parked to save memory: it opens again with the agent's next call";

const ALL_TABS: usize = 8;

const IDLE: Duration = Duration::from_secs(600);

pub(super) const BUILDING: Duration = Duration::from_secs(20);

#[derive(Clone, Debug)]
pub struct Tab {
    pub id: String,
    pub agent: String,
    pub store: Store,
    pub store_name: Option<String>,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub parked: bool,
    pub used: Instant,
    pub size: (u32, u32),
}

impl Tab {
    pub fn label(&self) -> String {
        format!("{LABEL}{}", self.id)
    }

    pub fn listed(&self) -> AgentTab {
        AgentTab {
            id: self.id.clone(),
            url: self.url.clone(),
            title: self.title.clone(),
            loading: self.loading,
            store: self.store,
            parked: self.parked,
        }
    }
}

static TABS: Mutex<Vec<Tab>> = Mutex::new(Vec::new());

static GONE: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

static NEXT: AtomicU64 = AtomicU64::new(1);

static TICKING: std::sync::Once = std::sync::Once::new();

fn tabs() -> std::sync::MutexGuard<'static, Vec<Tab>> {
    TABS.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn owner(label: &str) -> Option<Owner> {
    let id = label.strip_prefix(LABEL)?;
    tabs().iter().find(|one| one.id == id).map(|one| Owner {
        agent: one.agent.clone(),
        tab: one.id.clone(),
        label: label.to_string(),
    })
}

pub fn of(agent: &str) -> Vec<Tab> {
    tabs()
        .iter()
        .filter(|one| one.agent == agent)
        .cloned()
        .collect()
}

pub fn held(id: &str) -> Option<Tab> {
    tabs().iter().find(|one| one.id == id).cloned()
}

pub fn find(agent: &str, id: &str) -> Option<Tab> {
    tabs()
        .iter()
        .find(|one| one.agent == agent && one.id == id)
        .cloned()
}

pub fn may_open(owner: &Owner, url: &str) -> Result<(), String> {
    if !super::policy::on_the_web(url) {
        return Err("an agent's page stays on the web".to_string());
    }
    super::policy::site_allowed_for(&owner.agent, url, store_of(&owner.tab))
}

fn store_of(id: &str) -> Store {
    tabs()
        .iter()
        .find(|one| one.id == id)
        .map_or(Store::Reader, |one| one.store)
}

pub fn open(
    app: &AppHandle,
    agent: &str,
    url: &str,
    store: Store,
    store_name: Option<String>,
    size: (u32, u32),
    (most, ceiling): (usize, u32),
) -> Result<Tab, Answer> {
    let address = web_address(url)?;
    if let Some(why) = super::memory::too_much(ceiling) {
        return Err(Answer::error(Code::Limit, why));
    }
    make_room(app, agent, most, None);
    let tab = Tab {
        id: format!("a{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: agent.to_string(),
        store,
        store_name,
        url: address.to_string(),
        title: String::new(),
        loading: true,
        parked: false,
        used: Instant::now(),
        size: (size.0.clamp(320, 3840), size.1.clamp(240, 2400)),
    };
    tabs().push(tab.clone());
    start_ticking(app);
    if let Err(why) = build(app, &tab, Some(&address)) {
        tabs().retain(|one| one.id != tab.id);
        return Err(Answer::error(Code::Failed, why));
    }
    said(app, &tab);
    Ok(tab)
}

pub fn page(app: &AppHandle, agent: &str, id: &str) -> Result<(Tab, View), Answer> {
    let Some(mut tab) = find(agent, id) else {
        return Err(Answer::error(
            Code::NoSuchTab,
            format!("{id} is not one of this agent's tabs: browser_tabs lists them"),
        ));
    };
    touch(id);
    if let Some(view) = super::engines::view(app, &tab.label()) {
        return Ok((tab, view));
    }
    let address = web_address(&tab.url)?;
    make_room(app, agent, usize::MAX, Some(id));
    build(app, &tab, Some(&address)).map_err(|why| Answer::error(Code::Failed, why))?;
    tab.parked = false;
    set(id, |one| {
        one.parked = false;
        one.loading = true;
    });
    super::engines::view(app, &tab.label())
        .map(|view| (tab, view))
        .ok_or_else(|| Answer::error(Code::Failed, "the tab's page could not be built again"))
}

fn touch(id: &str) {
    set(id, |one| one.used = Instant::now());
}

pub fn set(id: &str, change: impl FnOnce(&mut Tab)) {
    if let Some(one) = tabs().iter_mut().find(|one| one.id == id) {
        change(one);
    }
}

pub(super) fn web_address(url: &str) -> Result<Url, Answer> {
    let address: Url = url.trim().parse().map_err(|error| {
        Answer::error(
            Code::BadArguments,
            format!("that is not an address: {error}"),
        )
    })?;
    let web = crate::web_tabs::allowed(&address) && address.scheme() != "view-source";
    if web || address.as_str() == "about:blank" {
        Ok(address)
    } else {
        Err(Answer::error(
            Code::BadArguments,
            "an agent's tab opens http and https addresses",
        ))
    }
}

fn make_room(app: &AppHandle, agent: &str, most: usize, keep: Option<&str>) {
    loop {
        let open: Vec<Tab> = tabs().iter().filter(|one| !one.parked).cloned().collect();
        let mine = open.iter().filter(|one| one.agent == agent).count();
        let candidates: Vec<&Tab> = if mine >= most {
            open.iter().filter(|one| one.agent == agent).collect()
        } else if open.len() >= ALL_TABS {
            open.iter().collect()
        } else {
            return;
        };
        let Some(oldest) = candidates
            .into_iter()
            .filter(|one| Some(one.id.as_str()) != keep)
            .min_by_key(|one| one.used)
        else {
            return;
        };
        park(app, &oldest.id);
    }
}

pub fn park(app: &AppHandle, id: &str) {
    let label = format!("{LABEL}{id}");
    set(id, |one| {
        one.parked = true;
        one.loading = false;
    });
    let_go(app, &label);
}

pub fn close(app: &AppHandle, id: &str) {
    let gone = {
        let mut all = tabs();
        let at = all.iter().position(|one| one.id == id);
        at.map(|at| all.remove(at))
    };
    if let Some(tab) = gone {
        let_go(app, &tab.label());
        let _ = app.emit(
            EVENT,
            Event::Closed {
                agent: tab.agent,
                id: tab.id,
            },
        );
    }
}

pub fn close_all(app: &AppHandle, agent: Option<&str>) {
    let ids: Vec<String> = tabs()
        .iter()
        .filter(|one| agent.is_none_or(|agent| one.agent == agent))
        .map(|one| one.id.clone())
        .collect();
    for id in ids {
        close(app, &id);
    }
}

const ANCHOR: &str = "web-session";

pub(super) fn bare(app: &AppHandle, store: Option<&str>) -> Result<(View, bool), String> {
    if store.is_none() {
        if let Some(anchor) = super::engines::view(app, ANCHOR) {
            return Ok((anchor, false));
        }
    }
    let tab = Tab {
        id: format!("c{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: String::new(),
        store: Store::Reader,
        store_name: store.map(str::to_string),
        url: "about:blank".into(),
        title: String::new(),
        loading: false,
        parked: false,
        used: Instant::now(),
        size: (WIDTH, HEIGHT),
    };
    build_page(app, &tab, None)?;
    super::engines::view(app, &tab.label())
        .map(|view| (view, true))
        .ok_or_else(|| "the page was never built".into())
}

pub(super) fn let_go_of_bare(app: &AppHandle, view: &View) {
    let_go(app, &view.label());
}

fn let_go(app: &AppHandle, label: &str) {
    if let Some(view) = super::engines::view(app, label) {
        view.close();
    }
    engines::forget(label);
    quiet::forget(app, label);
}

pub fn bye(agent: &str) {
    let mut gone = GONE.lock().unwrap_or_else(PoisonError::into_inner);
    gone.retain(|(one, _)| one != agent);
    gone.push((agent.to_string(), Instant::now()));
}

pub fn back(agent: &str) {
    GONE.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|(one, _)| one != agent);
}

pub fn said(app: &AppHandle, tab: &Tab) {
    let _ = app.emit(
        EVENT,
        Event::Tab {
            agent: tab.agent.clone(),
            id: tab.id.clone(),
            url: tab.url.clone(),
            title: tab.title.clone(),
        },
    );
}

fn build(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    let Some(reader) = super::engines::reader_of(tab.store_name.as_deref()) else {
        return build_page(app, tab, address);
    };
    build_page(app, tab, None)?;
    let label = tab.label();
    let twin = super::engines::view(app, &label).ok_or("the page was never built")?;
    super::twin::carry(app, reader, &twin);
    if let Some(address) = address {
        cdp::call(
            &twin,
            "Page.navigate",
            &serde_json::json!({ "url": address.as_str() }),
        )?;
    }
    Ok(())
}

fn build_page(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    super::engines::cef::build(
        app,
        &Owner {
            agent: tab.agent.clone(),
            tab: tab.id.clone(),
            label: tab.label(),
        },
        tab.store_name.as_deref(),
        tab.size,
        address.map(Url::as_str),
    )
}

pub fn reserve_popup(opener: &Owner, url: &str) -> Option<String> {
    let (store, store_name, size) = {
        let all = tabs();
        let one = all.iter().find(|one| one.id == opener.tab)?;
        (one.store, one.store_name.clone(), one.size)
    };
    let tab = Tab {
        id: format!("a{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        agent: opener.agent.clone(),
        store,
        store_name,
        url: url.to_string(),
        title: String::new(),
        loading: true,
        parked: false,
        used: Instant::now(),
        size,
    };
    let id = tab.id.clone();
    tabs().push(tab);
    engines::opened(&opener.label, &id);
    Some(id)
}

static SHOWN: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

pub fn shown_as(id: &str) -> Option<String> {
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .find(|(agent_tab, _)| agent_tab == id)
        .map(|(_, reader)| reader.clone())
}

pub fn adopt(app: &AppHandle, id: &str, reader: &str) -> Result<(), String> {
    if held(id).is_none() {
        return Err("there is no such agent tab".into());
    }
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push((id.to_string(), reader.to_string()));
    close(app, id);
    Err("an agent's page on Orden's own Chromium has no window: the tab loads its address".into())
}

fn start_ticking(app: &AppHandle) {
    TICKING.call_once(|| {
        let app = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(15));
            tick(&app);
        });
    });
}

fn tick(app: &AppHandle) {
    let idle: Vec<String> = tabs()
        .iter()
        .filter(|one| !one.parked && one.used.elapsed() >= IDLE)
        .map(|one| one.id.clone())
        .collect();
    for id in idle {
        park(app, &id);
    }
    let gone: Vec<String> = {
        let mut gone = GONE.lock().unwrap_or_else(PoisonError::into_inner);
        let due: Vec<String> = gone
            .iter()
            .filter(|(_, at)| at.elapsed() >= IDLE)
            .map(|(agent, _)| agent.clone())
            .collect();
        gone.retain(|(_, at)| at.elapsed() < IDLE);
        due
    };
    for agent in gone {
        close_all(app, Some(&agent));
    }
    engines::sleep_idle(app);
    super::approvals::expire(app);
}

#[cfg(test)]
mod tests {
    use super::web_address;

    #[test]
    fn an_agent_tab_goes_to_the_web_and_nowhere_else() {
        assert!(web_address("https://example.com/").is_ok());
        assert!(web_address(" http://127.0.0.1:9/x ").is_ok());
        assert!(web_address("file:///C:/Windows/win.ini").is_err());
        assert!(web_address("tauri://localhost").is_err());
        assert!(web_address("javascript:alert(1)").is_err());
        assert!(web_address("not an address").is_err());
        assert!(web_address("chrome://version").is_err());
        assert!(web_address("view-source:https://example.com/").is_err());
        assert!(web_address("data:text/html,x").is_err());
        assert!(web_address("about:version").is_err());
        assert!(web_address("http://tauri.localhost/").is_err());
        assert!(web_address("https://nib.localhost/").is_err());
        assert!(web_address("http://tauri.localhost./").is_err());
        assert!(web_address("about:blank").is_ok());
        assert_eq!(
            web_address(" HTTP://Example.com/x")
                .map(|one| one.to_string())
                .ok()
                .as_deref(),
            Some("http://example.com/x")
        );
    }
}
