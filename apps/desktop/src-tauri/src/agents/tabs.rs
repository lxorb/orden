use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(all(windows, not(feature = "cef")))]
use std::sync::mpsc::sync_channel;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter as _, Url};
#[cfg(all(windows, not(feature = "cef")))]
use tauri::{LogicalPosition, LogicalSize, Manager as _, WebviewBuilder, WebviewUrl};

#[cfg(any(windows, feature = "cef"))]
use super::cdp;
use super::engines::{self, View};
use super::quiet::{self, Owner};
use super::verbs::{AgentTab, Answer, Code, Event, Store, EVENT};

pub const LABEL: &str = "agent-";

#[cfg(all(windows, not(feature = "cef")))]
const AWAY: f64 = -10_000.0;

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

#[cfg(any(windows, feature = "cef"))]
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

#[cfg(all(target_os = "macos", not(feature = "cef")))]
fn build(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    build_page(app, tab, address)
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
fn build_page(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    super::engines::webkit::build(
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

#[cfg(feature = "cef")]
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

#[cfg(all(windows, not(feature = "cef")))]
fn build_page(app: &AppHandle, tab: &Tab, address: Option<&Url>) -> Result<(), String> {
    let window =
        super::shell::host(app).ok_or("Orden has no window for an agent's tab to live in")?;
    let label = tab.label();
    let blank: Url = "about:blank"
        .parse()
        .map_err(|error| format!("no blank page: {error}"))?;
    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(blank))
        .focused(false)
        .devtools(false)
        .disable_drag_drop_handler();
    let builder = crate::engine::web_store(builder, app, tab.store_name.as_deref())?;

    let (answered, answer) = sync_channel::<Result<(), String>>(1);
    let building = app.clone();
    let owner = Owner {
        agent: tab.agent.clone(),
        tab: tab.id.clone(),
        label: label.clone(),
    };
    let store = tab.store_name.clone();
    let (width, height) = tab.size;
    let going = address.map(ToString::to_string);
    app.run_on_main_thread(move || {
        let builder =
            crate::web_tabs::on_shared_session(builder, &window, &building, store.as_deref());
        let made = crate::engine::add_child(
            &window,
            builder,
            LogicalPosition::new(AWAY, AWAY),
            LogicalSize::new(f64::from(width), f64::from(height)),
        )
        .map_err(|error| format!("the page could not be built: {error}"));
        let made = made.and_then(|view| {
            let setting = building.clone();
            let telling = answered.clone();
            crate::engine::with_platform!(view, move |platform| {
                crate::web_tabs::keep_session(store.as_deref(), &platform);
                let Some(core) = cdp::core_of(&platform) else {
                    let _ = telling.try_send(Ok(()));
                    return;
                };
                crate::web_worlds::cleared(&platform, "", move |_| {
                    quiet::quieten(&setting, &core, &owner);
                    cdp::follow(&core, &owner.label);
                    listen(&setting, &core, &owner);
                    match going {
                        Some(url) => navigate_now(&core, &url),
                        None => quiet::hand_over(&owner.tab, Some(&core)),
                    }
                    let _ = telling.try_send(Ok(()));
                });
            })
            .map_err(|error| format!("the page could not be set up: {error}"))
        });
        if made.is_err() {
            let _ = answered.try_send(made);
        }
    })
    .map_err(|error| format!("the window could not be reached: {error}"))?;

    answer
        .recv_timeout(BUILDING)
        .map_err(|_| "the page was never built".to_string())?
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the page is sent through WebView2's own COM interface"
)]
fn navigate_now(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2, url: &str) {
    let _ = unsafe { core.Navigate(&windows_core::HSTRING::from(url)) };
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "navigation and title events are WebView2's own, reached through its COM interfaces"
)]
fn listen(
    app: &AppHandle,
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    owner: &Owner,
) {
    use webview2_com::{
        DocumentTitleChangedEventHandler, NavigationCompletedEventHandler,
        NavigationStartingEventHandler,
    };
    use windows_core::PWSTR;

    let starting = {
        let (owner, app) = (owner.clone(), app.clone());
        NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut uri = PWSTR::null();
            let url = unsafe {
                args.Uri(&raw mut uri)?;
                webview2_com::take_pwstr(uri)
            };
            if let Err(why) = may_open(&owner, &url) {
                unsafe { args.SetCancel(true)? };
                cdp::heard(&owner.label)
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .say(
                        "warning",
                        format!("Orden stopped the page going to {url}: {why}"),
                    );
                return Ok(());
            }
            set(&owner.tab, |one| one.loading = true);
            let _ = &app;
            Ok(())
        }))
    };
    let completed = {
        let (owner, app) = (owner.clone(), app.clone());
        NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
            let mut uri = PWSTR::null();
            let url = sender.and_then(|core| {
                unsafe { core.Source(&raw mut uri).ok()? };
                Some(webview2_com::take_pwstr(uri))
            });
            set(&owner.tab, |one| {
                one.loading = false;
                if let Some(url) = url {
                    one.url = url;
                }
            });
            if let Some(tab) = tabs().iter().find(|one| one.id == owner.tab).cloned() {
                said(&app, &tab);
            }
            Ok(())
        }))
    };
    let titled = {
        let (owner, app) = (owner.clone(), app.clone());
        DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
            let mut title = PWSTR::null();
            let title = sender.and_then(|core| {
                unsafe { core.DocumentTitle(&raw mut title).ok()? };
                Some(webview2_com::take_pwstr(title))
            });
            if let Some(title) = title {
                set(&owner.tab, |one| one.title = title);
            }
            if let Some(tab) = tabs().iter().find(|one| one.id == owner.tab).cloned() {
                said(&app, &tab);
            }
            Ok(())
        }))
    };
    let mut token = 0i64;
    unsafe {
        let _ = core.add_NavigationStarting(&starting, &raw mut token);
        let _ = core.add_NavigationCompleted(&completed, &raw mut token);
        let _ = core.add_DocumentTitleChanged(&titled, &raw mut token);
    }
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

#[cfg(all(windows, not(feature = "cef")))]
pub fn build_popup(app: &AppHandle, id: &str) {
    let Some(tab) = tabs().iter().find(|one| one.id == id).cloned() else {
        quiet::hand_over(id, None);
        return;
    };
    let building = app.clone();
    std::thread::spawn(move || {
        if build(&building, &tab, None).is_err() {
            let id = tab.id.clone();
            tabs().retain(|one| one.id != id);
            let _ = building.run_on_main_thread(move || quiet::hand_over(&id, None));
        } else {
            said(&building, &tab);
        }
    });
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub fn open_popup(app: &AppHandle, opener: &Owner, url: &str) {
    let Ok(address) = web_address(url) else {
        return;
    };
    if may_open(opener, url).is_err() {
        return;
    }
    let Some(id) = reserve_popup(opener, url) else {
        return;
    };
    let Some(tab) = tabs().iter().find(|one| one.id == id).cloned() else {
        return;
    };
    let building = app.clone();
    std::thread::spawn(move || {
        if build(&building, &tab, Some(&address)).is_err() {
            tabs().retain(|one| one.id != tab.id);
        } else {
            said(&building, &tab);
        }
    });
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

#[allow(
    unsafe_code,
    reason = "the page's settings are WebView2's own, reached through its COM interfaces"
)]
#[cfg(all(windows, not(feature = "cef")))]
pub fn adopt(app: &AppHandle, id: &str, reader: &str) -> Result<(), String> {
    let tab = tabs()
        .iter()
        .find(|one| one.id == id)
        .cloned()
        .ok_or("there is no such agent tab")?;
    let label = tab.label();
    let view = app.get_webview(&label).ok_or(PARKED)?;
    tabs().retain(|one| one.id != id);
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push((id.to_string(), reader.to_string()));
    let _ = view.with_webview(|platform| {
        let Some(core) = cdp::core_of(&platform) else {
            return;
        };
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2_8,
            };
            use windows_core::Interface as _;
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetAreDefaultScriptDialogsEnabled(true);
                let _ = settings.SetAreDefaultContextMenusEnabled(true);
                let _ = settings.SetAreDevToolsEnabled(true);
                if let Ok(three) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = three.SetAreBrowserAcceleratorKeysEnabled(true);
                }
                if let Ok(four) = settings.cast::<ICoreWebView2Settings4>() {
                    let _ = four.SetIsGeneralAutofillEnabled(true);
                    let _ = four.SetIsPasswordAutosaveEnabled(true);
                }
            }
            if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
                let _ = eight.SetIsMuted(false);
            }
        }
    });
    crate::web_tabs::hand_page_to(app, reader, &label, tab.store_name.clone());
    let _ = app.emit(
        EVENT,
        Event::Closed {
            agent: tab.agent,
            id: tab.id,
        },
    );
    Ok(())
}

#[cfg(feature = "cef")]
pub fn adopt(app: &AppHandle, id: &str, reader: &str) -> Result<(), String> {
    if held(id).is_none() {
        return Err("there is no such agent tab".into());
    }
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push((id.to_string(), reader.to_string()));
    close(app, id);
    Err("an agent's page on nib's own Chromium has no window: the tab loads its address".into())
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub fn adopt(app: &AppHandle, id: &str, reader: &str) -> Result<(), String> {
    if !tabs().iter().any(|one| one.id == id) {
        return Err("there is no such agent tab".into());
    }
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push((id.to_string(), reader.to_string()));
    close(app, id);
    Err("an agent's page on WKWebView is shown as a reader's tab of its own: the tab loads its address".into())
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
