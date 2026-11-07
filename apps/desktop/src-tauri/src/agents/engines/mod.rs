#[cfg(feature = "cef")]
pub mod cef;
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub mod webkit;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager as _, Webview};

use super::grants::Grant;
use super::keys::Key;
use super::policy::Facts;
use super::snapshot::{Part, Wanted};
use super::verbs::{
    Answer, Code, ConsoleLines, Cookie, FieldValue, Match, Picture, ReadAs, Requests, Store, Until,
};
use crate::pdf::PdfPage;

#[cfg(any(windows, feature = "cef"))]
pub use super::page::Element;
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub use webkit::Element;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReaderStore {
    Twin,
    Blocked,
}

pub const READER_STORE: ReaderStore = ReaderStore::Twin;

pub fn reader_store() -> ReaderStore {
    match std::env::var("ORDEN_AGENT_READER_STORE").as_deref() {
        Ok("blocked") => ReaderStore::Blocked,
        Ok("twin") => ReaderStore::Twin,
        _ => READER_STORE,
    }
}

const TWIN: &str = "agent__twin";

pub fn twin_of(reader: Option<&str>) -> String {
    match reader {
        None => TWIN.to_string(),
        Some(name) => format!("{TWIN}_{name}"),
    }
}

#[allow(
    clippy::option_option,
    reason = "no twin, and a twin of the store every space shares, are two different answers"
)]
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "WKWebView runs no extensions, so its pages need no twin"
    )
)]
pub fn reader_of(store: Option<&str>) -> Option<Option<&str>> {
    let rest = store?.strip_prefix(TWIN)?;
    if rest.is_empty() {
        return Some(None);
    }
    rest.strip_prefix('_')
        .filter(|one| !one.is_empty())
        .map(Some)
}

#[derive(Clone)]
pub enum View {
    Webview(Webview),
    #[cfg(feature = "cef")]
    Windowless(cef::Windowless),
}

impl View {
    pub fn label(&self) -> String {
        match self {
            View::Webview(view) => view.label().to_string(),
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.label().to_string(),
        }
    }

    pub fn url(&self) -> String {
        match self {
            View::Webview(view) => view.url().map(|one| one.to_string()).unwrap_or_default(),
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.url(),
        }
    }

    pub fn close(&self) {
        match self {
            View::Webview(view) => {
                let _ = view.close();
            }
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.close(),
        }
    }
}

pub fn view(app: &AppHandle, label: &str) -> Option<View> {
    #[cfg(feature = "cef")]
    if let Some(page) = cef::page(label) {
        return Some(View::Windowless(page));
    }
    app.get_webview(label).map(View::Webview)
}

pub fn forget(label: &str) {
    #[cfg(any(windows, feature = "cef"))]
    super::cdp::forget(label);
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    webkit::forget(label);
}

pub fn opened(label: &str, tab: &str) {
    #[cfg(any(windows, feature = "cef"))]
    super::cdp::heard(label)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .opened
        .push(tab.to_string());
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    webkit::opened(label, tab);
}

pub fn sleep_idle(app: &AppHandle) {
    #[cfg(any(windows, feature = "cef"))]
    super::cdp::sleep_idle(app);
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    let _ = app;
}

pub const TWINS: bool = cfg!(any(windows, feature = "cef"));

#[cfg(any(windows, feature = "cef"))]
pub const NAME: &str = if cfg!(windows) {
    "WebView2"
} else {
    "Chromium"
};
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub const NAME: &str = "WKWebView";

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "the other engine's table, which the test reads beside this one's"
    )
)]
pub const CDP_CANNOT: &[(&str, &str)] = &[];

#[cfg_attr(
    any(windows, feature = "cef"),
    allow(
        dead_code,
        reason = "the other engine's table, which the test reads beside this one's"
    )
)]
pub const WEBKIT_CANNOT: &[(&str, &str)] = &[
    (
        "browser_drag",
        "a drag on WKWebView is the system's own drag session, which only the real pointer starts: an agent's would take the reader's pointer",
    ),
    (
        "browser_upload",
        "WKWebView gives a file input its files only through the file panel a person picks them in, and Orden never opens one for an agent's page",
    ),
    (
        "browser_console",
        "WKWebView has no road to a page's console for an app: its Web Inspector's protocol is Safari's alone",
    ),
    (
        "browser_network",
        "WKWebView says nothing of a page's requests to an app: there is no protocol to its network log",
    ),
];

#[cfg(any(windows, feature = "cef"))]
const CANNOT: &[(&str, &str)] = CDP_CANNOT;
#[cfg(all(target_os = "macos", not(feature = "cef")))]
const CANNOT: &[(&str, &str)] = WEBKIT_CANNOT;

pub fn cannot(verb: &str) -> Option<&'static str> {
    CANNOT
        .iter()
        .find(|(name, _)| *name == verb)
        .map(|(_, why)| *why)
}

pub fn refused(verb: &str) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        format!(
            "{verb} is not available on {NAME}: {}",
            cannot(verb).unwrap_or("this engine has no way to do it")
        ),
    )
}

pub fn cut(text: String, most: usize) -> String {
    match text.char_indices().nth(most) {
        Some((at, _)) => text[..at].to_string(),
        None => text,
    }
}

pub const SETTLED: &str = r"(still, most) => new Promise((done) => {
  if (!document.body) return done(true)
  let quiet
  const watcher = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(end, still) })
  const end = () => { watcher.disconnect(); done(true) }
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  quiet = setTimeout(end, still)
  setTimeout(end, most)
})";

pub type Tree = (Vec<Part>, HashSet<(String, u64)>);

pub const UNREAD: u64 = 0;

pub fn left_a_part_out(secret: &HashSet<(String, u64)>) -> bool {
    secret.iter().any(|(_, node)| *node == UNREAD)
}

pub type Gate<'g> = &'g dyn Fn(&Element) -> Result<(), Answer>;

pub struct Page<'a> {
    pub view: &'a View,
    pub label: String,
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub own: bool,
    pub since: u64,
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub limits: Option<(Grant, Store)>,
    pub credentials: AtomicBool,
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub worlds: Mutex<HashMap<(Option<String>, String), i64>>,
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub frame_lists: Mutex<HashMap<Option<String>, Vec<String>>>,
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub worlds_renewed: AtomicBool,
}

impl Page<'_> {
    pub fn frame_may_be_acted_in(&self, facts: &Facts) -> Result<(), Answer> {
        acts_in(self.limits.as_ref(), facts)
    }

    pub fn grant_limits_sites(&self) -> bool {
        limits_sites(self.limits.as_ref())
    }
}

pub fn limits_sites(limits: Option<&(Grant, Store)>) -> bool {
    limits.is_some_and(|(grant, _)| !grant.sites.is_empty())
}

pub fn acts_in(limits: Option<&(Grant, Store)>, facts: &Facts) -> Result<(), Answer> {
    if facts.at.is_empty() && facts.opaque && limits_sites(limits) {
        return Err(Answer::error(
            Code::SiteDenied,
            "what is at that point says nothing of itself or of where it is: take a snapshot and press something else",
        ));
    }
    match limits {
        Some((grant, store)) => super::policy::frame_allowed(grant, &facts.at, *store)
            .map_err(|why| Answer::error(Code::SiteDenied, why)),
        None => Ok(()),
    }
}

#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(dead_code, reason = "WKWebView reads no frame by its address")
)]
pub fn frame_readable(limits: Option<&(Grant, Store)>, at: &[String]) -> bool {
    limits.is_none_or(|(grant, store)| super::policy::frame_allowed(grant, at, *store).is_ok())
}

pub fn from_allowed(limits: Option<&(Grant, Store)>, at: &[String]) -> Result<(), String> {
    let Some((grant, store)) = limits else {
        return Ok(());
    };
    let placed = at.iter().any(|one| {
        tauri::Url::parse(one)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host().is_some())
    });
    if !placed && limits_sites(limits) {
        return Err("the engine did not say which site that came from".into());
    }
    super::policy::frame_allowed(grant, at, *store)
}

impl Page<'_> {
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub fn may_touch_credentials(&self) -> bool {
        self.credentials.load(Ordering::Relaxed)
    }

    pub fn clear_credentials(&self) {
        self.credentials.store(true, Ordering::Relaxed);
    }

    pub fn refuse_secret(&self, facts: &Facts) -> Result<(), Answer> {
        if (facts.password() || facts.sign_in()) && !self.may_touch_credentials() {
            return Err(Answer::error(
                Code::PasswordField,
                "that is a sign-in, and this agent's mode asks before signing in",
            ));
        }
        Ok(())
    }

    pub fn may_press(&self, key: &Key) -> Result<(), Answer> {
        if let Some(facts) = self.active_facts()? {
            if facts.picker() && key.opens_a_picker() {
                return Err(Answer::error(
                    Code::BadArguments,
                    "that key would open a list of the engine's own: use browser_select or browser_fill_form",
                ));
            }
            if facts.password() && key.changes_words() && !self.may_touch_credentials() {
                return Err(Answer::error(
                    Code::PasswordField,
                    "the field with the keyboard is a password field, and this agent's mode asks before signing in",
                ));
            }
        }
        Ok(())
    }
}

pub trait Engine {
    fn wake(&self);
    fn url(&self) -> String;
    fn title(&self) -> String;
    fn element(&self, reference: &str) -> Result<Element, Answer>;
    fn element_at(&self, point: (f64, f64)) -> Result<Element, Answer>;
    fn facts(&self, element: &Element) -> Result<Facts, Answer>;
    fn facts_of_press(&self, element: &Element) -> Result<Facts, Answer>;
    fn at_first_point(&self, element: &Element) -> Result<Element, Answer>;
    fn aimed(&self, element: &Element) -> Result<Element, Answer>;
    fn may_act_in(&self, facts: &Facts) -> Result<(), Answer>;
    fn limits_sites(&self) -> bool;
    fn tick_changes(&self, element: &Element, wanted: bool) -> Result<bool, Answer>;
    fn active_facts(&self) -> Result<Option<Facts>, Answer>;
    fn navigate(&self, url: &str) -> Result<(), Answer>;
    fn step(&self, by: i64) -> Result<(), Answer>;
    fn wait(&self, until: &Until, most: Duration) -> Result<u64, Answer>;
    fn settle(&self, navigations_before: u64);
    fn navigations(&self) -> u64;
    fn opened(&self) -> Vec<String>;
    fn hosts(&self) -> Vec<String>;
    fn parts(&self) -> Result<Tree, Answer>;
    fn find(&self, wanted: &Wanted<'_>) -> Result<Vec<Match>, Answer>;
    fn read(&self, app: &AppHandle, shape: ReadAs) -> Result<(String, String, String), Answer>;
    fn clip(&self) -> Result<(String, String, String), Answer>;
    fn pdf(&self, paper: &PdfPage) -> Result<String, Answer>;
    fn click(
        &self,
        element: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer>;
    fn click_at(
        &self,
        point: (f64, f64),
        judged: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer>;
    fn hover(&self, element: &Element) -> Result<(), Answer>;
    fn type_text(&self, element: &Element, text: &str, replace: bool) -> Result<(), Answer>;
    fn press(&self, key: &Key) -> Result<(), Answer>;
    fn press_in_page(&self, key: &Key) -> Result<(), Answer>;
    fn scroll(&self, element: Option<&Element>, dx: f64, dy: f64) -> Result<(), Answer>;
    fn select(&self, element: &Element, values: &[String]) -> Result<Vec<String>, Answer>;
    fn fill(&self, element: &Element, value: &FieldValue, gate: Gate<'_>) -> Result<(), Answer>;
    fn drag(
        &self,
        from: (&Element, &Element),
        to: (&Element, &Element),
        gates: (Gate<'_>, Gate<'_>),
    ) -> Result<(), Answer>;
    fn upload(&self, element: &Element, files: &[String], gate: Gate<'_>) -> Result<(), Answer>;
    fn screenshot(
        &self,
        element: Option<&Element>,
        full: bool,
        scale: Option<f64>,
    ) -> Result<Picture, Answer>;
    fn console(&self, since: Option<u64>, level: Option<&str>) -> Result<ConsoleLines, Answer>;
    fn network(
        &self,
        since: Option<u64>,
        matching: Option<&str>,
        bodies: bool,
    ) -> Result<Requests, Answer>;
    fn evaluate(&self, expression: &str, page_world: bool) -> Result<Value, Answer>;
    fn cookies(&self) -> Result<Vec<Cookie>, Answer>;
    fn set_cookie(&self, cookie: &Cookie) -> Result<(), Answer>;
    fn clear(&self) -> Result<(), Answer>;
    fn local(&self) -> Result<Map<String, Value>, Answer>;
}

#[cfg(test)]
mod tests {
    use super::{
        acts_in, frame_readable, from_allowed, reader_of, twin_of, CDP_CANNOT, WEBKIT_CANNOT,
    };
    use crate::agents::grants::{Grant, SiteRule};
    use crate::agents::policy::Facts;
    use crate::agents::verbs::{Answer, Code, Store, NAMES};

    fn denying() -> (Grant, Store) {
        let mut grant = Grant::own("a".into(), "A");
        grant.sites.insert("bank.example".into(), SiteRule::Deny);
        (grant, Store::Reader)
    }

    fn at(addresses: &[&str]) -> Vec<String> {
        addresses.iter().map(|one| (*one).to_string()).collect()
    }

    #[test]
    fn a_frame_of_a_denied_site_is_not_acted_in_and_one_that_says_nothing_is_not_either() {
        let limits = denying();
        let facts = |addresses: &[&str], opaque: bool| Facts {
            at: at(addresses),
            opaque,
            ..Facts::default()
        };
        let refused = |facts: &Facts| {
            matches!(
                acts_in(Some(&limits), facts),
                Err(Answer::Error {
                    code: Code::SiteDenied,
                    ..
                })
            )
        };
        assert!(refused(&facts(&["https://bank.example/pay"], false)));
        assert!(refused(&facts(
            &["about:blank", "https://bank.example"],
            false
        )));
        assert!(refused(&facts(&[], true)));
        assert!(acts_in(Some(&limits), &facts(&["https://shop.example/"], false)).is_ok());
        assert!(acts_in(None, &facts(&["https://bank.example/"], false)).is_ok());
        assert!(acts_in(None, &facts(&[], true)).is_ok());
    }

    #[test]
    fn a_frame_of_a_denied_site_is_not_read() {
        let limits = denying();
        assert!(!frame_readable(
            Some(&limits),
            &at(&["https://bank.example/x"])
        ));
        assert!(!frame_readable(
            Some(&limits),
            &at(&["https://www.bank.example/x"])
        ));
        assert!(frame_readable(
            Some(&limits),
            &at(&["https://shop.example/"])
        ));
        assert!(frame_readable(None, &at(&["https://bank.example/"])));
    }

    #[test]
    fn what_a_frame_raised_or_said_is_the_agent_s_only_where_the_engine_placed_it() {
        let limits = denying();
        assert!(from_allowed(Some(&limits), &at(&["https://bank.example/"])).is_err());
        assert!(from_allowed(
            Some(&limits),
            &at(&["about:blank", "https://bank.example/"])
        )
        .is_err());
        assert!(from_allowed(Some(&limits), &at(&["https://shop.example/"])).is_ok());
        for nowhere in [&[][..], &["null"], &[":3"], &["about:blank"]] {
            assert!(
                from_allowed(Some(&limits), &at(nowhere)).is_err(),
                "{nowhere:?}"
            );
        }
        let open = (Grant::own("a".into(), "A"), Store::Reader);
        assert!(from_allowed(Some(&open), &[]).is_ok());
        assert!(from_allowed(None, &[]).is_ok());
    }

    #[test]
    fn every_engine_does_each_browser_verb_or_says_why_not() {
        for (engine, table) in [("cdp", CDP_CANNOT), ("webkit", WEBKIT_CANNOT)] {
            for (verb, why) in table {
                assert!(
                    NAMES.contains(verb) || *verb == "capture_to_note",
                    "{engine}: {verb} is no verb"
                );
                assert!(why.len() > 20, "{engine}: {verb} says no reason");
            }
            let mut names: Vec<&str> = table.iter().map(|(verb, _)| *verb).collect();
            names.sort_unstable();
            names.dedup();
            assert_eq!(names.len(), table.len(), "{engine}: a verb named twice");
        }
    }

    #[test]
    fn a_twin_names_the_store_it_carries_and_no_agent_s_store_is_one() {
        assert_eq!(reader_of(Some(&twin_of(None))), Some(None));
        assert_eq!(
            reader_of(Some(&twin_of(Some("space_abc")))),
            Some(Some("space_abc"))
        );
        assert_eq!(reader_of(Some("agent_twin")), None);
        assert_eq!(reader_of(Some("agent_claude-code")), None);
        assert_eq!(reader_of(Some("agent__twin_")), None);
        assert_eq!(reader_of(None), None);
        assert_eq!(reader_of(Some("space_x")), None);
        assert!(twin_of(None).starts_with("agent_"));
    }
}
