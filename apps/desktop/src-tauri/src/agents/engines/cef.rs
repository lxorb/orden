#![allow(
    clippy::transmute_ptr_to_ptr,
    reason = "the cef crate's wrap_* macros transmute between a wrapper and the struct it wraps"
)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

#[allow(
    clippy::wildcard_imports,
    reason = "the cef crate's wrap_* macros expand to calls on its traits by their bare names"
)]
use cef::*;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::super::cdp;
use super::super::quiet::{self, Owner, Said};
use super::super::tabs;
use super::super::verbs::{Dialog, DialogKind, Download, DownloadState};
use super::View;

const FRAME_RATE: i32 = 60;

static WINDOWLESS: OnceLock<bool> = OnceLock::new();

pub fn windowless_wanted(config: &Path) -> bool {
    *WINDOWLESS.get_or_init(|| {
        std::env::var_os("ORDEN_AGENT_PAGES").is_some_and(|said| said == "1")
            || std::fs::read_to_string(config.join("agents.json")).is_ok_and(|text| paired(&text))
    })
}

fn paired(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|file| file.get("agents")?.as_array().map(|all| !all.is_empty()))
        .unwrap_or(false)
}

type Hearing = Arc<dyn Fn(&str, Option<&str>, &Value) + Send + Sync>;

struct Page {
    owner: Owner,
    app: AppHandle,
    size: (u32, u32),
    going: Mutex<Option<String>>,
    built: Mutex<Option<SyncSender<Result<(), String>>>>,
    host: Mutex<Option<BrowserHost>>,
    observing: Mutex<Option<Registration>>,
    url: Mutex<String>,
    waiting: Mutex<HashMap<i32, SyncSender<Result<Value, String>>>>,
    hearing: Mutex<Vec<Hearing>>,
    dialog: Mutex<Option<(u64, Answering)>>,
}

enum Answering {
    Script(JsdialogCallback),
    SignIn {
        session: Option<String>,
        request: String,
    },
    Certificate(
        SelectClientCertificateCallback,
        Vec<(X509Certificate, String)>,
    ),
}

impl Page {
    fn host(&self) -> Option<BrowserHost> {
        self.host
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn say(&self, text: String) {
        quiet::say(&self.owner.label, "warning", text);
    }
}

#[derive(Clone)]
pub struct Windowless {
    label: String,
    page: Arc<Page>,
}

static PAGES: Mutex<Option<HashMap<String, Windowless>>> = Mutex::new(None);

static NEXT: AtomicI32 = AtomicI32::new(1);

pub fn page(label: &str) -> Option<Windowless> {
    PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()?
        .get(label)
        .cloned()
}

impl Windowless {
    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn url(&self) -> String {
        self.page
            .url
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn close(&self) {
        if let Some(all) = PAGES
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            all.remove(&self.label);
        }
        if let Some(host) = self.page.host() {
            on_ui(move || host.close_browser(1));
        }
    }

    pub fn ask(
        &self,
        session: Option<&str>,
        method: &str,
        params: &Value,
    ) -> Result<cdp::Answering, String> {
        let host = self.page.host().ok_or("the page has closed")?;
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = Value::from(session);
        }
        let (answered, answer) = sync_channel(1);
        self.page
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, answered);
        let page = Arc::clone(&self.page);
        let bytes = message.to_string().into_bytes();
        let posted = on_ui(move || {
            if host.send_dev_tools_message(Some(&bytes)) == 0 {
                if let Some(waiting) = page
                    .waiting
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .remove(&id)
                {
                    let _ = waiting.try_send(Err("the page refused the message".into()));
                }
            }
        });
        if !posted {
            self.page
                .waiting
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            return Err("the engine's thread could not be reached".into());
        }
        Ok(answer)
    }

    pub fn tell(&self, method: &str, params: &Value) {
        let _ = self.ask(None, method, params);
    }

    pub fn hear(&self, heard: impl Fn(&str, Option<&str>, &Value) + Send + Sync + 'static) {
        self.page
            .hearing
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Arc::new(heard));
    }
}

type Work = Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>;

pub(crate) fn on_ui(job: impl FnOnce() + Send + 'static) -> bool {
    let job: Work = Arc::new(Mutex::new(Some(Box::new(job))));
    let mut task = Job::new(job);
    post_task(ThreadId::UI, Some(&mut task)) != 0
}

wrap_task! {
    struct Job {
        job: Work,
    }

    impl Task {
        fn execute(&self) {
            let job = self.job.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some(job) = job {
                job();
            }
        }
    }
}

pub fn build(
    app: &AppHandle,
    owner: &Owner,
    store: Option<&str>,
    size: (u32, u32),
    going: Option<&str>,
) -> Result<(), String> {
    if !WINDOWLESS.get().copied().unwrap_or(false) {
        return Err(
            "nib's own Chromium makes agents' pages from the launch after the first agent was paired: quit nib and open it again"
                .into(),
        );
    }
    let profile = crate::engine::profile(app, store)?;
    let (built, waiting) = sync_channel(1);
    let page = Arc::new(Page {
        owner: owner.clone(),
        app: app.clone(),
        size,
        going: Mutex::new(going.map(str::to_string)),
        built: Mutex::new(Some(built)),
        host: Mutex::new(None),
        observing: Mutex::new(None),
        url: Mutex::new("about:blank".into()),
        waiting: Mutex::new(HashMap::new()),
        hearing: Mutex::new(Vec::new()),
        dialog: Mutex::new(None),
    });
    let making = Arc::clone(&page);
    let posted = on_ui(move || {
        let settings = RequestContextSettings {
            cache_path: profile.to_string_lossy().as_ref().into(),
            ..Default::default()
        };
        let mut ready = Ready::new(Arc::new(Mutex::new(Some(Arc::clone(&making)))));
        if request_context_create_context(Some(&settings), Some(&mut ready)).is_none() {
            finished(
                &making,
                Err("the page's profile could not be opened".into()),
            );
        }
    });
    if !posted {
        return Err("the engine's thread could not be reached".into());
    }
    waiting
        .recv_timeout(tabs::BUILDING)
        .map_err(|_| "the page was never built".to_string())?
}

fn finished(page: &Page, outcome: Result<(), String>) {
    if let Some(built) = page
        .built
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
    {
        let _ = built.try_send(outcome);
    }
}

wrap_request_context_handler! {
    struct Ready {
        page: Arc<Mutex<Option<Arc<Page>>>>,
    }

    impl RequestContextHandler {
        fn on_request_context_initialized(&self, request_context: Option<&mut RequestContext>) {
            let Some(page) = self.page.lock().unwrap_or_else(PoisonError::into_inner).take() else {
                return;
            };
            let mut client = Agent::new(Arc::clone(&page));
            let made = browser_host_create_browser_sync(
                Some(&windowless()),
                Some(&mut client),
                Some(&CefString::from("about:blank")),
                Some(&browser_settings()),
                None,
                request_context,
            );
            if made.is_none() {
                finished(&page, Err("the engine made no page".into()));
            }
        }
    }
}

fn windowless() -> WindowInfo {
    WindowInfo {
        windowless_rendering_enabled: 1,
        runtime_style: RuntimeStyle::ALLOY,
        ..Default::default()
    }
}

fn browser_settings() -> BrowserSettings {
    BrowserSettings {
        windowless_frame_rate: FRAME_RATE,
        background_color: 0xFFFF_FFFF,
        ..Default::default()
    }
}

fn quietened(page: &Windowless) {
    for (method, params) in quieting() {
        page.tell(method, &params);
    }
}

fn quieting() -> [(&'static str, Value); 4] {
    [
        ("Page.enable", json!({})),
        (
            "Page.setInterceptFileChooserDialog",
            json!({ "enabled": true }),
        ),
        (
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": quiet::STUBS, "runImmediately": true }),
        ),
        ("Fetch.enable", signing_in()),
    ]
}

fn signing_in() -> Value {
    json!({ "handleAuthRequests": true, "patterns": [{ "urlPattern": "*" }] })
}

fn signed_in(request: &str, said: &Said) -> Value {
    let response = if said.accept {
        json!({
            "response": "ProvideCredentials",
            "username": said.username.as_deref().unwrap_or_default(),
            "password": said.password.as_deref().unwrap_or_default(),
        })
    } else {
        json!({ "response": "CancelAuth" })
    };
    json!({ "requestId": request, "authChallengeResponse": response })
}

fn made(page: &Arc<Page>, browser: &Browser) {
    let Some(host) = browser.host() else {
        finished(page, Err("the engine made a page with no host".into()));
        return;
    };
    host.was_hidden(0);
    host.set_windowless_frame_rate(FRAME_RATE);
    host.set_audio_muted(1);
    let mut observer = Listening::new(Arc::clone(page));
    let observing = host.add_dev_tools_message_observer(Some(&mut observer));
    *page
        .observing
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = observing;
    *page.host.lock().unwrap_or_else(PoisonError::into_inner) = Some(host);

    let handle = Windowless {
        label: page.owner.label.clone(),
        page: Arc::clone(page),
    };
    PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashMap::new)
        .insert(handle.label.clone(), handle.clone());
    cdp::follow_view(&View::Windowless(handle.clone()), &handle.label);
    quietened(&handle);
    let going = page
        .going
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    if let Some(url) = going {
        handle.tell("Page.navigate", &json!({ "url": url }));
    }
    finished(page, Ok(()));
}

fn closed(page: &Page) {
    if let Some(all) = PAGES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        if all
            .get(&page.owner.label)
            .is_some_and(|one| std::ptr::eq(Arc::as_ptr(&one.page), page))
        {
            all.remove(&page.owner.label);
        }
    }
    page.observing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    page.host
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    page.dialog
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    quiet::release(&page.owner.label);
    for (_, waiting) in page
        .waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .drain()
    {
        let _ = waiting.try_send(Err("the page has closed".into()));
    }
}

wrap_dev_tools_message_observer! {
    struct Listening {
        page: Arc<Page>,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_message(
            &self,
            _browser: Option<&mut Browser>,
            message: Option<&[u8]>,
        ) -> ::std::os::raw::c_int {
            if let Some(message) = message.and_then(|raw| serde_json::from_slice::<Value>(raw).ok()) {
                heard(&self.page, &message);
            }
            1
        }
    }
}

fn heard(page: &Arc<Page>, message: &Value) {
    if let Some(id) = message
        .get("id")
        .and_then(Value::as_i64)
        .and_then(|id| i32::try_from(id).ok())
    {
        let waiting = page
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(waiting) = waiting {
            let _ = waiting.try_send(answer(message));
        }
        return;
    }
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    let session = message.get("sessionId").and_then(Value::as_str);
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let request = params.get("requestId").and_then(Value::as_str);
    match (method, request) {
        ("Fetch.requestPaused", Some(request)) => {
            send(
                page,
                session,
                "Fetch.continueRequest",
                &json!({ "requestId": request }),
            );
            return;
        }
        ("Fetch.authRequired", Some(request)) => {
            let realm = params
                .pointer("/authChallenge/realm")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let url = params
                .pointer("/request/url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            hold(
                page,
                DialogKind::SignIn,
                quiet::signing_in(realm),
                String::new(),
                url.to_string(),
                Answering::SignIn {
                    session: session.map(str::to_string),
                    request: request.to_string(),
                },
            );
            return;
        }
        ("Target.attachedToTarget", _) => {
            if let Some(frame) = params.get("sessionId").and_then(Value::as_str) {
                send(page, Some(frame), "Fetch.enable", &signing_in());
            }
        }
        _ => {}
    }
    let hearing = page
        .hearing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    for one in hearing {
        one(method, session, &params);
    }
}

fn send(page: &Arc<Page>, session: Option<&str>, method: &str, params: &Value) {
    let found = Windowless {
        label: page.owner.label.clone(),
        page: Arc::clone(page),
    };
    let _ = found.ask(session, method, params);
}

fn answer(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the page refused")
            .to_string());
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

pub fn answer_dialog(_app: &AppHandle, label: &str, said: Said) -> Result<(), String> {
    let found = page(label).ok_or("the page has closed")?;
    settle(&found.page, None, said);
    Ok(())
}

fn settle(page: &Arc<Page>, number: Option<u64>, said: Said) {
    let held = {
        let mut dialog = page.dialog.lock().unwrap_or_else(PoisonError::into_inner);
        if dialog
            .as_ref()
            .is_some_and(|(one, _)| number.is_none_or(|number| *one == number))
        {
            dialog.take()
        } else {
            None
        }
    };
    let Some((_, answering)) = held else {
        return;
    };
    quiet::release(&page.owner.label);
    give(page, answering, said);
}

fn give(page: &Arc<Page>, answering: Answering, said: Said) {
    match answering {
        Answering::Script(callback) => {
            on_ui(move || {
                let words = said.text.as_deref().map(CefString::from);
                callback.cont(i32::from(said.accept), words.as_ref());
            });
        }
        Answering::SignIn { session, request } => send(
            page,
            session.as_deref(),
            "Fetch.continueWithAuth",
            &signed_in(&request, &said),
        ),
        Answering::Certificate(callback, offered) => {
            on_ui(move || {
                let mut chosen = said
                    .chosen(offered.iter().map(|(_, words)| words.as_str()))
                    .and_then(|at| offered.into_iter().nth(at))
                    .map(|(one, _)| one);
                callback.select(chosen.as_mut());
            });
        }
    }
}

fn hold(
    page: &Arc<Page>,
    kind: DialogKind,
    message: String,
    default: String,
    url: String,
    answering: Answering,
) {
    let number = quiet::NUMBER.fetch_add(1, Ordering::Relaxed);
    let before = page
        .dialog
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .replace((number, answering));
    if let Some((_, before)) = before {
        give(page, before, Said::only(false));
    }
    quiet::hold(
        &page.owner.label,
        Dialog {
            kind,
            message: cdp::cut(message, 4_000),
            default_text: (kind == DialogKind::Prompt).then_some(default),
            url,
            open_ms: 0,
        },
    );
    let late = Arc::clone(page);
    std::thread::spawn(move || {
        std::thread::sleep(quiet::DIALOG_PATIENCE);
        settle(&late, Some(number), Said::only(kind == DialogKind::Alert));
    });
}

fn text(said: Option<&CefString>) -> String {
    said.map(ToString::to_string).unwrap_or_default()
}

wrap_client! {
    struct Agent {
        page: Arc<Page>,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(Screen::new(Arc::clone(&self.page)))
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(Life::new(Arc::clone(&self.page)))
        }

        fn jsdialog_handler(&self) -> Option<JsdialogHandler> {
            Some(Dialogs::new(Arc::clone(&self.page)))
        }

        fn permission_handler(&self) -> Option<PermissionHandler> {
            Some(Permissions::new(Arc::clone(&self.page)))
        }

        fn download_handler(&self) -> Option<DownloadHandler> {
            Some(Downloads::new(Arc::clone(&self.page)))
        }

        fn dialog_handler(&self) -> Option<DialogHandler> {
            Some(Files::new(Arc::clone(&self.page)))
        }

        fn context_menu_handler(&self) -> Option<ContextMenuHandler> {
            Some(Menus::new())
        }

        fn request_handler(&self) -> Option<RequestHandler> {
            Some(Requests::new(Arc::clone(&self.page)))
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(Display::new(Arc::clone(&self.page)))
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            Some(Loads::new(Arc::clone(&self.page)))
        }
    }
}

wrap_render_handler! {
    struct Screen {
        page: Arc<Page>,
    }

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (width, height) = self.page.size;
                *rect = Rect {
                    x: 0,
                    y: 0,
                    width: i32::try_from(width).unwrap_or(1280),
                    height: i32::try_from(height).unwrap_or(800),
                };
            }
        }

        fn screen_info(
            &self,
            _browser: Option<&mut Browser>,
            screen_info: Option<&mut ScreenInfo>,
        ) -> ::std::os::raw::c_int {
            let Some(screen) = screen_info else {
                return 0;
            };
            let (width, height) = self.page.size;
            let whole = Rect {
                x: 0,
                y: 0,
                width: i32::try_from(width).unwrap_or(1280),
                height: i32::try_from(height).unwrap_or(800),
            };
            screen.device_scale_factor = 1.0;
            screen.depth = 24;
            screen.depth_per_component = 8;
            screen.rect.clone_from(&whole);
            screen.available_rect = whole;
            1
        }

        fn on_paint(
            &self,
            _browser: Option<&mut Browser>,
            _type_: PaintElementType,
            _dirty_rects: Option<&[Rect]>,
            _buffer: *const u8,
            _width: ::std::os::raw::c_int,
            _height: ::std::os::raw::c_int,
        ) {
        }
    }
}

wrap_life_span_handler! {
    struct Life {
        page: Arc<Page>,
    }

    impl LifeSpanHandler {
        fn on_before_popup(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: ::std::os::raw::c_int,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: ::std::os::raw::c_int,
            _popup_features: Option<&PopupFeatures>,
            window_info: Option<&mut WindowInfo>,
            client: Option<&mut Option<Client>>,
            settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            let url = text(target_url);
            let owner = &self.page.owner;
            if let Err(why) = tabs::may_open(owner, &url) {
                self.page.say(format!("Orden refused a window to {url}: {why}"));
                return 1;
            }
            let (Some(window_info), Some(client), Some(settings)) = (window_info, client, settings) else {
                return 1;
            };
            let Some(tab) = tabs::reserve_popup(owner, &url) else {
                return 1;
            };
            let popup = Arc::new(Page {
                owner: Owner {
                    agent: owner.agent.clone(),
                    tab: tab.clone(),
                    label: format!("{}{tab}", tabs::LABEL),
                },
                app: self.page.app.clone(),
                size: self.page.size,
                going: Mutex::new(None),
                built: Mutex::new(None),
                host: Mutex::new(None),
                observing: Mutex::new(None),
                url: Mutex::new(url),
                waiting: Mutex::new(HashMap::new()),
                hearing: Mutex::new(Vec::new()),
                dialog: Mutex::new(None),
            });
            *window_info = windowless();
            *settings = browser_settings();
            *client = Some(Agent::new(popup));
            0
        }

        fn on_after_created(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                made(&self.page, browser);
                if let Some(tab) = tabs::find(&self.page.owner.agent, &self.page.owner.tab) {
                    tabs::said(&self.page.app, &tab);
                }
            }
        }

        fn do_close(&self, _browser: Option<&mut Browser>) -> ::std::os::raw::c_int {
            0
        }

        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            closed(&self.page);
        }
    }
}

wrap_jsdialog_handler! {
    struct Dialogs {
        page: Arc<Page>,
    }

    impl JsdialogHandler {
        fn on_jsdialog(
            &self,
            _browser: Option<&mut Browser>,
            origin_url: Option<&CefString>,
            dialog_type: JsdialogType,
            message_text: Option<&CefString>,
            default_prompt_text: Option<&CefString>,
            callback: Option<&mut JsdialogCallback>,
            _suppress_message: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            let Some(callback) = callback else {
                return 0;
            };
            let kind = if dialog_type == JsdialogType::CONFIRM {
                DialogKind::Confirm
            } else if dialog_type == JsdialogType::PROMPT {
                DialogKind::Prompt
            } else {
                DialogKind::Alert
            };
            hold(
                &self.page,
                kind,
                text(message_text),
                text(default_prompt_text),
                text(origin_url),
                Answering::Script(callback.clone()),
            );
            1
        }

        fn on_before_unload_dialog(
            &self,
            _browser: Option<&mut Browser>,
            message_text: Option<&CefString>,
            _is_reload: ::std::os::raw::c_int,
            callback: Option<&mut JsdialogCallback>,
        ) -> ::std::os::raw::c_int {
            let Some(callback) = callback else {
                return 0;
            };
            let url = self.page.url.lock().unwrap_or_else(PoisonError::into_inner).clone();
            hold(
                &self.page,
                DialogKind::Beforeunload,
                text(message_text),
                String::new(),
                url,
                Answering::Script(callback.clone()),
            );
            1
        }

        fn on_reset_dialog_state(&self, _browser: Option<&mut Browser>) {
            self.page.dialog.lock().unwrap_or_else(PoisonError::into_inner).take();
            quiet::release(&self.page.owner.label);
        }
    }
}

wrap_permission_handler! {
    struct Permissions {
        page: Arc<Page>,
    }

    impl PermissionHandler {
        fn on_request_media_access_permission(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            requesting_origin: Option<&CefString>,
            _requested_permissions: u32,
            callback: Option<&mut MediaAccessCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cont(0);
            }
            self.page.say(format!(
                "Orden refused {} the camera and the microphone",
                text(requesting_origin)
            ));
            1
        }

        fn on_show_permission_prompt(
            &self,
            _browser: Option<&mut Browser>,
            _prompt_id: u64,
            requesting_origin: Option<&CefString>,
            _requested_permissions: u32,
            callback: Option<&mut PermissionPromptCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cont(PermissionRequestResult::DENY);
            }
            self.page
                .say(format!("Orden refused {} a permission", text(requesting_origin)));
            1
        }
    }
}

wrap_download_handler! {
    struct Downloads {
        page: Arc<Page>,
    }

    impl DownloadHandler {
        fn can_download(
            &self,
            _browser: Option<&mut Browser>,
            _url: Option<&CefString>,
            _request_method: Option<&CefString>,
        ) -> ::std::os::raw::c_int {
            1
        }

        fn on_before_download(
            &self,
            _browser: Option<&mut Browser>,
            download_item: Option<&mut DownloadItem>,
            suggested_name: Option<&CefString>,
            callback: Option<&mut BeforeDownloadCallback>,
        ) -> ::std::os::raw::c_int {
            let (Some(item), Some(callback)) = (download_item, callback) else {
                return 0;
            };
            let owner = &self.page.owner;
            let Some(path) = quiet::destination(&self.page.app, &owner.agent, &text(suggested_name)) else {
                return 0;
            };
            let record = Download {
                tab: owner.tab.clone(),
                url: CefString::from(&item.url()).to_string(),
                path: path.to_string_lossy().into_owned(),
                state: DownloadState::Going,
            };
            if item.total_bytes() > quiet::MOST_DOWNLOAD {
                quiet::noted(
                    &owner.agent,
                    Download {
                        state: DownloadState::TooLarge,
                        ..record
                    },
                );
                return 0;
            }
            quiet::noted(&owner.agent, record);
            callback.cont(Some(&CefString::from(path.to_string_lossy().as_ref())), 0);
            1
        }

        fn on_download_updated(
            &self,
            _browser: Option<&mut Browser>,
            download_item: Option<&mut DownloadItem>,
            callback: Option<&mut DownloadItemCallback>,
        ) {
            let Some(item) = download_item else {
                return;
            };
            let path = CefString::from(&item.full_path()).to_string();
            if path.is_empty() {
                return;
            }
            let agent = &self.page.owner.agent;
            if item.received_bytes() > quiet::MOST_DOWNLOAD {
                if let Some(callback) = callback {
                    callback.cancel();
                }
                quiet::moved(agent, &path, DownloadState::TooLarge);
            } else if item.is_complete() != 0 {
                quiet::moved(agent, &path, DownloadState::Done);
            } else if item.is_canceled() != 0 || item.is_interrupted() != 0 {
                quiet::moved(agent, &path, DownloadState::Failed);
            }
        }
    }
}

wrap_dialog_handler! {
    struct Files {
        page: Arc<Page>,
    }

    impl DialogHandler {
        fn on_file_dialog(
            &self,
            _browser: Option<&mut Browser>,
            _mode: FileDialogMode,
            _title: Option<&CefString>,
            _default_file_path: Option<&CefString>,
            _accept_filters: Option<&mut CefStringList>,
            _accept_extensions: Option<&mut CefStringList>,
            _accept_descriptions: Option<&mut CefStringList>,
            callback: Option<&mut FileDialogCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cancel();
            }
            self.page
                .say("Orden refused the page a file chooser: browser_upload answers one".into());
            1
        }
    }
}

wrap_context_menu_handler! {
    struct Menus;

    impl ContextMenuHandler {
        fn on_before_context_menu(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _params: Option<&mut ContextMenuParams>,
            model: Option<&mut MenuModel>,
        ) {
            if let Some(model) = model {
                model.clear();
            }
        }
    }
}

wrap_request_handler! {
    struct Requests {
        page: Arc<Page>,
    }

    impl RequestHandler {
        fn on_before_browse(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _user_gesture: ::std::os::raw::c_int,
            _is_redirect: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            let (Some(frame), Some(request)) = (frame, request) else {
                return 0;
            };
            if frame.is_main() == 0 {
                return 0;
            }
            let url = CefString::from(&request.url()).to_string();
            match tabs::may_open(&self.page.owner, &url) {
                Ok(()) => {
                    tabs::set(&self.page.owner.tab, |one| one.loading = true);
                    0
                }
                Err(why) => {
                    self.page
                        .say(format!("Orden stopped the page going to {url}: {why}"));
                    1
                }
            }
        }

        fn on_open_urlfrom_tab(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            target_url: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            self.page.say(format!(
                "Orden kept {} from opening in a tab of the reader's",
                text(target_url)
            ));
            1
        }

        fn on_select_client_certificate(
            &self,
            _browser: Option<&mut Browser>,
            _is_proxy: ::std::os::raw::c_int,
            host: Option<&CefString>,
            _port: ::std::os::raw::c_int,
            certificates: Option<&[Option<X509Certificate>]>,
            callback: Option<&mut SelectClientCertificateCallback>,
        ) -> ::std::os::raw::c_int {
            let Some(callback) = callback else {
                return 0;
            };
            let offered: Vec<(X509Certificate, String)> = certificates
                .unwrap_or_default()
                .iter()
                .flatten()
                .map(|one| {
                    let words = one
                        .subject()
                        .map(|subject| CefString::from(&subject.display_name()).to_string())
                        .unwrap_or_default();
                    (one.clone(), words)
                })
                .collect();
            let message = quiet::certificates(offered.iter().map(|(_, words)| words.as_str()));
            hold(
                &self.page,
                DialogKind::Certificate,
                message,
                String::new(),
                format!("https://{}/", text(host)),
                Answering::Certificate(callback.clone(), offered),
            );
            1
        }
    }
}

wrap_display_handler! {
    struct Display {
        page: Arc<Page>,
    }

    impl DisplayHandler {
        fn on_address_change(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            url: Option<&CefString>,
        ) {
            if frame.is_some_and(|frame| frame.is_main() != 0) {
                let url = text(url);
                self.page
                    .url
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone_from(&url);
                tabs::set(&self.page.owner.tab, |one| one.url = url);
            }
        }

        fn on_title_change(&self, _browser: Option<&mut Browser>, title: Option<&CefString>) {
            let title = text(title);
            tabs::set(&self.page.owner.tab, |one| one.title = title);
            if let Some(tab) = tabs::find(&self.page.owner.agent, &self.page.owner.tab) {
                tabs::said(&self.page.app, &tab);
            }
        }

        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            _message: Option<&CefString>,
            _source: Option<&CefString>,
            _line: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            1
        }
    }
}

wrap_load_handler! {
    struct Loads {
        page: Arc<Page>,
    }

    impl LoadHandler {
        fn on_loading_state_change(
            &self,
            _browser: Option<&mut Browser>,
            is_loading: ::std::os::raw::c_int,
            _can_go_back: ::std::os::raw::c_int,
            _can_go_forward: ::std::os::raw::c_int,
        ) {
            let loading = is_loading != 0;
            tabs::set(&self.page.owner.tab, |one| one.loading = loading);
            if !loading {
                if let Some(tab) = tabs::find(&self.page.owner.agent, &self.page.owner.tab) {
                    tabs::said(&self.page.app, &tab);
                }
            }
        }

        fn on_load_error(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _error_code: Errorcode,
            error_text: Option<&CefString>,
            failed_url: Option<&CefString>,
        ) {
            if frame.is_some_and(|frame| frame.is_main() != 0) && text(error_text).contains("AUTH") {
                self.page.say(format!(
                    "The site at {} did not sign in: {}",
                    text(failed_url),
                    text(error_text)
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{answer, paired, quieting, signed_in, Said};

    #[test]
    fn an_answer_is_its_result_or_the_agent_s_words() {
        assert_eq!(
            answer(&json!({ "id": 3, "result": { "data": "x" } })),
            Ok(json!({ "data": "x" }))
        );
        assert_eq!(
            answer(&json!({ "id": 3, "error": { "code": -32000, "message": "No node" } })),
            Err("No node".to_string())
        );
        assert_eq!(answer(&json!({ "id": 4 })), Ok(serde_json::Value::Null));
    }

    #[test]
    fn an_agent_page_takes_its_own_sign_ins() {
        let fetch = quieting()
            .into_iter()
            .find(|(method, _)| *method == "Fetch.enable")
            .map(|(_, params)| params)
            .expect("the page's sign-ins are asked for");
        assert_eq!(fetch["handleAuthRequests"], json!(true));
        assert_eq!(fetch["patterns"], json!([{ "urlPattern": "*" }]));
    }

    #[test]
    fn a_sign_in_is_answered_with_its_words_or_cancelled() {
        let yes = Said {
            accept: true,
            username: Some("ada".into()),
            password: Some("pw".into()),
            ..Said::default()
        };
        assert_eq!(
            signed_in("r1", &yes),
            json!({ "requestId": "r1", "authChallengeResponse": { "response": "ProvideCredentials", "username": "ada", "password": "pw" } })
        );
        assert_eq!(
            signed_in("r2", &Said::only(false)),
            json!({ "requestId": "r2", "authChallengeResponse": { "response": "CancelAuth" } })
        );
    }

    #[test]
    fn a_run_wants_windowless_pages_only_with_an_agent_paired() {
        assert!(paired(r#"{"agents":[{"id":"claude-code"}]}"#));
        assert!(!paired(r#"{"agents":[]}"#));
        assert!(!paired("not json"));
    }
}
