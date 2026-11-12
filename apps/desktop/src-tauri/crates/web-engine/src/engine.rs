use std::path::{Path, PathBuf};

use orden_contracts::{Failure, FailureKind, Outcome};
use url::Url;

use crate::policy::{tab_may_open, Becomes, ExtensionUrls};
use crate::profiles::{Profiles, StoreName};
use crate::switches::{overlay_scrollbars, Switch, ENGINE_SWIPE};
use crate::MODULE;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SandboxPolicy {
    #[default]
    Auto,
    Required,
    Disabled,
}

impl SandboxPolicy {
    #[must_use]
    pub fn parse(asked: &str) -> Self {
        match asked {
            "required" => Self::Required,
            "disabled" | "off" => Self::Disabled,
            _ => Self::Auto,
        }
    }
}

pub const LOWEST_DEBUG_PORT: u16 = 1024;

#[must_use]
pub fn debug_port(asked: Option<&str>) -> Option<u16> {
    asked
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port >= LOWEST_DEBUG_PORT)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineSettings {
    pub sandbox: SandboxPolicy,
    pub remote_debugging: Option<u16>,
    pub switches: Vec<Switch>,
    pub disabled_features: Vec<String>,
    pub enabled_features: Vec<String>,
    pub deep_link_schemes: Vec<String>,
    pub root_cache: Option<PathBuf>,
    pub windowless: bool,
    pub accelerated: bool,
}

impl Default for EngineSettings {
    fn default() -> Self {
        let (swipe_feature, swipe_switch, swipe_off) = ENGINE_SWIPE;
        Self {
            sandbox: SandboxPolicy::Auto,
            remote_debugging: None,
            switches: vec![(swipe_switch.to_owned(), Some(swipe_off.to_owned()))],
            disabled_features: vec![swipe_feature.to_owned()],
            enabled_features: overlay_scrollbars()
                .map(str::to_owned)
                .into_iter()
                .collect(),
            deep_link_schemes: vec!["orden".to_owned(), "nib".to_owned()],
            root_cache: None,
            windowless: false,
            accelerated: true,
        }
    }
}

impl EngineSettings {
    #[must_use]
    pub fn with_switches(mut self, more: impl IntoIterator<Item = Switch>) -> Self {
        self.switches.extend(more);
        self
    }

    #[must_use]
    pub fn disabling(mut self, feature: &str) -> Self {
        if !self.disabled_features.iter().any(|one| one == feature) {
            self.disabled_features.push(feature.to_owned());
        }
        self
    }

    #[must_use]
    pub fn enabling(mut self, feature: &str) -> Self {
        if !self.enabled_features.iter().any(|one| one == feature) {
            self.enabled_features.push(feature.to_owned());
        }
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Embed {
    pub label: String,
    pub window: String,
    pub url: Url,
    pub store: Option<StoreName>,
    pub private: bool,
    pub position: (f64, f64),
    pub size: (f64, f64),
}

pub fn embed_allowed(embed: &Embed, extensions: &impl ExtensionUrls) -> Outcome<()> {
    if embed.label.is_empty() {
        return Err(Failure::new(
            MODULE,
            FailureKind::Invalid,
            "a page has a label",
        ));
    }
    if crate::policy::blank(&embed.url) || tab_may_open(&embed.url, extensions) {
        return Ok(());
    }
    Err(Failure::new(
        MODULE,
        FailureKind::Refused,
        format!("{} is not an address a web tab opens", embed.url),
    ))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub expires: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Download {
    pub id: u64,
    pub url: String,
    pub file: PathBuf,
    pub received: u64,
    pub total: Option<u64>,
    pub done: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Picture {
    pub width: u32,
    pub height: u32,
    pub png: Vec<u8>,
}

pub trait WebPage {
    fn label(&self) -> &str;

    fn navigate(&self, url: &Url) -> Outcome<()>;

    fn step(&self, delta: i32) -> Outcome<()>;

    fn reload(&self) -> Outcome<()>;

    fn evaluate(&self, script: &str) -> Outcome<()>;

    fn send(&self, message: &str) -> Outcome<u64>;

    fn place(&self, position: (f64, f64), size: (f64, f64)) -> Outcome<()>;

    fn zoom(&self, factor: f64) -> Outcome<()>;

    fn find(&self, text: &str, forward: bool) -> Outcome<()>;

    fn devtools(&self) -> Outcome<()>;

    fn print_to_pdf(&self, into: &Path) -> Outcome<()>;

    fn capture(&self) -> Outcome<Picture>;

    fn close(&self) -> Outcome<()>;
}

pub trait WebEngine {
    fn settings(&self) -> &EngineSettings;

    fn profiles(&self) -> &Profiles;

    fn embed(&self, embed: Embed) -> Outcome<Box<dyn WebPage>>;

    fn page(&self, label: &str) -> Option<Box<dyn WebPage>>;

    fn cookies(&self, store: Option<&StoreName>) -> Outcome<Vec<Cookie>>;

    fn clear(&self, store: Option<&StoreName>) -> Outcome<()>;

    fn downloads(&self) -> Outcome<Vec<Download>>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Heard {
    Navigated { label: String, url: String },
    Titled { label: String, title: String },
    Loaded { label: String },
    Opening { label: String, becomes: Becomes },
    Downloading(Download),
    Closed { label: String },
}

pub trait Listener {
    fn heard(&self, event: Heard);
}
