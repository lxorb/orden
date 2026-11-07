use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, Webview, WebviewBuilder,
    WebviewUrl,
};

pub(crate) const LABEL: &str = "web-";

#[cfg(any(windows, target_os = "macos", feature = "cef"))]
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

#[cfg_attr(
    not(any(windows, target_os = "macos", feature = "cef")),
    allow(
        dead_code,
        reason = "only the engines whose cookies are given an expiry ask"
    )
)]
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

const CHOSEN: &str = "nib://web-chosen";

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

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 has agent tabs to show")
)]
pub(crate) fn hand_page_to(app: &AppHandle, tab: &str, label: &str, store: Option<String>) {
    if let Ok(mut held) = ADOPTED.lock() {
        held.get_or_insert_with(HashMap::new)
            .insert(tab.to_string(), label.to_string());
    }
    listening(app, tab, store, None);
    #[cfg(all(windows, not(feature = "cef")))]
    reported(app, tab, label);
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's loads and title are WebView2's own events, reached through its COM interfaces"
)]
fn reported(app: &AppHandle, tab: &str, label: &str) {
    use webview2_com::{
        DocumentTitleChangedEventHandler, NavigationCompletedEventHandler,
        NavigationStartingEventHandler,
    };
    use windows_core::PWSTR;

    let Some(view) = app.get_webview(label) else {
        return;
    };
    let (app, tab, label) = (app.clone(), tab.to_string(), label.to_string());
    let _ = view.with_webview(move |platform| {
        let said = |app: &AppHandle, tab: &str, label: &str, url: String, title: Option<String>| {
            if let Some(view) = app.get_webview(label) {
                say(app, &view, tab, &url, title, false);
            }
        };
        let starting = {
            let (app, tab) = (app.clone(), tab.clone());
            NavigationStartingEventHandler::create(Box::new(move |_, _| {
                started(&app, &tab);
                Ok(())
            }))
        };
        let ended = {
            let (app, tab, label) = (app.clone(), tab.clone(), label.clone());
            NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                let mut url = PWSTR::null();
                let url = sender.and_then(|core| unsafe {
                    core.Source(&raw mut url).ok()?;
                    Some(webview2_com::take_pwstr(url))
                });
                said(&app, &tab, &label, url.unwrap_or_default(), None);
                Ok(())
            }))
        };
        let titled = {
            let (app, tab, label) = (app.clone(), tab.clone(), label.clone());
            DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                let (mut url, mut title) = (PWSTR::null(), PWSTR::null());
                let read = sender.and_then(|core| unsafe {
                    core.Source(&raw mut url).ok()?;
                    core.DocumentTitle(&raw mut title).ok()?;
                    Some((
                        webview2_com::take_pwstr(url),
                        webview2_com::take_pwstr(title),
                    ))
                });
                if let Some((url, title)) = read {
                    said(&app, &tab, &label, url, Some(title));
                }
                Ok(())
            }))
        };
        unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let mut token = 0i64;
                let _ = core.add_NavigationStarting(&starting, &raw mut token);
                let _ = core.add_NavigationCompleted(&ended, &raw mut token);
                let _ = core.add_DocumentTitleChanged(&titled, &raw mut token);
            }
        }
    });
}

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 has agent tabs to show")
)]
pub(crate) fn opened_from_adopted(app: &AppHandle, label: &str, url: &str) {
    let tab = ADOPTED.lock().ok().and_then(|held| {
        held.as_ref()?
            .iter()
            .find(|(_, one)| *one == label)
            .map(|(tab, _)| tab.clone())
    });
    let (Some(tab), Ok(parsed)) = (tab, url.parse::<Url>()) else {
        return;
    };
    let Some(address) = handed_over(&parsed) else {
        return;
    };
    let holder = app.get_webview(label).map_or_else(
        || MAIN.to_string(),
        |view| view.window().label().to_string(),
    );
    let _ = app.emit_to(
        &holder,
        OPENED,
        Opening {
            tab,
            url: address,
            behind: false,
        },
    );
}

fn unadopt(tab: &str) {
    if let Ok(mut held) = ADOPTED.lock() {
        if let Some(all) = held.as_mut() {
            all.remove(tab);
        }
    }
}

const MAIN: &str = "main";

const MOVED: &str = "nib://web-tab";

#[cfg_attr(
    any(not(any(windows, target_os = "macos")), feature = "cef"),
    allow(dead_code)
)]
const ASKED: &str = "nib://web-ask";

const OPENED: &str = "nib://web-open";

const BLOCKED: &str = "nib://web-blocked";

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
    #[cfg(any(windows, target_os = "macos", feature = "cef"))]
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

#[cfg(not(feature = "cef"))]
const POPUP: &str = "popup-";

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

#[cfg_attr(
    any(not(any(windows, target_os = "macos")), feature = "cef"),
    allow(dead_code)
)]
#[derive(Clone, Serialize)]
struct Asked {
    tab: String,
    id: u64,
    origin: String,
    kind: String,
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

pub(crate) fn allowed(url: &Url) -> bool {
    if url.scheme() == "view-source" {
        return url
            .as_str()
            .strip_prefix("view-source:")
            .and_then(|inner| Url::parse(inner).ok())
            .is_some_and(|inner| inner.scheme() != "view-source" && allowed(&inner));
    }

    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }

    !app_host(url.host_str().unwrap_or_default())
}

pub(crate) fn app_host(host: &str) -> bool {
    matches!(
        host.trim_end_matches('.').to_ascii_lowercase().as_str(),
        "tauri.localhost" | "ipc.localhost" | "asset.localhost" | "nib.localhost"
    )
}

pub(crate) fn tab_may_open(url: &Url) -> bool {
    allowed(url) || crate::extensions::ours(url)
}

#[cfg_attr(
    not(all(target_os = "macos", not(feature = "cef"))),
    allow(dead_code, reason = "only WKWebView asks about a frame's navigation")
)]
pub(crate) fn frame_may_open(url: &Url) -> bool {
    match url.scheme() {
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        "data" => true,
        "blob" => {
            Url::parse(url.path()).is_ok_and(|inner| inner.scheme() != "blob" && allowed(&inner))
        }
        _ => tab_may_open(url),
    }
}

pub(crate) fn open_as_tab(app: &AppHandle, window: &str, tab: &str, url: &Url) {
    let payload = Opening {
        tab: tab.to_string(),
        url: url.to_string(),
        behind: false,
    };
    let _ = app.emit_to(window, OPENED, payload);
}

#[cfg(feature = "cef")]
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Becomes {
    Tab(String),
    Window,
    Blocked(String),
    Nothing,
}

pub(crate) fn becomes(url: &Url, sized: bool, said: bool, unasked: bool) -> Becomes {
    if said {
        return handed_over(url).map_or(Becomes::Nothing, Becomes::Tab);
    }
    if unasked {
        return handed_over(url).map_or(Becomes::Nothing, Becomes::Blocked);
    }
    if crate::extensions::ours(url) {
        return Becomes::Tab(url.to_string());
    }
    if sized || blank(url) || signs_in(url) {
        return Becomes::Window;
    }
    handed_over(url).map_or(Becomes::Nothing, Becomes::Tab)
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

const SIGNING_IN: &[&str] = &[
    "auth",
    "authorize",
    "authorization",
    "authenticate",
    "oidc",
    "openid",
    "saml",
    "saml2",
    "sso",
    "signin",
    "login",
    "logon",
    "consent",
    "3ds",
    "threeds",
    "challenge",
];

const SIGNING_IN_HOSTS: &[&str] = &[
    "accounts", "account", "auth", "login", "sso", "id", "secure",
];

fn signs_in(url: &Url) -> bool {
    let words = |text: &str| {
        text.to_ascii_lowercase()
            .split(|one: char| !one.is_ascii_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    let host = url.host_str().unwrap_or_default();
    let first = host
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let path = words(url.path());
    let said = |word: &str| SIGNING_IN.contains(&word) || word.starts_with("oauth");
    SIGNING_IN_HOSTS.contains(&first.as_str())
        || path.iter().any(|word| said(word))
        || path.windows(2).any(|pair| {
            matches!(
                (pair[0].as_str(), pair[1].as_str()),
                ("sign" | "log", "in" | "on")
            )
        })
}

fn blank(url: &Url) -> bool {
    url.scheme() == "about" && url.path() == "blank"
}

#[cfg(not(feature = "cef"))]
fn popup(
    app: &AppHandle,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
    tab: &str,
    holder: &str,
    private: bool,
) -> Option<tauri::WebviewWindow> {
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(1);

    let label = format!("{POPUP}{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let blank = Url::parse(BLANK).ok()?;
    let opening = app.clone();
    let asking = tab.to_string();
    let holding = holder.to_string();

    let building = tauri::WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank))
        .window_features(features)
        .incognito(private)
        .title(url.host_str().unwrap_or_default())
        .disable_drag_drop_handler()
        .on_navigation(allowed)
        .on_new_window(move |url, _| {
            if let Some(address) = handed_over(&url) {
                let payload = Opening {
                    tab: asking.clone(),
                    url: address,
                    behind: false,
                };
                let _ = opening.emit_to(&holding, OPENED, payload);
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        });

    let window = crate::placement::built(building).ok()?;

    #[cfg(windows)]
    {
        let closing = window.clone();
        let _ = crate::engine::with_platform!(window, move |platform| {
            crate::web_opens::closing(&platform, closing);
            crate::web_worlds::cleared(&platform, "", |cleared| {
                crate::trace::mark(&format!("web popup: {}", cleared.said()));
            });
        });
    }
    Some(window)
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

fn opening(place: Option<Place>, url: &str) -> String {
    let want = place.and_then(|one| {
        serde_json::to_string(&serde_json::json!({ "url": url, "x": one.x, "y": one.y })).ok()
    });

    #[cfg(all(windows, not(feature = "cef")))]
    let mut scripts = vec![
        crate::web_opens::SCRIPT.to_string(),
        crate::web_swipe::script().to_string(),
    ];
    #[cfg(feature = "cef")]
    let mut scripts = vec![
        crate::web_opens::script(),
        crate::web_swipe::script().to_string(),
        crate::web_media::script().to_string(),
    ];
    #[cfg(all(not(windows), not(feature = "cef")))]
    let mut scripts: Vec<String> = Vec::new();

    #[cfg(any(windows, feature = "cef", target_os = "macos"))]
    scripts.push(crate::web_pass::script().to_string());

    if let Some(one) = want {
        scripts.push(PLACE.replace("__PLACE__", &one));
    }

    scripts
        .iter()
        .flat_map(|one| [one.as_str(), ";\n"])
        .collect()
}

#[cfg(all(windows, not(feature = "cef")))]
mod session {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use webview2_com::BrowserProcessExitedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment, ICoreWebView2Environment5,
    };
    use windows_core::Interface as _;

    thread_local! {
        static ENV: RefCell<HashMap<String, (ICoreWebView2Environment, u32)>> =
            RefCell::new(HashMap::new());
    }

    fn key(store: Option<&str>) -> String {
        store.unwrap_or_default().to_string()
    }

    pub fn shared(store: Option<&str>) -> Option<ICoreWebView2Environment> {
        let named = key(store);
        let (env, browser) = ENV.with_borrow(|held| held.get(&named).cloned())?;
        if running(browser) {
            return Some(env);
        }
        ENV.with_borrow_mut(|held| held.remove(&named));
        None
    }

    #[allow(
        unsafe_code,
        reason = "whether the browser process still runs is Win32's to say"
    )]
    fn running(browser: u32) -> bool {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        const STILL_ACTIVE: u32 = 259;

        if browser == 0 {
            return true;
        }
        unsafe {
            let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, browser) else {
                return false;
            };
            let mut code = 0u32;
            let asked = GetExitCodeProcess(process, &raw mut code);
            let _ = CloseHandle(process);
            asked.is_err() || code == STILL_ACTIVE
        }
    }

    #[allow(
        unsafe_code,
        reason = "the browser process is named by WebView2's COM interface"
    )]
    fn browser_of(platform: &tauri::webview::PlatformWebview) -> u32 {
        let mut browser = 0u32;
        unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let _ = core.BrowserProcessId(&raw mut browser);
            }
        }
        browser
    }

    #[allow(
        unsafe_code,
        reason = "the process ending is WebView2's own event, reached through its COM interfaces"
    )]
    pub fn keep(store: Option<&str>, platform: &tauri::webview::PlatformWebview) {
        let env = platform.environment();
        let named = key(store);
        let browser = browser_of(platform);
        let fresh = ENV.with_borrow_mut(|held| {
            if held.contains_key(&named) {
                return false;
            }
            held.insert(named.clone(), (env.clone(), browser));
            true
        });

        if !fresh {
            return;
        }

        let kept = env.as_raw() as usize;
        let handler = BrowserProcessExitedEventHandler::create(Box::new(move |_env, _args| {
            ENV.with_borrow_mut(|held| {
                if held.get(&named).map(|(one, _)| one.as_raw() as usize) == Some(kept) {
                    held.remove(&named);
                }
            });
            Ok(())
        }));
        unsafe {
            if let Ok(env) = env.cast::<ICoreWebView2Environment5>() {
                let mut token = 0i64;
                let _ = env.add_BrowserProcessExited(&handler, &raw mut token);
            }
        }
    }

    pub fn answering(app: &tauri::AppHandle, store: Option<&str>) -> Result<(), String> {
        use tauri::Manager as _;
        let answers = store.is_some()
            || app
                .get_webview(ANCHOR)
                .is_none_or(|anchor| crate::web_answers::answers(&anchor));
        if answers {
            return Ok(());
        }
        crate::web_answers::said(app);
        Err(crate::web_answers::NOT_ANSWERING.to_owned())
    }

    const ANCHOR: &str = "web-session";

    pub fn anchor(window: &tauri::Window, app: &tauri::AppHandle) {
        use tauri::Manager as _;

        if window.app_handle().get_webview(ANCHOR).is_some() {
            return;
        }

        let Ok(blank) = super::BLANK.parse::<tauri::Url>() else {
            return;
        };

        let builder = tauri::WebviewBuilder::new(ANCHOR, tauri::WebviewUrl::External(blank))
            .focused(false)
            .disable_drag_drop_handler();

        let Ok(builder) = crate::engine::web_store(builder, app, None) else {
            return;
        };

        let made = crate::engine::add_child(
            window,
            builder,
            tauri::LogicalPosition::new(0.0, 0.0),
            tauri::LogicalSize::new(1.0, 1.0),
        );

        if let Ok(view) = made {
            let _ = view.hide();
            let _ = view.with_webview(|platform| keep(None, &platform));
        }
    }
}

fn page_built(
    window: &tauri::Window,
    builder: WebviewBuilder<crate::Engine>,
    pane: &Pane,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<(), String> {
    let _doing = crate::stall::doing("web_open: building the page");
    #[cfg(all(windows, not(feature = "cef")))]
    let builder = {
        session::answering(app, store)?;
        on_shared_session(builder, window, app, store)
    };
    #[cfg(not(all(windows, not(feature = "cef"))))]
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
    #[cfg(target_os = "macos")]
    crate::web_cut::under::lower(window, &view);
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

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) fn warm(app: &AppHandle) {
    let anchoring = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = anchoring.get_window(MAIN) {
            let _doing = crate::stall::doing("web_warm");
            session::anchor(&window, &anchoring);
            crate::trace::mark("web session warmed");
        }
    });
}

#[cfg(all(desktop, not(all(windows, not(feature = "cef")))))]
pub(crate) fn warm(_app: &AppHandle) {}

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) fn on_shared_session(
    builder: WebviewBuilder<tauri::Wry>,
    window: &tauri::Window,
    app: &AppHandle,
    store: Option<&str>,
) -> WebviewBuilder<tauri::Wry> {
    session::anchor(window, app);

    match session::shared(store) {
        Some(env) => builder.with_environment(env),
        None => builder,
    }
}

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) fn keep_session(store: Option<&str>, platform: &tauri::webview::PlatformWebview) {
    session::keep(store, platform);
}

#[derive(Debug, Default, Deserialize)]
pub struct Profile {
    store: Option<String>,
    #[serde(default)]
    private: bool,
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

    let scripts = crate::page_style::with(opening(revived.place, &url));
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

    #[cfg(all(windows, not(feature = "cef")))]
    let builder = builder.zoom_hotkeys_enabled(true);

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

    #[cfg(all(windows, not(feature = "cef")))]
    crate::web_wheel::arm();

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
    #[cfg(feature = "cef")]
    let _ = private;
    let opening = app.clone();
    let asking = tab.to_string();
    let holder = holder.to_string();
    builder.on_new_window(move |url: Url, features| {
        #[cfg(windows)]
        let hushed = crate::extensions::welcome::taken(&asking);
        let said = crate::web_opens::taken(&asking);
        if crate::web_opens::ours(&asking) {
            return NewWindowResponse::Deny;
        }
        #[cfg(windows)]
        if hushed {
            return NewWindowResponse::Deny;
        }

        let unasked = crate::web_opens::unasked(&asking);
        let sized = features.size().is_some() || features.position().is_some();
        let address = match becomes(&url, sized, said.is_some(), unasked) {
            Becomes::Nothing => return NewWindowResponse::Deny,
            Becomes::Blocked(address) => {
                popup_blocked(&opening, &holder, &asking, &address);
                return NewWindowResponse::Deny;
            }
            Becomes::Tab(address) => address,
            #[cfg(feature = "cef")]
            Becomes::Window => return NewWindowResponse::Allow,
            #[cfg(not(feature = "cef"))]
            Becomes::Window => {
                if let Some(window) = popup(&opening, &url, features, &asking, &holder, private) {
                    return NewWindowResponse::Create { window };
                }
                match handed_over(&url) {
                    Some(address) => address,
                    None => return NewWindowResponse::Deny,
                }
            }
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
    #[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
    let _ = private;
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

        #[cfg(all(any(windows, target_os = "macos"), not(feature = "cef")))]
        if !private {
            let _ = view.with_webview(|platform| crate::web_cookies::keep(&platform, || ()));
        }
        #[cfg(feature = "cef")]
        if !private {
            crate::web_cookies::keep(&view, || ());
        }

        #[cfg(all(not(windows), not(feature = "cef")))]
        {
            let marked = sending.clone();
            let named = moved.clone();
            let holder = view.window().label().to_string();
            let _ = view.eval_with_callback(crate::web_icons::ASK, move |answer| {
                let declaring = serde_json::from_str(&answer).unwrap_or_default();
                if let Some(icon) = crate::web_icons::best(&declaring) {
                    crate::web_icons::said(&marked, &holder, &named, &icon);
                }
            });
        }
        #[cfg(feature = "cef")]
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
    #[cfg(not(feature = "cef"))]
    {
        let _ = seen;
        view.url().map(|one| one.to_string()).unwrap_or_default()
    }
    #[cfg(feature = "cef")]
    {
        let _ = view;
        seen.lock().map(|last| last.clone()).unwrap_or_default()
    }
}

fn listening(app: &AppHandle, tab: &str, store: Option<String>, onward: Option<(Url, String)>) {
    #[cfg(not(all(windows, not(feature = "cef"))))]
    let _ = store;

    let Some(view) = app.get_webview(&label_of(tab)) else {
        return;
    };

    #[cfg(feature = "cef")]
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
            #[cfg(all(windows, not(feature = "cef")))]
            session::keep(store.as_deref(), &platform);
            #[cfg(all(windows, not(feature = "cef")))]
            crate::extensions::webview2::seen(&asking, store.as_deref(), &platform);
            #[cfg(windows)]
            crate::extensions::welcome::listen(&platform, store.as_deref(), &named);
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

            #[cfg(not(feature = "cef"))]
            if let Some((address, scripts)) = onward {
                crate::web_worlds::sent(&platform, address.as_str(), &scripts, |cleared| {
                    crate::trace::mark(&format!("web tab: {}", cleared.said()));
                });
            }
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

const OURS: [&str; 2] = ["http://tauri.localhost", "tauri://localhost"];

fn origin_of(url: &str) -> String {
    match url.find("://") {
        Some(at) => match url[at + 3..].find('/') {
            Some(end) => url[..at + 3 + end].to_lowercase(),
            None => url.to_lowercase(),
        },
        None => String::new(),
    }
}

#[cfg_attr(
    any(not(any(windows, target_os = "macos")), feature = "cef"),
    allow(
        dead_code,
        reason = "only the WebView2 and WKWebView handlers ask this; see `own` in `ask`"
    )
)]
fn is_ours(known: &[String], asked: &str) -> bool {
    let origin = origin_of(asked);
    if origin.is_empty() {
        return false;
    }

    OURS.contains(&origin.as_str()) || known.contains(&origin)
}

#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
fn capture_kinds(kind: isize) -> &'static [&'static str] {
    match kind {
        0 => &["camera"],
        1 => &["microphone"],
        2 => &["camera", "microphone"],
        _ => &[],
    }
}

#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
pub(crate) fn origin_written(protocol: &str, host: &str, port: isize) -> String {
    if port > 0 {
        format!("{protocol}://{host}:{port}")
    } else {
        format!("{protocol}://{host}")
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

    let _ = app.emit_to(view.window().label(), MOVED, payload);
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

    #[cfg(all(windows, not(feature = "cef")))]
    if crate::web_visual::is_drawn_under(view.label()) {
        crate::web_visual::visual_corner(&view, corner.unwrap_or(0.0), scale);
        crate::web_visual::visual_opacity(&view, opacity.unwrap_or(1.0));
    }
    #[cfg(target_os = "macos")]
    crate::web_cut::under::opacity(&view, opacity.unwrap_or(1.0));
    #[cfg(not(any(all(windows, not(feature = "cef")), target_os = "macos")))]
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
    #[cfg(feature = "cef")]
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

    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    return view
        .with_webview(|platform| {
            if let Err(error) = crate::pdf::print_sheet(&platform) {
                eprintln!("web_print: {error}");
            }
        })
        .map_err(|error| format!("that page could not be printed: {error}"));

    #[cfg(not(all(target_os = "macos", not(feature = "cef"))))]
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

#[cfg(feature = "cef")]
async fn in_our_world(view: &Webview, script: &str) -> Option<serde_json::Value> {
    let (view, script) = (view.clone(), script.to_string());
    tauri::async_runtime::spawn_blocking(move || crate::web_worlds::value(&view, &script))
        .await
        .ok()
        .flatten()
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's world is reached through WebView2's COM interfaces"
)]
async fn in_our_world(view: &Webview, script: &str) -> Option<serde_json::Value> {
    let (sending, mut waiting) = tauri::async_runtime::channel::<Option<String>>(1);
    let script = script.to_string();

    view.with_webview(
        move |platform| match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => crate::web_worlds::evaluate(&core, script, move |answer| {
                let _ = sending.try_send(answer);
            }),
            Err(_) => {
                let _ = sending.try_send(None);
            }
        },
    )
    .ok()?;

    let answer = waiting.recv().await.flatten()?;
    serde_json::from_str::<serde_json::Value>(&answer)
        .ok()?
        .pointer("/result/value")
        .cloned()
}

#[cfg(all(not(windows), not(feature = "cef")))]
#[allow(
    clippy::unused_async,
    reason = "the same call as on the engines that do wait for a world"
)]
async fn in_our_world(_view: &Webview, _script: &str) -> Option<serde_json::Value> {
    None
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
            crate::web_pass::forget(&named);
            crate::keyboard::closed(view.label());
            crate::web_follow::unfollow(view.label());
            crate::web_cut::uncut(view.label());
            #[cfg(feature = "cef")]
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

#[cfg(feature = "cef")]
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

#[cfg(not(feature = "cef"))]
async fn photographed(view: Webview) -> Result<Option<String>, String> {
    let (sending, mut waiting) = tauri::async_runtime::channel::<Option<Vec<u8>>>(1);

    let asked = view.with_webview(move |platform| {
        let answering = sending.clone();
        if let Err(error) = shot::photograph(&platform, sending) {
            eprintln!("web_shot: {error}");
            let _ = answering.try_send(None);
        }
    });

    if asked.is_err() {
        return Ok(None);
    }

    let bytes = waiting.recv().await.flatten();
    Ok(bytes.map(|one| {
        use base64::Engine as _;
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(one)
        )
    }))
}

#[tauri::command]
pub fn web_answer(app: AppHandle, id: u64, allow: bool) {
    let _ = app.run_on_main_thread(move || ask::answer(id, allow));
}

pub(crate) fn close_page(app: &AppHandle, tab: &str) {
    if let Some(view) = app.get_webview(&label_of(tab)) {
        #[cfg(feature = "cef")]
        let_go(view.label());
        crate::keyboard::closed(view.label());
        crate::web_follow::unfollow(view.label());
        crate::web_cut::uncut(view.label());
        let _ = view.close();
    }
}

#[cfg(feature = "cef")]
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

#[cfg(all(windows, not(feature = "cef")))]
mod ask {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION,
        COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES,
        COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS,
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS,
        COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DENY,
    };
    use webview2_com::PermissionRequestedEventHandler;

    use super::{Asked, ASKED};

    struct Waiting {
        args: ICoreWebView2PermissionRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    thread_local! {
        static WAITING: RefCell<HashMap<u64, Waiting>> = RefCell::new(HashMap::new());
    }

    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn named(kind: COREWEBVIEW2_PERMISSION_KIND) -> Option<&'static str> {
        match kind {
            COREWEBVIEW2_PERMISSION_KIND_CAMERA => Some("camera"),
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => Some("microphone"),
            COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => Some("location"),
            COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => Some("notifications"),
            COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => Some("clipboard"),
            COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS => Some("sensors"),
            COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS => Some("downloads"),
            COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS => Some("fonts"),
            COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES => Some("midi"),
            COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT => Some("windows"),
            _ => None,
        }
    }

    #[allow(
        unsafe_code,
        reason = "a permission request is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };

            let handler =
                PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };

                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                    if args.PermissionKind(&raw mut kind).is_err() {
                        return Ok(());
                    }
                    let Some(kind) = named(kind) else {
                        let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                        return Ok(());
                    };

                    let mut uri = windows_core::PWSTR::null();
                    if args.Uri(&raw mut uri).is_err() {
                        return Ok(());
                    }
                    let origin = webview2_com::take_pwstr(uri);

                    let Ok(deferral) = args.GetDeferral() else {
                        return Ok(());
                    };

                    let id = NEXT.fetch_add(1, Ordering::Relaxed);
                    WAITING.with_borrow_mut(|held| {
                        held.insert(
                            id,
                            Waiting {
                                args: args.clone(),
                                deferral,
                            },
                        );
                    });

                    let _ = app.emit_to(
                        window.as_str(),
                        ASKED,
                        Asked {
                            tab: tab.clone(),
                            id,
                            origin,
                            kind: kind.to_string(),
                        },
                    );

                    Ok(())
                }));

            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &raw mut token);
        }
    }

    #[allow(
        unsafe_code,
        reason = "a permission request is one of WebView2's own events, and its objects are reached through COM"
    )]
    pub fn own(webview: &PlatformWebview, ours: Vec<String>) {
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };

            let handler =
                PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };

                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                    if args.PermissionKind(&raw mut kind).is_err() {
                        return Ok(());
                    }

                    let mut uri = windows_core::PWSTR::null();
                    if args.Uri(&raw mut uri).is_err() {
                        return Ok(());
                    }
                    let origin = webview2_com::take_pwstr(uri);

                    let mine = super::is_ours(&ours, &origin);
                    let asked_for = matches!(
                        kind,
                        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                            | COREWEBVIEW2_PERMISSION_KIND_CAMERA
                    );
                    let allow = mine && asked_for;

                    crate::trace::mark(&format!(
                        "microphone: {origin} asked for {kind:?} and was {}",
                        if allow { "allowed" } else { "refused" }
                    ));

                    let _ = args.SetState(if allow {
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW
                    } else {
                        COREWEBVIEW2_PERMISSION_STATE_DENY
                    });

                    Ok(())
                }));

            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &raw mut token);
        }
    }

    #[allow(
        unsafe_code,
        reason = "the request and its deferral are WebView2's own objects"
    )]
    pub fn answer(id: u64, allow: bool) {
        let Some(waiting) = WAITING.with_borrow_mut(|held| held.remove(&id)) else {
            return;
        };

        unsafe {
            let _ = waiting.args.SetState(if allow {
                COREWEBVIEW2_PERMISSION_STATE_ALLOW
            } else {
                COREWEBVIEW2_PERMISSION_STATE_DENY
            });
            let _ = waiting.deferral.Complete();
        }
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod ask {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU64, Ordering};

    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject, Sel};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
    use objc2_foundation::{MainThreadMarker, NSObjectProtocol};
    use objc2_web_kit::{
        WKFrameInfo, WKMediaCaptureType, WKPermissionDecision, WKSecurityOrigin, WKUIDelegate,
        WKWebView,
    };
    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Emitter};

    use super::{Asked, ASKED};

    enum Answering {
        Tab {
            app: AppHandle,
            tab: String,
            window: String,
        },
        Own {
            ours: Vec<String>,
        },
    }

    struct Held {
        inner: Option<Retained<ProtocolObject<dyn WKUIDelegate>>>,
        answering: Answering,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "NibWebCaptureDelegate"]
        #[ivars = Held]
        struct Gate;

        unsafe impl NSObjectProtocol for Gate {}

        unsafe impl WKUIDelegate for Gate {
            #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
            fn request_media_capture_permission(
                &self,
                _webview: &WKWebView,
                _origin: &WKSecurityOrigin,
                frame: &WKFrameInfo,
                kind: WKMediaCaptureType,
                decide: &DynBlock<dyn Fn(WKPermissionDecision)>,
            ) {
                requested(&self.ivars().answering, frame, kind, decide);
            }
        }

        impl Gate {
            #[unsafe(method(respondsToSelector:))]
            fn responds_to_selector(&self, selector: Sel) -> bool {
                forwards(self, selector)
            }

            #[unsafe(method(forwardingTargetForSelector:))]
            fn forwarding_target_for_selector(&self, _selector: Sel) -> *mut AnyObject {
                self.ivars()
                    .inner
                    .as_ref()
                    .map_or(std::ptr::null_mut(), |inner| {
                        Retained::as_ptr(inner).cast::<AnyObject>().cast_mut()
                    })
            }
        }
    );

    #[allow(
        unsafe_code,
        reason = "the superclass's own answer is asked for through the Objective-C runtime"
    )]
    fn forwards(gate: &Gate, selector: Sel) -> bool {
        let own: bool = unsafe { msg_send![super(gate), respondsToSelector: selector] };
        own || gate
            .ivars()
            .inner
            .as_ref()
            .is_some_and(|inner| inner.respondsToSelector(selector))
    }

    struct Waiting {
        decide: RcBlock<dyn Fn(WKPermissionDecision)>,
        then: Option<&'static str>,
        origin: String,
        app: AppHandle,
        tab: String,
        window: String,
    }

    thread_local! {
        static WAITING: RefCell<HashMap<u64, Waiting>> = RefCell::new(HashMap::new());
    }

    static NEXT: AtomicU64 = AtomicU64::new(1);

    static KEPT: u8 = 0;

    #[allow(
        unsafe_code,
        reason = "a frame's security origin is read through the Objective-C runtime"
    )]
    fn origin_of(frame: &WKFrameInfo) -> String {
        unsafe {
            let origin = frame.securityOrigin();
            super::origin_written(
                &origin.protocol().to_string(),
                &origin.host().to_string(),
                origin.port(),
            )
        }
    }

    fn requested(
        answering: &Answering,
        frame: &WKFrameInfo,
        kind: WKMediaCaptureType,
        decide: &DynBlock<dyn Fn(WKPermissionDecision)>,
    ) {
        let origin = origin_of(frame);
        let asked = super::capture_kinds(kind.0);

        match answering {
            Answering::Own { ours } => {
                let allow = !asked.is_empty() && super::is_ours(ours, &origin);
                crate::trace::mark(&format!(
                    "microphone: {origin} asked for {asked:?} and was {}",
                    if allow { "allowed" } else { "refused" }
                ));
                decide.call((if allow {
                    WKPermissionDecision::Grant
                } else {
                    WKPermissionDecision::Deny
                },));
            }
            Answering::Tab { app, tab, window } => {
                let Some((first, rest)) = asked.split_first() else {
                    decide.call((WKPermissionDecision::Deny,));
                    return;
                };

                hold(
                    Waiting {
                        decide: decide.copy(),
                        then: rest.first().copied(),
                        origin,
                        app: app.clone(),
                        tab: tab.clone(),
                        window: window.clone(),
                    },
                    first,
                );
            }
        }
    }

    fn hold(waiting: Waiting, kind: &str) {
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let said = Asked {
            tab: waiting.tab.clone(),
            id,
            origin: waiting.origin.clone(),
            kind: kind.to_string(),
        };
        let (app, window) = (waiting.app.clone(), waiting.window.clone());

        WAITING.with_borrow_mut(|held| held.insert(id, waiting));
        if app.emit_to(window.as_str(), ASKED, said).is_err() {
            answer(id, false);
        }
    }

    #[allow(
        unsafe_code,
        reason = "a WKWebView's UI delegate is set, and kept alive, through the Objective-C runtime"
    )]
    fn guard(webview: &PlatformWebview, answering: Answering) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };

        let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
            return;
        };

        unsafe {
            let inner = view.UIDelegate();
            let gate = Gate::alloc(mtm).set_ivars(Held { inner, answering });
            let gate: Retained<Gate> = msg_send![super(gate), init];

            view.setUIDelegate(Some(ProtocolObject::from_ref(&*gate)));
            objc2::ffi::objc_setAssociatedObject(
                Retained::as_ptr(&view).cast::<AnyObject>().cast_mut(),
                (&raw const KEPT).cast::<c_void>(),
                Retained::as_ptr(&gate).cast::<AnyObject>().cast_mut(),
                objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
        }
    }

    pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
        guard(webview, Answering::Tab { app, tab, window });
    }

    pub fn own(webview: &PlatformWebview, ours: Vec<String>) {
        guard(webview, Answering::Own { ours });
    }

    pub fn answer(id: u64, allow: bool) {
        let Some(mut waiting) = WAITING.with_borrow_mut(|held| held.remove(&id)) else {
            return;
        };

        if allow {
            if let Some(next) = waiting.then.take() {
                hold(waiting, next);
                return;
            }
        }

        waiting.decide.call((if allow {
            WKPermissionDecision::Grant
        } else {
            WKPermissionDecision::Deny
        },));
    }
}

#[cfg(any(not(any(windows, target_os = "macos")), feature = "cef"))]
mod ask {
    use tauri::webview::PlatformWebview;
    use tauri::AppHandle;

    pub fn listen(_webview: &PlatformWebview, _app: AppHandle, _tab: String, _window: String) {}

    pub fn own(_webview: &PlatformWebview, _ours: Vec<String>) {}

    pub fn answer(_id: u64, _allow: bool) {}
}

#[cfg(all(windows, not(feature = "cef")))]
mod shot {
    use tauri::async_runtime::Sender;
    use tauri::webview::PlatformWebview;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows_com::Win32::Foundation::HGLOBAL;
    use windows_com::Win32::System::Com::{
        IStream, StructuredStorage::CreateStreamOnHGlobal, STREAM_SEEK_END, STREAM_SEEK_SET,
    };

    #[allow(
        unsafe_code,
        reason = "CapturePreview is reached through WebView2's COM interfaces, and the picture comes back in a COM stream"
    )]
    pub fn photograph(
        webview: &PlatformWebview,
        done: Sender<Option<Vec<u8>>>,
    ) -> Result<(), String> {
        unsafe {
            let core = webview
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;

            let stream: IStream = CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true)
                .map_err(|error| error.to_string())?;

            let reading = stream.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let bytes = match result {
                    Err(_) => None,
                    Ok(()) => png(&reading),
                };
                let _ = done.try_send(bytes);
                Ok(())
            }));

            core.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            )
            .map_err(|error| error.to_string())
        }
    }

    #[allow(unsafe_code, reason = "a COM stream is read through its own interface")]
    pub fn png(stream: &IStream) -> Option<Vec<u8>> {
        unsafe {
            let mut end = 0u64;
            stream.Seek(0, STREAM_SEEK_END, Some(&raw mut end)).ok()?;
            stream.Seek(0, STREAM_SEEK_SET, None).ok()?;

            let size = usize::try_from(end).ok()?;
            if size == 0 || size > 32 * 1024 * 1024 {
                return None;
            }

            let mut bytes = vec![0u8; size];
            let mut read = 0u32;
            let got = stream.Read(
                bytes.as_mut_ptr().cast(),
                u32::try_from(size).ok()?,
                Some(&raw mut read),
            );
            if got.is_err() {
                return None;
            }

            bytes.truncate(usize::try_from(read).unwrap_or(0));
            (!bytes.is_empty()).then_some(bytes)
        }
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod shot {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;
    use tauri::async_runtime::Sender;
    use tauri::webview::PlatformWebview;

    const LARGEST: usize = 32 * 1024 * 1024;

    #[allow(
        unsafe_code,
        reason = "WKWebView's snapshot is reached through the Objective-C runtime, from the pointer wry hands out"
    )]
    pub fn photograph(
        webview: &PlatformWebview,
        done: Sender<Option<Vec<u8>>>,
    ) -> Result<(), String> {
        let view = unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }
            .ok_or("there is no page to photograph")?;

        let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
            let bytes = unsafe { image.as_ref() }.and_then(png);
            let _ = done.try_send(bytes);
        });

        unsafe { view.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
        Ok(())
    }

    #[allow(
        unsafe_code,
        reason = "a bitmap is encoded through AppKit's Objective-C interface"
    )]
    fn png(image: &NSImage) -> Option<Vec<u8>> {
        let tiff = image.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
        let data = unsafe {
            bitmap.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }?;

        let bytes = data.to_vec();
        (!bytes.is_empty() && bytes.len() <= LARGEST).then_some(bytes)
    }
}

#[cfg(all(windows, not(feature = "cef")))]
pub(crate) use shot::png as read_stream;

#[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
mod shot {
    use tauri::async_runtime::Sender;
    use tauri::webview::PlatformWebview;

    #[allow(
        clippy::unnecessary_wraps,
        reason = "the signature matches the Windows photograph, which does fail"
    )]
    pub fn photograph(
        _webview: &PlatformWebview,
        done: Sender<Option<Vec<u8>>>,
    ) -> Result<(), String> {
        let _ = done.try_send(None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        address, allowed, becomes, capture_kinds, frame_may_open, handed_over, is_ours, opening,
        origin_of, origin_written, reader, tab_of, Becomes, Place, Profile, Trail, WebTabs, BLANK,
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
        for refused in ["nib://open?x", "file:///etc/passwd", "javascript:alert(1)"] {
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
    fn the_window_own_page_is_the_app() {
        assert!(is_ours(&[], "http://tauri.localhost/"));
        assert!(is_ours(&[], "http://tauri.localhost"));
        assert!(is_ours(&[], "tauri://localhost/index.html"));
        let dev = vec!["http://localhost:1420".to_string()];
        assert!(is_ours(&dev, "http://localhost:1420/"));
    }

    #[test]
    fn and_nothing_else_is() {
        assert!(!is_ours(&[], "https://tauri.localhost/"));
        assert!(!is_ours(&[], "http://tauri.localhost.example.com/"));
        assert!(!is_ours(&[], "http://evil.example/"));
        let dev = vec!["http://localhost:1420".to_string()];
        assert!(!is_ours(&dev, "http://localhost:8080/"));
        assert!(!is_ours(&[], ""));
        assert!(!is_ours(&[], "about:blank"));
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
    fn a_security_origin_is_written_as_an_origin() {
        assert_eq!(
            origin_written("https", "example.com", 0),
            "https://example.com"
        );
        assert_eq!(
            origin_written("http", "localhost", 1420),
            "http://localhost:1420"
        );
        assert!(is_ours(&[], &origin_written("tauri", "localhost", 0)));
        assert!(!is_ours(&[], &origin_written("https", "evil.example", 0)));
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
    fn a_frame_holds_the_page_s_own_documents_and_nothing_a_tab_may_not_open() {
        for own in [
            "about:blank",
            "about:srcdoc",
            "data:text/html,<p>hi",
            "blob:https://example.com/4b1f-11",
            "https://example.com/embed",
        ] {
            assert!(frame_may_open(&at(own)), "{own}");
        }
        for never in [
            "about:preferences",
            "blob:file:///C:/x",
            "blob:http://tauri.localhost/1",
            "file:///C:/notes/Idea.md",
            "http://ipc.localhost/notes",
            "nib://open?path=a.md",
            "mailto:someone@example.com",
        ] {
            assert!(!frame_may_open(&at(never)), "{never}");
        }
        assert!(!allowed(&at("about:blank")));
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

        assert!(handed_over(&at("nib://command?id=record")).is_none());
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
    fn nib_s_page_scripts_leave_the_page_s_world_alone() {
        for scripts in [
            opening(None, "https://a.example/page"),
            opening(Some(Place { x: 0.0, y: 940.0 }), "https://a.example/page"),
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

    #[cfg(all(windows, not(feature = "cef")))]
    #[test]
    fn a_page_is_handed_the_keys_script_and_nothing_else() {
        assert_eq!(
            opening(None, "https://a.example/page"),
            format!(
                "{};\n{};\n{};\n",
                crate::web_opens::SCRIPT,
                crate::web_swipe::script(),
                crate::web_pass::script()
            )
        );
    }

    #[cfg(feature = "cef")]
    #[test]
    fn a_page_on_chromium_is_handed_the_keys_script_and_nothing_else() {
        assert_eq!(
            opening(None, "https://a.example/page"),
            format!(
                "{};
{};
{};
{};
",
                crate::web_opens::script(),
                crate::web_swipe::script(),
                crate::web_media::script(),
                crate::web_pass::script()
            )
        );
    }

    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    #[test]
    fn a_page_on_a_mac_is_handed_pass_s_script_alone() {
        assert_eq!(
            opening(None, "https://a.example/page"),
            format!("{};\n", crate::web_pass::script())
        );
    }

    #[test]
    fn nobody_opens_a_tab_on_the_blank_page() {
        assert!(address(BLANK).is_err());
        assert!(handed_over(&at(BLANK)).is_none());
    }

    #[test]
    fn a_revived_page_carries_the_place_it_was_left_at() {
        let opened = opening(None, "https://a.example/page");
        assert!(!opened.contains("__PLACE__"));
        assert!(!opened.contains("scrollTo"));

        let revived = opening(Some(Place { x: 0.0, y: 940.0 }), "https://a.example/page");
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
        assert!(said.contains("data-nib-selection"));
        assert!(said.contains("input[type=password]"));
        assert!(said.contains("removeAttribute('value')"));
    }
}
