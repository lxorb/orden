#[cfg(all(windows, not(feature = "cef")))]
use std::cell::Cell;
use std::collections::{HashMap, HashSet, VecDeque};
#[cfg(all(windows, not(feature = "cef")))]
use std::rc::Rc;
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
#[cfg(all(windows, not(feature = "cef")))]
use tauri::webview::PlatformWebview;
#[cfg(all(windows, not(feature = "cef")))]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2DevToolsProtocolEventReceivedEventArgs2, ICoreWebView2_11,
};
#[cfg(all(windows, not(feature = "cef")))]
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
};
#[cfg(all(windows, not(feature = "cef")))]
use windows_core::{Interface as _, HSTRING, PWSTR};

use super::engines::View;
use super::verbs::{ConsoleLine, Request};

pub const PATIENCE: Duration = Duration::from_secs(30);

const RING: usize = 500;

const AWAKE: Duration = Duration::from_secs(60);

const LONGEST_LINE: usize = 4_000;

pub fn call(view: &View, method: &str, params: &Value) -> Result<Value, String> {
    call_in(view, None, method, params, PATIENCE)
}

pub fn call_in(
    view: &View,
    session: Option<&str>,
    method: &str,
    params: &Value,
    patience: Duration,
) -> Result<Value, String> {
    asked(view, session, method, params)?
        .recv_timeout(patience)
        .map_err(|_| format!("{method}: the page did not answer"))?
}

pub fn call_until(
    view: &View,
    session: Option<&str>,
    method: &str,
    params: &Value,
    give_up: impl Fn() -> bool,
) -> Result<Option<Value>, String> {
    let answer = asked(view, session, method, params)?;
    let started = Instant::now();
    loop {
        match answer.recv_timeout(Duration::from_millis(25)) {
            Ok(said) => return said.map(Some),
            Err(RecvTimeoutError::Disconnected) => {
                return Err(format!("{method}: the page did not answer"));
            }
            Err(RecvTimeoutError::Timeout) => {
                if give_up() {
                    return Ok(None);
                }
                if started.elapsed() >= PATIENCE {
                    return Err(format!("{method}: the page did not answer"));
                }
            }
        }
    }
}

pub type Answering = Receiver<Result<Value, String>>;

fn asked(
    view: &View,
    session: Option<&str>,
    method: &str,
    params: &Value,
) -> Result<Answering, String> {
    match view {
        #[cfg(all(windows, not(feature = "cef")))]
        View::Webview(view) => {
            let (answered, answer) = sync_channel(1);
            let asking = (
                method.to_string(),
                params.to_string(),
                session.map(str::to_string),
            );
            view.with_webview(move |platform| {
                let (method, params, session) = asking;
                send(&platform, session.as_deref(), &method, &params, answered);
            })
            .map_err(|error| format!("the page could not be reached: {error}"))?;
            Ok(answer)
        }
        #[cfg(feature = "cef")]
        View::Webview(view) => {
            let (answered, answer) = sync_channel(1);
            let (view, session, method, params) = (
                view.clone(),
                session.map(str::to_string),
                method.to_string(),
                params.clone(),
            );
            std::thread::spawn(move || {
                let said = crate::engine::devtools::call(
                    &view,
                    session.as_deref(),
                    &method,
                    &params,
                    PATIENCE,
                );
                let _ = answered.try_send(said);
            });
            Ok(answer)
        }
        #[cfg(feature = "cef")]
        View::Windowless(page) => page.ask(session, method, params),
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is WebView2's own, reached through its COM interfaces"
)]
fn send(
    platform: &PlatformWebview,
    session: Option<&str>,
    method: &str,
    params: &str,
    answered: std::sync::mpsc::SyncSender<Result<Value, String>>,
) {
    let late = answered.clone();
    let named = method.to_string();
    let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
        let _ = late.try_send(match result {
            Ok(()) => parsed(&named, &json),
            Err(error) => Err(refusal(&json).unwrap_or_else(|| error.message())),
        });
        Ok(())
    }));
    let (method, params) = (HSTRING::from(method), HSTRING::from(params));
    let sent = unsafe {
        platform
            .controller()
            .CoreWebView2()
            .and_then(|core| match session {
                None => core.CallDevToolsProtocolMethod(&method, &params, &done),
                Some(session) => core.cast::<ICoreWebView2_11>().and_then(|core| {
                    core.CallDevToolsProtocolMethodForSession(
                        &HSTRING::from(session),
                        &method,
                        &params,
                        &done,
                    )
                }),
            })
    };
    if let Err(error) = sent {
        let _ = answered.try_send(Err(error.message()));
    }
}

#[cfg(all(windows, not(feature = "cef")))]
pub fn post(core: &ICoreWebView2, method: &str, params: &Value) {
    ask(core, method, params, |_| ());
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol is WebView2's own, reached through its COM interfaces"
)]
pub fn ask(
    core: &ICoreWebView2,
    method: &str,
    params: &Value,
    answered: impl FnOnce(Result<Value, String>) + 'static,
) {
    type Answered = Box<dyn FnOnce(Result<Value, String>)>;

    let answered = Rc::new(Cell::new(Some(Box::new(answered) as Answered)));
    let late = answered.clone();
    let named = method.to_string();
    let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
        if let Some(said) = late.take() {
            said(match result {
                Ok(()) => parsed(&named, &json),
                Err(error) => Err(refusal(&json).unwrap_or_else(|| error.message())),
            });
        }
        Ok(())
    }));
    let sent = unsafe {
        core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params.to_string()),
            &done,
        )
    };
    if let Err(error) = sent {
        if let Some(said) = answered.take() {
            said(Err(error.message()));
        }
    }
}

#[cfg(all(windows, not(feature = "cef")))]
fn parsed(method: &str, text: &str) -> Result<Value, String> {
    if text.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(text).map_err(|error| format!("{method}: {error}"))
}

#[cfg(all(windows, not(feature = "cef")))]
fn refusal(json: &str) -> Option<String> {
    let said: Value = serde_json::from_str(json).ok()?;
    said.get("message")?.as_str().map(str::to_string)
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the DevTools Protocol's events are WebView2's own, reached through its COM interfaces"
)]
pub fn hear(core: &ICoreWebView2, event: &str, on: impl Fn(&str, Value) + 'static) -> bool {
    unsafe {
        let Ok(receiver) = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event)) else {
            return false;
        };
        let handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut said = PWSTR::null();
                args.ParameterObjectAsJson(&raw mut said)?;
                let said = webview2_com::take_pwstr(said);
                let session = args
                    .cast::<ICoreWebView2DevToolsProtocolEventReceivedEventArgs2>()
                    .ok()
                    .and_then(|two| {
                        let mut session = PWSTR::null();
                        two.SessionId(&raw mut session).ok()?;
                        Some(webview2_com::take_pwstr(session))
                    })
                    .unwrap_or_default();
                if let Ok(value) = serde_json::from_str(&said) {
                    on(&session, value);
                }
                Ok(())
            }));
        let mut token = 0i64;
        receiver
            .add_DevToolsProtocolEventReceived(&handler, &raw mut token)
            .is_ok()
    }
}

#[derive(Clone, Debug)]
pub struct Frame {
    pub session: String,
    pub id: String,
    pub url: String,
    pub parent: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Whence {
    Orden,
    Frame(Vec<String>),
}

#[derive(Clone, Debug, Default)]
struct Placed {
    origin: String,
    parent: Option<String>,
}

#[derive(Default)]
pub struct Heard {
    nested: HashSet<String>,
    console: VecDeque<(ConsoleLine, Whence)>,
    console_next: u64,
    requests: VecDeque<(Request, Whence)>,
    requests_next: u64,
    started: HashMap<(String, String), (u64, Instant)>,
    in_flight: HashSet<(String, String)>,
    network_moved: Option<Instant>,
    contexts: HashMap<(String, i64), String>,
    origins: HashMap<(String, String), Placed>,
    page_origin: Option<String>,
    frames: Vec<Option<Frame>>,
    pub chooser: Option<u64>,
    pub opened: Vec<String>,
    pub navigations: u64,
    pub loads: u64,
    pub main_frame: Option<String>,
    pub dragged: Option<Value>,
    used: Option<Instant>,
    awake: bool,
    console_on: bool,
    followed: bool,
}

impl Heard {
    pub fn console(
        &self,
        since: Option<u64>,
        level: Option<&str>,
    ) -> (Vec<(ConsoleLine, Whence)>, u64) {
        let lines = self
            .console
            .iter()
            .filter(|(one, _)| since.is_none_or(|since| one.seq > since))
            .filter(|(one, _)| level.is_none_or(|level| one.level == level))
            .cloned()
            .collect();
        (lines, self.console_next)
    }

    pub fn requests(
        &self,
        since: Option<u64>,
        matching: Option<&str>,
    ) -> (Vec<(Request, Whence)>, u64) {
        let rows = self
            .requests
            .iter()
            .filter(|(one, _)| since.is_none_or(|since| one.seq > since))
            .filter(|(one, _)| matching.is_none_or(|part| one.url.contains(part)))
            .cloned()
            .collect();
        (rows, self.requests_next)
    }

    pub fn request_id(&self, seq: u64) -> Option<(String, String)> {
        self.started
            .iter()
            .find(|(_, (one, _))| *one == seq)
            .map(|(key, _)| key.clone())
    }

    pub fn idle_for(&self, quiet: Duration) -> bool {
        self.in_flight.is_empty() && self.network_moved.is_none_or(|at| at.elapsed() >= quiet)
    }

    pub fn in_flight(&self) -> Vec<(Request, Whence)> {
        let seqs: Vec<u64> = self
            .in_flight
            .iter()
            .filter_map(|key| self.started.get(key).map(|(seq, _)| *seq))
            .collect();
        self.requests
            .iter()
            .filter(|(one, _)| seqs.contains(&one.seq))
            .cloned()
            .collect()
    }

    pub fn frames(&self) -> Vec<(usize, Frame)> {
        self.frames
            .iter()
            .enumerate()
            .filter_map(|(at, one)| one.clone().map(|frame| (at + 1, frame)))
            .collect()
    }

    pub fn frame(&self, number: usize) -> Option<Frame> {
        self.frames.get(number.checked_sub(1)?).cloned().flatten()
    }

    pub fn say(&mut self, level: &str, text: String) {
        self.line(level, text, Some("orden".to_string()), Whence::Orden);
    }

    fn line(&mut self, level: &str, text: String, source: Option<String>, whence: Whence) {
        self.console_next += 1;
        self.console.push_back((
            ConsoleLine {
                seq: self.console_next,
                level: level.to_string(),
                text: cut(text, LONGEST_LINE),
                source,
            },
            whence,
        ));
        while self.console.len() > RING {
            self.console.pop_front();
        }
    }

    fn request_started(&mut self, session: &str, event: &Value) {
        let Some(id) = event.get("requestId").and_then(Value::as_str) else {
            return;
        };
        let key = (session.to_string(), id.to_string());
        if !self.in_flight.insert(key.clone()) && self.started.contains_key(&key) {
            return;
        }
        self.requests_next += 1;
        let seq = self.requests_next;
        self.started.insert(key, (seq, Instant::now()));
        self.network_moved = Some(Instant::now());
        let request = event.get("request").cloned().unwrap_or_default();
        let frame = event.get("frameId").and_then(Value::as_str);
        let from = placed(
            event
                .get("documentURL")
                .and_then(Value::as_str)
                .map(|url| url.strip_prefix("blob:").unwrap_or(url).to_string())
                .into_iter()
                .chain(match frame {
                    Some(frame) => self.frame_place(session, frame),
                    None => self.session_address(session),
                }),
        );
        self.requests.push_back((
            Request {
                seq,
                method: text_at(&request, "method"),
                url: cut(text_at(&request, "url"), LONGEST_LINE),
                status: None,
                kind: text_at(event, "type"),
                ms: None,
                failed: None,
                body: None,
            },
            from,
        ));
        while self.requests.len() > RING {
            if let Some((gone, _)) = self.requests.pop_front() {
                self.started.retain(|_, (seq, _)| *seq != gone.seq);
            }
        }
    }

    fn responded(&mut self, session: &str, event: &Value) {
        let Some(seq) = self.seq_of(session, event) else {
            return;
        };
        let status = event
            .pointer("/response/status")
            .and_then(Value::as_u64)
            .and_then(|one| u16::try_from(one).ok());
        if let Some((row, _)) = self.requests.iter_mut().find(|(one, _)| one.seq == seq) {
            row.status = status;
        }
    }

    fn request_ended(&mut self, session: &str, event: &Value, failed: Option<String>) {
        let Some(id) = event.get("requestId").and_then(Value::as_str) else {
            return;
        };
        let key = (session.to_string(), id.to_string());
        self.in_flight.remove(&key);
        self.network_moved = Some(Instant::now());
        let Some((seq, at)) = self.started.get(&key).copied() else {
            return;
        };
        if let Some((row, _)) = self.requests.iter_mut().find(|(one, _)| one.seq == seq) {
            row.ms = u64::try_from(at.elapsed().as_millis()).ok();
            row.failed = failed;
        }
    }

    fn session_address(&self, session: &str) -> Option<String> {
        if session.is_empty() {
            return None;
        }
        self.frames
            .iter()
            .flatten()
            .find(|frame| frame.session == session)
            .map(|frame| frame.url.clone())
    }

    fn frame_place(&self, session: &str, frame: &str) -> Option<String> {
        let key = |id: &str| (session.to_string(), id.to_string());
        if !self.origins.contains_key(&key(frame)) {
            return self
                .frames
                .iter()
                .flatten()
                .find(|one| one.session == session && one.id == frame)
                .map(|one| one.url.clone());
        }
        let mut at = frame.to_string();
        for _ in 0..DEEPEST_FRAMES {
            let one = self.origins.get(&key(&at))?;
            if on_the_web(&one.origin) {
                return Some(one.origin.clone());
            }
            at = one.parent.clone()?;
        }
        None
    }

    fn session_place(&self, session: &str) -> Option<String> {
        let shared = self
            .origins
            .iter()
            .any(|((owner, _), one)| owner == session && one.parent.is_some());
        if shared {
            None
        } else if session.is_empty() {
            self.page_origin.clone()
        } else {
            self.session_address(session)
        }
    }

    fn sent_from(&self, session: &str, request: &str) -> Option<Whence> {
        let (seq, _) = self
            .started
            .get(&(session.to_string(), request.to_string()))?;
        self.requests
            .iter()
            .find(|(one, _)| one.seq == *seq)
            .map(|(_, from)| from.clone())
    }

    fn navigated(&mut self, session: &str, frame: &Value) {
        let Some(id) = frame.get("id").and_then(Value::as_str) else {
            return;
        };
        let url = text_at(frame, "url");
        let origin = frame
            .get("securityOrigin")
            .and_then(Value::as_str)
            .filter(|one| !one.is_empty())
            .map_or_else(|| url.clone(), str::to_string);
        if session.is_empty() && frame.get("parentId").is_none() {
            self.origins.retain(|(owner, _), _| !owner.is_empty());
            self.page_origin = Some(origin.clone());
        }
        if let Some(held) = self
            .frames
            .iter_mut()
            .flatten()
            .find(|one| one.session == session && one.id == id)
        {
            held.url.clone_from(&url);
        }
        let parent = frame
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string);
        self.origins.insert(
            (session.to_string(), id.to_string()),
            Placed { origin, parent },
        );
    }

    fn frame_attached(&mut self, session: &str, event: &Value) {
        let (Some(id), Some(parent)) = (
            event.get("frameId").and_then(Value::as_str),
            event.get("parentFrameId").and_then(Value::as_str),
        ) else {
            return;
        };
        self.origins
            .entry((session.to_string(), id.to_string()))
            .or_insert_with(|| Placed {
                origin: String::new(),
                parent: Some(parent.to_string()),
            });
    }

    fn logged(&mut self, session: &str, event: &Value) {
        let entry = event.get("entry").cloned().unwrap_or_default();
        let level = match entry.get("level").and_then(Value::as_str) {
            Some("error") => "error",
            Some("warning") => "warning",
            Some("verbose") => "debug",
            _ => "info",
        };
        let source = entry.get("url").and_then(Value::as_str).map(str::to_string);
        let whence = match entry.get("networkRequestId").and_then(Value::as_str) {
            Some(request) => self
                .sent_from(session, request)
                .unwrap_or(Whence::Frame(Vec::new())),
            None => Whence::Frame(self.session_place(session).into_iter().collect()),
        };
        self.line(level, text_at(&entry, "text"), source, whence);
    }

    fn target_changed(&mut self, event: &Value) {
        let (Some(id), Some(url)) = (
            event
                .pointer("/targetInfo/targetId")
                .and_then(Value::as_str),
            event.pointer("/targetInfo/url").and_then(Value::as_str),
        ) else {
            return;
        };
        if let Some(frame) = self.frames.iter_mut().flatten().find(|one| one.id == id) {
            frame.url = url.to_string();
        }
    }

    pub fn frame_tree(&mut self, session: &str, tree: &Value) {
        if let Some(frame) = tree.get("frame") {
            self.navigated(session, frame);
        }
        for child in tree
            .get("childFrames")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            self.frame_tree(session, child);
        }
    }

    fn printed_in(&self, session: &str, context: Option<i64>) -> Whence {
        let mut at: Vec<String> = context
            .and_then(|id| self.contexts.get(&(session.to_string(), id)))
            .cloned()
            .into_iter()
            .collect();
        at.extend(self.session_address(session));
        Whence::Frame(at)
    }

    fn context_created(&mut self, session: &str, event: &Value) {
        let Some(context) = event.get("context") else {
            return;
        };
        if let Some(id) = context.get("id").and_then(Value::as_i64) {
            self.contexts
                .insert((session.to_string(), id), text_at(context, "origin"));
        }
    }

    fn seq_of(&self, session: &str, event: &Value) -> Option<u64> {
        let id = event.get("requestId")?.as_str()?;
        self.started
            .get(&(session.to_string(), id.to_string()))
            .map(|(seq, _)| *seq)
    }

    fn attached(&mut self, parent: &str, event: &Value) {
        if event.pointer("/targetInfo/type").and_then(Value::as_str) != Some("iframe") {
            return;
        }
        let (Some(session), Some(frame)) = (
            event.get("sessionId").and_then(Value::as_str),
            event
                .pointer("/targetInfo/targetId")
                .and_then(Value::as_str),
        ) else {
            return;
        };
        let url = event
            .pointer("/targetInfo/url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if let Some(held) = self.frames.iter_mut().flatten().find(|one| one.id == frame) {
            held.session = session.to_string();
            held.url = url;
            held.parent = parent.to_string();
            return;
        }
        self.frames.push(Some(Frame {
            session: session.to_string(),
            id: frame.to_string(),
            url,
            parent: parent.to_string(),
        }));
    }

    fn detached(&mut self, event: &Value) {
        let Some(session) = event.get("sessionId").and_then(Value::as_str) else {
            return;
        };
        for one in &mut self.frames {
            if one.as_ref().is_some_and(|frame| frame.session == session) {
                *one = None;
            }
        }
        self.in_flight.retain(|(owner, _)| owner != session);
        self.contexts.retain(|(owner, _), _| owner != session);
        self.origins.retain(|(owner, _), _| owner != session);
        self.nested.remove(session);
    }

    fn not_nested(&self) -> Vec<String> {
        self.frames()
            .into_iter()
            .map(|(_, frame)| frame.session)
            .filter(|session| !self.nested.contains(session))
            .collect()
    }
}

static HEARD: Mutex<Option<HashMap<String, Arc<Mutex<Heard>>>>> = Mutex::new(None);

pub fn heard(label: &str) -> Arc<Mutex<Heard>> {
    let mut all = HEARD.lock().unwrap_or_else(PoisonError::into_inner);
    Arc::clone(
        all.get_or_insert_with(HashMap::new)
            .entry(label.to_string())
            .or_default(),
    )
}

pub fn forget(label: &str) {
    let mut all = HEARD.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(all) = all.as_mut() {
        all.remove(label);
    }
}

pub fn labels() -> Vec<String> {
    HEARD
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|all| all.keys().cloned().collect())
        .unwrap_or_default()
}

const EVENTS: [&str; 20] = [
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Network.loadingFinished",
    "Network.loadingFailed",
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "Runtime.executionContextCreated",
    "Runtime.executionContextDestroyed",
    "Runtime.executionContextsCleared",
    "Log.entryAdded",
    "Page.fileChooserOpened",
    "Target.attachedToTarget",
    "Target.targetInfoChanged",
    "Page.frameNavigated",
    "Page.frameAttached",
    "Page.frameDetached",
    "Page.frameStartedNavigating",
    "Page.loadEventFired",
    "Input.dragIntercepted",
    "Target.detachedFromTarget",
];

#[cfg(all(windows, not(feature = "cef")))]
pub fn follow(core: &ICoreWebView2, label: &str) {
    let page = heard(label);
    if std::mem::replace(
        &mut page.lock().unwrap_or_else(PoisonError::into_inner).followed,
        true,
    ) {
        return;
    }
    for event in EVENTS {
        let page = Arc::clone(&page);
        hear(core, event, move |session, value| {
            let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
            heard_event(&mut held, event, session, value);
        });
    }
}

pub fn follow_view(view: &View, label: &str) {
    #[cfg(all(windows, not(feature = "cef")))]
    {
        let View::Webview(webview) = view;
        let named = label.to_string();
        let _ = webview.with_webview(move |platform| {
            if let Some(core) = core_of(&platform) {
                follow(&core, &named);
            }
        });
    }
    #[cfg(feature = "cef")]
    {
        let page = heard(label);
        if std::mem::replace(
            &mut page.lock().unwrap_or_else(PoisonError::into_inner).followed,
            true,
        ) {
            return;
        }
        let hearing = move |method: &str, session: Option<&str>, params: &Value| {
            if EVENTS.contains(&method) {
                let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
                heard_event(
                    &mut held,
                    method,
                    session.unwrap_or_default(),
                    params.clone(),
                );
            }
        };
        match view {
            View::Webview(webview) => {
                let _ = crate::engine::devtools::hear(webview, hearing);
            }
            View::Windowless(windowless) => windowless.hear(hearing),
        }
    }
}

fn heard_event(held: &mut Heard, method: &str, session: &str, event: Value) {
    match method {
        "Network.requestWillBeSent" => held.request_started(session, &event),
        "Network.responseReceived" => held.responded(session, &event),
        "Network.loadingFinished" => held.request_ended(session, &event, None),
        "Network.loadingFailed" => {
            let why = text_at(&event, "errorText");
            held.request_ended(session, &event, Some(why));
        }
        "Runtime.consoleAPICalled" => {
            let level = match event.get("type").and_then(Value::as_str) {
                Some("error" | "assert") => "error",
                Some("warning") => "warning",
                Some("info") => "info",
                Some("debug") => "debug",
                _ => "log",
            };
            let whence = held.printed_in(
                session,
                event.get("executionContextId").and_then(Value::as_i64),
            );
            held.line(level, spoken(&event), frame_source(&event), whence);
        }
        "Runtime.exceptionThrown" => {
            let details = event.get("exceptionDetails").cloned().unwrap_or_default();
            let text = details
                .pointer("/exception/description")
                .and_then(Value::as_str)
                .map_or_else(|| text_at(&details, "text"), str::to_string);
            let source = Some(format!(
                "{}:{}",
                text_at(&details, "url"),
                details
                    .get("lineNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or_default()
                    + 1
            ));
            let whence = held.printed_in(
                session,
                details.get("executionContextId").and_then(Value::as_i64),
            );
            held.line("error", text, source, whence);
        }
        "Runtime.executionContextCreated" => held.context_created(session, &event),
        "Runtime.executionContextDestroyed" => {
            if let Some(id) = event.get("executionContextId").and_then(Value::as_i64) {
                held.contexts.remove(&(session.to_string(), id));
            }
        }
        "Runtime.executionContextsCleared" => {
            held.contexts.retain(|(owner, _), _| owner != session);
        }
        "Log.entryAdded" => held.logged(session, &event),
        "Page.fileChooserOpened" => {
            held.chooser = event.get("backendNodeId").and_then(Value::as_u64);
        }
        "Target.attachedToTarget" => held.attached(session, &event),
        "Target.targetInfoChanged" => held.target_changed(&event),
        "Page.frameNavigated" => {
            if let Some(frame) = event.get("frame") {
                held.navigated(session, frame);
            }
        }
        "Page.frameAttached" => held.frame_attached(session, &event),
        "Page.frameDetached" => {
            if let Some(id) = event.get("frameId").and_then(Value::as_str) {
                held.origins.remove(&(session.to_string(), id.to_string()));
            }
        }
        "Target.detachedFromTarget" => held.detached(&event),
        "Page.frameStartedNavigating" => {
            let main = held.main_frame.as_deref();
            let ours = session.is_empty()
                && main
                    .is_none_or(|main| event.get("frameId").and_then(Value::as_str) == Some(main));
            let same = matches!(
                event.get("navigationType").and_then(Value::as_str),
                Some("sameDocument" | "historySameDocument")
            );
            if ours && !same {
                held.navigations += 1;
                held.in_flight.clear();
                held.network_moved = Some(Instant::now());
            }
        }
        "Page.loadEventFired" => {
            if session.is_empty() {
                held.loads += 1;
            }
        }
        "Input.dragIntercepted" => held.dragged = event.get("data").cloned(),
        _ => {}
    }
}

fn on_the_web(origin: &str) -> bool {
    tauri::Url::parse(origin)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host().is_some())
}

fn placed(at: impl Iterator<Item = String>) -> Whence {
    let mut kept: Vec<String> = Vec::new();
    for one in at {
        if !kept.contains(&one) {
            kept.push(one);
        }
    }
    Whence::Frame(kept)
}

fn spoken(event: &Value) -> String {
    event
        .get("args")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter()
                .map(|one| match one.get("value") {
                    Some(Value::String(text)) => text.clone(),
                    Some(value) if !value.is_null() => value.to_string(),
                    _ => one
                        .get("description")
                        .and_then(Value::as_str)
                        .or_else(|| one.get("type").and_then(Value::as_str))
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

fn frame_source(event: &Value) -> Option<String> {
    let top = event.pointer("/stackTrace/callFrames/0")?;
    Some(format!(
        "{}:{}",
        top.get("url")?.as_str()?,
        top.get("lineNumber")?.as_u64()? + 1
    ))
}

fn text_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub use super::engines::cut;

pub fn awake(view: &View, label: &str, own: bool) {
    let page = heard(label);
    let asleep = {
        let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
        held.used = Some(Instant::now());
        !std::mem::replace(&mut held.awake, true)
    };
    if !asleep {
        return;
    }
    follow_view(view, label);
    for method in ["Page.enable", "DOM.enable", "Network.enable", "Log.enable"] {
        let _ = call(view, method, &json!({}));
    }
    if own {
        let _ = call(view, "Target.setAutoAttach", &auto_attach());
    } else {
        attach_existing(view);
    }
    if let Ok(tree) = call(view, "Page.getFrameTree", &json!({})) {
        if let Some(tree) = tree.get("frameTree") {
            page.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .frame_tree("", tree);
        }
    }
    let frames = page.lock().unwrap_or_else(PoisonError::into_inner).frames();
    for (_, frame) in frames {
        for method in ["Network.enable", "Page.enable"] {
            let _ = call_in(
                view,
                Some(&frame.session),
                method,
                &json!({}),
                super::page::FRAME_PATIENCE,
            );
        }
        if let Ok(tree) = call_in(
            view,
            Some(&frame.session),
            "Page.getFrameTree",
            &json!({}),
            super::page::FRAME_PATIENCE,
        ) {
            if let Some(tree) = tree.get("frameTree") {
                page.lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .frame_tree(&frame.session, tree);
            }
        }
    }
}

fn auto_attach() -> Value {
    json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true, "filter": [{ "type": "iframe" }] })
}

const DEEPEST_FRAMES: usize = 32;

pub fn follow_nested(view: &View, label: &str, patience: Duration) -> Result<(), String> {
    let page = heard(label);
    for _ in 0..DEEPEST_FRAMES {
        let sessions = page
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .not_nested();
        if sessions.is_empty() {
            return Ok(());
        }
        for session in sessions {
            let asked = call_in(
                view,
                Some(&session),
                "Target.setAutoAttach",
                &auto_attach(),
                patience,
            );
            let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
            match asked {
                Ok(_) => {
                    held.nested.insert(session);
                }
                Err(why) if held.not_nested().contains(&session) => return Err(why),
                Err(_) => {}
            }
        }
    }
    Err("frames too deep to follow".to_string())
}

fn attach_existing(view: &View) {
    let Ok(tree) = call(view, "Page.getFrameTree", &json!({})) else {
        return;
    };
    let mut frames = HashSet::new();
    let mut walking = vec![tree.get("frameTree").cloned().unwrap_or_default()];
    while let Some(node) = walking.pop() {
        if let Some(id) = node.pointer("/frame/id").and_then(Value::as_str) {
            frames.insert(id.to_string());
        }
        walking.extend(
            node.get("childFrames")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
    }
    let Ok(targets) = call(view, "Target.getTargets", &json!({})) else {
        return;
    };
    for info in targets
        .get("targetInfos")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let is_frame = info.get("type").and_then(Value::as_str) == Some("iframe");
        let Some(id) = info.get("targetId").and_then(Value::as_str) else {
            continue;
        };
        if is_frame && frames.contains(id) {
            let _ = call(
                view,
                "Target.attachToTarget",
                &json!({ "targetId": id, "flatten": true }),
            );
        }
    }
}

pub fn listen_to_console(view: &View, label: &str) {
    let page = heard(label);
    let first = !std::mem::replace(
        &mut page
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .console_on,
        true,
    );
    if first {
        let _ = call_in(
            view,
            None,
            "Runtime.enable",
            &json!({}),
            Duration::from_secs(3),
        );
    }
}

pub fn sleep_idle(app: &tauri::AppHandle) {
    for label in labels() {
        let page = heard(&label);
        let sleepy = {
            let mut held = page.lock().unwrap_or_else(PoisonError::into_inner);
            let idle = held.awake && held.used.is_none_or(|at| at.elapsed() >= AWAKE);
            if idle {
                held.awake = false;
                held.console_on = false;
            }
            idle
        };
        if !sleepy {
            continue;
        }
        let Some(view) = super::engines::view(app, &label) else {
            forget(&label);
            continue;
        };
        for method in [
            "Runtime.disable",
            "Network.disable",
            "Accessibility.disable",
            "DOM.disable",
            "Log.disable",
        ] {
            let _ = call_in(&view, None, method, &json!({}), Duration::from_secs(5));
        }
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the engine is reached through WebView2's COM interfaces"
)]
pub fn core_of(platform: &PlatformWebview) -> Option<ICoreWebView2> {
    unsafe { platform.controller().CoreWebView2().ok() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_console_call_prints_each_argument_as_the_console_would() {
        let event = json!({
            "type": "log",
            "args": [
                { "type": "string", "value": "saved" },
                { "type": "number", "value": 3 },
                { "type": "object", "description": "Object" },
                { "type": "undefined" },
            ],
        });
        assert_eq!(spoken(&event), "saved 3 Object undefined");
    }

    #[test]
    fn the_ring_keeps_the_last_five_hundred_and_counts_on() {
        let mut heard = Heard::default();
        for at in 0..(RING + 20) {
            heard.line("log", format!("{at}"), None, Whence::Orden);
        }
        let (lines, next) = heard.console(None, None);
        assert_eq!(lines.len(), RING);
        assert_eq!(lines[0].0.text, "20");
        assert_eq!(next, u64::try_from(RING + 20).expect("small"));
        let (after, _) = heard.console(Some(next - 2), None);
        assert_eq!(after.len(), 2);
    }

    #[test]
    fn a_request_is_in_flight_until_it_ends_and_a_redirect_is_the_same_request() {
        let mut heard = Heard::default();
        let sent = json!({ "requestId": "1", "type": "Fetch", "request": { "method": "GET", "url": "https://a.example/x" } });
        heard.request_started("", &sent);
        heard.request_started("", &sent);
        assert!(!heard.idle_for(Duration::ZERO));
        heard.responded(
            "",
            &json!({ "requestId": "1", "response": { "status": 302 } }),
        );
        heard.request_ended("", &json!({ "requestId": "1" }), None);
        assert!(heard.idle_for(Duration::ZERO));
        let (rows, next) = heard.requests(None, Some("a.example"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0.status, Some(302));
        assert_eq!(rows[0].0.method, "GET");
        assert_eq!(next, 1);
        assert!(!heard.idle_for(Duration::from_secs(60)));
    }

    #[test]
    fn a_line_and_a_request_carry_the_frame_they_came_from() {
        let mut heard = Heard::default();
        heard.attached(
            "",
            &json!({ "sessionId": "s1", "targetInfo": { "type": "iframe", "targetId": "F", "url": "https://bank.example/app" } }),
        );
        heard_event(
            &mut heard,
            "Runtime.executionContextCreated",
            "",
            json!({ "context": { "id": 7, "origin": "https://bank.example" } }),
        );
        let printed = |context: i64, url: &str| {
            json!({
                "type": "log",
                "executionContextId": context,
                "args": [{ "type": "string", "value": "balance 1200" }],
                "stackTrace": { "callFrames": [{ "url": url, "lineNumber": 0 }] },
            })
        };
        heard_event(
            &mut heard,
            "Runtime.consoleAPICalled",
            "",
            printed(7, "https://cdn.example/app.js"),
        );
        heard_event(&mut heard, "Runtime.consoleAPICalled", "", printed(9, ""));
        heard_event(
            &mut heard,
            "Log.entryAdded",
            "",
            json!({ "entry": { "level": "error", "text": "no url" } }),
        );
        heard.say("warning", "Orden kept a tab from opening".into());
        let (lines, _) = heard.console(None, None);
        let whence: Vec<&Whence> = lines.iter().map(|(_, whence)| whence).collect();
        assert_eq!(
            whence,
            [
                &Whence::Frame(vec!["https://bank.example".into()]),
                &Whence::Frame(vec![]),
                &Whence::Frame(vec![]),
                &Whence::Orden,
            ]
        );
        assert_eq!(
            lines[0].0.source.as_deref(),
            Some("https://cdn.example/app.js:1")
        );
        heard_event(
            &mut heard,
            "Runtime.executionContextsCleared",
            "",
            json!({}),
        );
        heard_event(&mut heard, "Runtime.consoleAPICalled", "", printed(7, ""));
        assert_eq!(heard.console(None, None).0[4].1, Whence::Frame(vec![]));

        heard.request_started(
            "s1",
            &json!({ "requestId": "1", "type": "Fetch", "documentURL": "https://bank.example/app", "request": { "method": "GET", "url": "https://api.backend.example/accounts" } }),
        );
        heard.request_started(
            "",
            &json!({ "requestId": "2", "type": "Fetch", "documentURL": "https://shop.example/", "request": { "method": "GET", "url": "https://api.backend.example/cart" } }),
        );
        let (rows, _) = heard.requests(None, None);
        assert_eq!(
            rows[0].1,
            Whence::Frame(vec!["https://bank.example/app".into()])
        );
        assert_eq!(
            rows[1].1,
            Whence::Frame(vec!["https://shop.example/".into()])
        );
    }

    fn went(heard: &mut Heard, session: &str, frame: Value) {
        heard_event(
            heard,
            "Page.frameNavigated",
            session,
            json!({ "frame": frame }),
        );
    }

    fn sent(heard: &mut Heard, session: &str, id: &str, frame: &str, document: &str, url: &str) {
        heard.request_started(
            session,
            &json!({ "requestId": id, "frameId": frame, "documentURL": document, "type": "Fetch", "request": { "method": "GET", "url": url } }),
        );
    }

    fn at(all: &[&str]) -> Whence {
        Whence::Frame(all.iter().map(|one| (*one).to_string()).collect())
    }

    #[test]
    fn a_request_and_a_log_line_are_placed_by_the_frame_they_came_from() {
        let mut heard = Heard::default();
        went(
            &mut heard,
            "",
            json!({ "id": "M", "url": "https://shop.example/", "securityOrigin": "https://shop.example" }),
        );
        went(
            &mut heard,
            "",
            json!({ "id": "B", "parentId": "M", "url": "about:blank", "securityOrigin": "https://shop.example" }),
        );
        went(
            &mut heard,
            "",
            json!({ "id": "P", "parentId": "M", "url": "https://pay.example.com/", "securityOrigin": "https://pay.example.com" }),
        );
        sent(
            &mut heard,
            "",
            "1",
            "B",
            "about:blank",
            "https://shop.example/api/x",
        );
        sent(
            &mut heard,
            "",
            "2",
            "Q",
            "blob:https://shop.example/u",
            "https://shop.example/api/y",
        );
        sent(
            &mut heard,
            "",
            "3",
            "P",
            "https://pay.example.com/",
            "https://api.example.com/accounts",
        );
        let (rows, _) = heard.requests(None, None);
        assert_eq!(rows[0].1, at(&["about:blank", "https://shop.example"]));
        assert_eq!(rows[1].1, at(&["https://shop.example/u"]));
        assert_eq!(
            rows[2].1,
            at(&["https://pay.example.com/", "https://pay.example.com"])
        );
        heard_event(
            &mut heard,
            "Log.entryAdded",
            "",
            json!({ "entry": { "level": "error", "text": "Failed to load resource: 404", "url": "https://api.example.com/accounts", "networkRequestId": "3" } }),
        );
        heard_event(
            &mut heard,
            "Log.entryAdded",
            "",
            json!({ "entry": { "level": "warning", "text": "an intervention" } }),
        );
        let (lines, _) = heard.console(None, None);
        assert_eq!(lines[0].1, rows[2].1);
        assert_eq!(lines[1].1, at(&[]));
    }

    #[test]
    fn a_frame_with_no_origin_of_its_own_is_placed_by_the_frame_round_it() {
        let mut heard = Heard::default();
        went(
            &mut heard,
            "",
            json!({ "id": "M", "url": "https://www.example.com/", "securityOrigin": "https://www.example.com" }),
        );
        went(
            &mut heard,
            "",
            json!({ "id": "P", "parentId": "M", "url": "https://pay.example.com/", "securityOrigin": "https://pay.example.com" }),
        );
        went(
            &mut heard,
            "",
            json!({ "id": "D", "parentId": "P", "url": "data:text/html,x", "securityOrigin": "null" }),
        );
        heard_event(
            &mut heard,
            "Page.frameAttached",
            "",
            json!({ "frameId": "U", "parentFrameId": "P" }),
        );
        sent(
            &mut heard,
            "",
            "1",
            "D",
            "data:text/html,x",
            "https://api.example.com/accounts",
        );
        sent(
            &mut heard,
            "",
            "2",
            "U",
            "about:blank",
            "https://api.example.com/accounts",
        );
        sent(
            &mut heard,
            "",
            "3",
            "Z",
            "about:blank",
            "https://api.example.com/accounts",
        );
        sent(
            &mut heard,
            "",
            "4",
            "M",
            "https://www.example.com/",
            "https://api.example.com/cart",
        );
        let (rows, _) = heard.requests(None, None);
        assert_eq!(
            rows[0].1,
            at(&["data:text/html,x", "https://pay.example.com"])
        );
        assert_eq!(rows[1].1, at(&["about:blank", "https://pay.example.com"]));
        assert_eq!(rows[2].1, at(&["about:blank"]));
        assert_eq!(
            rows[3].1,
            at(&["https://www.example.com/", "https://www.example.com"])
        );
    }

    #[test]
    fn a_log_line_of_a_request_never_heard_is_placed_nowhere_and_a_removed_frame_is_forgotten() {
        let mut heard = Heard::default();
        went(
            &mut heard,
            "",
            json!({ "id": "M", "url": "https://shop.example/", "securityOrigin": "https://shop.example" }),
        );
        let logged = |heard: &mut Heard, entry: Value| {
            heard_event(heard, "Log.entryAdded", "", json!({ "entry": entry }));
        };
        logged(
            &mut heard,
            json!({ "level": "error", "text": "Failed", "url": "https://api.example.com/a", "networkRequestId": "99" }),
        );
        logged(
            &mut heard,
            json!({ "level": "warning", "text": "an intervention" }),
        );
        let (lines, _) = heard.console(None, None);
        assert_eq!(lines[0].1, at(&[]));
        assert_eq!(lines[1].1, at(&["https://shop.example"]));
        went(
            &mut heard,
            "",
            json!({ "id": "B", "parentId": "M", "url": "about:blank", "securityOrigin": "https://shop.example" }),
        );
        heard_event(
            &mut heard,
            "Page.frameDetached",
            "",
            json!({ "frameId": "B", "reason": "remove" }),
        );
        sent(
            &mut heard,
            "",
            "1",
            "B",
            "about:blank",
            "https://shop.example/x",
        );
        assert_eq!(heard.requests(None, None).0[0].1, at(&["about:blank"]));
    }

    #[test]
    fn a_frame_of_its_own_is_placed_where_it_went_since_it_was_attached() {
        let mut heard = Heard::default();
        heard.attached(
            "",
            &json!({ "sessionId": "s1", "targetInfo": { "type": "iframe", "targetId": "F", "url": "https://a.example.com/" } }),
        );
        went(
            &mut heard,
            "s1",
            json!({ "id": "F", "url": "https://pay.example.com/x", "securityOrigin": "https://pay.example.com" }),
        );
        heard.request_started(
            "s1",
            &json!({ "requestId": "4", "documentURL": "about:blank", "type": "Fetch", "request": { "method": "GET", "url": "https://api.example.com/z" } }),
        );
        assert_eq!(
            heard.requests(None, None).0[0].1,
            at(&["about:blank", "https://pay.example.com/x"])
        );
        heard_event(
            &mut heard,
            "Target.targetInfoChanged",
            "",
            json!({ "targetInfo": { "targetId": "F", "type": "iframe", "url": "https://b.example/" } }),
        );
        assert_eq!(
            heard.session_address("s1").as_deref(),
            Some("https://b.example/")
        );
        went(
            &mut heard,
            "",
            json!({ "id": "M", "url": "https://shop.example/", "securityOrigin": "https://shop.example" }),
        );
        went(
            &mut heard,
            "",
            json!({ "id": "B", "parentId": "M", "url": "about:blank", "securityOrigin": "https://shop.example" }),
        );
        went(
            &mut heard,
            "",
            json!({ "id": "M", "url": "https://other.example/", "securityOrigin": "https://other.example" }),
        );
        sent(
            &mut heard,
            "",
            "5",
            "B",
            "about:blank",
            "https://other.example/q",
        );
        assert_eq!(heard.requests(None, None).0[1].1, at(&["about:blank"]));
    }

    #[test]
    fn a_frame_keeps_its_number_when_another_goes() {
        let mut heard = Heard::default();
        let attach = |heard: &mut Heard, session: &str, frame: &str| {
            heard.attached("", &json!({ "sessionId": session, "targetInfo": { "type": "iframe", "targetId": frame, "url": "https://b.example/" } }));
        };
        attach(&mut heard, "s1", "F1");
        attach(&mut heard, "s2", "F2");
        heard.detached(&json!({ "sessionId": "s1" }));
        assert!(heard.frame(1).is_none());
        assert_eq!(heard.frame(2).map(|one| one.id).as_deref(), Some("F2"));
        attach(&mut heard, "s3", "F2");
        assert_eq!(heard.frame(2).map(|one| one.session).as_deref(), Some("s3"));
        heard.attached(
            "",
            &json!({ "sessionId": "w", "targetInfo": { "type": "worker", "targetId": "W" } }),
        );
        assert_eq!(heard.frames().len(), 1);
    }

    #[test]
    fn a_frame_inside_a_frame_is_told_apart_and_asked_once() {
        let mut heard = Heard::default();
        let attach = |heard: &mut Heard, parent: &str, session: &str, frame: &str| {
            heard_event(
                heard,
                "Target.attachedToTarget",
                parent,
                json!({ "sessionId": session, "targetInfo": { "type": "iframe", "targetId": frame, "url": "https://b.example/" } }),
            );
        };
        attach(&mut heard, "", "s1", "F1");
        assert_eq!(heard.not_nested(), ["s1"]);
        heard.nested.insert("s1".to_string());
        attach(&mut heard, "s1", "s2", "F2");
        assert_eq!(heard.not_nested(), ["s2"]);
        assert_eq!(heard.frame(2).map(|one| one.parent).as_deref(), Some("s1"));
        heard.detached(&json!({ "sessionId": "s1" }));
        assert!(!heard.nested.contains("s1"));
    }

    #[test]
    fn text_is_cut_between_two_characters() {
        assert_eq!(cut("héllo".into(), 2), "hé");
        assert_eq!(cut("hi".into(), 5), "hi");
    }
}
