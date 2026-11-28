#[macro_use]
mod absent;
mod pipe;
mod webview;
mod window;
pub mod wire;

use std::borrow::Cow;
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};

use tauri_runtime::dpi::{PhysicalPosition, PhysicalSize};
use tauri_runtime::monitor::Monitor;
use tauri_runtime::webview::{DetachedWebview, PageLoadEvent, PendingWebview};
use tauri_runtime::window::{
    DetachedWindow, DetachedWindowWebview, PendingWindow, RawWindow, WindowEvent, WindowId,
};
use tauri_runtime::{
    Error, EventLoopProxy, ExitRequestedEventAction, Result, RunEvent, Runtime, RuntimeHandle,
    RuntimeInitArgs, RuntimeInitAttrs, UserEvent,
};
use tauri_utils::Theme;
use url::Url;

use pipe::{held, Context, Ends, Message, WebviewState, WindowState};
pub use webview::ElectronWebviewDispatcher;
pub use window::{ElectronWindowBuilder, ElectronWindowDispatcher};
use wire::{
    FromShell, PageEvent, Point, Screens, Script, ToShell, Transport, WindowCall, WindowChange,
    INVOKE_SCHEME, PIPE_ENV, SCHEMES,
};

pub(crate) fn create_window<T: UserEvent>(
    context: &Context,
    pending: PendingWindow<T, ElectronRuntime>,
) -> Result<DetachedWindow<T, ElectronRuntime>> {
    let raw = context.next_id();
    let id = WindowId::from(raw);
    let label = pending.label;
    held(&context.0.windows).insert(
        raw,
        Arc::new(WindowState { label: label.clone(), id, listeners: Mutex::default() }),
    );
    context.send(
        &ToShell::WindowCreate {
            window: raw,
            label: label.clone(),
            options: pending.window_builder.options,
        },
        &[],
    )?;
    let webview = match pending.webview {
        Some(pending) => {
            let use_https_scheme = pending.webview_attributes.use_https_scheme;
            let devtools = pending.webview_attributes.devtools;
            let webview = create_webview(context, raw, pending)?;
            Some(DetachedWindowWebview { webview, use_https_scheme, devtools })
        }
        None => None,
    };
    Ok(DetachedWindow {
        id,
        label,
        dispatcher: ElectronWindowDispatcher { raw, context: context.clone() },
        webview,
    })
}

pub(crate) fn create_webview<T: UserEvent>(
    context: &Context,
    window: u32,
    pending: PendingWebview<T, ElectronRuntime>,
) -> Result<DetachedWebview<T, ElectronRuntime>> {
    if held(&context.0.webviews).values().any(|one| one.window == window) {
        return Err(Error::CreateWebview(
            "a window of the Electron shell holds one webview".into(),
        ));
    }
    if let Some(unknown) =
        pending.uri_scheme_protocols.keys().find(|scheme| !SCHEMES.contains(&scheme.as_str()))
    {
        return Err(Error::CreateWebview(
            format!("the Electron shell serves {SCHEMES:?} and not {unknown}").into(),
        ));
    }
    let id = context.next_id();
    let dispatcher = ElectronWebviewDispatcher { id, context: context.clone() };
    let label = pending.label;
    let attributes = pending.webview_attributes;
    let posted = pending.ipc_handler.map(|handler| {
        let detached = DetachedWebview::<T, ElectronRuntime> {
            label: label.clone(),
            dispatcher: dispatcher.clone(),
        };
        Box::new(move |request: http::Request<String>| handler(detached.clone(), request))
            as pipe::Posted
    });
    held(&context.0.webviews).insert(
        id,
        Arc::new(WebviewState {
            label: label.clone(),
            window,
            protocols: pending.uri_scheme_protocols,
            posted: Mutex::new(posted),
            page_load: Mutex::new(pending.on_page_load_handler),
        }),
    );
    context.send(
        &ToShell::WebviewCreate {
            window,
            webview: id,
            label: label.clone(),
            url: pending.url,
            scripts: attributes
                .initialization_scripts
                .into_iter()
                .map(|one| Script { script: one.script, main_frame_only: one.for_main_frame_only })
                .collect(),
            devtools: attributes.devtools,
            user_agent: attributes.user_agent,
        },
        &[],
    )?;
    Ok(DetachedWebview { label, dispatcher })
}

fn window_of(context: &Context, id: WindowId) -> Result<u32> {
    held(&context.0.windows)
        .iter()
        .find(|(_, one)| one.id == id)
        .map(|(raw, _)| *raw)
        .ok_or(Error::WindowNotFound)
}

fn cursor(context: &Context) -> Result<PhysicalPosition<f64>> {
    let said: Point = context.ask(|id| ToShell::Cursor { id })?;
    Ok(PhysicalPosition::new(said.x, said.y))
}

#[derive(Debug, Clone)]
pub struct ElectronHandle {
    context: Context,
}

impl<T: UserEvent> RuntimeHandle<T> for ElectronHandle {
    type Runtime = ElectronRuntime;

    absent_from_handle!();

    fn create_proxy(&self) -> EventProxy {
        EventProxy { context: self.context.clone() }
    }

    fn request_exit(&self, code: i32) -> Result<()> {
        self.context.post(Message::Exit(code))
    }

    fn custom_scheme_url(&self, scheme: &str, _https: bool) -> String {
        format!("{scheme}://localhost")
    }

    fn webview_version(&self) -> Result<String> {
        self.context.ask(|id| ToShell::Version { id })
    }

    fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
        &self,
        pending: PendingWindow<T, Self::Runtime>,
        _after_window_creation: Option<F>,
    ) -> Result<DetachedWindow<T, Self::Runtime>> {
        create_window(&self.context, pending)
    }

    fn create_webview(
        &self,
        window_id: WindowId,
        pending: PendingWebview<T, Self::Runtime>,
    ) -> Result<DetachedWebview<T, Self::Runtime>> {
        create_webview(&self.context, window_of(&self.context, window_id)?, pending)
    }

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.post(Message::Task(Box::new(f)))
    }

    fn primary_monitor(&self) -> Result<Option<Monitor>> {
        Ok(window::monitors(&self.context, Screens::Primary)?.into_iter().next())
    }

    fn monitor_from_point(&self, x: f64, y: f64) -> Result<Option<Monitor>> {
        Ok(window::monitors(&self.context, Screens::Point { x, y })?.into_iter().next())
    }

    fn available_monitors(&self) -> Result<Vec<Monitor>> {
        window::monitors(&self.context, Screens::All)
    }

    fn set_theme(&self, theme: Option<Theme>) {
        let _ = window::wear(&self.context, theme);
    }

    fn cursor_position(&self) -> Result<PhysicalPosition<f64>> {
        cursor(&self.context)
    }
}

#[derive(Debug, Clone)]
pub struct EventProxy {
    context: Context,
}

impl<T: UserEvent> EventLoopProxy<T> for EventProxy {
    fn send_event(&self, event: T) -> Result<()> {
        self.context.post(Message::User(Box::new(event)))
    }
}

#[derive(Default)]
pub struct Electron {
    ends: Mutex<Option<Ends>>,
    path: Option<String>,
    transport: Transport,
}

impl Electron {
    #[must_use]
    pub fn over(reader: impl Read + Send + 'static, writer: impl Write + Send + 'static) -> Self {
        Self {
            ends: Mutex::new(Some((Box::new(reader), Box::new(writer)))),
            path: None,
            transport: Transport::default(),
        }
    }

    #[must_use]
    pub fn pipe(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    #[must_use]
    pub fn transport(mut self, transport: Transport) -> Self {
        self.transport = transport;
        self
    }

    fn ends(&self) -> Result<Ends> {
        if let Some(ends) = held(&self.ends).take() {
            return Ok(ends);
        }
        let path = self
            .path
            .clone()
            .or_else(|| std::env::var(PIPE_ENV).ok())
            .ok_or_else(|| Error::CreateWindow(format!("{PIPE_ENV} is not set").into()))?;
        pipe::open(&path).map_err(|error| Error::CreateWindow(Box::new(error)))
    }
}

impl<T: UserEvent> RuntimeInitAttrs<T> for Electron {
    type Runtime = ElectronRuntime;
}

impl<T: UserEvent> From<Electron> for tauri_runtime::dynamic::DynRuntimeInitAttrs<T> {
    fn from(attrs: Electron) -> Self {
        Self::new(attrs)
    }
}

enum Step {
    On,
    Leave,
}

#[derive(Debug)]
pub struct ElectronRuntime {
    context: Context,
    rx: Receiver<Message>,
}

impl ElectronRuntime {
    fn init(args: RuntimeInitArgs<Electron>) -> Result<Self> {
        let attrs = args.runtime_init_attrs;
        let (context, rx) = Context::connect(attrs.ends()?, args.identifier, attrs.transport)?;
        Ok(Self { context, rx })
    }

    fn refuse(&self, request: u64) {
        let _ = self.context.send(&ToShell::Refuse { request }, &[]);
    }

    fn requested(
        &self,
        request: u64,
        webview: Option<u32>,
        address: &str,
        method: &str,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) {
        let Some(webview) = webview.and_then(|id| self.context.webview(id)) else {
            return self.refuse(request);
        };
        let scheme = address.split(':').next().unwrap_or_default();
        if scheme == INVOKE_SCHEME && self.context.0.transport == Transport::PostMessage {
            return self.refuse(request);
        }
        let Some(protocol) = webview.protocols.get(scheme) else {
            return self.refuse(request);
        };
        let mut building = http::Request::builder().method(method).uri(address);
        for (name, value) in headers {
            building = building.header(name, value);
        }
        let Ok(asked) = building.body(body) else {
            return self.refuse(request);
        };
        let context = self.context.clone();
        protocol(
            &webview.label,
            asked,
            Box::new(move |response: http::Response<Cow<'static, [u8]>>| {
                let headers = response
                    .headers()
                    .iter()
                    .map(|(name, value)| {
                        (
                            name.as_str().to_owned(),
                            String::from_utf8_lossy(value.as_bytes()).into_owned(),
                        )
                    })
                    .collect();
                let _ = context.send(
                    &ToShell::Respond { request, status: response.status().as_u16(), headers },
                    response.body(),
                );
            }),
        );
    }

    fn posted(&self, webview: Option<u32>, address: &str, body: &[u8]) {
        let Some(webview) = webview.and_then(|id| self.context.webview(id)) else {
            return;
        };
        let Ok(asked) =
            http::Request::builder().uri(address).body(String::from_utf8_lossy(body).into_owned())
        else {
            return;
        };
        let handler = held(&webview.posted);
        if let Some(handler) = handler.as_ref() {
            handler(asked);
        }
    }

    fn loaded(&self, webview: u32, address: &str, event: PageEvent) {
        let (Some(webview), Ok(address)) = (self.context.webview(webview), Url::parse(address))
        else {
            return;
        };
        let event = match event {
            PageEvent::Started => PageLoadEvent::Started,
            PageEvent::Finished => PageLoadEvent::Finished,
        };
        let handler = held(&webview.page_load);
        if let Some(handler) = handler.as_ref() {
            handler(address, event);
        }
    }

    fn told<T: UserEvent>(
        window: &WindowState,
        event: WindowEvent,
        callback: &mut dyn FnMut(RunEvent<T>),
    ) {
        let listeners = std::mem::take(&mut *held(&window.listeners));
        for (_, listener) in &listeners {
            listener(&event);
        }
        let mut kept = held(&window.listeners);
        let added = std::mem::replace(&mut *kept, listeners);
        kept.extend(added);
        drop(kept);
        callback(RunEvent::WindowEvent { label: window.label.clone(), event });
    }

    fn changed<T: UserEvent>(
        &self,
        raw: u32,
        change: WindowChange,
        callback: &mut dyn FnMut(RunEvent<T>),
    ) -> Step {
        let Some(window) = self.context.window(raw) else {
            return Step::On;
        };
        match change {
            WindowChange::Close => {
                let (tx, rx) = channel();
                Self::told(&window, WindowEvent::CloseRequested { signal_tx: tx }, callback);
                if !matches!(rx.try_recv(), Ok(true)) {
                    let _ = self.context.send(
                        &ToShell::WindowCall { window: raw, id: None, call: WindowCall::Destroy },
                        &[],
                    );
                }
            }
            WindowChange::Closed => {
                Self::told(&window, WindowEvent::Destroyed, callback);
                held(&self.context.0.windows).remove(&raw);
                held(&self.context.0.webviews).retain(|_, one| one.window != raw);
                if held(&self.context.0.windows).is_empty() {
                    return Self::leaving(None, callback);
                }
            }
            WindowChange::Focus => Self::told(&window, WindowEvent::Focused(true), callback),
            WindowChange::Blur => Self::told(&window, WindowEvent::Focused(false), callback),
            WindowChange::Resize { width, height } => {
                Self::told(
                    &window,
                    WindowEvent::Resized(PhysicalSize::new(width, height)),
                    callback,
                );
            }
            WindowChange::Move { x, y } => {
                Self::told(&window, WindowEvent::Moved(PhysicalPosition::new(x, y)), callback);
            }
        }
        Step::On
    }

    fn leaving<T: UserEvent>(code: Option<i32>, callback: &mut dyn FnMut(RunEvent<T>)) -> Step {
        let (tx, rx) = channel();
        callback(RunEvent::ExitRequested { code, tx });
        if matches!(rx.try_recv(), Ok(ExitRequestedEventAction::Prevent)) {
            Step::On
        } else {
            Step::Leave
        }
    }

    fn step<T: UserEvent>(&self, message: Message, callback: &mut dyn FnMut(RunEvent<T>)) -> Step {
        match message {
            Message::Task(task) => task(),
            Message::User(event) => {
                if let Ok(event) = event.downcast::<T>() {
                    callback(RunEvent::UserEvent(*event));
                }
            }
            Message::Shell(FromShell::Request { request, webview, url, method, headers }, body) => {
                self.requested(request, webview, &url, &method, headers, body);
            }
            Message::Shell(FromShell::Post { webview, url }, body) => {
                self.posted(webview, &url, &body);
            }
            Message::Shell(FromShell::Page { webview, url, event }, _) => {
                self.loaded(webview, &url, event);
            }
            Message::Shell(FromShell::Window { window, event }, _) => {
                return self.changed(window, event, callback);
            }
            Message::Shell(FromShell::Opened { urls }, _) => {
                let urls = urls.iter().filter_map(|one| Url::parse(one).ok()).collect();
                callback(RunEvent::Opened { urls });
            }
            Message::Shell(FromShell::Welcome { .. } | FromShell::Reply { .. }, _) => {}
            Message::Exit(code) => return Self::leaving(Some(code), callback),
            Message::Closed => return Step::Leave,
        }
        Step::On
    }
}

impl<T: UserEvent> Runtime<T> for ElectronRuntime {
    type WindowDispatcher = ElectronWindowDispatcher;
    type WebviewDispatcher = ElectronWebviewDispatcher;
    type Handle = ElectronHandle;
    type EventLoopProxy = EventProxy;
    type RuntimeWebviewAttributes = ();
    type RuntimeInitAttrs = Electron;
    type WindowOpener = ();
    type Webview = ();

    absent_from_runtime!();

    fn new(args: RuntimeInitArgs<Electron>) -> Result<Self> {
        Self::init(args)
    }

    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    fn new_any_thread(args: RuntimeInitArgs<Electron>) -> Result<Self> {
        Self::init(args)
    }

    fn create_proxy(&self) -> EventProxy {
        EventProxy { context: self.context.clone() }
    }

    fn handle(&self) -> Self::Handle {
        ElectronHandle { context: self.context.clone() }
    }

    fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
        &self,
        pending: PendingWindow<T, Self>,
        _after_window_creation: Option<F>,
    ) -> Result<DetachedWindow<T, Self>> {
        create_window(&self.context, pending)
    }

    fn create_webview(
        &self,
        window_id: WindowId,
        pending: PendingWebview<T, Self>,
    ) -> Result<DetachedWebview<T, Self>> {
        create_webview(&self.context, window_of(&self.context, window_id)?, pending)
    }

    fn primary_monitor(&self) -> Option<Monitor> {
        window::monitors(&self.context, Screens::Primary).ok()?.into_iter().next()
    }

    fn monitor_from_point(&self, x: f64, y: f64) -> Option<Monitor> {
        window::monitors(&self.context, Screens::Point { x, y }).ok()?.into_iter().next()
    }

    fn available_monitors(&self) -> Vec<Monitor> {
        window::monitors(&self.context, Screens::All).unwrap_or_default()
    }

    fn set_theme(&self, theme: Option<Theme>) {
        let _ = window::wear(&self.context, theme);
    }

    #[cfg(any(
        target_os = "macos",
        windows,
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    fn run_iteration<F: FnMut(RunEvent<T>)>(&mut self, mut callback: F) {
        while let Ok(message) = self.rx.try_recv() {
            let _ = self.step(message, &mut callback);
        }
        callback(RunEvent::MainEventsCleared);
    }

    fn run_return<F: FnMut(RunEvent<T>) + 'static>(self, mut callback: F) -> i32 {
        callback(RunEvent::Ready);
        let mut code = 0;
        while let Ok(message) = self.rx.recv() {
            if let Message::Exit(asked) = &message {
                code = *asked;
            }
            if matches!(self.step(message, &mut callback), Step::Leave) {
                break;
            }
            callback(RunEvent::MainEventsCleared);
        }
        callback(RunEvent::Exit);
        let _ = self.context.send(&ToShell::Exit { code }, &[]);
        code
    }

    fn run<F: FnMut(RunEvent<T>) + 'static>(self, callback: F) {
        self.run_return(callback);
    }

    fn cursor_position(&self) -> Result<PhysicalPosition<f64>> {
        cursor(&self.context)
    }
}
