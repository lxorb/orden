use std::fmt;

pub const LONGEST_ID: usize = 200;

macro_rules! id {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(String);

        impl $name {
            #[must_use]
            pub fn new(raw: &str) -> Option<Self> {
                (!raw.is_empty() && raw.len() <= LONGEST_ID).then(|| Self(raw.to_owned()))
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id!(SpaceId);
id!(UserId);
id!(GuestId);
id!(DeviceId);
id!(TabId);
id!(AgentId);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ItemId(String);

impl ItemId {
    #[must_use]
    pub fn new(raw: &str) -> Option<Self> {
        let plain = !raw.is_empty()
            && raw.len() <= LONGEST_ID
            && !raw.contains(['/', '\\'])
            && !raw.contains("..")
            && !raw.chars().any(char::is_control);
        plain.then(|| Self(raw.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NotePath(String);

impl NotePath {
    #[must_use]
    pub fn new(raw: &str) -> Option<Self> {
        (!raw.is_empty() && !raw.contains('\0')).then(|| Self(raw.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EntryKind {
    Note,
    Canvas,
    Pages,
    Url,
    Term,
    Chat,
    File,
    Folder,
}

impl EntryKind {
    pub const ALL: [EntryKind; 8] = [
        EntryKind::Note,
        EntryKind::Canvas,
        EntryKind::Pages,
        EntryKind::Url,
        EntryKind::Term,
        EntryKind::Chat,
        EntryKind::File,
        EntryKind::Folder,
    ];

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            EntryKind::Note => "note",
            EntryKind::Canvas => "canvas",
            EntryKind::Pages => "pages",
            EntryKind::Url => "url",
            EntryKind::Term => "term",
            EntryKind::Chat => "chat",
            EntryKind::File => "file",
            EntryKind::Folder => "folder",
        }
    }

    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == raw)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FailureKind {
    Invalid,
    Missing,
    Refused,
    Conflict,
    Unreachable,
    Timeout,
    TooLarge,
    Unsupported,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub kind: FailureKind,
    pub module: &'static str,
    pub message: String,
}

impl Failure {
    #[must_use]
    pub fn new(module: &'static str, kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            module,
            message: message.into(),
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.module, self.message)
    }
}

impl std::error::Error for Failure {}

pub type Outcome<T> = Result<T, Failure>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub path: NotePath,
    pub is_dir: bool,
    pub modified: u64,
    pub created: u64,
    pub children: Vec<Entry>,
}

pub trait NoteStore {
    fn read(&self, path: &NotePath) -> Outcome<String>;

    fn write(&self, path: &NotePath, words: &str) -> Outcome<()>;

    fn write_bytes(&self, path: &NotePath, bytes: &[u8]) -> Outcome<()>;

    fn tree(&self, space: &SpaceId) -> Outcome<Entry>;
}

pub trait Events {
    fn emit(&self, name: &str, payload: &str) -> Outcome<()>;
}

pub const EVENT_PREFIX: &str = "orden://";

#[must_use]
pub fn is_event_name(name: &str) -> bool {
    name.len() > EVENT_PREFIX.len() && name.starts_with(EVENT_PREFIX)
}
