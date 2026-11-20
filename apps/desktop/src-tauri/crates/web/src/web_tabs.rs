use orden_base::Held as _;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, Webview, WebviewBuilder,
    WebviewUrl,
};

pub const LABEL: &str = "web-";
pub fn is_page(label: &str) -> bool {
    label.starts_with(LABEL) || adopted_label(label)
}
static PRIVATE: Mutex<std::collections::BTreeSet<String>> =
    Mutex::new(std::collections::BTreeSet::new());
fn mark_private(label: &str, private: bool) {
    let mut marked = PRIVATE.held();
    if private {
        marked.insert(label.to_string());
    } else {
        marked.remove(label);
    }
}
pub fn is_private(label: &str) -> bool {
    PRIVATE.held().contains(label)
}
static ADOPTED: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
pub fn label_of(tab: &str) -> String {
    ADOPTED
        .lock()
        .ok()
        .and_then(|held| held.as_ref()?.get(tab).cloned())
        .unwrap_or_else(|| format!("{LABEL}{tab}"))
}
fn adopted_label(label: &str) -> bool {
    ADOPTED
        .lock()
        .is_ok_and(|held| held.as_ref().is_some_and(|all| all.values().any(|one| one == label)))
}
const CHOSEN: &str = "orden://web-chosen";
pub fn page_chosen(app: &AppHandle, window: &str, page: &str) {
    if let Some(tab) = tab_of(page) {
        let _ = app.emit_to(window, CHOSEN, serde_json::json!({ "tab": tab }));
    }
}
pub fn tab_of(label: &str) -> Option<String> {
    let adopted = ADOPTED.lock().ok().and_then(|held| {
        held.as_ref()?.iter().find(|(_, page)| page.as_str() == label).map(|(tab, _)| tab.clone())
    });
    adopted.or_else(|| label.strip_prefix(LABEL).map(str::to_string))
}
fn unadopt(tab: &str) {
    if let Ok(mut held) = ADOPTED.lock() {
        if let Some(all) = held.as_mut() {
            all.remove(tab);
        }
    }
}
const MOVED: &str = "orden://web-tab";
const OPENED: &str = "orden://web-open";
const BLOCKED: &str = "orden://web-blocked";
const LONGEST_PAGE: usize = 4_000_000;
const BLANK: &str = "about:blank";
const PLACE: &str = r"(function () {
  var want = __PLACE__
  if (!want || window.top !== window) return

  function put() {
    try {
      if (location.href !== want.url) return
      window.scrollTo(want.x, want.y)
    } catch (error) {
      // A page that will not be scrolled is a page that opens at the top.
    }
  }

  if (document.readyState !== 'loading') put()
  else document.addEventListener('DOMContentLoaded', put, { once: true })
  window.addEventListener('load', function () {
    put()
    setTimeout(put, 400)
  }, { once: true })
})()";
const LOOKED: &str = r"(function () {
  try {
    var edited = Array.prototype.some.call(document.querySelectorAll('input, textarea'), function (one) {
      return /^(text|search|email|url|tel|password|number|textarea)$/.test(one.type) && one.value !== one.defaultValue
    })
    return { url: location.href, x: window.scrollX || 0, y: window.scrollY || 0, edited: edited }
  } catch (error) {
    return { url: '', x: 0, y: 0, edited: false }
  }
})()";
const READER: &str = include_str!("web_tabs/reader.js");
#[cfg(any(windows, test))]
const BARS: &str = include_str!("web_bars.js");
#[cfg(any(windows, test))]
fn bars() -> &'static str {
    BARS.trim().trim_start_matches(';')
}
struct Kept {
    urls: Vec<String>,
    at: usize,
}
#[derive(Debug, Default, PartialEq)]
struct Steps {
    urls: Vec<String>,
    at: usize,
    kept: bool,
}
impl Steps {
    fn back(&self) -> bool {
        self.at > 0
    }
    fn forward(&self) -> bool {
        self.at + 1 < self.urls.len()
    }
    fn to(&self, by: isize) -> Option<usize> {
        self.at.checked_add_signed(by).filter(|there| *there < self.urls.len())
    }
}
fn seed(url: &str) -> bool {
    url.is_empty() || url == BLANK || crate::engine::internal(url)
}
fn steps_of(engine: Option<crate::engine::Entries>, kept: Option<&Kept>) -> Steps {
    let (mut urls, at) = engine.unwrap_or_default();
    let seeds = urls.iter().take_while(|one| seed(one)).count();
    urls.drain(..seeds);
    match kept {
        Some(kept) if urls.len() <= 1 => Steps { urls: kept.urls.clone(), at: kept.at, kept: true },
        _ => {
            let at = at.saturating_sub(seeds).min(urls.len().saturating_sub(1));
            Steps { urls, at, kept: false }
        }
    }
}
pub fn managed(builder: tauri::Builder<orden_base::Engine>) -> tauri::Builder<orden_base::Engine> {
    let builder = builder.on_window_event(crate::web_cookies::leaving);
    builder.on_window_event(crate::web_follow::heard).manage(WebTabs::default())
}
#[derive(Default)]
pub struct WebTabs {
    kept: Mutex<HashMap<String, Kept>>,
    opening: Mutex<HashSet<String>>,
}
struct Claim<'a> {
    tabs: &'a WebTabs,
    tab: &'a str,
}
impl Drop for Claim<'_> {
    fn drop(&mut self) {
        self.tabs.built(self.tab);
    }
}
impl WebTabs {
    fn claim(&self, tab: &str) -> bool {
        self.opening.lock().is_ok_and(|mut busy| busy.insert(tab.to_string()))
    }
    fn claimed<'a>(&'a self, tab: &'a str) -> Option<Claim<'a>> {
        self.claim(tab).then_some(Claim { tabs: self, tab })
    }
    fn built(&self, tab: &str) {
        if let Ok(mut busy) = self.opening.lock() {
            busy.remove(tab);
        }
    }
    fn restore(&self, tab: &str, urls: Vec<String>, at: usize) {
        if let Ok(mut kept) = self.kept.lock() {
            if urls.len() < 2 {
                kept.remove(tab);
            } else {
                let at = at.min(urls.len() - 1);
                kept.insert(tab.to_string(), Kept { urls, at });
            }
        }
    }
    fn steps(&self, tab: &str, engine: Option<crate::engine::Entries>) -> Steps {
        let Ok(mut kept) = self.kept.lock() else {
            return steps_of(engine, None);
        };
        let steps = steps_of(engine, kept.get(tab));
        if !steps.kept {
            kept.remove(tab);
        }
        steps
    }
    fn stepped(&self, tab: &str, at: usize) {
        if let Ok(mut kept) = self.kept.lock() {
            if let Some(one) = kept.get_mut(tab) {
                one.at = at;
            }
        }
    }
    fn forget(&self, tab: &str) {
        if let Ok(mut kept) = self.kept.lock() {
            kept.remove(tab);
        }
    }
}
fn engine_history_now(view: &Webview) -> Option<crate::engine::Entries> {
    let (sending, said) = std::sync::mpsc::channel();
    view.with_webview(move |platform| {
        let _ = sending.send(crate::engine::history(&platform));
    })
    .ok()?;
    said.recv_timeout(std::time::Duration::from_secs(2)).ok().flatten()
}
async fn engine_history(view: &Webview) -> Option<crate::engine::Entries> {
    let view = view.clone();
    tauri::async_runtime::spawn_blocking(move || engine_history_now(&view)).await.ok().flatten()
}
struct Telling {
    app: AppHandle,
    view: Webview,
    tab: String,
    url: String,
    title: Option<String>,
    loading: bool,
}
fn in_order(telling: Telling) {
    static TELLING: std::sync::OnceLock<Mutex<std::sync::mpsc::Sender<Telling>>> =
        std::sync::OnceLock::new();
    let sender = TELLING.get_or_init(|| {
        let (sender, told) = std::sync::mpsc::channel::<Telling>();
        let _ = std::thread::Builder::new().name("web steps".into()).spawn(move || {
            for one in told {
                tell(one);
            }
        });
        Mutex::new(sender)
    });
    if let Ok(sender) = sender.lock() {
        let _ = sender.send(telling);
    }
}
fn tell(told: Telling) {
    let Telling { app, view, tab, url, title, loading } = told;
    if app.get_webview(view.label()).is_none() {
        return;
    }
    let engine = engine_history_now(&view);
    let steps = app.try_state::<WebTabs>().map(|tabs| tabs.steps(&tab, engine)).unwrap_or_default();
    let payload = Moved {
        tab: tab.clone(),
        url,
        title: title.unwrap_or_default(),
        back: steps.back(),
        forward: steps.forward(),
        loading,
    };
    let Ok(payload) = serde_json::to_value(payload) else {
        return;
    };
    crate::web_steady::say(&app, view.window().label(), MOVED, &tab, loading, payload);
}
#[derive(Deserialize)]
pub struct Pane {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Clone, Serialize)]
struct Moved {
    tab: String,
    url: String,
    title: String,
    back: bool,
    forward: bool,
    loading: bool,
}
#[derive(Clone, Serialize)]
struct Opening {
    tab: String,
    url: String,
    behind: bool,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct Place {
    x: f64,
    y: f64,
}
#[derive(Deserialize)]
pub struct Revived {
    place: Option<Place>,
    trail: Vec<String>,
    at: usize,
}
#[derive(Deserialize)]
struct Looked {
    url: String,
    x: f64,
    y: f64,
    #[serde(default)]
    edited: bool,
}
#[derive(Serialize)]
pub struct Look {
    url: String,
    x: f64,
    y: f64,
    trail: Vec<String>,
    at: usize,
    edited: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Clipped {
    url: String,
    title: String,
    html: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Back,
    Forward,
    Reload,
    Fresh,
    Stop,
}
pub use orden_web_engine::allowed;

pub fn tab_may_open(url: &Url) -> bool {
    orden_web_engine::tab_may_open(url, &crate::extension_ids::ours)
}
pub fn open_as_tab(app: &AppHandle, window: &str, tab: &str, url: &Url) {
    let payload = Opening { tab: tab.to_string(), url: url.to_string(), behind: false };
    let _ = app.emit_to(window, OPENED, payload);
}
pub fn opened_beside(app: &AppHandle, window: &str, tab: &str, url: &str, behind: bool) {
    let Some(address) = Url::parse(url).ok().as_ref().and_then(handed_over) else {
        return;
    };
    let payload = Opening { tab: tab.to_string(), url: address, behind };
    let _ = app.emit_to(window, OPENED, payload);
}
fn handed_over(url: &Url) -> Option<String> {
    tab_may_open(url).then(|| url.to_string())
}
pub use orden_web_engine::Becomes;

pub fn becomes(url: &Url, sized: bool) -> Becomes {
    orden_web_engine::becomes(url, sized, &crate::extension_ids::ours)
}
pub fn popup_blocked(app: &AppHandle, window: &str, tab: &str, url: &str) {
    let Some(address) = Url::parse(url).ok().as_ref().and_then(handed_over) else {
        return;
    };
    let payload = Opening { tab: tab.to_string(), url: address, behind: false };
    let _ = app.emit_to(window, BLOCKED, payload);
}
fn address(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|error| format!("that is not an address: {error}"))?;
    if tab_may_open(&parsed) {
        Ok(parsed)
    } else {
        Err("a web tab only opens http and https pages".into())
    }
}
pub fn reader(selection: bool) -> String {
    READER
        .replace("__SELECTION__", if selection { "yes" } else { "no" })
        .replace("__LONGEST__", &LONGEST_PAGE.to_string())
}
fn opening(place: Option<Place>, url: &str, pass: bool) -> String {
    let want = place.and_then(|one| {
        serde_json::to_string(&serde_json::json!({ "url": url, "x": one.x, "y": one.y })).ok()
    });
    let mut scripts = vec![
        crate::web_opens::script(),
        crate::web_swipe::script().to_string(),
        crate::web_pointer::script().to_string(),
        crate::web_painted::script().to_string(),
        crate::web_media::script().to_string(),
    ];
    #[cfg(windows)]
    scripts.push(bars().to_string());
    if pass {
        scripts.push(crate::web_pass::script().to_string());
    }
    if let Some(one) = want {
        scripts.push(PLACE.replace("__PLACE__", &one));
    }
    scripts.iter().flat_map(|one| [one.as_str(), ";\n"]).collect()
}
fn page_built(
    window: &tauri::Window,
    builder: WebviewBuilder<orden_base::Engine>,
    pane: &Pane,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<(), String> {
    let _doing = orden_crashes::stall::doing("web_open: building the page");
    let _ = (app, store);
    let bounds = crate::web_follow::Bounds::from(pane);
    let scale = crate::page_scale::of(window).unwrap_or(1.0);
    let (left, top, width, height) = crate::web_follow::edges(bounds, scale);
    let view = crate::engine::add_child(
        window,
        builder,
        PhysicalPosition::new(left, top),
        PhysicalSize::new(width, height),
    )
    .map_err(|error| format!("that page could not be opened: {error}"))?;
    crate::page_style::worn(&view);
    crate::page_scheme::wear(&view);
    let zoom = crate::page_scale::web(1.0);
    if (zoom - 1.0).abs() > 0.01 {
        let _ = view.set_zoom(zoom);
    }
    crate::web_follow::put(&view, bounds, scale)
        .map_err(|error| format!("that page could not be placed: {error}"))?;
    Ok(())
}
pub fn warm(_app: &AppHandle) {}
#[derive(Debug, Default, Deserialize)]
pub struct Profile {
    store: Option<String>,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    pass: bool,
}
impl Profile {
    fn checked(&self) -> Result<(Option<String>, bool), String> {
        if self.private {
            return Ok((None, true));
        }
        let store = crate::web_stores::named(self.store.as_deref())?.map(str::to_string);
        Ok((store, false))
    }
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn web_open(
    webview: Webview,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    url: String,
    pane: Pane,
    revived: Revived,
    profile: Profile,
    ground: Option<String>,
) -> Result<crate::web_cut::Layering, String> {
    let address = address(&url)?;
    let (store, private) = profile.checked()?;
    let label = label_of(&tab);
    let app = webview.app_handle().clone();
    if app.get_webview(&label).is_some() {
        if crate::downloads::revive(&app, &tab) || adopted_label(&label) {
            return Ok(crate::web_cut::layering(&label));
        }
        return Err("that tab already has a page".into());
    }
    let Some(claim) = tabs.claimed(&tab) else {
        return Err("that tab is already opening a page".into());
    };
    tabs.restore(&tab, revived.trail, revived.at);
    let mut opened = opening(revived.place, &url, profile.pass);
    if crate::web_page_ui::takes(webview.window().label(), "select") {
        opened.push_str(crate::web_select::script());
        opened.push_str(";\n");
    }
    let scripts = crate::page_style::with(opened);
    let (built_on, onward) = (
        Url::parse(BLANK).map_err(|error| format!("that page could not be opened: {error}"))?,
        Some((address, scripts)),
    );
    let starting = (app.clone(), tab.clone());
    let builder = WebviewBuilder::new(label, WebviewUrl::External(built_on))
        .focused(orden_placement::placement::away().is_none())
        .on_navigation(move |to| {
            let going = tab_may_open(to);
            if going {
                started(&starting.0, &starting.1);
            }
            going
        })
        .disable_drag_drop_handler();
    let builder = match crate::page_style::ground_for(webview.window().label(), ground.as_deref()) {
        Some(colour) => builder.background_color(colour),
        None => builder,
    };
    mark_private(&label_of(&tab), private);
    let builder = crate::engine::web_store(builder, &app, store.as_deref())?.incognito(private);
    let builder = windows_asked(builder, &app, &tab, webview.window().label(), private);
    let builder = crate::downloads::saving(builder, &app, &tab, webview.window().label());
    let builder = reporting(builder, &app, &tab, private);
    let builder = crate::web_menu::asking(builder, &app, &tab, webview.window().label());
    let builder = crate::web_dialog::asking(builder, &app, &tab, webview.window().label());
    let builder = crate::web_permission::asking(builder, &app, &tab, webview.window().label());
    let stepping = (app.clone(), tab.clone());
    let builder = crate::engine::zooms(
        builder,
        Box::new(move |step| crate::web_page::stepped(&stepping.0, &stepping.1, step)),
    );
    let window = webview.window();
    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
    let (building, storing) = (app.clone(), store.clone());
    let posted = app.run_on_main_thread(move || {
        crate::engine::once_built(move || {
            let _ = sending.try_send(page_built(
                &window,
                builder,
                &pane,
                &building,
                storing.as_deref(),
            ));
        });
    });
    let made = match posted {
        Err(error) => Err(format!("that page could not be opened: {error}")),
        Ok(()) => {
            waiting.recv().await.unwrap_or_else(|| Err("that page was never built".to_string()))
        }
    };
    drop(claim);
    made?;
    crate::keyboard::built(&label_of(&tab));
    listening(&app, &tab, store, onward);
    Ok(crate::web_cut::layering(&label_of(&tab)))
}
fn windows_asked(
    builder: WebviewBuilder<orden_base::Engine>,
    app: &AppHandle,
    tab: &str,
    holder: &str,
    private: bool,
) -> WebviewBuilder<orden_base::Engine> {
    let _ = private;
    let opening = app.clone();
    let asking = tab.to_string();
    let holder = holder.to_string();
    builder.on_new_window(move |url: Url, features| {
        let sized = features.size().is_some() || features.position().is_some();
        let address = match becomes(&url, sized) {
            Becomes::Nothing => {
                eprintln!("web tab: a {} window it asked for was refused", url.scheme());
                return NewWindowResponse::Deny;
            }
            Becomes::Tab(address) => address,
            Becomes::Window => return NewWindowResponse::Allow,
        };
        let payload = Opening { tab: asking.clone(), url: address, behind: false };
        let _ = opening.emit_to(&holder, OPENED, payload);
        NewWindowResponse::Deny
    })
}
fn reporting(
    builder: WebviewBuilder<orden_base::Engine>,
    app: &AppHandle,
    tab: &str,
    private: bool,
) -> WebviewBuilder<orden_base::Engine> {
    let moved = tab.to_string();
    let sending = app.clone();
    let seen = std::sync::Arc::new(Mutex::new(String::new()));
    let noting = seen.clone();
    let builder = builder.on_page_load(move |view, payload| {
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        if let Ok(mut last) = noting.lock() {
            payload.url().as_str().clone_into(&mut last);
        }
        say(&sending, &view, &moved, payload.url().as_str(), None, loading);
        if loading {
            return;
        }
        crate::page_style::worn(&view);
        if !private {
            crate::web_cookies::keep(&view, || ());
        }
        {
            let marked = sending.clone();
            let named = moved.clone();
            let holder = view.window().label().to_string();
            let asking = view.clone();
            std::thread::spawn(move || {
                let declaring = crate::web_worlds::value(&asking, crate::web_icons::ASK)
                    .and_then(|said| serde_json::from_value(said).ok())
                    .unwrap_or_default();
                if let Some(icon) = crate::web_icons::best(&declaring) {
                    crate::web_icons::said(&marked, &holder, &named, &icon);
                }
            });
        }
    });
    let titled = tab.to_string();
    let naming = app.clone();
    builder.on_document_title_changed(move |view, title| {
        let url = address_now(&view, &seen);
        say(&naming, &view, &titled, &url, Some(title), false);
    })
}
fn address_now(view: &Webview, seen: &Mutex<String>) -> String {
    {
        let _ = view;
        seen.lock().map(|last| last.clone()).unwrap_or_default()
    }
}
fn listening(app: &AppHandle, tab: &str, store: Option<String>, onward: Option<(Url, String)>) {
    let _ = store;
    let Some(view) = app.get_webview(&label_of(tab)) else {
        return;
    };
    if let Some((address, scripts)) = onward.clone() {
        let clearing = view.clone();
        let (hearing, named, holder) =
            (app.clone(), tab.to_string(), view.window().label().to_string());
        std::thread::spawn(move || {
            crate::web_worlds::asking(&clearing, &hearing, &named, &holder);
            crate::downloads::follow(&clearing, &hearing, &holder);
            let cleared = crate::web_worlds::sent(&clearing, &address, &scripts);
            orden_base::trace::mark(&format!("web tab: {}", cleared.said()));
        });
    }
    let window = view.window().label().to_string();
    let label = view.label().to_string();
    let asking = app.clone();
    let _ = on_the_page(app, &label_of(tab), move |view| {
        let _ = crate::engine::with_platform!(view, move |platform| {
            crate::web_keys::listen(&platform, asking.clone(), window.clone());
            crate::keyboard::page(&asking, &platform, &label, &window);
            crate::pinch::web_page(&platform, &asking, &label);
        });
    });
}
fn started(app: &AppHandle, tab: &str) {
    if let Some(view) = app.get_webview(&label_of(tab)) {
        say(app, &view, tab, "", None, true);
    }
}
fn say(
    app: &AppHandle,
    view: &Webview,
    tab: &str,
    url: &str,
    title: Option<String>,
    loading: bool,
) {
    if url == BLANK || crate::engine::internal(url) {
        return;
    }
    in_order(Telling {
        app: app.clone(),
        view: view.clone(),
        tab: tab.to_string(),
        url: url.to_string(),
        title,
        loading,
    });
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn web_place(
    app: AppHandle,
    tab: String,
    pane: Pane,
    visible: bool,
    frame: Option<crate::web_follow::Frame>,
    cut: Option<crate::web_cut::Cut>,
    corner: Option<crate::web_cut::Foot>,
    opacity: Option<f64>,
) -> Result<crate::web_cut::Layering, String> {
    let view = found(&app, &tab)?;
    let answering = {
        let _doing = orden_crashes::stall::doing("web_place: asked");
        crate::web_answers::answers(&view)
    };
    if !answering {
        crate::web_answers::said(&app);
        if visible {
            return Err(crate::web_answers::NOT_ANSWERING.to_owned());
        }
        let _doing = orden_crashes::stall::doing("web_place: put away");
        crate::web_answers::put_away(&view);
        return Ok(crate::web_cut::layering(view.label()));
    }
    let window = view.window();
    let bounds = crate::web_follow::placed(
        &window,
        view.label(),
        crate::web_follow::Bounds::from(&pane),
        frame,
        visible,
    );
    let scale = crate::page_scale::of(&window)
        .map_err(|error| format!("that page could not be placed: {error}"))?;
    let (_, _, width, height) = crate::web_follow::edges(bounds, scale);
    if !visible {
        let _doing = orden_crashes::stall::doing("web_place: hidden");
        crate::page_hide::out_of_sight(&view);
        view.hide().map_err(|error| format!("that page could not be hidden: {error}"))?;
    }
    {
        let _doing = orden_crashes::stall::doing("web_place: bounds");
        crate::web_follow::put(&view, bounds, scale)
            .map_err(|error| format!("that page could not be placed: {error}"))?;
    }
    let _ = opacity;
    if visible {
        let _doing = orden_crashes::stall::doing("web_place: cut");
        crate::web_cut::apply(
            &view,
            cut.clone(),
            width,
            height,
            scale,
            corner.unwrap_or(crate::web_cut::Foot::Even(0.0)),
        );
    }
    if visible {
        let _doing = orden_crashes::stall::doing("web_place: shown");
        crate::page_hide::no_ground(&view);
        view.show().map_err(|error| format!("that page could not be shown: {error}"))?;
    }
    let _doing = orden_crashes::stall::doing("web_place: keyboard");
    if visible && cut.is_some() {
        crate::keyboard::hold_for_layer(&app, window.label());
    }
    crate::keyboard::placed(&app, &view, visible && cut.is_none());
    Ok(crate::web_cut::layering(view.label()))
}
impl From<&Pane> for crate::web_follow::Bounds {
    fn from(pane: &Pane) -> Self {
        Self { x: pane.x, y: pane.y, width: pane.width, height: pane.height }
    }
}
#[tauri::command]
pub fn web_navigate(app: AppHandle, tab: String, url: String) -> Result<(), String> {
    let at = address(&url)?;
    let view = found(&app, &tab)?;
    view.navigate(at).map_err(|error| format!("that address could not be opened: {error}"))
}
#[tauri::command]
pub async fn web_step(
    app: AppHandle,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    step: Step,
    by: Option<u32>,
) -> Result<(), String> {
    let view = found(&app, &tab)?;
    let steps = isize::try_from(by.unwrap_or(1).max(1)).unwrap_or(1);
    let by = match step {
        Step::Reload => return view.reload().map_err(|error| error.to_string()),
        Step::Fresh => return crate::web_reload::fresh(&view),
        Step::Stop => return crate::web_reload::stop(&view),
        Step::Back => -steps,
        Step::Forward => steps,
    };
    let steps = tabs.steps(&tab, engine_history(&view).await);
    let Some(there) = steps.to(by) else {
        return Ok(());
    };
    let going = if steps.kept {
        let url = address(&steps.urls[there])?;
        tabs.stepped(&tab, there);
        format!("location.replace({})", serde_json::Value::String(url.to_string()))
    } else {
        format!("history.go({by})")
    };
    view.eval(going).map_err(|error| format!("that page could not be stepped: {error}"))
}
#[tauri::command]
pub async fn web_trail(app: AppHandle, tab: String) -> (Vec<String>, usize) {
    let engine = match app.get_webview(&label_of(&tab)) {
        Some(view) => engine_history(&view).await,
        None => None,
    };
    let steps = app.state::<WebTabs>().steps(&tab, engine);
    (steps.urls, steps.at)
}
#[tauri::command]
pub async fn web_look(
    app: AppHandle,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
) -> Result<Look, String> {
    let view = found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);
    view.eval_with_callback(LOOKED, move |answer| {
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;
    let answer = waiting.recv().await.ok_or_else(|| "that page said nothing".to_string())?;
    let said = serde_json::from_str::<Looked>(&answer)
        .map_err(|error| format!("that page could not be read: {error}"))?;
    let steps = tabs.steps(&tab, engine_history(&view).await);
    Ok(Look {
        url: said.url,
        x: said.x,
        y: said.y,
        trail: steps.urls,
        at: steps.at,
        edited: said.edited,
    })
}
#[tauri::command]
pub fn web_scroll(app: AppHandle, tab: String, x: f64, y: f64) -> Result<(), String> {
    found(&app, &tab)?
        .eval(format!("window.scrollTo({x}, {y})"))
        .map_err(|error| format!("that page could not be scrolled: {error}"))
}
#[tauri::command]
pub fn web_zoom(app: AppHandle, tab: String, factor: f64) -> Result<(), String> {
    found(&app, &tab)?
        .set_zoom(crate::page_scale::web(factor))
        .map_err(|error| format!("that page could not be zoomed: {error}"))
}
#[tauri::command]
#[allow(clippy::unused_async)]
pub async fn web_print(app: AppHandle, tab: String) -> Result<(), String> {
    let view = found(&app, &tab)?;
    view.eval("window.print()").map_err(|error| format!("that page could not be printed: {error}"))
}
#[tauri::command]
pub fn web_devtools(app: AppHandle, tab: String) -> Result<(), String> {
    found(&app, &tab)?.open_devtools();
    Ok(())
}
#[tauri::command]
pub async fn web_clip(app: AppHandle, tab: String, selection: bool) -> Result<Clipped, String> {
    let view = found(&app, &tab)?;
    let script = reader(selection);
    if let Some(said) = in_our_world(&view, &script).await {
        if let Ok(clipped) = serde_json::from_value::<Clipped>(said) {
            return Ok(clipped);
        }
    }
    in_the_page(&view, script).await
}
async fn in_our_world(view: &Webview, script: &str) -> Option<serde_json::Value> {
    let (view, script) = (view.clone(), script.to_string());
    tauri::async_runtime::spawn_blocking(move || crate::web_worlds::value(&view, &script))
        .await
        .ok()
        .flatten()
}
async fn in_the_page(view: &Webview, script: String) -> Result<Clipped, String> {
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);
    view.eval_with_callback(script, move |answer| {
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;
    let answer = waiting.recv().await.ok_or_else(|| "that page said nothing".to_string())?;
    serde_json::from_str::<Clipped>(&answer)
        .map_err(|error| format!("that page could not be read: {error}"))
}
#[tauri::command]
pub async fn web_close(
    app: AppHandle,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    keep: bool,
) -> Result<(), String> {
    let label = label_of(&tab);
    unadopt(&tab);
    if keep {
        if let Some(view) = app.get_webview(&label) {
            let steps = tabs.steps(&tab, engine_history(&view).await);
            tabs.restore(&tab, steps.urls, steps.at);
        }
    }
    let (sending, mut waiting) = tauri::async_runtime::channel::<()>(1);
    let closing = app.clone();
    let named = tab.clone();
    let posted = app.run_on_main_thread(move || {
        let _doing = orden_crashes::stall::doing("web_close");
        if let Some(view) = closing.get_webview(&label) {
            crate::web_steady::forget(&named);
            crate::web_pass::forget(&named);
            crate::keyboard::closed(view.label());
            crate::web_follow::unfollow(view.label());
            crate::web_cut::uncut(view.label());
            crate::web_drawing::forget(view.label());
            let_go(view.label());
            if !crate::web_answers::answers(&view) {
                crate::web_answers::said(&closing);
                crate::web_answers::put_away(&view);
                crate::web_answers::close_when_answering(&closing, view.label().to_owned());
            } else if crate::downloads::linger(&closing, &named) {
                let _ = view.hide();
            } else {
                let _ = view.close();
            }
        }
        let _ = sending.try_send(());
    });
    if posted.is_ok() {
        let _ = waiting.recv().await;
    }
    if !keep {
        tabs.forget(&tab);
    }
    Ok(())
}
#[tauri::command]
pub async fn web_shot(
    app: AppHandle,
    tab: String,
    quick: Option<bool>,
) -> Result<Option<String>, String> {
    photographed(found(&app, &tab)?, quick.unwrap_or(false)).await
}
const QUICK_SCALE: f64 = 0.5;
const QUICK_QUALITY: u8 = 60;
fn shot_asked(quick: Option<(f64, f64)>) -> (serde_json::Value, &'static str) {
    match quick {
        None => (serde_json::json!({ "format": "png", "fromSurface": true }), "image/png"),
        Some((width, height)) => (
            serde_json::json!({
                "format": "jpeg",
                "quality": QUICK_QUALITY,
                "fromSurface": true,
                "clip": { "x": 0, "y": 0, "width": width, "height": height, "scale": QUICK_SCALE },
            }),
            "image/jpeg",
        ),
    }
}
fn seen_size(metrics: &serde_json::Value) -> Option<(f64, f64)> {
    let seen = metrics.get("cssVisualViewport").or_else(|| metrics.get("visualViewport"))?;
    let width = seen.get("clientWidth")?.as_f64()?;
    let height = seen.get("clientHeight")?.as_f64()?;
    (width > 0.0 && height > 0.0).then_some((width, height))
}
async fn photographed(view: Webview, quick: bool) -> Result<Option<String>, String> {
    let taken = tauri::async_runtime::spawn_blocking(move || {
        let patience = std::time::Duration::from_secs(2);
        let size = quick
            .then(|| {
                crate::engine::devtools::call(
                    &view,
                    None,
                    "Page.getLayoutMetrics",
                    &serde_json::json!({}),
                    patience,
                )
                .ok()
                .as_ref()
                .and_then(seen_size)
            })
            .flatten();
        let (asked, kind) = shot_asked(size);
        crate::engine::devtools::call(&view, None, "Page.captureScreenshot", &asked, patience)
            .map(|shot| (shot, kind))
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(match taken {
        Ok((shot, kind)) => shot["data"].as_str().map(|data| format!("data:{kind};base64,{data}")),
        Err(error) => {
            eprintln!("web_shot: {error}");
            None
        }
    })
}
pub fn close_page(app: &AppHandle, tab: &str) {
    if let Some(view) = app.get_webview(&label_of(tab)) {
        let_go(view.label());
        crate::keyboard::closed(view.label());
        crate::web_follow::unfollow(view.label());
        crate::web_cut::uncut(view.label());
        crate::web_drawing::forget(view.label());
        let _ = view.close();
    }
}
fn let_go(label: &str) {
    crate::engine::devtools::let_go_of(label);
}
pub fn found(app: &AppHandle, tab: &str) -> Result<Webview, String> {
    app.get_webview(&label_of(tab)).ok_or_else(|| "that tab has no page open".to_string())
}
pub fn on_the_page(
    app: &AppHandle,
    label: &str,
    then: impl FnOnce(Webview) + Send + 'static,
) -> tauri::Result<()> {
    let (asking, label) = (app.clone(), label.to_owned());
    app.run_on_main_thread(move || {
        if let Some(view) = asking.get_webview(&label) {
            then(view);
        }
    })
}
#[cfg(test)]
mod tests {
    use super::{
        address, allowed, becomes, handed_over, opening, reader, steps_of, tab_of, Becomes, Place,
        Profile, Steps, WebTabs, BLANK,
    };
    use tauri::Url;

    #[test]
    fn what_reads_a_page_from_a_command_thread_goes_by_the_windows_own() {
        let tabs = include_str!("web_tabs.rs").replace('\r', "");
        let listening = tabs
            .split("fn listening(")
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap_or_default();
        let (before, after) =
            listening.split_once("on_the_page(").expect("`listening` reaches the page directly");
        assert!(!before.contains("with_webview("), "asked before going over");
        assert!(after.contains("with_platform!("));
        for (file, source) in [
            ("web_certificate.rs", include_str!("web_certificate.rs")),
            ("web_pause.rs", include_str!("web_pause.rs")),
        ] {
            assert!(source.contains("on_the_page("), "{file} reaches the page directly");
        }
    }
    #[test]
    fn a_window_a_page_asks_for_becomes_what_it_needs() {
        let at = |text: &str| Url::parse(text).expect("an address");
        let site = "https://accounts.example/o/oauth2/auth?client_id=1";
        let web = |text: &str| Becomes::Tab(text.to_string());
        assert_eq!(becomes(&at(site), true), Becomes::Window);
        assert_eq!(becomes(&at(BLANK), false), Becomes::Window);
        assert_eq!(becomes(&at("about:blank#x"), false), Becomes::Window);
        assert_eq!(becomes(&at(site), false), Becomes::Window);
        for opens_a_tab in [
            "https://docs.google.com/document/d/1/edit",
            "https://example.com/a",
            "https://drive.example/file/d/2/view?usp=drive_web",
            "https://blog.example/author/jane",
            "https://example.com/authors",
        ] {
            assert_eq!(becomes(&at(opens_a_tab), false), web(opens_a_tab), "{opens_a_tab}");
        }
        for signs_in in [
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=1",
            "https://github.com/login/oauth/authorize?client_id=1",
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            "https://appleid.apple.com/auth/authorize",
            "https://bank.example/3ds/challenge",
            "https://example.com/signin",
            "https://example.com/sign-in",
            "https://sso.example.com/start",
        ] {
            assert_eq!(becomes(&at(signs_in), false), Becomes::Window, "{signs_in}");
        }
        for refused in ["orden://open?x", "file:///etc/passwd", "javascript:alert(1)"] {
            assert_eq!(becomes(&at(refused), false), Becomes::Nothing, "{refused}");
        }
    }
    #[test]
    fn a_window_of_the_page_s_own_content_opens_where_its_address_lives() {
        let at = |text: &str| Url::parse(text).expect("an address");
        for own in [
            "blob:https://shop.example/1b4e28ba-2fa1-11d2-883f-0016d3cca427",
            "data:text/html,<p>receipt</p>",
            "data:application/pdf;base64,JVBERi0=",
        ] {
            for sized in [false, true] {
                assert_eq!(becomes(&at(own), sized), Becomes::Window, "{own}");
            }
        }
        for refused in [
            "blob:http://tauri.localhost/1b4e28ba-2fa1-11d2-883f-0016d3cca427",
            "blob:null/1b4e28ba-2fa1-11d2-883f-0016d3cca427",
            "data:text/html,<p data-tauri-cef-internal></p>",
        ] {
            assert_eq!(becomes(&at(refused), false), Becomes::Nothing, "{refused}");
        }
    }
    #[test]
    fn an_extension_s_own_page_becomes_a_tab() {
        let id = "abcdefghijklmnopabcdefghijklmnop";
        crate::extension_ids::known(id);
        let page = format!("chrome-extension://{id}/dashboard.html");
        let tab = Becomes::Tab(page.clone());
        assert_eq!(becomes(&at(&page), false), tab);
        assert_eq!(becomes(&at(&page), true), tab);
        let other = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/dashboard.html";
        assert_eq!(becomes(&at(other), false), Becomes::Nothing);
    }
    fn at(url: &str) -> Url {
        Url::parse(url).expect("an address")
    }
    #[test]
    fn a_page_is_private_as_it_was_last_built() {
        let label = "web-private-test";
        assert!(!super::is_private(label));
        super::mark_private(label, true);
        assert!(super::is_private(label));
        super::mark_private(label, false);
        assert!(!super::is_private(label));
    }
    #[test]
    fn a_private_page_is_in_no_space_s_store() {
        let read = |said: &str| serde_json::from_str::<Profile>(said).expect("a profile");
        assert_eq!(read(r#"{"store":null}"#).checked(), Ok((None, false)));
        assert_eq!(
            read(r#"{"store":"space_s1"}"#).checked(),
            Ok((Some("space_s1".to_string()), false))
        );
        assert_eq!(read(r#"{"store":"space_s1","private":true}"#).checked(), Ok((None, true)));
        assert!(read(r#"{"store":"../web"}"#).checked().is_err());
    }
    #[test]
    fn only_the_web_and_its_source_are_allowed_and_the_app_is_not_a_page() {
        for (url, fine) in [
            ("https://example.com/a", true),
            ("http://example.com/a", true),
            ("view-source:https://example.com/a?b=1", true),
            ("file:///C:/notes/Idea.md", false),
            ("mailto:someone@example.com", false),
            ("data:text/html,<p>hi", false),
            ("http://tauri.localhost/index.html", false),
            ("https://TAURI.localhost/", false),
            ("http://ipc.localhost/notes", false),
            ("http://asset.localhost/a.png", false),
            ("view-source:file:///C:/notes/Idea.md", false),
            ("view-source:http://tauri.localhost/", false),
            ("view-source:view-source:https://example.com/", false),
            ("view-source:", false),
        ] {
            assert_eq!(allowed(&at(url)), fine, "{url}");
        }
        assert_eq!(
            handed_over(&at("view-source:https://example.com/a")),
            Some("view-source:https://example.com/a".to_string())
        );
    }
    #[test]
    fn a_window_the_page_asked_for_is_a_page_or_is_nothing() {
        assert_eq!(
            handed_over(&at("https://example.com/a")),
            Some("https://example.com/a".to_string())
        );
        for url in [
            "orden://command?id=record",
            "file:///C:/notes/Idea.md",
            "smb://example.com/share",
            "ms-officecmd:x",
            "http://tauri.localhost/index.html",
            BLANK,
        ] {
            assert!(handed_over(&at(url)).is_none(), "{url}");
        }
    }
    fn engine(urls: &[&str], at: usize) -> crate::engine::Entries {
        (urls.iter().map(|one| (*one).to_string()).collect(), at)
    }
    fn owned(urls: &[&str]) -> Vec<String> {
        urls.iter().map(|one| (*one).to_string()).collect()
    }
    #[test]
    fn the_steps_are_the_engine_s_own_entries_without_the_blank_page_the_tab_was_built_on() {
        let a = "https://a.example/";
        let b = "https://b.example/hop";
        let first = steps_of(Some(engine(&[BLANK, a], 1)), None);
        assert_eq!(first, Steps { urls: owned(&[a]), at: 0, kept: false });
        assert!(!first.back());
        assert!(!first.forward());
        assert_eq!(first.to(-1), None);
        let replaced = steps_of(Some(engine(&[BLANK, a, b], 2)), None);
        assert_eq!(replaced.urls, owned(&[a, b]));
        assert!(replaced.back() && !replaced.forward());
        assert_eq!(replaced.to(-1), Some(0));
        assert_eq!(replaced.to(-2), None);
        let back = steps_of(Some(engine(&[BLANK, a, b], 1)), None);
        assert!(!back.back() && back.forward());
        assert_eq!(back.to(1), Some(1));
        assert_eq!(back.to(2), None);
        let seeded = steps_of(Some(engine(&[BLANK, "about:blank", a], 2)), None);
        assert_eq!((seeded.urls.len(), seeded.at), (1, 0));
        assert_eq!(steps_of(None, None), Steps::default());
        assert_eq!(steps_of(Some(engine(&[BLANK], 0)), None), Steps::default());
    }
    #[test]
    fn a_revived_trail_steps_by_address_until_the_page_goes_somewhere_of_its_own() {
        let urls = owned(&["https://a.example/", "https://b.example/", "https://c.example/"]);
        let tabs = WebTabs::default();
        tabs.restore("t", urls.clone(), 2);
        let revived = tabs.steps("t", Some(engine(&[BLANK, "https://c.example/"], 1)));
        assert_eq!(revived, Steps { urls: urls.clone(), at: 2, kept: true });
        assert_eq!(revived.to(-2), Some(0));
        tabs.stepped("t", 0);
        let stepped = tabs.steps("t", Some(engine(&[BLANK, "https://a.example/"], 1)));
        assert_eq!((stepped.at, stepped.kept, stepped.forward()), (0, true, true));
        let elsewhere =
            tabs.steps("t", Some(engine(&[BLANK, "https://a.example/", "https://d.example/"], 2)));
        assert_eq!(elsewhere.urls, owned(&["https://a.example/", "https://d.example/"]));
        assert!(!elsewhere.kept);
        assert!(!tabs.steps("t", Some(engine(&[BLANK, "https://a.example/"], 1))).kept);
        tabs.restore("u", owned(&["https://a.example/"]), 0);
        assert!(!tabs.steps("u", None).kept);
        assert!(tabs.kept.lock().expect("kept").get("u").is_none());
    }
    #[test]
    fn orden_s_page_scripts_leave_the_page_s_world_alone() {
        for scripts in [
            opening(None, "https://a.example/page", true),
            opening(Some(Place { x: 0.0, y: 940.0 }), "https://a.example/page", true),
        ] {
            for script in scripts.split(";\n").filter(|one| !one.is_empty()) {
                assert!(script.starts_with("(function () {"), "{script}");
                assert!(script.ends_with("})()"), "{script}");
            }
            for written in [
                "window.__",
                "window.ipc",
                "__TAURI",
                "isTauri",
                "defineProperty",
                "delete window",
                "prototype",
                "window.open =",
                "chrome.webview",
            ] {
                assert!(!scripts.contains(written), "{written}");
            }
        }
    }
    #[test]
    fn a_quick_shot_is_a_half_scale_jpeg_of_the_seen_page_and_a_plain_one_stays_a_png() {
        let (plain, kind) = super::shot_asked(None);
        assert_eq!(plain, serde_json::json!({ "format": "png", "fromSurface": true }));
        assert_eq!(kind, "image/png");
        let (quick, kind) = super::shot_asked(Some((800.0, 600.0)));
        assert_eq!(kind, "image/jpeg");
        assert_eq!(quick["format"], "jpeg");
        assert_eq!(quick["quality"], 60);
        assert_eq!(quick["fromSurface"], true);
        assert_eq!(
            quick["clip"],
            serde_json::json!({ "x": 0, "y": 0, "width": 800.0, "height": 600.0, "scale": 0.5 })
        );
        let metrics =
            serde_json::json!({ "cssVisualViewport": { "clientWidth": 800, "clientHeight": 600 } });
        assert_eq!(super::seen_size(&metrics), Some((800.0, 600.0)));
        assert_eq!(super::seen_size(&serde_json::json!({})), None);
        let empty =
            serde_json::json!({ "cssVisualViewport": { "clientWidth": 0, "clientHeight": 600 } });
        assert_eq!(super::seen_size(&empty), None);
    }
    #[test]
    fn a_page_on_chromium_is_handed_the_keys_script_and_nothing_else() {
        assert_eq!(
            opening(None, "https://a.example/page", true),
            format!(
                "{};\n{};\n{};\n{};\n{};\n{}{};\n",
                crate::web_opens::script(),
                crate::web_swipe::script(),
                crate::web_pointer::script(),
                crate::web_painted::script(),
                crate::web_media::script(),
                if cfg!(windows) { format!("{};\n", super::bars()) } else { String::new() },
                crate::web_pass::script()
            )
        );
    }
    #[test]
    fn a_page_s_own_bars_keep_clear_of_the_pane_s_rounded_corners() {
        let script = super::bars();
        assert!(script.starts_with("(function () {") && script.ends_with("})()"));
        assert!(script.contains("html::-webkit-scrollbar-track:horizontal{margin:0 18px}"));
        assert!(script.contains("html::-webkit-scrollbar-track:vertical{margin:0 0 18px}"));
        assert!(script.contains("html::-webkit-scrollbar-corner{background:transparent}"));
        assert_eq!(opening(None, "https://a.example/page", false).contains(script), cfg!(windows));
    }
    #[test]
    fn a_page_opened_while_pass_is_off_is_handed_none_of_pass_s_script() {
        for place in [None, Some(Place { x: 0.0, y: 940.0 })] {
            let opened = opening(place, "https://a.example/page", false);
            assert!(!opened.contains(crate::web_pass::script()));
            assert!(!opened.contains("__ordenPass"));
        }
    }
    #[test]
    fn nobody_opens_a_tab_on_the_blank_page() {
        assert!(address(BLANK).is_err());
    }
    #[test]
    fn a_revived_page_carries_the_place_it_was_left_at() {
        let opened = opening(None, "https://a.example/page", true);
        assert!(!opened.contains("__PLACE__"));
        assert!(!opened.contains("scrollTo"));
        let revived = opening(Some(Place { x: 0.0, y: 940.0 }), "https://a.example/page", true);
        assert!(revived.contains("window.scrollTo"));
        assert!(revived.contains("\"url\":\"https://a.example/page\""));
        assert!(revived.contains("940"));
        assert!(revived.contains("})();"));
        assert!(!revived.contains("})()\n(function"));
    }
    #[test]
    fn one_tab_builds_one_page_at_a_time() {
        let tabs = WebTabs::default();
        assert!(tabs.claim("a"));
        assert!(!tabs.claim("a"));
        assert!(tabs.claim("b"));
        tabs.built("a");
        assert!(tabs.claim("a"));
    }
    #[test]
    fn a_build_given_up_on_the_way_gives_the_tab_back() {
        fn build(tabs: &WebTabs) -> Result<(), String> {
            let _claim = tabs.claimed("a").ok_or("busy")?;
            assert!(!tabs.claim("a"));
            Err("the store could not be had".to_string())
        }
        let tabs = WebTabs::default();
        assert!(build(&tabs).is_err());
        assert!(tabs.claim("a"));
    }
    #[test]
    fn a_tab_is_told_from_its_page_s_label() {
        assert_eq!(tab_of("web-a1").as_deref(), Some("a1"));
        assert_eq!(tab_of("main"), None);
    }
    #[test]
    fn a_kept_trail_belongs_to_its_own_tab() {
        let tabs = WebTabs::default();
        tabs.restore("a", vec!["https://a.example/".into(), "https://b.example/".into()], 1);
        assert!(tabs.steps("a", None).back());
        assert!(!tabs.steps("b", None).back());
        tabs.forget("a");
        assert!(!tabs.steps("a", None).back());
    }
    #[test]
    fn the_reader_says_whether_it_wants_the_selection() {
        assert!(reader(true).contains("'yes' === 'yes'"));
        assert!(reader(false).contains("'no' === 'yes'"));
        assert!(!reader(false).contains("__LONGEST__"));
        assert!(!reader(true).contains("__SELECTION__"));
    }
    #[test]
    fn the_reader_writes_the_marks_the_window_reads_it_by() {
        let said = reader(true);
        assert!(said.contains("`<!DOCTYPE html>${root.outerHTML}`"));
        assert!(said.contains("data-orden-selection"));
        assert!(said.contains("input[type=password]"));
        assert!(said.contains("removeAttribute('value')"));
    }
}
