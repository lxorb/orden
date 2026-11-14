use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, Webview, WebviewBuilder,
    WebviewUrl,
};

pub(crate) const LABEL: &str = "web-";

pub(crate) fn is_page(label: &str) -> bool {
    label.starts_with(LABEL) || adopted_label(label)
}

static PRIVATE: Mutex<std::collections::BTreeSet<String>> =
    Mutex::new(std::collections::BTreeSet::new());

fn mark_private(label: &str, private: bool) {
    let mut marked = PRIVATE.lock().unwrap_or_else(PoisonError::into_inner);
    if private {
        marked.insert(label.to_string());
    } else {
        marked.remove(label);
    }
}

pub(crate) fn is_private(label: &str) -> bool {
    PRIVATE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(label)
}

static ADOPTED: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

pub(crate) fn label_of(tab: &str) -> String {
    ADOPTED
        .lock()
        .ok()
        .and_then(|held| held.as_ref()?.get(tab).cloned())
        .unwrap_or_else(|| format!("{LABEL}{tab}"))
}

fn adopted_label(label: &str) -> bool {
    ADOPTED.lock().is_ok_and(|held| {
        held.as_ref()
            .is_some_and(|all| all.values().any(|one| one == label))
    })
}

const CHOSEN: &str = "orden://web-chosen";

pub(crate) fn page_chosen(app: &AppHandle, window: &str, page: &str) {
    if let Some(tab) = tab_of(page) {
        let _ = app.emit_to(window, CHOSEN, serde_json::json!({ "tab": tab }));
    }
}

pub(crate) fn tab_of(label: &str) -> Option<String> {
    let adopted = ADOPTED.lock().ok().and_then(|held| {
        held.as_ref()?
            .iter()
            .find(|(_, page)| page.as_str() == label)
            .map(|(tab, _)| tab.clone())
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

const MAIN: &str = "main";

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

#[derive(Default)]
struct Trail {
    urls: Vec<String>,
    at: usize,
    engine: bool,
}

impl Trail {
    fn restored(urls: Vec<String>, at: usize) -> Self {
        let at = at.min(urls.len().saturating_sub(1));
        Self {
            engine: urls.len() < 2,
            urls,
            at,
        }
    }

    fn step_to(&self, by: isize) -> Option<&String> {
        self.at
            .checked_add_signed(by)
            .and_then(|there| self.urls.get(there))
    }
    fn visited(&mut self, url: &str) {
        if self.urls.get(self.at).is_some_and(|here| here == url) {
            return;
        }

        if self.at > 0 && self.urls.get(self.at - 1).is_some_and(|back| back == url) {
            self.at -= 1;
            return;
        }

        if self.urls.get(self.at + 1).is_some_and(|on| on == url) {
            self.at += 1;
            return;
        }

        if !self.urls.is_empty() {
            self.urls.truncate(self.at + 1);
            self.at = self.urls.len();
        }

        self.urls.push(url.to_string());
    }

    fn back(&self) -> bool {
        self.at > 0
    }

    fn forward(&self) -> bool {
        self.at + 1 < self.urls.len()
    }
}

pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    let builder = builder.on_window_event(crate::web_cookies::leaving);
    builder
        .on_window_event(crate::web_follow::heard)
        .manage(WebTabs::default())
}

#[derive(Default)]
pub struct WebTabs {
    trails: Mutex<HashMap<String, Trail>>,
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
        self.opening
            .lock()
            .is_ok_and(|mut busy| busy.insert(tab.to_string()))
    }

    fn claimed<'a>(&'a self, tab: &'a str) -> Option<Claim<'a>> {
        self.claim(tab).then_some(Claim { tabs: self, tab })
    }

    fn built(&self, tab: &str) {
        if let Ok(mut busy) = self.opening.lock() {
            busy.remove(tab);
        }
    }

    fn walked(&self, tab: &str, url: &str) {
        if let Ok(mut trails) = self.trails.lock() {
            trails.entry(tab.to_string()).or_default().visited(url);
        }
    }

    fn restore(&self, tab: &str, urls: Vec<String>, at: usize) {
        if urls.is_empty() {
            return;
        }

        if let Ok(mut trails) = self.trails.lock() {
            trails.insert(tab.to_string(), Trail::restored(urls, at));
        }
    }

    fn walk(&self, tab: &str) -> (Vec<String>, usize) {
        self.trails
            .lock()
            .ok()
            .and_then(|trails| trails.get(tab).map(|one| (one.urls.clone(), one.at)))
            .unwrap_or_default()
    }

    fn stepping(&self, tab: &str, by: isize) -> Option<String> {
        let mut trails = self.trails.lock().ok()?;
        let trail = trails.get_mut(tab)?;
        let url = trail.step_to(by)?.clone();

        if by.unsigned_abs() > 1 {
            trail.at = trail.at.checked_add_signed(by)?;
        }

        (!trail.engine).then_some(url)
    }
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

pub(crate) use orden_web_engine::{allowed, app_host};

pub(crate) fn tab_may_open(url: &Url) -> bool {
    orden_web_engine::tab_may_open(url, &crate::extensions::ours)
}

pub(crate) fn open_as_tab(app: &AppHandle, window: &str, tab: &str, url: &Url) {
    let payload = Opening {
        tab: tab.to_string(),
        url: url.to_string(),
        behind: false,
    };
    let _ = app.emit_to(window, OPENED, payload);
}

pub(crate) fn opened_beside(app: &AppHandle, window: &str, tab: &str, url: &str, behind: bool) {
    let Some(address) = Url::parse(url).ok().as_ref().and_then(handed_over) else {
        return;
    };
    let payload = Opening {
        tab: tab.to_string(),
        url: address,
        behind,
    };
    let _ = app.emit_to(window, OPENED, payload);
}

fn handed_over(url: &Url) -> Option<String> {
    tab_may_open(url).then(|| url.to_string())
}

pub(crate) use orden_web_engine::Becomes;

pub(crate) fn becomes(url: &Url, sized: bool, said: bool, unasked: bool) -> Becomes {
    orden_web_engine::becomes(
        url,
        orden_web_engine::Asked {
            sized,
            said,
            unasked,
        },
        &crate::extensions::ours,
    )
}

pub(crate) fn popup_blocked(app: &AppHandle, window: &str, tab: &str, url: &str) {
    let Some(address) = Url::parse(url).ok().as_ref().and_then(handed_over) else {
        return;
    };
    let payload = Opening {
        tab: tab.to_string(),
        url: address,
        behind: false,
    };
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

pub(crate) fn reader(selection: bool) -> String {
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

    scripts
        .iter()
        .flat_map(|one| [one.as_str(), ";\n"])
        .collect()
}

fn page_built(
    window: &tauri::Window,
    builder: WebviewBuilder<crate::Engine>,
    pane: &Pane,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<(), String> {
    let _doing = crate::stall::doing("web_open: building the page");
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

pub(crate) fn warm(_app: &AppHandle) {}

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
pub async fn web_open(
    webview: Webview,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    url: String,
    pane: Pane,
    revived: Revived,
    profile: Profile,
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

    let scripts = crate::page_style::with(opening(revived.place, &url, profile.pass));
    let (built_on, onward) = (
        Url::parse(BLANK).map_err(|error| format!("that page could not be opened: {error}"))?,
        Some((address, scripts)),
    );

    let starting = (app.clone(), tab.clone());
    let builder = WebviewBuilder::new(label, WebviewUrl::External(built_on))
        .focused(crate::placement::away().is_none())
        .on_navigation(move |to| {
            let going = tab_may_open(to);
            if going {
                started(&starting.0, &starting.1);
            }
            going
        })
        .disable_drag_drop_handler();

    mark_private(&label_of(&tab), private);
    let builder = crate::engine::web_store(builder, &app, store.as_deref())?.incognito(private);

    let builder = windows_asked(builder, &app, &tab, webview.window().label(), private);

    let builder = crate::downloads::saving(builder, &app, &tab, webview.window().label());

    let builder = reporting(builder, &app, &tab, private);

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
        Ok(()) => waiting
            .recv()
            .await
            .unwrap_or_else(|| Err("that page was never built".to_string())),
    };

    drop(claim);
    made?;
    crate::keyboard::built(&label_of(&tab));

    listening(&app, &tab, store, onward);
    tabs.walked(&tab, &url);
    Ok(crate::web_cut::layering(&label_of(&tab)))
}

fn windows_asked(
    builder: WebviewBuilder<crate::Engine>,
    app: &AppHandle,
    tab: &str,
    holder: &str,
    private: bool,
) -> WebviewBuilder<crate::Engine> {
    let _ = private;
    let opening = app.clone();
    let asking = tab.to_string();
    let holder = holder.to_string();
    builder.on_new_window(move |url: Url, features| {
        let heard = crate::web_opens::heard(&asking, &url);
        let said = heard.said;
        if heard.ours {
            return NewWindowResponse::Deny;
        }

        let sized = features.size().is_some() || features.position().is_some();
        let address = match becomes(&url, sized, said.is_some(), heard.unasked) {
            Becomes::Nothing => return NewWindowResponse::Deny,
            Becomes::Blocked(address) => {
                popup_blocked(&opening, &holder, &asking, &address);
                return NewWindowResponse::Deny;
            }
            Becomes::Tab(address) => address,
            Becomes::Window => return NewWindowResponse::Allow,
        };

        let payload = Opening {
            tab: asking.clone(),
            url: address,
            behind: said == Some(crate::web_opens::Asked::Behind),
        };
        let _ = opening.emit_to(&holder, OPENED, payload);
        NewWindowResponse::Deny
    })
}

fn reporting(
    builder: WebviewBuilder<crate::Engine>,
    app: &AppHandle,
    tab: &str,
    private: bool,
) -> WebviewBuilder<crate::Engine> {
    let moved = tab.to_string();
    let sending = app.clone();
    let seen = std::sync::Arc::new(Mutex::new(String::new()));
    let noting = seen.clone();
    let builder = builder.on_page_load(move |view, payload| {
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        if let Ok(mut last) = noting.lock() {
            payload.url().as_str().clone_into(&mut last);
        }
        say(
            &sending,
            &view,
            &moved,
            payload.url().as_str(),
            None,
            loading,
        );

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
        let (hearing, named, holder) = (
            app.clone(),
            tab.to_string(),
            view.window().label().to_string(),
        );
        std::thread::spawn(move || {
            crate::web_worlds::asking(&clearing, &hearing, &named, &holder);
            crate::downloads::follow(&clearing, &hearing, &holder);
            let cleared = crate::web_worlds::sent(&clearing, &address, &scripts);
            crate::trace::mark(&format!("web tab: {}", cleared.said()));
        });
    }

    let window = view.window().label().to_string();
    let label = view.label().to_string();
    let asking = app.clone();
    let named = tab.to_string();
    let _ = on_the_page(app, &label_of(tab), move |view| {
        let _ = crate::engine::with_platform!(view, move |platform| {
            crate::web_keys::listen(&platform, asking.clone(), window.clone());
            crate::keyboard::page(&asking, &platform, &label, &window);
            crate::web_opens::listen(&platform, asking.clone(), named.clone(), window.clone());
            crate::web_page::listen(&platform, asking.clone(), named.clone(), window.clone());
            crate::web_find::listen(&platform, asking.clone(), named.clone(), window.clone());
            crate::downloads::listen(&platform, asking.clone(), window.clone());
            crate::web_icons::listen(&platform, asking.clone(), named.clone(), window.clone());
            crate::web_dialogs::listen(&platform, asking.clone(), named.clone(), window.clone());
            crate::pinch::web_page(&platform, &asking, &label);
            crate::web_pass::listen(&platform, asking.clone(), named.clone(), window.clone());
            ask::listen(&platform, asking, named, window);
        });
    });
}

pub fn hearing(app: &AppHandle) {
    let Some(view) = app.get_webview(MAIN) else {
        crate::trace::mark("microphone: no webview to listen on");
        return;
    };

    let ours: Vec<String> = app
        .config()
        .build
        .dev_url
        .as_ref()
        .map(|url| vec![origin_of(url.as_str())])
        .unwrap_or_default();

    let _ = view.with_webview(move |platform| {
        ask::own(&platform, ours);
        crate::trace::mark("microphone: listening on the window's own page");
    });
}

fn origin_of(url: &str) -> String {
    match url.find("://") {
        Some(at) => match url[at + 3..].find('/') {
            Some(end) => url[..at + 3 + end].to_lowercase(),
            None => url.to_lowercase(),
        },
        None => String::new(),
    }
}

#[cfg(test)]
fn capture_kinds(kind: isize) -> &'static [&'static str] {
    match kind {
        0 => &["camera"],
        1 => &["microphone"],
        2 => &["camera", "microphone"],
        _ => &[],
    }
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

    let stepping = app.try_state::<WebTabs>().and_then(|tabs| {
        tabs.trails.lock().ok().map(|mut open| {
            let trail = open.entry(tab.to_string()).or_default();
            if !loading && !url.is_empty() {
                trail.visited(url);
            }
            (trail.back(), trail.forward())
        })
    });
    let (back, forward) = stepping.unwrap_or((false, false));

    let payload = Moved {
        tab: tab.to_string(),
        url: url.to_string(),
        title: title.unwrap_or_default(),
        back,
        forward,
        loading,
    };

    let Ok(payload) = serde_json::to_value(payload) else {
        return;
    };
    crate::web_steady::say(app, view.window().label(), MOVED, tab, loading, payload);
}

#[tauri::command]
#[allow(
    clippy::too_many_arguments,
    reason = "a command's arguments are what the window sends, one by one"
)]
pub fn web_place(
    app: AppHandle,
    tab: String,
    pane: Pane,
    visible: bool,
    frame: Option<crate::web_follow::Frame>,
    cut: Option<crate::web_cut::Cut>,
    corner: Option<f64>,
    opacity: Option<f64>,
) -> Result<crate::web_cut::Layering, String> {
    let view = found(&app, &tab)?;

    let answering = {
        let _doing = crate::stall::doing("web_place: asked");
        crate::web_answers::answers(&view)
    };
    if !answering {
        crate::web_answers::said(&app);
        if visible {
            return Err(crate::web_answers::NOT_ANSWERING.to_owned());
        }
        let _doing = crate::stall::doing("web_place: put away");
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
        let _doing = crate::stall::doing("web_place: hidden");
        crate::page_hide::out_of_sight(&view);
        view.hide()
            .map_err(|error| format!("that page could not be hidden: {error}"))?;
    }
    {
        let _doing = crate::stall::doing("web_place: bounds");
        crate::web_follow::put(&view, bounds, scale)
            .map_err(|error| format!("that page could not be placed: {error}"))?;
    }

    let _ = opacity;
    if visible {
        let _doing = crate::stall::doing("web_place: cut");
        crate::web_cut::apply(
            &view,
            cut.clone(),
            width,
            height,
            scale,
            corner.unwrap_or(0.0),
        );
    }

    if visible {
        let _doing = crate::stall::doing("web_place: shown");
        crate::page_hide::no_ground(&view);
        view.show()
            .map_err(|error| format!("that page could not be shown: {error}"))?;
    }

    let _doing = crate::stall::doing("web_place: keyboard");
    if visible && cut.is_some() {
        crate::keyboard::hold_for_layer(&app, window.label());
    }
    crate::keyboard::placed(&app, &view, visible && cut.is_none());
    Ok(crate::web_cut::layering(view.label()))
}

impl From<&Pane> for crate::web_follow::Bounds {
    fn from(pane: &Pane) -> Self {
        Self {
            x: pane.x,
            y: pane.y,
            width: pane.width,
            height: pane.height,
        }
    }
}

#[tauri::command]
pub fn web_navigate(app: AppHandle, tab: String, url: String) -> Result<(), String> {
    let at = address(&url)?;
    let view = found(&app, &tab)?;
    crate::web_dialogs::dismiss(&app, &tab);
    view.navigate(at)
        .map_err(|error| format!("that address could not be opened: {error}"))
}

#[tauri::command]
pub fn web_step(
    app: AppHandle,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    step: Step,
    by: Option<u32>,
) -> Result<(), String> {
    let view = found(&app, &tab)?;
    if !matches!(step, Step::Stop) {
        crate::web_dialogs::dismiss(&app, &tab);
    }
    let steps = isize::try_from(by.unwrap_or(1).max(1)).unwrap_or(1);

    let by = match step {
        Step::Reload => return view.reload().map_err(|error| error.to_string()),
        Step::Fresh => return crate::web_reload::fresh(&view),
        Step::Stop => return crate::web_reload::stop(&view),
        Step::Back => -steps,
        Step::Forward => steps,
    };

    if let Some(url) = tabs.stepping(&tab, by) {
        let at = address(&url)?;
        return view
            .navigate(at)
            .map_err(|error| format!("that page could not be stepped: {error}"));
    }

    view.eval(format!("history.go({by})"))
        .map_err(|error| format!("that page could not be stepped: {error}"))
}

#[tauri::command]
pub fn web_trail(tabs: tauri::State<'_, WebTabs>, tab: String) -> (Vec<String>, usize) {
    tabs.walk(&tab)
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

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;

    let said = serde_json::from_str::<Looked>(&answer)
        .map_err(|error| format!("that page could not be read: {error}"))?;
    let (trail, at) = tabs.walk(&tab);

    Ok(Look {
        url: said.url,
        x: said.x,
        y: said.y,
        trail,
        at,
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
pub async fn web_print(app: AppHandle, tab: String) -> Result<(), String> {
    let view = found(&app, &tab)?;

    view.eval("window.print()")
        .map_err(|error| format!("that page could not be printed: {error}"))
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

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;

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
    let (sending, mut waiting) = tauri::async_runtime::channel::<()>(1);
    let closing = app.clone();
    let named = tab.clone();

    let posted = app.run_on_main_thread(move || {
        let _doing = crate::stall::doing("web_close");
        if let Some(view) = closing.get_webview(&label) {
            crate::web_find::forget(&named);
            crate::web_dialogs::forget(&named);
            ask::forget(&named);
            crate::web_steady::forget(&named);
            crate::web_pass::forget(&named);
            crate::keyboard::closed(view.label());
            crate::web_follow::unfollow(view.label());
            crate::web_cut::uncut(view.label());
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

    if let Ok(mut open) = tabs.trails.lock() {
        if keep {
            if let Some(trail) = open.get_mut(&tab) {
                trail.engine = false;
            }
        } else {
            open.remove(&tab);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn web_shot(app: AppHandle, tab: String) -> Result<Option<String>, String> {
    photographed(found(&app, &tab)?).await
}

async fn photographed(view: Webview) -> Result<Option<String>, String> {
    let taken = tauri::async_runtime::spawn_blocking(move || {
        crate::agents::cdp::call_in(
            &crate::agents::engines::View::Webview(view),
            None,
            "Page.captureScreenshot",
            &serde_json::json!({ "format": "png", "fromSurface": true }),
            std::time::Duration::from_secs(2),
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(match taken {
        Ok(shot) => shot["data"]
            .as_str()
            .map(|data| format!("data:image/png;base64,{data}")),
        Err(error) => {
            eprintln!("web_shot: {error}");
            None
        }
    })
}

#[tauri::command]
pub fn web_answer(app: AppHandle, id: u64, allow: bool) {
    let _ = app.run_on_main_thread(move || ask::answer(id, allow));
}

pub(crate) fn close_page(app: &AppHandle, tab: &str) {
    if let Some(view) = app.get_webview(&label_of(tab)) {
        let_go(view.label());
        crate::keyboard::closed(view.label());
        crate::web_follow::unfollow(view.label());
        crate::web_cut::uncut(view.label());
        let _ = view.close();
    }
}

fn let_go(label: &str) {
    crate::engine::devtools::let_go_of(label);
}

pub(crate) fn found(app: &AppHandle, tab: &str) -> Result<Webview, String> {
    app.get_webview(&label_of(tab))
        .ok_or_else(|| "that tab has no page open".to_string())
}

pub(crate) fn on_the_page(
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

mod ask {
    use tauri::webview::PlatformWebview;
    use tauri::AppHandle;

    pub fn listen(_webview: &PlatformWebview, _app: AppHandle, _tab: String, _window: String) {}

    pub fn own(_webview: &PlatformWebview, _ours: Vec<String>) {}

    pub fn answer(_id: u64, _allow: bool) {}

    pub fn forget(_tab: &str) {}
}

#[cfg(test)]
mod tests {
    use super::{
        address, allowed, becomes, capture_kinds, handed_over, opening, origin_of, reader, tab_of,
        Becomes, Place, Profile, Trail, WebTabs, BLANK,
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
        let (before, after) = listening
            .split_once("on_the_page(")
            .expect("`listening` reaches the page directly");
        assert!(!before.contains("with_webview("), "asked before going over");
        assert!(after.contains("with_platform!("));
        for (file, source) in [
            (
                "web_certificate/chromium.rs",
                include_str!("web_certificate/chromium.rs"),
            ),
            ("web_pause.rs", include_str!("web_pause.rs")),
        ] {
            assert!(
                source.contains("on_the_page("),
                "{file} reaches the page directly"
            );
        }
    }

    #[test]
    fn a_window_a_page_asks_for_becomes_what_it_needs() {
        let at = |text: &str| Url::parse(text).expect("an address");
        let site = "https://accounts.example/o/oauth2/auth?client_id=1";
        let web = |text: &str| Becomes::Tab(text.to_string());

        assert_eq!(
            becomes(&at("https://example.com/a"), false, true, false),
            web("https://example.com/a")
        );
        assert_eq!(becomes(&at(site), true, true, false), web(site));
        assert_eq!(becomes(&at(site), true, false, false), Becomes::Window);
        assert_eq!(becomes(&at(BLANK), false, false, false), Becomes::Window);
        assert_eq!(
            becomes(&at("about:blank#x"), false, false, false),
            Becomes::Window
        );
        assert_eq!(becomes(&at(site), false, false, false), Becomes::Window);
        for opens_a_tab in [
            "https://docs.google.com/document/d/1/edit",
            "https://example.com/a",
            "https://drive.example/file/d/2/view?usp=drive_web",
            "https://blog.example/author/jane",
            "https://example.com/authors",
        ] {
            assert_eq!(
                becomes(&at(opens_a_tab), false, false, false),
                web(opens_a_tab),
                "{opens_a_tab}"
            );
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
            assert_eq!(
                becomes(&at(signs_in), false, false, false),
                Becomes::Window,
                "{signs_in}"
            );
        }
        assert_eq!(
            becomes(&at(site), true, false, true),
            Becomes::Blocked(site.to_string())
        );
        assert_eq!(becomes(&at(BLANK), false, false, true), Becomes::Nothing);
        for refused in [
            "orden://open?x",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert_eq!(
                becomes(&at(refused), false, true, false),
                Becomes::Nothing,
                "{refused}"
            );
            assert_eq!(
                becomes(&at(refused), false, false, false),
                Becomes::Nothing,
                "{refused}"
            );
        }
        assert_eq!(becomes(&at(BLANK), false, true, false), Becomes::Nothing);
    }

    #[test]
    fn an_extension_s_own_page_becomes_a_tab() {
        let id = "abcdefghijklmnopabcdefghijklmnop";
        crate::extensions::known(id);
        let page = format!("chrome-extension://{id}/dashboard.html");
        let tab = Becomes::Tab(page.clone());
        assert_eq!(becomes(&at(&page), false, false, false), tab);
        assert_eq!(becomes(&at(&page), true, false, false), tab);
        assert_eq!(becomes(&at(&page), false, true, false), tab);
        let other = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/dashboard.html";
        assert_eq!(becomes(&at(other), false, false, false), Becomes::Nothing);
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
        assert_eq!(
            read(r#"{"store":"space_s1","private":true}"#).checked(),
            Ok((None, true))
        );
        assert!(read(r#"{"store":"../web"}"#).checked().is_err());
    }

    #[test]
    fn a_capture_request_is_asked_about_kind_by_kind() {
        assert_eq!(capture_kinds(0), ["camera"]);
        assert_eq!(capture_kinds(1), ["microphone"]);
        assert_eq!(capture_kinds(2), ["camera", "microphone"]);
        assert!(capture_kinds(3).is_empty());
        assert!(capture_kinds(-1).is_empty());
    }

    #[test]
    fn an_origin_is_the_scheme_the_host_and_the_port() {
        assert_eq!(
            origin_of("http://a.example:8080/x/y?z"),
            "http://a.example:8080"
        );
        assert_eq!(origin_of("HTTP://A.Example/"), "http://a.example");
        assert_eq!(origin_of("about:blank"), "");
    }

    #[test]
    fn only_the_web_is_allowed() {
        assert!(allowed(&at("https://example.com/a")));
        assert!(allowed(&at("http://example.com/a")));
        assert!(!allowed(&at("file:///C:/notes/Idea.md")));
        assert!(!allowed(&at("mailto:someone@example.com")));
        assert!(!allowed(&at("data:text/html,<p>hi")));
    }

    #[test]
    fn the_app_is_not_a_page() {
        assert!(!allowed(&at("http://tauri.localhost/index.html")));
        assert!(!allowed(&at("https://TAURI.localhost/")));
        assert!(!allowed(&at("http://ipc.localhost/notes")));
        assert!(!allowed(&at("http://asset.localhost/a.png")));
    }

    #[test]
    fn the_source_of_a_page_is_that_page() {
        assert!(allowed(&at("view-source:https://example.com/a?b=1")));
        assert_eq!(
            handed_over(&at("view-source:https://example.com/a")),
            Some("view-source:https://example.com/a".to_string())
        );
        assert!(!allowed(&at("view-source:file:///C:/notes/Idea.md")));
        assert!(!allowed(&at("view-source:http://tauri.localhost/")));
        assert!(!allowed(&at(
            "view-source:view-source:https://example.com/"
        )));
        assert!(!allowed(&at("view-source:")));
    }

    #[test]
    fn a_window_the_page_asked_for_is_a_page_or_is_nothing() {
        assert_eq!(
            handed_over(&at("https://example.com/a")),
            Some("https://example.com/a".to_string())
        );

        assert!(handed_over(&at("orden://command?id=record")).is_none());
        assert!(handed_over(&at("file:///C:/notes/Idea.md")).is_none());
        assert!(handed_over(&at("smb://example.com/share")).is_none());
        assert!(handed_over(&at("ms-officecmd:x")).is_none());
        assert!(handed_over(&at("http://tauri.localhost/index.html")).is_none());
    }

    #[test]
    fn a_trail_remembers_where_it_has_been() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        assert!(!trail.back());
        assert!(!trail.forward());

        trail.visited("https://b.example/");
        assert!(trail.back());
        assert!(!trail.forward());
    }

    #[test]
    fn the_same_page_again_is_not_a_step() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://a.example/");
        assert!(!trail.back());
        assert_eq!(trail.urls.len(), 1);
    }

    #[test]
    fn a_step_back_moves_along_the_trail_rather_than_adding_to_it() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://b.example/");
        trail.visited("https://a.example/");

        assert_eq!(trail.at, 0);
        assert_eq!(trail.urls.len(), 2);
        assert!(!trail.back());
        assert!(trail.forward());
    }

    #[test]
    fn somewhere_new_forgets_what_was_ahead() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://b.example/");
        trail.visited("https://a.example/");
        trail.visited("https://c.example/");

        assert_eq!(trail.urls, ["https://a.example/", "https://c.example/"]);
        assert!(trail.back());
        assert!(!trail.forward());
    }

    #[test]
    fn a_row_of_the_history_is_a_jump_that_keeps_the_trail() {
        let tabs = WebTabs::default();
        tabs.restore("t", vec!["https://a.example/".into()], 0);
        for url in ["https://b.example/", "https://c.example/"] {
            tabs.walked("t", url);
        }

        assert_eq!(tabs.stepping("t", -2), None);
        tabs.walked("t", "https://a.example/");
        assert_eq!(
            tabs.walk("t"),
            (
                vec![
                    "https://a.example/".to_string(),
                    "https://b.example/".to_string(),
                    "https://c.example/".to_string(),
                ],
                0,
            )
        );

        assert_eq!(tabs.stepping("t", -1), None);
        assert_eq!(tabs.stepping("t", 3), None);
        assert_eq!(tabs.walk("t").1, 0);
    }

    #[test]
    fn a_revived_page_jumps_by_address() {
        let tabs = WebTabs::default();
        tabs.restore(
            "t",
            vec![
                "https://a.example/".into(),
                "https://b.example/".into(),
                "https://c.example/".into(),
            ],
            2,
        );

        assert_eq!(
            tabs.stepping("t", -2),
            Some("https://a.example/".to_string())
        );
        tabs.walked("t", "https://a.example/");
        assert_eq!(tabs.walk("t").0.len(), 3);
        assert_eq!(
            tabs.stepping("t", 1),
            Some("https://b.example/".to_string())
        );
    }

    #[test]
    fn orden_s_page_scripts_leave_the_page_s_world_alone() {
        for scripts in [
            opening(None, "https://a.example/page", true),
            opening(
                Some(Place { x: 0.0, y: 940.0 }),
                "https://a.example/page",
                true,
            ),
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
    fn a_page_on_chromium_is_handed_the_keys_script_and_nothing_else() {
        assert_eq!(
            opening(None, "https://a.example/page", true),
            format!(
                "{};\n{};\n{};\n{}{};\n",
                crate::web_opens::script(),
                crate::web_swipe::script(),
                crate::web_media::script(),
                if cfg!(windows) {
                    format!("{};\n", super::bars())
                } else {
                    String::new()
                },
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
        assert_eq!(
            opening(None, "https://a.example/page", false).contains(script),
            cfg!(windows)
        );
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
    fn a_window_no_one_heard_asked_for_is_blocked_not_opened() {
        let unheard = crate::web_opens::Heard::UNHEARD;
        assert_eq!(
            becomes(
                &at("https://a.example/opened"),
                false,
                unheard.said.is_some(),
                unheard.unasked
            ),
            Becomes::Blocked("https://a.example/opened".to_string())
        );
    }

    #[test]
    fn nobody_opens_a_tab_on_the_blank_page() {
        assert!(address(BLANK).is_err());
        assert!(handed_over(&at(BLANK)).is_none());
    }

    #[test]
    fn a_revived_page_carries_the_place_it_was_left_at() {
        let opened = opening(None, "https://a.example/page", true);
        assert!(!opened.contains("__PLACE__"));
        assert!(!opened.contains("scrollTo"));

        let revived = opening(
            Some(Place { x: 0.0, y: 940.0 }),
            "https://a.example/page",
            true,
        );
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
    fn a_private_tab_s_popup_is_private() {
        let source = include_str!("web_tabs.rs");
        let popup = source
            .split("fn popup(")
            .nth(1)
            .and_then(|from| from.split("\n}\n").next())
            .expect("the popup's function");
        assert!(popup.contains(".incognito(private)"));
    }

    #[test]
    fn a_page_s_waiting_dialog_is_let_go_before_it_is_sent_anywhere() {
        let source = include_str!("web_tabs.rs");
        for (command, moves) in [
            ("pub fn web_navigate(", ".navigate(at)"),
            ("pub fn web_step(", "view.reload()"),
        ] {
            let body = source
                .split(command)
                .nth(1)
                .and_then(|from| from.split("\n}\n").next())
                .expect("the command");
            let dismissed = body.find("web_dialogs::dismiss(").expect("dialogs let go");
            assert!(dismissed < body.find(moves).expect("the move"), "{command}");
        }
    }

    #[test]
    fn a_page_s_waiting_question_is_let_go_when_it_leaves_or_closes() {
        let source = include_str!("web_tabs.rs");
        let close = source
            .split("pub async fn web_close(")
            .nth(1)
            .and_then(|from| from.split("\n}\n").next())
            .expect("the close");
        assert!(close.contains("ask::forget(&named)"));
    }

    #[test]
    fn a_tab_is_told_from_its_page_s_label() {
        assert_eq!(tab_of("web-a1").as_deref(), Some("a1"));
        assert_eq!(tab_of("main"), None);
    }

    #[test]
    fn a_page_that_could_not_be_built_gives_the_tab_back() {
        let tabs = WebTabs::default();

        assert!(tabs.claim("a"));
        tabs.built("a");
        assert!(tabs.claim("a"));
    }

    #[test]
    fn the_trail_is_kept_for_the_tab_that_walked_it() {
        let tabs = WebTabs::default();

        tabs.walked("a", "https://a.example/");
        tabs.walked("a", "https://b.example/");
        tabs.walked("b", "https://c.example/");

        let trails = tabs.trails.lock().expect("the trails");
        assert!(trails["a"].back());
        assert!(!trails["b"].back());
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
