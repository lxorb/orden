#![cfg_attr(
    not(any(windows, feature = "cef", target_os = "macos")),
    allow(dead_code)
)]

use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, PoisonError};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter as _, Manager as _};

pub(crate) const BINDING: &str = "nibPass";

const SCRIPT: &str = include_str!("web_pass.js");

const LONGEST: usize = 64 * 1024;

const LONGEST_ID: usize = 64;

const LONGEST_VALUE: usize = 4096;

const MOST_FORMS: usize = 64;

const MOST_FIELDS: usize = 256;

const MOST_VALUES: usize = 64;

const MOST_FRAMES: usize = 64;

const FORMS: &str = "orden://pass-forms";

const MARK: &str = "orden://pass-mark";

const SUBMITTED: &str = "orden://pass-submitted";

const FILL: &str =
    "function (asked) { var pass = globalThis.__nibPass; return pass ? pass.fill(asked) : false }";

const KINDS: [&str; 8] = [
    "login", "username", "password", "totp", "signup", "change", "card", "identity",
];

const ROLES: [&str; 25] = [
    "username",
    "email",
    "password",
    "new-password",
    "totp",
    "cc-name",
    "cc-number",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-csc",
    "given-name",
    "additional-name",
    "family-name",
    "name",
    "tel",
    "street-address",
    "address-line2",
    "postal-code",
    "address-level2",
    "address-level1",
    "country",
    "organization",
    "bday",
    "unknown",
];

pub(crate) fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Place {
    pub(crate) frame: String,
    pub(crate) origin: String,
    pub(crate) url: String,
    pub(crate) top: bool,
}

pub(crate) fn secure(origin: &str) -> bool {
    let Ok(url) = tauri::Url::parse(origin) else {
        return false;
    };
    match url.scheme() {
        "https" => url.host().is_some(),
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct PageField {
    field: String,
    role: String,
    visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct PageForm {
    form: String,
    kind: String,
    fields: Vec<PageField>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Said {
    Forms {
        forms: Vec<PageForm>,
    },
    Mark {
        form: String,
        field: String,
    },
    Submitted {
        form: String,
        #[serde(rename = "formKind")]
        form_kind: String,
        username: Option<String>,
        password: Option<String>,
        #[serde(rename = "newPassword")]
        new_password: Option<String>,
    },
}

#[derive(Debug, PartialEq, Eq)]
struct Heard {
    doc: Option<String>,
    said: Said,
}

fn script_named(id: &str) -> bool {
    !id.is_empty() && id.len() <= LONGEST_ID && id.bytes().all(|one| one.is_ascii_alphanumeric())
}

fn short_value(value: Option<&String>) -> bool {
    value.is_none_or(|one| one.len() <= LONGEST_VALUE)
}

impl Said {
    fn sound(&self) -> bool {
        match self {
            Self::Forms { forms } => {
                forms.len() <= MOST_FORMS
                    && forms.iter().all(|form| {
                        script_named(&form.form)
                            && KINDS.contains(&form.kind.as_str())
                            && form.fields.len() <= MOST_FIELDS
                            && form.fields.iter().all(|one| {
                                script_named(&one.field) && ROLES.contains(&one.role.as_str())
                            })
                    })
            }
            Self::Mark { form, field } => script_named(form) && script_named(field),
            Self::Submitted {
                form,
                form_kind,
                username,
                password,
                new_password,
            } => {
                script_named(form)
                    && KINDS.contains(&form_kind.as_str())
                    && short_value(username.as_ref())
                    && short_value(password.as_ref())
                    && short_value(new_password.as_ref())
            }
        }
    }
}

fn message_read(payload: &str) -> Option<Heard> {
    if payload.len() > LONGEST {
        return None;
    }
    let value: Value = serde_json::from_str(payload).ok()?;
    let doc = value
        .get("doc")
        .and_then(Value::as_str)
        .filter(|one| script_named(one))
        .map(str::to_string);
    let said: Said = serde_json::from_value(value).ok()?;
    said.sound().then_some(Heard { doc, said })
}

fn event_told(tab: &str, place: &Place, said: &Said) -> (&'static str, Value) {
    let mut told = json!({
        "tab": tab,
        "frame": place.frame,
        "origin": place.origin,
        "url": place.url,
        "secure": secure(&place.origin),
        "top": place.top,
    });
    let (event, more) = match said {
        Said::Forms { forms } => (
            FORMS,
            json!({
                "forms": forms.iter().map(|form| json!({
                    "form": form.form,
                    "kind": form.kind,
                    "fields": form.fields.iter().map(|one| json!({
                        "field": one.field,
                        "role": one.role,
                        "visible": one.visible,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            }),
        ),
        Said::Mark { form, field } => (MARK, json!({ "form": form, "field": field })),
        Said::Submitted {
            form,
            form_kind,
            username,
            password,
            new_password,
        } => (
            SUBMITTED,
            json!({
                "form": form,
                "kind": form_kind,
                "username": username,
                "password": password,
                "newPassword": new_password,
            }),
        ),
    };
    if let (Some(all), Value::Object(more)) = (told.as_object_mut(), more) {
        all.extend(more);
    }
    (event, told)
}

fn said_emitted(app: &AppHandle, window: &str, tab: &str, place: &Place, said: &Said) {
    let (event, body) = event_told(tab, place, said);
    let _ = app.emit_to(window, event, body);
}

fn fill_asked(
    form: &str,
    origin: &str,
    doc: Option<&str>,
    values: &HashMap<String, String>,
    submit: bool,
) -> Value {
    let mut asked = json!({
        "form": form,
        "origin": origin,
        "values": values,
        "submit": submit,
    });
    if let Some(doc) = doc {
        asked["doc"] = Value::from(doc);
    }
    asked
}

fn fill_checked(
    frame: &str,
    origin: &str,
    form: &str,
    values: &HashMap<String, String>,
) -> Result<(), String> {
    if !script_named(form) || frame.is_empty() || frame.len() > 256 {
        return Err("Pass was asked to fill a form it does not know".into());
    }
    if values.len() > MOST_VALUES
        || values
            .iter()
            .any(|(field, value)| !script_named(field) || value.len() > LONGEST_VALUE)
    {
        return Err("Pass was asked to fill fields it does not know".into());
    }
    if !secure(origin) {
        return Err("Pass fills only a page that is https or on this machine".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn web_pass_fill(
    webview: tauri::Webview,
    tab: String,
    frame: String,
    origin: String,
    form: String,
    values: HashMap<String, String>,
    submit: bool,
) -> Result<bool, String> {
    crate::agents::from_the_app(&webview)?;
    fill_checked(&frame, &origin, &form, &values)?;
    let view = crate::web_tabs::found(webview.app_handle(), &tab)?;
    engine::frame_fill(view, tab, frame, origin, form, values, submit).await
}

pub(crate) fn forget(tab: &str) {
    engine::forget(tab);
}

#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
pub(crate) struct Queues<J: Send + 'static> {
    held: Mutex<HashMap<String, Sender<J>>>,
}

#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
impl<J: Send + 'static> Queues<J> {
    pub(crate) fn new() -> Self {
        Self {
            held: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn spawn(&self, tab: &str, job: J, run: fn(J)) {
        let mut held = self.held.lock().unwrap_or_else(PoisonError::into_inner);
        let job = match held.get(tab) {
            Some(sending) => match sending.send(job) {
                Ok(()) => return,
                Err(back) => back.0,
            },
            None => job,
        };
        let (sending, jobs) = channel::<J>();
        if sending.send(job).is_err() {
            return;
        }
        held.insert(tab.to_string(), sending);
        std::thread::spawn(move || {
            for job in jobs {
                run(job);
            }
        });
    }

    pub(crate) fn forget(&self, tab: &str) {
        self.held
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(tab);
    }
}

#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
fn place_in(tree: Option<&Value>, main: bool, was: &Place) -> Option<Place> {
    frames_in(tree, main)
        .into_iter()
        .find(|one| one.frame == was.frame && one.origin == was.origin)
}

#[cfg(feature = "cef")]
pub(crate) use engine::binding_called;
pub(crate) use engine::listen;

#[cfg(any(windows, feature = "cef"))]
mod engine {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{AppHandle, Webview};

    use super::Place;
    use crate::agents::cdp;
    use crate::agents::engines::View;

    const PATIENCE: Duration = Duration::from_secs(5);

    const MOST_KNOWN: usize = 2048;

    #[derive(Default)]
    struct Known {
        contexts: HashMap<(String, String, i64), Place>,
        frames: HashMap<(String, String), String>,
    }

    static KNOWN: LazyLock<Mutex<Known>> = LazyLock::new(Mutex::default);

    struct Job {
        view: Webview,
        app: AppHandle,
        window: String,
        tab: String,
        session: String,
        context: i64,
        payload: String,
    }

    static JOBS: LazyLock<super::Queues<Job>> = LazyLock::new(super::Queues::new);

    fn known_frames() -> MutexGuard<'static, Known> {
        KNOWN.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn binding_called(
        view: &Webview,
        app: &AppHandle,
        window: &str,
        tab: &str,
        session: Option<&str>,
        params: &Value,
    ) {
        if params.get("name").and_then(Value::as_str) != Some(super::BINDING) {
            return;
        }
        let (Some(payload), Some(context)) = (
            params.get("payload").and_then(Value::as_str),
            params.get("executionContextId").and_then(Value::as_i64),
        ) else {
            return;
        };
        if payload.len() > super::LONGEST {
            return;
        }
        let job = Job {
            view: view.clone(),
            app: app.clone(),
            window: window.to_string(),
            tab: tab.to_string(),
            session: session.unwrap_or_default().to_string(),
            context,
            payload: payload.to_string(),
        };
        JOBS.spawn(tab, job, |job| job_done(&job));
    }

    fn job_done(job: &Job) {
        let Some(heard) = super::message_read(&job.payload) else {
            return;
        };
        let Some(place) = context_placed(&job.view, &job.tab, &job.session, job.context) else {
            crate::trace::mark("pass: a message from a frame the engine did not place");
            return;
        };
        let Some(place) = place_now(&job.view, &job.tab, &job.session, job.context, &place) else {
            return;
        };
        super::said_emitted(&job.app, &job.window, &job.tab, &place, &heard.said);
    }

    fn context_placed(view: &Webview, tab: &str, session: &str, context: i64) -> Option<Place> {
        let key = (tab.to_string(), session.to_string(), context);
        if let Some(place) = known_frames().contexts.get(&key) {
            return Some(place.clone());
        }
        frames_learned(view, tab, session);
        known_frames().contexts.get(&key).cloned()
    }

    fn place_now(
        view: &Webview,
        tab: &str,
        session: &str,
        context: i64,
        was: &Place,
    ) -> Option<Place> {
        let tree = cdp::call_in(
            &View::Webview(view.clone()),
            session_asked(session),
            "Page.getFrameTree",
            &json!({}),
            PATIENCE,
        )
        .ok()?;
        let now = super::place_in(tree.get("frameTree"), session.is_empty(), was)?;
        known_frames()
            .contexts
            .insert((tab.to_string(), session.to_string(), context), now.clone());
        Some(now)
    }

    fn session_asked(session: &str) -> Option<&str> {
        (!session.is_empty()).then_some(session)
    }

    fn world_in(frame: &str) -> Value {
        json!({ "frameId": frame, "worldName": crate::web_worlds::WORLD })
    }

    fn frames_learned(view: &Webview, tab: &str, session: &str) {
        let view = View::Webview(view.clone());
        let Ok(tree) = cdp::call_in(
            &view,
            session_asked(session),
            "Page.getFrameTree",
            &json!({}),
            PATIENCE,
        ) else {
            return;
        };
        for frame in super::frames_in(tree.get("frameTree"), session.is_empty()) {
            let Ok(world) = cdp::call_in(
                &view,
                session_asked(session),
                "Page.createIsolatedWorld",
                &world_in(&frame.frame),
                PATIENCE,
            ) else {
                continue;
            };
            let Some(context) = world.get("executionContextId").and_then(Value::as_i64) else {
                continue;
            };
            let mut known = known_frames();
            if known.contexts.len() >= MOST_KNOWN {
                known.contexts.retain(|(owner, _, _), _| owner != tab);
            }
            known
                .frames
                .insert((tab.to_string(), frame.frame.clone()), session.to_string());
            known
                .contexts
                .insert((tab.to_string(), session.to_string(), context), frame);
        }
    }

    fn frame_filled(
        view: &Webview,
        tab: &str,
        frame: &str,
        origin: &str,
        asked: &Value,
    ) -> Result<bool, String> {
        let session = known_frames()
            .frames
            .get(&(tab.to_string(), frame.to_string()))
            .cloned()
            .ok_or_else(|| "Pass has heard nothing from that frame".to_string())?;
        let view = View::Webview(view.clone());
        let call = |method: &str, params: &Value| {
            cdp::call_in(&view, session_asked(&session), method, params, PATIENCE)
                .map_err(|_| "the page could not be reached to fill it".to_string())
        };
        let world = call("Page.createIsolatedWorld", &world_in(frame))?;
        let context = world
            .get("executionContextId")
            .and_then(Value::as_i64)
            .ok_or_else(|| "the frame has no world to fill from".to_string())?;
        let tree = call("Page.getFrameTree", &json!({}))?;
        let now = super::frames_in(tree.get("frameTree"), session.is_empty())
            .into_iter()
            .find(|one| one.frame == frame)
            .ok_or_else(|| "that frame is gone".to_string())?;
        if now.origin != origin {
            return Err("that frame is on another site now".into());
        }
        let said = call(
            "Runtime.callFunctionOn",
            &json!({
                "functionDeclaration": super::FILL,
                "executionContextId": context,
                "arguments": [{ "value": asked }],
                "returnByValue": true,
                "awaitPromise": true,
                "silent": true,
            }),
        )?;
        Ok(said
            .pointer("/result/value")
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }

    pub(super) async fn frame_fill(
        view: Webview,
        tab: String,
        frame: String,
        origin: String,
        form: String,
        values: HashMap<String, String>,
        submit: bool,
    ) -> Result<bool, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let asked = super::fill_asked(&form, &origin, None, &values, submit);
            frame_filled(&view, &tab, &frame, &origin, &asked)
        })
        .await
        .map_err(|_| "the page could not be filled".to_string())?
    }

    pub(super) fn forget(tab: &str) {
        JOBS.forget(tab);
        let mut known = known_frames();
        known.contexts.retain(|(owner, _, _), _| owner != tab);
        known.frames.retain(|(owner, _), _| owner != tab);
    }

    #[cfg(feature = "cef")]
    pub(crate) fn listen(
        _webview: &tauri::webview::PlatformWebview,
        _app: AppHandle,
        _tab: String,
        _window: String,
    ) {
    }

    #[cfg(all(windows, not(feature = "cef")))]
    pub(crate) fn listen(
        webview: &tauri::webview::PlatformWebview,
        app: AppHandle,
        tab: String,
        window: String,
    ) {
        use tauri::Manager as _;

        let Some(core) = cdp::core_of(webview) else {
            return;
        };
        let _ = cdp::hear(&core, "Runtime.bindingCalled", move |session, params| {
            let Some(view) = app.get_webview(&crate::web_tabs::label_of(&tab)) else {
                return;
            };
            binding_called(&view, &app, &window, &tab, Some(session), &params);
        });
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod engine {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
    use objc2_foundation::{MainThreadMarker, NSError, NSNumber, NSObjectProtocol, NSString};
    use objc2_web_kit::{
        WKContentWorld, WKFrameInfo, WKScriptMessage, WKScriptMessageHandler,
        WKUserContentController, WKWebView,
    };
    use tauri::{AppHandle, Webview};

    use super::Place;

    const PATIENCE: Duration = Duration::from_secs(10);

    const MOST_FRAMES: usize = 256;

    struct Held {
        app: AppHandle,
        tab: String,
        window: String,
    }

    type Frames = HashMap<(String, String), (Retained<WKFrameInfo>, String)>;

    thread_local! {
        static FRAMES: RefCell<Frames> = RefCell::new(HashMap::new());
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "NibPassMessages"]
        #[ivars = Held]
        struct Messages;

        unsafe impl NSObjectProtocol for Messages {}

        unsafe impl WKScriptMessageHandler for Messages {
            #[unsafe(method(userContentController:didReceiveScriptMessage:))]
            fn received(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
                message_heard(self.ivars(), message);
            }
        }
    );

    #[allow(
        unsafe_code,
        reason = "a script message and the frame it came from are read through the Objective-C runtime"
    )]
    fn message_heard(held: &Held, message: &WKScriptMessage) {
        let (payload, frame) = unsafe {
            let body = message.body();
            let Some(text) = body.downcast_ref::<NSString>() else {
                return;
            };
            (text.to_string(), message.frameInfo())
        };
        let Some(heard) = super::message_read(&payload) else {
            return;
        };
        let Some(doc) = heard.doc.clone() else {
            return;
        };
        let place = unsafe {
            let origin = frame.securityOrigin();
            Place {
                frame: doc.clone(),
                origin: crate::web_tabs::origin_written(
                    &origin.protocol().to_string(),
                    &origin.host().to_string(),
                    origin.port(),
                ),
                url: frame
                    .request()
                    .URL()
                    .and_then(|url| url.absoluteString())
                    .map(|url| url.to_string())
                    .unwrap_or_default(),
                top: frame.isMainFrame(),
            }
        };
        FRAMES.with_borrow_mut(|all| {
            if all.len() >= MOST_FRAMES {
                all.retain(|(owner, _), _| owner != &held.tab);
            }
            all.insert((held.tab.clone(), doc), (frame, place.origin.clone()));
        });
        super::said_emitted(&held.app, &held.window, &held.tab, &place, &heard.said);
    }

    #[allow(
        unsafe_code,
        reason = "a content world is named through the Objective-C runtime"
    )]
    fn nib_world(mtm: MainThreadMarker) -> Retained<WKContentWorld> {
        unsafe { WKContentWorld::worldWithName(&NSString::from_str(crate::web_worlds::WORLD), mtm) }
    }

    #[allow(
        unsafe_code,
        reason = "a WKWebView's script message handlers are set through the Objective-C runtime"
    )]
    pub(crate) fn listen(
        webview: &tauri::webview::PlatformWebview,
        app: AppHandle,
        tab: String,
        window: String,
    ) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
            return;
        };
        let messages = Messages::alloc(mtm).set_ivars(Held { app, tab, window });
        let messages: Retained<Messages> = unsafe { msg_send![super(messages), init] };
        let world = nib_world(mtm);
        let name = NSString::from_str(super::BINDING);
        unsafe {
            let content = view.configuration().userContentController();
            content.removeScriptMessageHandlerForName_contentWorld(&name, &world);
            content.addScriptMessageHandler_contentWorld_name(
                ProtocolObject::from_ref(&*messages),
                &world,
                &name,
            );
        }
    }

    #[allow(
        unsafe_code,
        reason = "a frame is filled through WKWebView's Objective-C interface, from the pointer wry hands out"
    )]
    pub(super) async fn frame_fill(
        view: Webview,
        tab: String,
        frame: String,
        origin: String,
        form: String,
        values: HashMap<String, String>,
        submit: bool,
    ) -> Result<bool, String> {
        let asked = super::fill_asked(&form, &origin, Some(&frame), &values, submit);
        let body = format!("return ({})({asked})", super::FILL);
        let (sending, mut answered) = tauri::async_runtime::channel::<Result<bool, String>>(1);
        view.with_webview(move |platform| {
            let refused = sending.clone();
            let say = move |said: Result<bool, String>| {
                let _ = refused.try_send(said);
            };
            let Some(mtm) = MainThreadMarker::new() else {
                say(Err("not on the window's thread".into()));
                return;
            };
            let Some(web) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) })
            else {
                say(Err("the page has gone".into()));
                return;
            };
            let Some((info, was)) =
                FRAMES.with_borrow(|all| all.get(&(tab.clone(), frame.clone())).cloned())
            else {
                say(Err("Pass has heard nothing from that frame".into()));
                return;
            };
            if was != origin {
                say(Err("that frame is on another site now".into()));
                return;
            }
            let answering = sending.clone();
            let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let said = unsafe {
                    if error.as_ref().is_some() {
                        Err("the page could not be filled".to_string())
                    } else {
                        Ok(value
                            .as_ref()
                            .and_then(|value| value.downcast_ref::<NSNumber>())
                            .is_some_and(NSNumber::as_bool))
                    }
                };
                let _ = answering.try_send(said);
            });
            unsafe {
                web.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(&body),
                    None,
                    Some(&info),
                    &nib_world(mtm),
                    Some(&done),
                );
            }
        })
        .map_err(|_| "the page could not be reached to fill it".to_string())?;
        match tokio::time::timeout(PATIENCE, answered.recv()).await {
            Ok(Some(said)) => said,
            _ => Err("the page did not answer".into()),
        }
    }

    pub(super) fn forget(tab: &str) {
        let tab = tab.to_string();
        FRAMES.with_borrow_mut(|all| all.retain(|(owner, _), _| owner != &tab));
    }
}

#[cfg(not(any(windows, feature = "cef", target_os = "macos")))]
mod engine {
    use std::collections::HashMap;

    use tauri::{AppHandle, Webview};

    pub(crate) fn listen(
        _webview: &tauri::webview::PlatformWebview,
        _app: AppHandle,
        _tab: String,
        _window: String,
    ) {
    }

    pub(super) async fn frame_fill(
        _view: Webview,
        _tab: String,
        _frame: String,
        _origin: String,
        _form: String,
        _values: HashMap<String, String>,
        _submit: bool,
    ) -> Result<bool, String> {
        Ok(false)
    }

    pub(super) fn forget(_tab: &str) {}
}

#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
fn frames_in(tree: Option<&Value>, main: bool) -> Vec<Place> {
    let mut found = Vec::new();
    let mut walking: Vec<&Value> = tree.into_iter().collect();
    while let Some(node) = walking.pop() {
        if found.len() >= MOST_FRAMES {
            break;
        }
        if let Some(frame) = node.get("frame") {
            if let Some(id) = frame.get("id").and_then(Value::as_str) {
                let text = |key: &str| {
                    frame
                        .get(key)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                found.push(Place {
                    frame: id.to_string(),
                    origin: text("securityOrigin"),
                    url: text("url") + &text("urlFragment"),
                    top: main && frame.get("parentId").is_none(),
                });
            }
        }
        walking.extend(
            node.get("childFrames")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );
    }
    found
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use std::sync::mpsc::{channel, Sender};
    use std::time::Duration;

    use super::{
        event_told, fill_asked, fill_checked, frames_in, message_read, place_in, script, secure,
        Place, Queues, Said, MOST_FRAMES,
    };

    fn place() -> Place {
        Place {
            frame: "F1".into(),
            origin: "https://a.example".into(),
            url: "https://a.example/login".into(),
            top: true,
        }
    }

    #[test]
    fn a_page_is_secure_when_it_is_https_or_on_this_machine() {
        for origin in [
            "https://a.example",
            "https://a.example:8443",
            "http://localhost:3000",
            "http://127.0.0.1",
            "http://[::1]:8080",
        ] {
            assert!(secure(origin), "{origin}");
        }
        for origin in [
            "http://a.example",
            "http://localhost.a.example",
            "http://127.0.0.2",
            "file:///etc",
            "null",
            "://",
            "",
            "data:text/html,x",
        ] {
            assert!(!secure(origin), "{origin}");
        }
    }

    #[test]
    fn the_forms_a_page_has_are_told_with_where_the_engine_says_they_are() {
        let heard = message_read(
            r#"{"doc":"ab12","kind":"forms","forms":[{"form":"f1","kind":"login","fields":[{"field":"e2","role":"email","visible":true},{"field":"e3","role":"password","visible":false}]}]}"#,
        )
        .expect("forms");
        assert_eq!(heard.doc.as_deref(), Some("ab12"));
        let (event, body) = event_told("t1", &place(), &heard.said);
        assert_eq!(event, "orden://pass-forms");
        assert_eq!(
            body,
            json!({
                "tab": "t1",
                "frame": "F1",
                "origin": "https://a.example",
                "url": "https://a.example/login",
                "secure": true,
                "top": true,
                "forms": [{
                    "form": "f1",
                    "kind": "login",
                    "fields": [
                        { "field": "e2", "role": "email", "visible": true },
                        { "field": "e3", "role": "password", "visible": false },
                    ],
                }],
            })
        );
    }

    #[test]
    fn a_mark_pressed_and_a_form_sent_are_told_in_their_own_shapes() {
        let mark = message_read(r#"{"kind":"mark","form":"f1","field":"e3"}"#).expect("mark");
        let (event, body) = event_told("t1", &place(), &mark.said);
        assert_eq!(event, "orden://pass-mark");
        assert_eq!(body["form"], "f1");
        assert_eq!(body["field"], "e3");
        assert_eq!(body["secure"], true);

        let sent = message_read(
            r#"{"kind":"submitted","form":"f1","formKind":"change","username":null,"password":"old","newPassword":"new"}"#,
        )
        .expect("submitted");
        let (event, body) = event_told("t1", &place(), &sent.said);
        assert_eq!(event, "orden://pass-submitted");
        assert_eq!(body["kind"], "change");
        assert_eq!(body["username"], serde_json::Value::Null);
        assert_eq!(body["password"], "old");
        assert_eq!(body["newPassword"], "new");
    }

    #[test]
    fn what_is_not_a_message_of_the_script_s_is_dropped() {
        let long = format!(
            r#"{{"kind":"mark","form":"f1","field":"e1","pad":"{}"}}"#,
            "x".repeat(64 * 1024)
        );
        for payload in [
            "",
            "not json",
            "[]",
            r#"{"kind":"steal","form":"f1"}"#,
            r#"{"form":"f1","field":"e1"}"#,
            r#"{"kind":"mark","form":"f 1","field":"e1"}"#,
            r#"{"kind":"mark","form":"","field":"e1"}"#,
            r#"{"kind":"mark","form":"f1"}"#,
            r#"{"kind":"forms","forms":[{"form":"f1","kind":"shop","fields":[]}]}"#,
            r#"{"kind":"forms","forms":[{"form":"f1","kind":"login","fields":[{"field":"e1","role":"ssn","visible":true}]}]}"#,
            r#"{"kind":"forms","forms":[{"form":"f1","kind":"login","fields":[{"field":"e1","role":"email","visible":"yes"}]}]}"#,
            r#"{"kind":"submitted","form":"f1","formKind":"login","username":7,"password":null,"newPassword":null}"#,
            long.as_str(),
        ] {
            assert!(message_read(payload).is_none(), "{payload:.80}");
        }
        let too_long = format!(
            r#"{{"kind":"submitted","form":"f1","formKind":"login","username":null,"password":"{}","newPassword":null}}"#,
            "x".repeat(5000)
        );
        assert!(message_read(&too_long).is_none());
        let many = (0..65)
            .map(|at| format!(r#"{{"form":"f{at}","kind":"login","fields":[]}}"#))
            .collect::<Vec<_>>()
            .join(",");
        assert!(message_read(&format!(r#"{{"kind":"forms","forms":[{many}]}}"#)).is_none());
    }

    #[test]
    fn a_document_s_name_is_kept_only_when_it_is_one() {
        let heard = message_read(r#"{"doc":"<script>","kind":"mark","form":"f1","field":"e1"}"#);
        assert_eq!(heard.expect("mark").doc, None);
        assert_eq!(
            message_read(r#"{"kind":"mark","form":"f1","field":"e1"}"#)
                .expect("mark")
                .said,
            Said::Mark {
                form: "f1".into(),
                field: "e1".into()
            }
        );
    }

    #[test]
    fn a_frame_is_placed_again_where_it_is_now_after_its_address_changed_in_place() {
        let was = place();
        let moved = json!({
            "frame": { "id": "F1", "url": "https://a.example/account", "securityOrigin": "https://a.example" },
        });
        assert_eq!(
            place_in(Some(&moved), true, &was),
            Some(Place {
                url: "https://a.example/account".into(),
                ..place()
            })
        );
        let elsewhere = json!({
            "frame": { "id": "F1", "url": "https://b.example/", "securityOrigin": "https://b.example" },
        });
        assert_eq!(place_in(Some(&elsewhere), true, &was), None);
        let gone = json!({ "frame": { "id": "F2", "url": "https://a.example/", "securityOrigin": "https://a.example" } });
        assert_eq!(place_in(Some(&gone), true, &was), None);
    }

    #[test]
    fn a_page_of_endless_frames_is_read_only_so_far() {
        let children: Vec<_> = (0..500)
            .map(|at| json!({ "frame": { "id": format!("C{at}"), "parentId": "M", "url": "https://a.example/", "securityOrigin": "https://a.example" } }))
            .collect();
        let tree = json!({
            "frame": { "id": "M", "url": "https://a.example/", "securityOrigin": "https://a.example" },
            "childFrames": children,
        });
        assert_eq!(frames_in(Some(&tree), true).len(), MOST_FRAMES);
    }

    type Run = Box<dyn FnOnce() + Send>;

    fn ran(run: Run) {
        run();
    }

    fn saying(to: Sender<&'static str>, word: &'static str) -> Run {
        Box::new(move || {
            let _ = to.send(word);
        })
    }

    #[test]
    fn a_tab_held_up_by_its_page_never_holds_another_tab_up() {
        let queues = Queues::<Run>::new();
        let (release, held) = channel::<()>();
        let (heard, said) = channel::<&'static str>();
        let first = heard.clone();
        queues.spawn(
            "slow",
            Box::new(move || {
                let _ = held.recv();
                let _ = first.send("slow");
            }),
            ran,
        );
        queues.spawn("quick", saying(heard.clone(), "quick"), ran);
        assert_eq!(said.recv_timeout(Duration::from_secs(5)), Ok("quick"));
        queues.spawn("slow", saying(heard.clone(), "after"), ran);
        assert!(said.recv_timeout(Duration::from_millis(200)).is_err());
        release.send(()).expect("the slow tab waits");
        assert_eq!(said.recv_timeout(Duration::from_secs(5)), Ok("slow"));
        assert_eq!(said.recv_timeout(Duration::from_secs(5)), Ok("after"));
        queues.forget("slow");
        queues.spawn("slow", saying(heard, "again"), ran);
        assert_eq!(said.recv_timeout(Duration::from_secs(5)), Ok("again"));
    }

    #[test]
    fn a_frame_is_placed_by_the_engine_s_own_tree() {
        let tree = json!({
            "frame": { "id": "M", "url": "https://a.example/", "securityOrigin": "https://a.example" },
            "childFrames": [
                {
                    "frame": { "id": "C", "parentId": "M", "url": "https://pay.example/card", "urlFragment": "#x", "securityOrigin": "https://pay.example" },
                },
                {
                    "frame": { "id": "S", "parentId": "M", "url": "about:srcdoc", "securityOrigin": "https://a.example" },
                },
            ],
        });
        let mut frames = frames_in(Some(&tree), true);
        frames.sort_by(|one, other| one.frame.cmp(&other.frame));
        assert_eq!(
            frames,
            vec![
                Place {
                    frame: "C".into(),
                    origin: "https://pay.example".into(),
                    url: "https://pay.example/card#x".into(),
                    top: false,
                },
                Place {
                    frame: "M".into(),
                    origin: "https://a.example".into(),
                    url: "https://a.example/".into(),
                    top: true,
                },
                Place {
                    frame: "S".into(),
                    origin: "https://a.example".into(),
                    url: "about:srcdoc".into(),
                    top: false,
                },
            ]
        );
        let other = frames_in(Some(&tree), false);
        assert!(other.iter().all(|one| !one.top));
        assert!(frames_in(None, true).is_empty());
    }

    #[test]
    fn a_fill_is_asked_only_for_known_names_on_a_secure_page() {
        let values: HashMap<String, String> = [("e1".to_string(), "alice".to_string())].into();
        assert!(fill_checked("F1", "https://a.example", "f1", &values).is_ok());
        let refused = fill_checked("F1", "http://a.example", "f1", &values).expect_err("http");
        assert!(!refused.contains("alice"));
        assert!(fill_checked("F1", "https://a.example", "f 1", &values).is_err());
        assert!(fill_checked("", "https://a.example", "f1", &values).is_err());
        let odd: HashMap<String, String> = [("e1\"".to_string(), "alice".to_string())].into();
        let refused = fill_checked("F1", "https://a.example", "f1", &odd).expect_err("odd");
        assert!(!refused.contains("alice"));
    }

    #[test]
    fn a_fill_carries_the_origin_the_script_checks_again() {
        let values: HashMap<String, String> = [("e1".to_string(), "alice".to_string())].into();
        let without = fill_asked("f1", "https://a.example", None, &values, true);
        assert_eq!(
            without,
            json!({ "form": "f1", "origin": "https://a.example", "values": { "e1": "alice" }, "submit": true })
        );
        let with = fill_asked("f1", "https://a.example", Some("ab12"), &values, false);
        assert_eq!(with["doc"], "ab12");
    }

    #[test]
    fn the_script_is_handed_over_whole_and_answers_to_the_binding() {
        assert!(script().starts_with("(function ()"));
        assert!(script().contains("globalThis.nibPass"));
        assert!(script().contains("__nibPass"));
        assert!(super::FILL.contains("__nibPass"));
    }
}
