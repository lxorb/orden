use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL: u32 = 1;
pub const SCHEMES: [&str; 3] = ["tauri", "ipc", "asset"];
pub const INVOKE_SCHEME: &str = "ipc";
pub const PIPE_ENV: &str = "ORDEN_ELECTRON_PIPE";
pub const TO_CORE: &str = "-to-core";
pub const TO_SHELL: &str = "-to-shell";

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Transport {
    #[default]
    PostMessage,
    Scheme,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resizable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximizable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimizable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focusable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximized: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub always_on_top: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_taskbar: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_shadow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    pub script: String,
    pub main_frame_only: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Extent {
    pub width: f64,
    pub height: f64,
    pub physical: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Place {
    pub x: f64,
    pub y: f64,
    pub physical: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "method", content = "value", rename_all = "camelCase")]
pub enum WindowCall {
    ScaleFactor,
    InnerBounds,
    OuterBounds,
    IsFullScreen,
    IsMinimized,
    IsMaximized,
    IsFocused,
    IsDecorated,
    IsResizable,
    IsMaximizable,
    IsMinimizable,
    IsClosable,
    IsVisible,
    IsEnabled,
    IsAlwaysOnTop,
    GetTitle,
    Center,
    FlashFrame(bool),
    SetResizable(bool),
    SetMaximizable(bool),
    SetMinimizable(bool),
    SetClosable(bool),
    SetTitle(String),
    Maximize,
    Unmaximize,
    Minimize,
    Restore,
    Show,
    Hide,
    Close,
    Destroy,
    SetHasShadow(bool),
    SetAlwaysOnTop(bool),
    SetVisibleOnAllWorkspaces(bool),
    SetContentProtection(bool),
    SetSize(Extent),
    SetMinSize(Option<Extent>),
    SetMaxSize(Option<Extent>),
    SetPosition(Place),
    SetFullScreen(bool),
    SetSimpleFullScreen(bool),
    Focus,
    SetFocusable(bool),
    SetSkipTaskbar(bool),
    SetIgnoreMouseEvents(bool),
    SetEnabled(bool),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "method", content = "value", rename_all = "camelCase")]
pub enum WebviewCall {
    OpenDevTools,
    CloseDevTools,
    IsDevToolsOpened,
    SetZoomFactor(f64),
    GetUrl,
    Bounds,
    LoadUrl(String),
    Reload,
    GoBack,
    CanGoBack,
    GoForward,
    CanGoForward,
    Print,
    Focus,
    ClearData,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "which", rename_all = "kebab-case")]
pub enum Screens {
    All,
    Primary,
    Point { x: f64, y: f64 },
    Window { window: u32 },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum ToShell {
    Hello {
        protocol: u32,
        identifier: String,
        schemes: Vec<String>,
        transport: Transport,
    },
    WindowCreate {
        window: u32,
        label: String,
        options: WindowOptions,
    },
    WebviewCreate {
        window: u32,
        webview: u32,
        label: String,
        url: String,
        scripts: Vec<Script>,
        devtools: Option<bool>,
        user_agent: Option<String>,
    },
    WindowCall {
        window: u32,
        id: Option<u64>,
        call: WindowCall,
    },
    WebviewCall {
        webview: u32,
        id: Option<u64>,
        call: WebviewCall,
    },
    Eval {
        webview: u32,
        id: Option<u64>,
        script: String,
    },
    Respond {
        request: u64,
        status: u16,
        headers: Vec<(String, String)>,
    },
    Refuse {
        request: u64,
    },
    Screen {
        id: u64,
        screens: Screens,
    },
    Cursor {
        id: u64,
    },
    Dark {
        id: u64,
    },
    Version {
        id: u64,
    },
    Theme {
        theme: Option<String>,
    },
    Exit {
        code: i32,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PageEvent {
    Started,
    Finished,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WindowChange {
    Close,
    Closed,
    Focus,
    Blur,
    Resize { width: u32, height: u32 },
    Move { x: i32, y: i32 },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum FromShell {
    Welcome {
        protocol: u32,
    },
    Reply {
        id: u64,
        value: Value,
    },
    Request {
        request: u64,
        webview: Option<u32>,
        url: String,
        method: String,
        headers: Vec<(String, String)>,
    },
    Post {
        webview: Option<u32>,
        url: String,
    },
    Page {
        webview: u32,
        url: String,
        event: PageEvent,
    },
    Window {
        window: u32,
        event: WindowChange,
    },
    Opened {
        urls: Vec<String>,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub name: Option<String>,
    pub bounds: Bounds,
    pub work_area: Bounds,
    pub scale: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
