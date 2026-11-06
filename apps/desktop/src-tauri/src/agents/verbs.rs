use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const EVENT: &str = "nib://agent";

pub type TabId = String;

pub type Ref = String;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Nothing {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OnTab {
    pub tab: TabId,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Store {
    #[default]
    Reader,
    Agent,
    Space,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Open {
    pub url: String,
    #[serde(default)]
    pub store: Store,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Navigate {
    pub tab: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub back: bool,
    #[serde(default)]
    pub forward: bool,
    #[serde(default)]
    pub reload: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Moment {
    Load,
    NetworkIdle,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Until {
    Moment(Moment),
    Text {
        text: String,
    },
    Element {
        #[serde(rename = "ref")]
        element: Ref,
    },
    Url {
        url: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wait {
    pub tab: TabId,
    #[serde(rename = "for")]
    pub until: Until,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub tab: TabId,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Find {
    pub tab: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadAs {
    Text,
    #[default]
    Markdown,
    Article,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Read {
    pub tab: TabId,
    #[serde(default, rename = "as")]
    pub shape: ReadAs,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureAs {
    Clip,
    Screenshot,
    Pdf,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Button {
    #[default]
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Modifier {
    Alt,
    Control,
    Meta,
    Shift,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Click {
    pub tab: TabId,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default)]
    pub button: Button,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modifiers: Vec<Modifier>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Type {
    pub tab: TabId,
    #[serde(rename = "ref")]
    pub element: Ref,
    pub text: String,
    #[serde(default)]
    pub submit: bool,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Press {
    pub tab: TabId,
    pub keys: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scroll {
    pub tab: TabId,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    #[serde(default)]
    pub dx: f64,
    #[serde(default)]
    pub dy: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Select {
    pub tab: TabId,
    #[serde(rename = "ref")]
    pub element: Ref,
    pub values: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FieldValue {
    Ticked(bool),
    Words(String),
    Options(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    #[serde(rename = "ref")]
    pub element: Ref,
    pub value: FieldValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FillForm {
    pub tab: TabId,
    pub fields: Vec<Field>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hover {
    pub tab: TabId,
    #[serde(rename = "ref")]
    pub element: Ref,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Drag {
    pub tab: TabId,
    pub from: Ref,
    pub to: Ref,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Upload {
    pub tab: TabId,
    #[serde(rename = "ref")]
    pub element: Ref,
    pub files: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Screenshot {
    pub tab: TabId,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub element: Option<Ref>,
    #[serde(default)]
    pub full_page: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Console {
    pub tab: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Network {
    pub tab: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub matching: Option<String>,
    #[serde(default)]
    pub bodies: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum World {
    #[default]
    Isolated,
    Page,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evaluate {
    pub tab: TabId,
    pub expression: String,
    #[serde(default)]
    pub world: World,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnswerDialog {
    pub tab: TabId,
    pub accept: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Downloads {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<TabId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageOp {
    Cookies,
    SetCookie,
    Clear,
    Local,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    #[serde(default)]
    pub http_only: bool,
    #[serde(default)]
    pub secure: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Storage {
    pub tab: TabId,
    pub op: StorageOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookie: Option<Cookie>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Takeover {
    pub tab: TabId,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Files {
    pub op: FilesOp,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default)]
    pub base64: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilesOp {
    Read,
    Write,
    Append,
    List,
    Stat,
    Mkdir,
    Move,
    Copy,
    Delete,
    Search,
    Changes,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilesDone {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub base64: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<FileEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub now: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    File,
    Folder,
    Link,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Process {
    pub op: ProcessOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub program: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub close: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessOp {
    Run,
    Start,
    List,
    Read,
    Write,
    Kill,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessDone {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended: Option<Ended>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<u64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub processes: Vec<ProcessEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ended {
    TimedOut,
    Killed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessEntry {
    pub id: String,
    pub program: String,
    pub args: Vec<String>,
    pub started: u64,
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Http {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub base64: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpDone {
    pub status: u16,
    pub url: String,
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub base64: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved: Option<String>,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct System {
    pub op: SystemOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemOp {
    Open,
    Reveal,
    Env,
    Info,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SystemDone {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opened: Option<String>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub withheld: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info: Option<SystemInfo>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    pub app_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webview: Option<String>,
    pub displays: Vec<Display>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Display {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalAsk {
    pub id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pair {
    pub client: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_ms: Option<u64>,
}

macro_rules! verbs {
    ($( $(#[$doc:meta])* $name:literal => $variant:ident($args:ty) -> $answer:ty, )*) => {
        #[derive(Clone, Debug, PartialEq)]
        pub enum Verb {
            $( $(#[$doc])* $variant($args), )*
        }

        #[allow(dead_code, reason = "the list the MCP server's schemas and the tests read")]
        pub const NAMES: &[&str] = &[$($name),*];

        #[allow(dead_code, reason = "the list the MCP server's schemas and the tests read")]
        pub const ANSWERS: &[(&str, &str)] = &[$(($name, stringify!($answer))),*];

        impl Verb {
            pub fn read(name: &str, args: Value) -> Option<Result<Self, String>> {
                let args = if args.is_null() { Value::Object(Default::default()) } else { args };
                match name {
                    $( $name => Some(
                        serde_json::from_value::<$args>(args)
                            .map(Verb::$variant)
                            .map_err(|error| format!("{}: {error}", $name)),
                    ), )*
                    _ => None,
                }
            }

            pub fn name(&self) -> &'static str {
                match self {
                    $( Verb::$variant(_) => $name, )*
                }
            }
        }
    };
}

verbs! {
    "browser_tabs" => Tabs(Nothing) -> TabList,
    "browser_open" => Open(Open) -> Opened,
    "browser_navigate" => Navigate(Navigate) -> Acted,
    "browser_wait" => Wait(Wait) -> Waited,
    "browser_snapshot" => Snapshot(Snapshot) -> Snapped,
    "browser_find" => Find(Find) -> Found,
    "browser_read" => Read(Read) -> PageText,
    "browser_click" => Click(Click) -> Acted,
    "browser_type" => Type(Type) -> Acted,
    "browser_press" => Press(Press) -> Acted,
    "browser_scroll" => Scroll(Scroll) -> Acted,
    "browser_select" => Select(Select) -> Acted,
    "browser_fill_form" => FillForm(FillForm) -> Acted,
    "browser_hover" => Hover(Hover) -> Acted,
    "browser_drag" => Drag(Drag) -> Acted,
    "browser_upload" => Upload(Upload) -> Acted,
    "browser_screenshot" => Screenshot(Screenshot) -> Picture,
    "browser_console" => Console(Console) -> ConsoleLines,
    "browser_network" => Network(Network) -> Requests,
    "browser_evaluate" => Evaluate(Evaluate) -> Evaluated,
    "browser_dialog" => Dialog(AnswerDialog) -> Acted,
    "browser_downloads" => Downloads(Downloads) -> DownloadList,
    "browser_storage" => Storage(Storage) -> Stored,
    "browser_close" => Close(OnTab) -> Closed,
    "browser_show" => Show(OnTab) -> Acted,
    "browser_takeover" => Takeover(Takeover) -> Acted,
    "files" => Files(Files) -> FilesDone,
    "process" => Process(Process) -> ProcessDone,
    "http" => Http(Http) -> HttpDone,
    "system" => System(System) -> SystemDone,
    "agent_status" => Status(Nothing) -> Status,
    "approval_status" => ApprovalStatus(ApprovalAsk) -> ApprovalState,
    "agent_pair" => Pair(Pair) -> Paired,
    "agent_bye" => Bye(Nothing) -> Nothing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    UnsupportedOnThisEngine,
    BadArguments,
    NotGranted,
    SiteDenied,
    NoSuchTab,
    NoSuchRef,
    Stopped,
    PasswordField,
    Limit,
    Timeout,
    Failed,
    NoDialog,
    Denied,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dialog {
    pub kind: DialogKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_text: Option<String>,
    pub url: String,
    pub open_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DialogKind {
    Alert,
    Confirm,
    Prompt,
    Beforeunload,
    SignIn,
    Certificate,
}

impl DialogKind {
    pub fn signs_in(self) -> bool {
        matches!(self, DialogKind::SignIn | DialogKind::Certificate)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Answer {
    Ok {
        result: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        untrusted: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dialog: Option<Box<Dialog>>,
    },
    NeedsApproval {
        approval: String,
        summary: String,
    },
    Error {
        code: Code,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dialog: Option<Box<Dialog>>,
    },
}

impl Answer {
    pub fn ok(result: impl Serialize) -> Self {
        Answer::Ok {
            result: serde_json::to_value(result).unwrap_or(Value::Null),
            untrusted: None,
            dialog: None,
        }
    }

    pub fn error(code: Code, message: impl Into<String>) -> Self {
        Answer::Error {
            code,
            message: message.into(),
            dialog: None,
        }
    }

    #[must_use]
    pub fn with_dialog(mut self, held: Option<Dialog>) -> Self {
        match &mut self {
            Answer::Ok { dialog, .. } | Answer::Error { dialog, .. } => {
                *dialog = held.map(Box::new);
            }
            Answer::NeedsApproval { .. } => {}
        }
        self
    }

    pub fn status(&self) -> &'static str {
        match self {
            Answer::Ok { .. } => "ok",
            Answer::NeedsApproval { .. } => "needs_approval",
            Answer::Error { .. } => "error",
        }
    }

    pub fn from_window(text: &str) -> Self {
        if let Ok(answer) = serde_json::from_str::<Answer>(text) {
            return answer;
        }
        let said: Value = serde_json::from_str(text).unwrap_or_default();
        let message = ["message", "error"]
            .iter()
            .find_map(|key| said.get(key).and_then(Value::as_str))
            .unwrap_or_default();
        let done = match said.get("status").and_then(Value::as_str) {
            Some(status) => status == "ok",
            None => said.get("ok").and_then(Value::as_bool) == Some(true),
        };
        if done {
            Answer::ok(said.get("result").or_else(|| said.get("value")))
        } else {
            Answer::error(Code::Failed, message)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReaderTab {
    pub id: TabId,
    pub title: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    pub front: bool,
    pub on_screen: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentTab {
    pub id: TabId,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub store: Store,
    pub parked: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TabList {
    pub reader: Vec<ReaderTab>,
    pub agent: Vec<AgentTab>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Opened {
    pub tab: TabId,
    pub store: Store,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Acted {
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opened: Vec<TabId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Waited {
    pub ms: u64,
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapped {
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Match {
    #[serde(rename = "ref")]
    pub element: Ref,
    pub role: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Found {
    pub matches: Vec<Match>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageText {
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Picture {
    pub png: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Captured {
    pub url: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub png: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConsoleLine {
    pub seq: u64,
    pub level: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConsoleLines {
    pub lines: Vec<ConsoleLine>,
    pub next: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub seq: u64,
    pub method: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Requests {
    pub requests: Vec<Request>,
    pub next: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evaluated {
    pub value: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    Going,
    Done,
    Failed,
    TooLarge,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Download {
    pub tab: TabId,
    pub url: String,
    pub path: String,
    pub state: DownloadState,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DownloadList {
    pub downloads: Vec<Download>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Stored {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<Cookie>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<serde_json::Map<String, Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Closed {
    pub tab: TabId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Paying,
    Sending,
    Publishing,
    Deleting,
    SigningIn,
    Settings,
    Terminal,
    Files,
    Writing,
    Trashing,
    Unread,
    Showing,
    Takeover,
    Pairing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalAnswer {
    Pending,
    Allowed,
    Denied,
    Expired,
    Done,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    pub id: String,
    pub agent: String,
    pub name: String,
    pub category: Category,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<TabId>,
    #[serde(default)]
    pub verb: String,
    pub asked: u64,
    pub answer: ApprovalAnswer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalState {
    pub approval: Approval,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Status {
    pub grant: super::grants::Grant,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stopped: bool,
    pub tabs: Vec<AgentTab>,
    pub approvals: Vec<Approval>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Paired {
    pub agent: String,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    Acting {
        agent: String,
        tab: TabId,
        verb: String,
    },
    Paused {
        agent: String,
    },
    Resumed {
        agent: String,
    },
    Asked {
        approval: Approval,
    },
    Answered {
        approval: Approval,
    },
    Tab {
        agent: String,
        id: TabId,
        url: String,
        title: String,
    },
    Closed {
        agent: String,
        id: TabId,
    },
    Stopped {
        closed: bool,
    },
    Connected {
        agents: Vec<String>,
    },
}

pub mod window {
    use serde::{Deserialize, Serialize};

    use crate::agents::grants::Scope;

    pub const AGENT_VERBS: &[(&str, Option<Scope>)] = &[
        ("get_context", Some(Scope::Context)),
        ("list_spaces", None),
        ("list_notes", Some(Scope::NotesRead)),
        ("search_notes", Some(Scope::NotesRead)),
        ("list_backlinks", Some(Scope::NotesRead)),
        ("read_note", Some(Scope::NotesRead)),
        ("list_versions", Some(Scope::NotesRead)),
        ("read_canvas", Some(Scope::NotesRead)),
        ("read_pdf", Some(Scope::NotesRead)),
        ("pdf_highlights", Some(Scope::NotesRead)),
        ("edit_note", Some(Scope::NotesWrite)),
        ("write_note", Some(Scope::NotesWrite)),
        ("append_note", Some(Scope::NotesWrite)),
        ("set_property", Some(Scope::NotesWrite)),
        ("set_task", Some(Scope::NotesWrite)),
        ("list_tasks", Some(Scope::NotesRead)),
        ("add_task", Some(Scope::NotesWrite)),
        ("update_task", Some(Scope::NotesWrite)),
        ("query_base", Some(Scope::NotesRead)),
        ("add_row", Some(Scope::NotesWrite)),
        ("edit_rows", Some(Scope::NotesWrite)),
        ("edit_base", Some(Scope::NotesWrite)),
        ("create_note", Some(Scope::NotesWrite)),
        ("restore_version", Some(Scope::NotesWrite)),
        ("edit_canvas", Some(Scope::NotesWrite)),
        ("capture_to_note", Some(Scope::NotesWrite)),
        ("attach_agent_log", Some(Scope::NotesWrite)),
        ("move_file", Some(Scope::Tree)),
        ("trash_file", Some(Scope::Tree)),
        ("create_folder", Some(Scope::Tree)),
        ("workspace_tabs", Some(Scope::Workspace)),
        ("bookmarks", Some(Scope::Workspace)),
        ("run_command", Some(Scope::Workspace)),
        ("read_setting", None),
        ("write_setting", Some(Scope::Settings)),
        ("run_terminal", Some(Scope::Terminal)),
        ("read_terminal", Some(Scope::Context)),
        ("type_terminal", Some(Scope::Terminal)),
        ("system_clipboard", Some(Scope::Clipboard)),
        ("ask_reader", Some(Scope::Ask)),
        ("note_editor", Some(Scope::Editor)),
        ("application_tabs", Some(Scope::Applications)),
        ("explorer_tabs", Some(Scope::Files)),
        ("recently_deleted", Some(Scope::Tree)),
        ("list_chats", Some(Scope::ChatsRead)),
        ("read_chat", Some(Scope::ChatsRead)),
        ("search_chats", Some(Scope::ChatsRead)),
        ("draft_message", Some(Scope::ChatsWrite)),
        ("post_message", Some(Scope::ChatsWrite)),
        ("react", Some(Scope::ChatsWrite)),
        ("run_agent", Some(Scope::Agents)),
        ("agent_result", Some(Scope::Agents)),
    ];

    pub const READER_TABS: &str = "agent.reader_tabs";

    pub const LEND: &str = "agent.lend";

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Lend {
        pub tab: String,
    }

    pub const STORE_FOR: &str = "agent.store_for";

    pub const MARKDOWN: &str = "agent.markdown";

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct StoreAsk {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub space: Option<String>,
        pub url: String,
    }

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct StoreSaid {
        pub space: String,
        #[serde(default)]
        pub store: Option<String>,
    }

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Convert {
        pub html: String,
        pub url: String,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_window_answer_is_read_by_its_status() {
        let read = Answer::from_window;
        assert_eq!(
            read(r#"{"ok":true,"status":"ok","result":{"path":"a.md"}}"#).status(),
            "ok"
        );
        assert_eq!(
            read(
                r#"{"ok":true,"status":"needs_approval","approval":"a17","summary":"Publish Notes"}"#
            ),
            Answer::NeedsApproval {
                approval: "a17".into(),
                summary: "Publish Notes".into(),
            }
        );
        assert!(matches!(
            read(r#"{"ok":false,"status":"error","code":"not_granted","message":"no","error":"no"}"#),
            Answer::Error { code: Code::NotGranted, ref message, .. } if message == "no"
        ));
        assert!(matches!(
            read(r#"{"ok":false,"status":"error","code":"nope","message":"why"}"#),
            Answer::Error { code: Code::Failed, ref message, .. } if message == "why"
        ));
        assert_eq!(read(r#"{"ok":true,"value":3}"#).status(), "ok");
        assert!(matches!(
            read(r#"{"ok":false,"error":"gone"}"#),
            Answer::Error { code: Code::Failed, ref message, .. } if message == "gone"
        ));
        assert_eq!(
            read(r#"{"ok":false,"status":"error","code":"failed","message":"\"ok\":true"}"#)
                .status(),
            "error"
        );
        assert_eq!(read("not json").status(), "error");
    }

    #[test]
    fn every_name_is_its_own_verb() {
        let mut seen = std::collections::HashSet::new();
        for name in NAMES {
            assert!(seen.insert(*name), "{name} is in the table twice");
            assert!(Verb::read(name, json!({})).is_some(), "{name} is not read");
        }
        assert_eq!(NAMES.len(), ANSWERS.len());
    }

    #[test]
    fn a_name_that_is_not_a_browser_verb_is_the_windows() {
        assert!(Verb::read("files.read", json!({})).is_none());
        assert!(Verb::read("eval", json!({})).is_none());
    }

    #[test]
    fn a_verb_that_takes_nothing_may_be_sent_nothing() {
        assert_eq!(
            Verb::read("browser_tabs", Value::Null),
            Some(Ok(Verb::Tabs(Nothing {})))
        );
    }

    #[test]
    fn arguments_it_does_not_take_are_refused() {
        let read = Verb::read("browser_click", json!({ "tab": "a1", "reff": "e2" }));
        assert!(matches!(read, Some(Err(_))));
    }

    #[test]
    fn a_click_reads_its_ref_and_its_defaults() {
        let read = Verb::read("browser_click", json!({ "tab": "a1", "ref": "f2e17" }));
        let Some(Ok(Verb::Click(click))) = read else {
            panic!("{read:?}");
        };
        assert_eq!(click.element.as_deref(), Some("f2e17"));
        assert_eq!(click.button, Button::Left);
        assert!(click.modifiers.is_empty());
    }

    #[test]
    fn a_click_can_be_a_point_in_the_tab_instead() {
        let read = Verb::read("browser_click", json!({ "tab": "a1", "x": 120.5, "y": 48 }));
        let Some(Ok(Verb::Click(click))) = read else {
            panic!("{read:?}");
        };
        assert_eq!(click.element, None);
        assert_eq!((click.x, click.y), (Some(120.5), Some(48.0)));
    }

    #[test]
    fn a_wait_is_a_word_or_one_of_three_shapes() {
        let read =
            |until: Value| match Verb::read("browser_wait", json!({ "tab": "a1", "for": until })) {
                Some(Ok(Verb::Wait(wait))) => wait.until,
                other => panic!("{other:?}"),
            };
        assert_eq!(read(json!("load")), Until::Moment(Moment::Load));
        assert_eq!(
            read(json!("network_idle")),
            Until::Moment(Moment::NetworkIdle)
        );
        assert_eq!(
            read(json!({ "text": "Saved" })),
            Until::Text {
                text: "Saved".into()
            }
        );
        assert_eq!(
            read(json!({ "ref": "e4" })),
            Until::Element {
                element: "e4".into()
            }
        );
        assert_eq!(
            read(json!({ "url": "/done" })),
            Until::Url {
                url: "/done".into()
            }
        );
    }

    #[test]
    fn a_field_is_ticked_or_words_or_options() {
        let fields: Vec<Field> = serde_json::from_value(json!([
            { "ref": "e1", "value": true },
            { "ref": "e2", "value": "Ada" },
            { "ref": "e3", "value": ["a", "b"] },
        ]))
        .expect("fields");
        assert_eq!(fields[0].value, FieldValue::Ticked(true));
        assert_eq!(fields[1].value, FieldValue::Words("Ada".into()));
        assert_eq!(
            fields[2].value,
            FieldValue::Options(vec!["a".into(), "b".into()])
        );
    }

    #[test]
    fn a_question_answers_at_once_in_the_documents_shape() {
        let asked = Answer::NeedsApproval {
            approval: "a17".into(),
            summary: "Place order on shop.example".into(),
        };
        assert_eq!(
            serde_json::to_value(&asked).expect("json"),
            json!({ "status": "needs_approval", "approval": "a17", "summary": "Place order on shop.example" })
        );
    }

    #[test]
    fn an_error_says_its_code_and_any_dialog() {
        let dialog = Dialog {
            kind: DialogKind::Confirm,
            message: "Delete this?".into(),
            default_text: None,
            url: "https://shop.example/".into(),
            open_ms: 12,
        };
        let said =
            Answer::error(Code::Stopped, "the reader pressed the stop").with_dialog(Some(dialog));
        assert_eq!(
            serde_json::to_value(&said).expect("json"),
            json!({
                "status": "error",
                "code": "stopped",
                "message": "the reader pressed the stop",
                "dialog": { "kind": "confirm", "message": "Delete this?", "url": "https://shop.example/", "open_ms": 12 },
            })
        );
    }

    #[test]
    fn an_event_says_its_kind() {
        let event = Event::Paused {
            agent: "claude-code".into(),
        };
        assert_eq!(
            serde_json::to_value(&event).expect("json"),
            json!({ "kind": "paused", "agent": "claude-code" })
        );
        assert_eq!(
            serde_json::to_value(Event::Stopped { closed: false }).expect("json"),
            json!({ "kind": "stopped", "closed": false })
        );
    }
}
