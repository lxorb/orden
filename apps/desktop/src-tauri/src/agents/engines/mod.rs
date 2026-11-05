//! Which engine an agent's page is on, and the one handle every verb holds it by
//! (docs/agent-native.md 12).
//!
//! | build | an agent's own tab | a reader's tab | the verbs |
//! | --- | --- | --- | --- |
//! | `WebView2` | a child webview outside the window's client area (`tabs.rs`) | its webview | the `DevTools` Protocol, all of them |
//! | Orden's own Chromium | a windowless browser with no native window at all (`cef.rs`) | its webview, through `engine/devtools.rs` | the same protocol, all of them |
//! | `WKWebView` | none yet: measured by scripts/webkit-agent-probe, see docs/agent-native.md 12 | - | the same [`Engine`], every verb in [`WEBKIT_CANNOT`] answering `unsupported_on_this_engine` (`webkit.rs`) |
//!
//! **One interface every verb goes through** (#1092). A verb is decided in `browser.rs`:
//! which tab, whether this agent may act there, what the page says it would be doing. It
//! is done through [`Engine`], the one set of acts on a [`Page`], which each engine
//! implements: the `DevTools` Protocol's in `page.rs`, `WKWebView`'s in `webkit.rs`. What
//! an engine has no honest way to do is in its table ([`CDP_CANNOT`], [`WEBKIT_CANNOT`])
//! with the reason, and the verb answers `unsupported_on_this_engine` with that reason
//! before anything is tried; a verb an engine neither does nor names is a verb the
//! parity script (scripts/agent-parity.py) fails on.
//!
//! **The reader's logins, never the reader's extensions.** Emil, 2026-10-03: an agent's
//! tab never loads the reader's extensions. An extension is installed into a profile, and
//! neither engine has a per-page switch for it, so a page in the reader's own store runs
//! every extension the reader installed - a password manager that fills in the agent's
//! page, an ad blocker that changes what it reads, anything with `<all_urls>` reading
//! what the agent reads. Two ways out, and Emil has not chosen; [`READER_STORE`] is the
//! switch:
//!
//! - **The twin** (the default): `store: "reader"` and `"space"` open in that store's twin,
//!   a profile of its own with no extension in it, which is handed the reader's cookies -
//!   every one, partitions kept - each time an agent's tab is built there. So the agent is
//!   signed in where the reader is and nothing of the reader's extensions is near it.
//!   Nothing goes back: what the agent signs into or out of in the twin never reaches the
//!   reader's store. What a cookie does not carry - a site that keeps its login in
//!   `localStorage` or `IndexedDB` alone - is signed out in the twin, and a site that
//!   rotates its session on every use can sign the reader out when the agent uses the
//!   copy. Playwright's `storageState` is the same idea and has the same edges.
//! - **Blocked**: an agent's tab is never in the reader's store; asked for it, the tab
//!   opens in the agent's own store, signed out, and the answer says so - the way a site
//!   set to "agent store only" already answers.

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

/// An element, resolved from a ref, as the engine finds it again.
#[cfg(any(windows, feature = "cef"))]
pub use super::page::Element;
/// An element, resolved from a ref, as the engine finds it again.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub use webkit::Element;

/// How an agent's tab reaches the reader's logins: see this file's comment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReaderStore {
    /// A twin of the reader's store, with their cookies and none of their extensions.
    Twin,
    /// Never the reader's store: the agent's own instead.
    Blocked,
}

/// The switch, until Emil decides. `NIB_AGENT_READER_STORE=blocked` turns a run to the
/// other one, which is how a probe proves both.
pub const READER_STORE: ReaderStore = ReaderStore::Twin;

/// The switch as this run has it.
pub fn reader_store() -> ReaderStore {
    match std::env::var("NIB_AGENT_READER_STORE").as_deref() {
        Ok("blocked") => ReaderStore::Blocked,
        Ok("twin") => ReaderStore::Twin,
        _ => READER_STORE,
    }
}

/// What a twin's name starts with. An agent's own store is `agent_<id>`, and an id is
/// letters, digits and dashes, so no agent's store is ever a twin's, and both start with
/// `agent_`, which is what keeps extensions out of a store on `WebView2`
/// (`extensions::in_store`).
const TWIN: &str = "agent__twin";

/// The twin of a reader's store: `None` is the one every space shares.
pub fn twin_of(reader: Option<&str>) -> String {
    match reader {
        None => TWIN.to_string(),
        Some(name) => format!("{TWIN}_{name}"),
    }
}

/// The reader's store a twin carries the cookies of, or `None` for a store that is no
/// twin. `Some(None)` is the store every space shares.
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

/// One page an agent acts on, on whichever engine it is.
#[derive(Clone)]
pub enum View {
    /// A webview of the app's: a reader's tab, or an agent's own on `WebView2`.
    Webview(Webview),
    /// An agent's own tab on Orden's own Chromium: a browser with no window.
    #[cfg(feature = "cef")]
    Windowless(cef::Windowless),
}

impl View {
    /// Its label: `web-<tab>` or `agent-<tab>`.
    pub fn label(&self) -> String {
        match self {
            View::Webview(view) => view.label().to_string(),
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.label().to_string(),
        }
    }

    /// Where it is now.
    pub fn url(&self) -> String {
        match self {
            View::Webview(view) => view.url().map(|one| one.to_string()).unwrap_or_default(),
            #[cfg(feature = "cef")]
            View::Windowless(page) => page.url(),
        }
    }

    /// Closes it.
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

/// The page under a label, on whichever engine has it.
pub fn view(app: &AppHandle, label: &str) -> Option<View> {
    #[cfg(feature = "cef")]
    if let Some(page) = cef::page(label) {
        return Some(View::Windowless(page));
    }
    app.get_webview(label).map(View::Webview)
}

/// Everything the engine keeps about a page let go of, for a page that closed.
pub fn forget(label: &str) {
    #[cfg(any(windows, feature = "cef"))]
    super::cdp::forget(label);
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    webkit::forget(label);
}

/// A tab a page opened, noted for the answer to the act that opened it (`Engine::opened`).
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

/// Puts to sleep what the engine keeps awake for pages nobody called on for a minute; the
/// agents' own timer calls it (`tabs`).
pub fn sleep_idle(app: &AppHandle) {
    #[cfg(any(windows, feature = "cef"))]
    super::cdp::sleep_idle(app);
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    let _ = app;
}

/// Whether an agent's tab in the reader's store is in its twin (see this file's comment):
/// on the engines that run the reader's extensions. `WKWebView` runs none, so its tab is
/// in the reader's store itself (docs/agent-native.md 12.3).
pub const TWINS: bool = cfg!(any(windows, feature = "cef"));

/// What this build's engine is called where an answer names it.
#[cfg(any(windows, feature = "cef"))]
pub const NAME: &str = if cfg!(windows) {
    "WebView2"
} else {
    "Chromium"
};
/// What this build's engine is called where an answer names it.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub const NAME: &str = "WKWebView";

/// What the `DevTools` Protocol has no honest way to do: nothing. Every verb is done on
/// `WebView2` and on Orden's own Chromium.
#[cfg_attr(
    not(any(windows, feature = "cef")),
    allow(
        dead_code,
        reason = "the other engine's table, which the test reads beside this one's"
    )
)]
pub const CDP_CANNOT: &[(&str, &str)] = &[];

/// What `WKWebView` has no honest way to do yet, verb by verb, and why; see
/// docs/agent-native.md 12.2. Each step of #1092 takes rows out of it.
#[cfg_attr(
    any(windows, feature = "cef"),
    allow(
        dead_code,
        reason = "the other engine's table, which the test reads beside this one's"
    )
)]
pub const WEBKIT_CANNOT: &[(&str, &str)] = &[
    ("browser_snapshot", NOT_BUILT),
    ("browser_find", NOT_BUILT),
    ("browser_read", NOT_BUILT),
    ("browser_click", NOT_BUILT),
    ("browser_type", NOT_BUILT),
    ("browser_press", NOT_BUILT),
    ("browser_scroll", NOT_BUILT),
    ("browser_select", NOT_BUILT),
    ("browser_fill_form", NOT_BUILT),
    ("browser_hover", NOT_BUILT),
    ("browser_drag", NOT_BUILT),
    ("browser_upload", NOT_BUILT),
    ("browser_screenshot", NOT_BUILT),
    ("browser_console", NOT_BUILT),
    ("browser_network", NOT_BUILT),
    ("browser_evaluate", NOT_BUILT),
    ("browser_storage", NOT_BUILT),
    ("browser_show", NOT_BUILT),
    ("browser_takeover", NOT_BUILT),
    ("capture_to_note", NOT_BUILT),
];

/// Why a verb `WEBKIT_CANNOT` names is not done yet.
#[cfg_attr(
    any(windows, feature = "cef"),
    allow(
        dead_code,
        reason = "the other engine's table, which the test reads beside this one's"
    )
)]
const NOT_BUILT: &str = "this verb is not built on WKWebView yet: on a Mac an agent's tab opens, goes, waits and answers its dialogs, and the rest follows (#1092)";

/// This build's engine's table.
#[cfg(any(windows, feature = "cef"))]
const CANNOT: &[(&str, &str)] = CDP_CANNOT;
/// This build's engine's table.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
const CANNOT: &[(&str, &str)] = WEBKIT_CANNOT;

/// Why this build's engine cannot do a verb, by its name, or `None` when it does it.
pub fn cannot(verb: &str) -> Option<&'static str> {
    CANNOT
        .iter()
        .find(|(name, _)| *name == verb)
        .map(|(_, why)| *why)
}

/// The answer to a verb this build's engine cannot do: `unsupported_on_this_engine`,
/// with the engine and the reason.
pub fn refused(verb: &str) -> Answer {
    Answer::error(
        Code::UnsupportedOnThisEngine,
        format!(
            "{verb} is not available on {NAME}: {}",
            cannot(verb).unwrap_or("this engine has no way to do it")
        ),
    )
}

/// Text cut at `most` characters, between two characters.
pub fn cut(text: String, most: usize) -> String {
    match text.char_indices().nth(most) {
        Some((at, _)) => text[..at].to_string(),
        None => text,
    }
}

/// Whether the document has stopped changing: resolves once nothing moved for `still`
/// milliseconds, or at `most`.
pub const SETTLED: &str = r"(still, most) => new Promise((done) => {
  if (!document.body) return done(true)
  let quiet
  const watcher = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(end, still) })
  const end = () => { watcher.disconnect(); done(true) }
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  quiet = setTimeout(end, still)
  setTimeout(end, most)
})";

/// A page's trees, and the secret fields among their nodes.
pub type Tree = (Vec<Part>, HashSet<(String, u64)>);

/// The node of the secret that stands for a whole part of the page no field of which could
/// be told: nothing of that part is written, and no picture of the page is taken.
pub const UNREAD: u64 = 0;

/// Whether a read of the page has left a part of it out, whichever part.
pub fn left_a_part_out(secret: &HashSet<(String, u64)>) -> bool {
    secret.iter().any(|(_, node)| *node == UNREAD)
}

/// What a press is put to the question by, for each element it finds under the pointer
/// other than the one already judged; see the `DevTools` page's `press_judged`.
pub type Gate<'g> = &'g dyn Fn(&Element) -> Result<(), Answer>;

/// A page an agent is acting on, on whichever engine has it.
pub struct Page<'a> {
    /// Its page, on whichever engine.
    pub view: &'a View,
    /// Its label.
    pub label: String,
    /// Whether it is an agent's own tab rather than the reader's.
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub own: bool,
    /// The stop the call started under.
    pub since: u64,
    /// What the agent may reach and the store the tab is in; none for the reader's own
    /// command line.
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub limits: Option<(Grant, Store)>,
    /// Whether this call may touch a credential: type into a sign-in form, photograph a
    /// focused password field, print a page with a filled one. Set by the one decision
    /// (`judged` in browser.rs, from the grant's mode, #1072), never by the page.
    pub credentials: AtomicBool,
    /// nib's own world in each session the call has been in, where everything the gate goes
    /// by is read: the page has no reach into it, however it dresses its own objects.
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub worlds: Mutex<HashMap<(Option<String>, String), i64>>,
    /// The frames of each session, once for the call, with the one that last read a node
    /// first: a page of many frames or fields asks once, and not for each of them.
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub frame_lists: Mutex<HashMap<Option<String>, Vec<String>>>,
    /// Whether the call has looked again with new worlds, which it does once.
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub worlds_renewed: AtomicBool,
}

impl Page<'_> {
    /// Whether the frame an element is in may be acted in (9.2): a denied site does not
    /// open for being in a frame. The same on every engine, from what `facts` says.
    pub fn frame_may_be_acted_in(&self, facts: &Facts) -> Result<(), Answer> {
        // Nowhere is no answer to where, for an agent with a site it may not act in.
        if facts.at.is_empty() && facts.opaque && self.grant_limits_sites() {
            return Err(Answer::error(
                Code::SiteDenied,
                "what is at that point says nothing of itself or of where it is: take a snapshot and press something else",
            ));
        }
        match &self.limits {
            Some((grant, store)) => super::policy::frame_allowed(grant, &facts.at, *store)
                .map_err(|why| Answer::error(Code::SiteDenied, why)),
            None => Ok(()),
        }
    }

    /// Whether the agent's grant has a rule for any site, so that a frame can be denied.
    pub fn grant_limits_sites(&self) -> bool {
        self.limits
            .as_ref()
            .is_some_and(|(grant, _)| !grant.sites.is_empty())
    }

    /// Whether this call was cleared to touch a credential (`credentials`).
    #[cfg_attr(
        not(any(windows, feature = "cef")),
        allow(dead_code, reason = "WKWebView's acts are built in #1092's next steps")
    )]
    pub fn may_touch_credentials(&self) -> bool {
        self.credentials.load(Ordering::Relaxed)
    }

    /// Clears this call to touch a credential: `judged`'s decision.
    pub fn clear_credentials(&self) {
        self.credentials.store(true, Ordering::Relaxed);
    }
}

/// Every act a verb does on a page (docs/agent-native.md 5.2), which each engine
/// implements: one interface, so a verb is the same verb on every engine and `browser.rs`
/// never asks an engine anything else. Each act settles before it answers, and refuses
/// what 9.4 refuses, on every engine alike.
pub trait Engine {
    /// The page's domains woken for an agent's call, and the call noted.
    fn wake(&self);
    /// Where the page is.
    fn url(&self) -> String;
    /// What the page calls itself.
    fn title(&self) -> String;
    /// An element from a ref the agent passed.
    fn element(&self, reference: &str) -> Result<Element, Answer>;
    /// The element at a point of the viewport, in CSS pixels.
    fn element_at(&self, point: (f64, f64)) -> Result<Element, Answer>;
    /// What an element says about itself and its form, for the policy.
    fn facts(&self, element: &Element) -> Result<Facts, Answer>;
    /// What a press on an element is judged by: the element its first point lands on,
    /// read as `facts` reads one.
    fn facts_of_press(&self, element: &Element) -> Result<Facts, Answer>;
    /// The element a press on `element` lands on, at its first point.
    fn at_first_point(&self, element: &Element) -> Result<Element, Answer>;
    /// The element a press aimed at `element` lands on.
    fn aimed(&self, element: &Element) -> Result<Element, Answer>;
    /// Whether an act in what `facts` describes is one the agent may do there: a frame of
    /// a site it may not reach is refused.
    fn may_act_in(&self, facts: &Facts) -> Result<(), Answer>;
    /// Whether the agent's grant limits the sites it reaches.
    fn limits_sites(&self) -> bool;
    /// Whether a press on a box or a radio would change it to `wanted`.
    fn tick_changes(&self, element: &Element, wanted: bool) -> Result<bool, Answer>;
    /// What the element with the keyboard says about itself, if one has it.
    fn active_facts(&self) -> Result<Option<Facts>, Answer>;
    /// The page sent to an address.
    fn navigate(&self, url: &str) -> Result<(), Answer>;
    /// Back (-1), forward (1) or reload (0).
    fn step(&self, by: i64) -> Result<(), Answer>;
    /// Until the page has loaded, gone quiet or shows something; answers how long.
    fn wait(&self, until: &Until, most: Duration) -> Result<u64, Answer>;
    /// Waits for an act to settle: a navigation it started, then a still document.
    fn settle(&self, navigations_before: u64);
    /// How many navigations of the page's own frame have started.
    fn navigations(&self) -> u64;
    /// The agent tabs the page opened since this was last asked.
    fn opened(&self) -> Vec<String>;
    /// The hosts the page and its frames have talked to, for the payment processors.
    fn hosts(&self) -> Vec<String>;
    /// The page's accessibility trees and its secret fields, as `snapshot` writes them.
    fn parts(&self) -> Result<Tree, Answer>;
    /// The refs that match.
    fn find(&self, wanted: &Wanted<'_>) -> Result<Vec<Match>, Answer>;
    /// The page as words: `(url, title, text)`.
    fn read(&self, app: &AppHandle, shape: ReadAs) -> Result<(String, String, String), Answer>;
    /// The article as the clip button reads it: `(url, title, html)`.
    fn clip(&self) -> Result<(String, String, String), Answer>;
    /// The page printed on the reader's paper, as base64.
    fn pdf(&self, paper: &PdfPage) -> Result<String, Answer>;
    /// An element pressed where it shows, each other element under the pointer put to
    /// `gate` first.
    fn click(
        &self,
        element: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer>;
    /// A point of the viewport pressed, `judged` being what it was judged to land on.
    fn click_at(
        &self,
        point: (f64, f64),
        judged: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer>;
    /// The pointer over an element.
    fn hover(&self, element: &Element) -> Result<(), Answer>;
    /// Words into a field, as text.
    fn type_text(&self, element: &Element, text: &str, replace: bool) -> Result<(), Answer>;
    /// A key into an agent's own page, through the engine.
    fn press(&self, key: &Key) -> Result<(), Answer>;
    /// A key into a reader's page, as the page's own events.
    fn press_in_page(&self, key: &Key) -> Result<(), Answer>;
    /// An element into view, or the page by an amount.
    fn scroll(&self, element: Option<&Element>, dx: f64, dy: f64) -> Result<(), Answer>;
    /// Options of a `<select>`, through the page.
    fn select(&self, element: &Element, values: &[String]) -> Result<Vec<String>, Answer>;
    /// One field of a form set.
    fn fill(&self, element: &Element, value: &FieldValue, gate: Gate<'_>) -> Result<(), Answer>;
    /// One element dragged onto another: each with what a press there lands on, and the
    /// gates the start and the end are put to.
    fn drag(
        &self,
        from: (&Element, &Element),
        to: (&Element, &Element),
        gates: (Gate<'_>, Gate<'_>),
    ) -> Result<(), Answer>;
    /// Files for a file input.
    fn upload(&self, element: &Element, files: &[String], gate: Gate<'_>) -> Result<(), Answer>;
    /// A PNG of the page, an element or the whole page, secrets painted over.
    fn screenshot(
        &self,
        element: Option<&Element>,
        full: bool,
        scale: Option<f64>,
    ) -> Result<Picture, Answer>;
    /// The page's console since a line.
    fn console(&self, since: Option<u64>, level: Option<&str>) -> Result<ConsoleLines, Answer>;
    /// The page's requests since one, with bodies when asked.
    fn network(
        &self,
        since: Option<u64>,
        matching: Option<&str>,
        bodies: bool,
    ) -> Result<Requests, Answer>;
    /// A script in nib's own world, or the page's.
    fn evaluate(&self, expression: &str, page_world: bool) -> Result<Value, Answer>;
    /// The page's store's cookies.
    fn cookies(&self) -> Result<Vec<Cookie>, Answer>;
    /// One cookie set in the page's store.
    fn set_cookie(&self, cookie: &Cookie) -> Result<(), Answer>;
    /// The page's site's cookies and storage cleared.
    fn clear(&self) -> Result<(), Answer>;
    /// The page's `localStorage`.
    fn local(&self) -> Result<Map<String, Value>, Answer>;
}

#[cfg(test)]
mod tests {
    use super::{reader_of, twin_of, CDP_CANNOT, WEBKIT_CANNOT};
    use crate::agents::verbs::NAMES;

    /// #1092: every browser verb is done by each engine or named in its table with the
    /// reason it cannot be, and the tables name nothing that is not a verb.
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
        // An agent's own store, whatever the agent is called, is never a twin.
        assert_eq!(reader_of(Some("agent_twin")), None);
        assert_eq!(reader_of(Some("agent_claude-code")), None);
        assert_eq!(reader_of(Some("agent__twin_")), None);
        assert_eq!(reader_of(None), None);
        assert_eq!(reader_of(Some("space_x")), None);
        // And a twin keeps extensions out the way an agent's own store does.
        assert!(twin_of(None).starts_with("agent_"));
    }
}
