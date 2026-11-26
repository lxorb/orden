use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tauri::AppHandle;

use crate::verbs::Category;
use orden_base::paths::{config_dir, made, write_privately};

const TOKEN_BYTES: usize = 32;
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Scope {
    #[serde(rename = "context")]
    Context,
    #[serde(rename = "notes.read")]
    NotesRead,
    #[serde(rename = "notes.write")]
    NotesWrite,
    #[serde(rename = "chats.read")]
    ChatsRead,
    #[serde(rename = "chats.write")]
    ChatsWrite,
    #[serde(rename = "tree")]
    Tree,
    #[serde(rename = "workspace")]
    Workspace,
    #[serde(rename = "workspace.focus")]
    WorkspaceFocus,
    #[serde(rename = "browser")]
    Browser,
    #[serde(rename = "browser.reader")]
    BrowserReader,
    #[serde(rename = "browser.script")]
    BrowserScript,
    #[serde(rename = "browser.network")]
    BrowserNetwork,
    #[serde(rename = "browser.storage")]
    BrowserStorage,
    #[serde(rename = "settings")]
    Settings,
    #[serde(rename = "terminal")]
    Terminal,
    #[serde(rename = "files")]
    Files,
    #[serde(rename = "processes")]
    Processes,
    #[serde(rename = "network")]
    Network,
    #[serde(rename = "clipboard")]
    Clipboard,
    #[serde(rename = "ask")]
    Ask,
    #[serde(rename = "editor")]
    Editor,
    #[serde(rename = "time")]
    Time,
    #[serde(rename = "agents")]
    Agents,
}
impl Scope {
    pub const ALL: [Scope; 23] = [
        Scope::Context,
        Scope::NotesRead,
        Scope::NotesWrite,
        Scope::ChatsRead,
        Scope::ChatsWrite,
        Scope::Tree,
        Scope::Workspace,
        Scope::WorkspaceFocus,
        Scope::Browser,
        Scope::BrowserReader,
        Scope::BrowserScript,
        Scope::BrowserNetwork,
        Scope::BrowserStorage,
        Scope::Settings,
        Scope::Terminal,
        Scope::Files,
        Scope::Processes,
        Scope::Network,
        Scope::Clipboard,
        Scope::Ask,
        Scope::Editor,
        Scope::Time,
        Scope::Agents,
    ];
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Every {
    All,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Spaces {
    All(Every),
    Named(Vec<String>),
}
impl Spaces {
    pub fn reach(&self, space: &str) -> bool {
        match self {
            Spaces::All(_) => true,
            Spaces::Named(names) => names.iter().any(|one| one == space),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SiteRule {
    Allow,
    Deny,
    AgentStore,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Unsupervised,
    Confirm,
    Autonomous,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    pub tabs: u32,
    pub calls: u32,
    pub navigations: u32,
    #[serde(default)]
    pub memory: u32,
}
impl Default for Limits {
    fn default() -> Self {
        Limits { tabs: 4, calls: 600, navigations: 60, memory: 0 }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Grant {
    pub id: String,
    pub name: String,
    pub client: String,
    #[serde(deserialize_with = "known_scopes")]
    pub scopes: Vec<Scope>,
    pub spaces: Spaces,
    #[serde(default)]
    pub sites: BTreeMap<String, SiteRule>,
    #[serde(default)]
    pub scripts: Vec<String>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub asks: BTreeMap<Category, bool>,
    #[serde(default)]
    pub always: BTreeMap<String, Vec<Category>>,
    #[serde(default)]
    pub programs: Vec<String>,
    #[serde(default)]
    pub limits: Limits,
    #[serde(default)]
    pub created: u64,
    #[serde(default)]
    pub built_in: bool,
    #[serde(skip)]
    pub thread: Option<String>,
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub chat: Option<Chat>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Chat {
    pub mode: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub without: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(skip)]
    pub kept_out: BTreeSet<String>,
}
impl Grant {
    pub fn own(id: String, client: &str) -> Self {
        Grant {
            id,
            name: client.to_string(),
            client: client.to_string(),
            scopes: Scope::ALL
                .into_iter()
                .filter(|one| {
                    !matches!(one, Scope::BrowserScript | Scope::BrowserStorage | Scope::Settings)
                })
                .collect(),
            spaces: Spaces::All(Every::All),
            sites: BTreeMap::new(),
            scripts: Vec::new(),
            mode: Mode::Unsupervised,
            asks: BTreeMap::new(),
            always: BTreeMap::new(),
            programs: Vec::new(),
            limits: Limits::default(),
            created: orden_base::clock::now(),
            built_in: false,
            thread: None,
            chat: None,
        }
    }
    pub fn third_party(id: String, client: &str) -> Self {
        let mut grant = Grant::own(id, client);
        grant.scopes.retain(|one| {
            !matches!(
                one,
                Scope::Context
                    | Scope::BrowserReader
                    | Scope::ChatsRead
                    | Scope::ChatsWrite
                    | Scope::Agents
                    | Scope::Terminal
                    | Scope::Files
                    | Scope::Processes
                    | Scope::Network
                    | Scope::Clipboard
                    | Scope::Ask
                    | Scope::Editor
                    | Scope::Time
            )
        });
        grant.mode = Mode::Confirm;
        grant
    }
    #[must_use]
    pub fn with_full_permissions(mut self) -> Self {
        self.mode = Mode::Autonomous;
        self.scopes = Scope::ALL.into_iter().collect();
        self
    }
    pub fn holds(&self, scope: Scope) -> bool {
        self.mode == Mode::Autonomous || self.scopes.contains(&scope)
    }
    pub fn asks(&self, category: Category) -> bool {
        let on = self.asks.get(&category).copied().unwrap_or(true);
        on && self.mode != Mode::Autonomous
    }
    pub fn asks_nothing(&self) -> bool {
        self.mode == Mode::Autonomous
    }
    pub fn always(&self, site: &str, category: Category) -> bool {
        self.always.get(site).is_some_and(|categories| categories.contains(&category))
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Kept {
    #[serde(flatten)]
    grant: Grant,
    token: String,
}
#[derive(Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    agents: Vec<Kept>,
    #[serde(default)]
    chats: bool,
    #[serde(default)]
    helpers: bool,
    #[serde(default)]
    orden: bool,
    #[serde(default)]
    carried: u32,
}
const CARRIED: u32 = 1;
pub const SIDEBAR: &str = "Orden ";
const SIDEBAR_DOTTED: &str = "Orden \u{b7} ";
pub const BUILT_IN: &str = "orden-";
fn undotted(grant: &mut Grant) {
    let Some(rest) = grant.client.strip_prefix(SIDEBAR_DOTTED) else {
        return;
    };
    grant.client = format!("{SIDEBAR}{rest}");
    if let Some(rest) = grant.name.strip_prefix(SIDEBAR_DOTTED) {
        grant.name = format!("{SIDEBAR}{rest}");
    }
}
fn with_helpers(grant: &mut Grant) {
    if grant.holds(Scope::Context) && !grant.holds(Scope::Agents) {
        grant.scopes.push(Scope::Agents);
    }
}
fn with_chats(grant: &mut Grant) {
    if !grant.holds(Scope::Context) {
        return;
    }
    for (notes, chats) in
        [(Scope::NotesRead, Scope::ChatsRead), (Scope::NotesWrite, Scope::ChatsWrite)]
    {
        if grant.holds(notes) && !grant.holds(chats) {
            grant.scopes.push(chats);
        }
    }
}
const BUSY: &str = "the agents cannot be read just now";
#[derive(Default)]
pub struct Grants(Mutex<Option<Vec<Kept>>>, Mutex<()>);
impl Grants {
    fn with<T>(
        &self,
        app: &AppHandle,
        with: impl FnOnce(&mut Vec<Kept>) -> T,
    ) -> Result<T, String> {
        let loaded = self.0.lock().map_err(|_| BUSY.to_string())?.is_some();
        let fresh = if loaded {
            None
        } else {
            let (kept, trouble) = read_carried(&file(app)?);
            if let Some(trouble) = trouble {
                orden_base::logs::say(app, "warn", &format!("agents: {trouble}"));
            }
            Some(kept)
        };
        let mut held = self.0.lock().map_err(|_| BUSY.to_string())?;
        if held.is_none() {
            *held = fresh;
        }
        let kept = held.as_mut().ok_or(BUSY)?;
        Ok(with(kept))
    }
    fn changed<T>(
        &self,
        app: &AppHandle,
        change: impl FnOnce(&mut Vec<Kept>) -> Result<T, String>,
    ) -> Result<T, String> {
        let path = file(app)?;
        let writing = self.1.lock().map_err(|_| BUSY.to_string())?;
        let (made, now) =
            self.with(app, |kept| change(kept).map(|made| (made, kept.clone())))??;
        write(&path, &now)?;
        drop(writing);
        Ok(made)
    }
    pub fn by_token(&self, app: &AppHandle, token: &str) -> Option<Grant> {
        let said = hashed(token);
        self.with(app, |kept| {
            let mut found = None;
            for one in kept.iter() {
                if same(&said, &one.token) && found.is_none() {
                    found = Some(one.grant.clone());
                }
            }
            found
        })
        .ok()
        .flatten()
    }
    pub fn by_id(&self, app: &AppHandle, id: &str) -> Option<Grant> {
        self.with(app, |kept| {
            kept.iter().find(|one| one.grant.id == id).map(|one| one.grant.clone())
        })
        .ok()
        .flatten()
    }
    pub fn all(&self, app: &AppHandle) -> Result<Vec<Grant>, String> {
        self.with(app, |kept| kept.iter().map(|one| one.grant.clone()).collect())
    }
    pub fn mint(
        &self,
        app: &AppHandle,
        client: &str,
        make: impl FnOnce(String, &str) -> Grant,
    ) -> Result<(Grant, String), String> {
        let token = fresh_token()?;
        self.changed(app, |kept| {
            let ids: Vec<&str> = kept.iter().map(|one| one.grant.id.as_str()).collect();
            let grant = make(free_id(client, &ids), client);
            kept.push(Kept { grant: grant.clone(), token: hashed(&token) });
            Ok((grant, token))
        })
    }
    pub fn replace(&self, app: &AppHandle, grants: Vec<Grant>) -> Result<Vec<Grant>, String> {
        self.changed(app, |kept| {
            let mut next = Vec::with_capacity(kept.len());
            for grant in grants {
                if let Some(one) = kept.iter().find(|one| one.grant.id == grant.id) {
                    next.push(Kept {
                        grant: Grant {
                            client: one.grant.client.clone(),
                            created: one.grant.created,
                            built_in: one.grant.built_in,
                            mode: if grant.mode == Mode::Autonomous {
                                one.grant.mode
                            } else {
                                grant.mode
                            },
                            ..grant
                        },
                        token: one.token.clone(),
                    });
                }
            }
            *kept = next;
            Ok(kept.iter().map(|one| one.grant.clone()).collect())
        })
    }
    pub fn change(
        &self,
        app: &AppHandle,
        id: &str,
        change: impl FnOnce(&mut Grant),
    ) -> Result<(), String> {
        self.changed(app, |kept| {
            let Some(one) = kept.iter_mut().find(|one| one.grant.id == id) else {
                return Err("there is no such agent".to_string());
            };
            change(&mut one.grant);
            Ok(())
        })
    }
}
pub fn cached(id: &str) -> Option<Grant> {
    crate::AGENTS
        .get()?
        .grants
        .0
        .lock()
        .ok()?
        .as_ref()?
        .iter()
        .find(|one| one.grant.id == id)
        .map(|one| one.grant.clone())
}
fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("agents.json"))
}
fn known_scopes<'de, D: serde::Deserializer<'de>>(said: D) -> Result<Vec<Scope>, D::Error> {
    let all = Vec::<serde_json::Value>::deserialize(said)?;
    Ok(all.into_iter().filter_map(|one| serde_json::from_value(one).ok()).collect())
}
#[cfg(test)]
fn read(path: &std::path::Path) -> Vec<Kept> {
    read_carried(path).0
}
fn read_carried(path: &std::path::Path) -> (Vec<Kept>, Option<String>) {
    let Some((text, file)) = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<File>(&text).ok().map(|file| (text, file)))
    else {
        return (Vec::new(), None);
    };
    let mut agents = file.agents;
    if !file.chats {
        for one in &mut agents {
            with_chats(&mut one.grant);
        }
    }
    if !file.helpers {
        for one in &mut agents {
            with_helpers(&mut one.grant);
        }
    }
    for one in &mut agents {
        undotted(&mut one.grant);
    }
    if file.carried >= CARRIED {
        return (agents, None);
    }
    let mut grants: Vec<&mut Grant> = agents.iter_mut().map(|one| &mut one.grant).collect();
    crate::former_grants::carried(&mut grants, file.orden);
    let trouble = kept_carried(path, &text, &agents).err();
    (agents, trouble)
}
fn kept_carried(path: &std::path::Path, before: &str, agents: &[Kept]) -> Result<(), String> {
    write(path, agents)
        .map_err(|error| format!("the agents stay under their former ids on disk: {error}"))?;
    let said = |kept: &[Kept]| serde_json::to_value(kept).ok();
    let back = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<File>(&text).ok())
        .is_some_and(|file| file.carried >= CARRIED && said(&file.agents) == said(agents));
    if back {
        return Ok(());
    }
    let restored = write_privately(path, before.as_bytes());
    Err(match restored {
        Ok(()) => "the agents did not read back as carried, so the file is as it was".to_owned(),
        Err(error) => format!("the agents did not read back as carried: {error}"),
    })
}
fn write(path: &std::path::Path, kept: &[Kept]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        made(dir)?;
    }
    let text = serde_json::to_string_pretty(&File {
        agents: kept.to_vec(),
        chats: true,
        helpers: true,
        orden: true,
        carried: CARRIED,
    })
    .map_err(|error| format!("could not write the agents: {error}"))?;
    write_privately(path, text.as_bytes())
}
fn free_id(client: &str, taken: &[&str]) -> String {
    let mut stem = String::new();
    for one in client.chars().flat_map(char::to_lowercase) {
        if one.is_ascii_alphanumeric() {
            stem.push(one);
        } else if !stem.is_empty() && !stem.ends_with('-') {
            stem.push('-');
        }
        if stem.len() >= 32 {
            break;
        }
    }
    let stem = stem.trim_end_matches('-');
    let stem = if stem.is_empty() { "agent" } else { stem };
    let kept = format!("agent-{stem}");
    let built_in = |prefix: &str| stem == prefix.trim_end_matches('-') || stem.starts_with(prefix);
    let stem = if built_in(BUILT_IN) { kept.as_str() } else { stem };
    if !taken.contains(&stem) {
        return stem.to_string();
    }
    (2..10_000)
        .map(|n| format!("{stem}-{n}"))
        .find(|one| !taken.contains(&one.as_str()))
        .unwrap_or_else(|| stem.to_string())
}
pub fn fresh_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("no randomness to make a token from: {error}"))?;
    Ok(hex(&bytes))
}
pub fn hashed(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}
pub(crate) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}
pub fn same(one: &str, other: &str) -> bool {
    if one.len() != other.len() {
        return false;
    }
    let mut differences = 0_u8;
    for (a, b) in one.bytes().zip(other.bytes()) {
        differences |= a ^ b;
    }
    differences == 0
}
#[tauri::command(async)]
pub fn agents_read(webview: tauri::Webview, app: AppHandle) -> Result<Vec<Grant>, String> {
    orden_base::labels::from_the_app(&webview)?;
    crate::state(&app).grants.all(&app)
}
#[tauri::command(async)]
pub fn agents_write(
    webview: tauri::Webview,
    app: AppHandle,
    grants: Vec<Grant>,
) -> Result<Vec<Grant>, String> {
    orden_base::labels::from_the_app(&webview)?;
    crate::state(&app).grants.replace(&app, grants)
}
#[tauri::command(async)]
pub fn agents_mint(
    webview: tauri::Webview,
    app: AppHandle,
    name: String,
) -> Result<Minted, String> {
    orden_base::labels::from_the_app(&webview)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("an agent needs a name".into());
    }
    let (grant, token) = crate::state(&app).grants.mint(&app, name, Grant::third_party)?;
    Ok(Minted { grant, token })
}
#[derive(Serialize)]
pub struct Minted {
    pub grant: Grant,
    pub token: String,
}
#[cfg(test)]
impl Grants {
    fn from(kept: Vec<Kept>) -> Self {
        Grants(Mutex::new(Some(kept)), Mutex::default())
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn kept(id: &str, token: &str) -> Kept {
        Kept { grant: Grant::own(id.into(), id), token: hashed(token) }
    }
    fn written(text: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("dir");
        let path = dir.path().join("agents.json");
        std::fs::write(&path, text).expect("write");
        (dir, path)
    }
    #[test]
    fn a_grant_round_trips_through_the_file_shape() {
        let mut grant = Grant::own("claude-code".into(), "Claude Code");
        grant.sites.insert("bank.example".into(), SiteRule::AgentStore);
        grant.sites.insert("evil.example".into(), SiteRule::Deny);
        grant.asks.insert(Category::Sending, false);
        grant.always.insert("shop.example".into(), vec![Category::Paying]);
        grant.spaces = Spaces::Named(vec!["Research".into()]);
        let text = serde_json::to_string(&File {
            agents: vec![Kept { grant: grant.clone(), token: hashed("t") }],
            chats: true,
            helpers: true,
            orden: true,
            carried: CARRIED,
        })
        .expect("json");
        let back: File = serde_json::from_str(&text).expect("read");
        assert_eq!(back.agents[0].grant, grant);
        assert_eq!(back.agents[0].token, hashed("t"));
        let value: serde_json::Value = serde_json::from_str(&text).expect("value");
        let one = &value["agents"][0];
        assert_eq!(one["sites"]["bank.example"], "agent-store");
        assert_eq!(one["spaces"][0], "Research");
        assert_eq!(one["mode"], "unsupervised");
        assert_eq!(one["asks"]["sending"], false);
        assert!(one["scopes"].as_array().expect("scopes").contains(&"browser.reader".into()));
    }
    #[test]
    fn a_scope_no_longer_known_is_dropped_and_the_grant_still_reads() {
        let mut value = serde_json::to_value(File {
            agents: vec![Kept { grant: Grant::own("a".into(), "A"), token: hashed("t") }],
            chats: true,
            helpers: true,
            orden: true,
            carried: CARRIED,
        })
        .expect("json");
        let scopes = value["agents"][0]["scopes"].as_array_mut().expect("scopes");
        scopes.insert(0, "applications".into());
        scopes.push("someday".into());
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("agents.json");
        std::fs::write(&path, value.to_string()).expect("written");
        let read = read(&path);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].grant.scopes, Grant::own("a".into(), "A").scopes);
    }
    #[test]
    fn the_file_from_before_the_rename_is_carried_once_and_kept_carried() {
        let kept = |id: &str, client: &str, name: &str| {
            let mut grant = Grant::own(id.into(), client);
            grant.name = name.into();
            Kept { grant, token: hashed("t") }
        };
        let text = serde_json::json!({
            "agents": [
                kept("nib-anthropic", "nib \u{b7} Claude", "nib \u{b7} Claude"),
                kept("nib-openai", "nib \u{b7} OpenAI", "My own OpenAI"),
                kept("claude-code", "Claude Code", "Claude Code"),
            ],
            "chats": true,
            "helpers": true,
        })
        .to_string();
        let (_dir, path) = written(&text);
        let (read, trouble) = read_carried(&path);
        assert_eq!(trouble, None);
        let said: Vec<(&str, &str, &str)> = read
            .iter()
            .map(|one| (one.grant.id.as_str(), one.grant.client.as_str(), one.grant.name.as_str()))
            .collect();
        assert_eq!(
            said,
            [
                ("orden-anthropic", "Orden Claude", "Orden Claude"),
                ("orden-openai", "Orden OpenAI", "My own OpenAI"),
                ("claude-code", "Claude Code", "Claude Code"),
            ]
        );
        assert!(read[0].grant.built_in && read[1].grant.built_in && !read[2].grant.built_in);
        let on_disk = std::fs::read_to_string(&path).expect("the file");
        let file: File = serde_json::from_str(&on_disk).expect("json");
        assert_eq!(file.carried, CARRIED);
        assert_eq!(file.agents[0].grant.id, "orden-anthropic");
        assert_eq!(file.agents[0].token, hashed("t"));
        let mut named = read.clone();
        named[2].grant.id = "nib-mine".into();
        named[2].grant.client = "Orden mine".into();
        named[2].grant.name = "nib \u{b7} mine".into();
        write(&path, &named).expect("write again");
        let again = super::read(&path);
        assert_eq!(again[2].grant.id, "nib-mine");
        assert_eq!(again[2].grant.name, "nib \u{b7} mine");
    }
    #[test]
    fn a_file_that_cannot_be_carried_keeps_its_former_words_and_says_so() {
        let (_dir, path) = written("not json");
        assert_eq!(read_carried(&path), (Vec::new(), None));
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "not json");
        let agents = [kept("orden-anthropic", "t")];
        let behind_a_file = path.join("agents.json");
        let trouble = kept_carried(&behind_a_file, "before", &agents).expect_err("no folder");
        assert!(trouble.contains("former ids"), "{trouble}");
        assert_eq!(std::fs::read_to_string(&path).expect("the file"), "not json");
    }
    #[test]
    fn a_sidebar_grant_named_with_a_dot_loses_the_dot_and_nothing_else() {
        let kept = |id: &str, client: &str, name: &str| {
            let mut grant = Grant::own(id.into(), client);
            grant.name = name.into();
            grant.built_in = id.starts_with(BUILT_IN);
            Kept { grant, token: hashed("t") }
        };
        let text = serde_json::json!({
            "agents": [
                kept("orden-anthropic", "Orden \u{b7} Claude", "Orden \u{b7} Claude"),
                kept("orden-openai", "Orden \u{b7} OpenAI", "Mine"),
                kept("claude-code", "Claude Code", "Orden \u{b7} mine"),
            ],
            "chats": true,
            "helpers": true,
            "orden": true,
        })
        .to_string();
        let (_dir, path) = written(&text);
        let read = read(&path);
        let labels: Vec<(&str, &str, &str)> = read
            .iter()
            .map(|one| (one.grant.id.as_str(), one.grant.client.as_str(), one.grant.name.as_str()))
            .collect();
        assert_eq!(
            labels,
            [
                ("orden-anthropic", "Orden Claude", "Orden Claude"),
                ("orden-openai", "Orden OpenAI", "Mine"),
                ("claude-code", "Claude Code", "Orden \u{b7} mine"),
            ]
        );
        assert!(read[0].grant.built_in);
    }
    #[test]
    fn a_grant_from_before_chats_reads_and_posts_where_it_reads_and_writes_notes() {
        let mut own = Grant::own("a".into(), "A");
        own.scopes
            .retain(|one| !matches!(one, Scope::ChatsRead | Scope::ChatsWrite | Scope::NotesWrite));
        let mut other = Grant::own("b".into(), "B");
        other
            .scopes
            .retain(|one| !matches!(one, Scope::Context | Scope::ChatsRead | Scope::ChatsWrite));
        let kept = |grant: &Grant| Kept { grant: grant.clone(), token: hashed("t") };
        let text = serde_json::json!({ "agents": [kept(&own), kept(&other)] }).to_string();
        let (_dir, path) = written(&text);
        let read = read(&path);
        assert!(read[0].grant.holds(Scope::ChatsRead));
        assert!(!read[0].grant.holds(Scope::ChatsWrite));
        assert!(!read[1].grant.holds(Scope::ChatsRead));
        let mut taken = read.clone();
        taken[0].grant.scopes.retain(|one| *one != Scope::ChatsRead);
        write(&path, &taken).expect("write again");
        assert!(!super::read(&path)[0].grant.holds(Scope::ChatsRead));
    }
    #[test]
    fn every_space_is_the_word_all() {
        let all: Spaces = serde_json::from_str("\"all\"").expect("all");
        assert_eq!(all, Spaces::All(Every::All));
        assert!(all.reach("anything"));
        let some: Spaces = serde_json::from_str("[\"A\"]").expect("named");
        assert!(some.reach("A"));
        assert!(!some.reach("B"));
        assert_eq!(serde_json::to_string(&all).expect("json"), "\"all\"");
    }
    #[test]
    fn the_defaults_are_emils() {
        let own = Grant::own("a".into(), "A");
        assert!(own.holds(Scope::Browser));
        assert!(own.holds(Scope::BrowserReader));
        assert!(own.holds(Scope::Context));
        assert!(!own.holds(Scope::BrowserScript));
        assert!(!own.holds(Scope::BrowserStorage));
        assert!(!own.holds(Scope::Settings));
        assert!(own.holds(Scope::Terminal));
        assert!(own.holds(Scope::ChatsRead) && own.holds(Scope::ChatsWrite));
        assert!(own.holds(Scope::Agents));
        assert!(own.holds(Scope::Files));
        assert!(own.asks(Category::Files));
        assert!(own.holds(Scope::Processes));
        assert!(own.holds(Scope::Network));
        assert!(own.holds(Scope::Clipboard) && own.holds(Scope::Ask));
        assert!(own.holds(Scope::Editor));
        assert!(own.holds(Scope::Time));
        assert!(own.asks(Category::Terminal));
        assert_eq!(own.mode, Mode::Unsupervised);
        assert!(own.asks(Category::Paying));
        assert_eq!(own.limits, Limits { tabs: 4, calls: 600, navigations: 60, memory: 0 });
        let other = Grant::third_party("b".into(), "B");
        assert!(!other.holds(Scope::Context));
        assert!(!other.holds(Scope::BrowserReader));
        assert!(!other.holds(Scope::ChatsRead) && !other.holds(Scope::ChatsWrite));
        assert!(!other.holds(Scope::Agents));
        assert!(!other.holds(Scope::Files));
        assert!(!other.holds(Scope::Processes));
        assert!(!other.holds(Scope::Network));
        assert!(!other.holds(Scope::Clipboard) && !other.holds(Scope::Ask));
        assert!(!other.holds(Scope::Editor));
        assert!(!other.holds(Scope::Time));
        assert_eq!(other.mode, Mode::Confirm);
    }
    #[test]
    fn a_token_finds_its_grant_and_no_other() {
        let grants = Grants::from(vec![kept("a", "one"), kept("b", "two")]);
        let found = |token: &str| {
            grants
                .0
                .lock()
                .expect("lock")
                .as_ref()
                .expect("read")
                .iter()
                .find(|one| same(&hashed(token), &one.token))
                .map(|one| one.grant.id.clone())
        };
        assert_eq!(found("one").as_deref(), Some("a"));
        assert_eq!(found("two").as_deref(), Some("b"));
        assert_eq!(found("three"), None);
        assert_eq!(found(""), None);
    }
    #[test]
    fn a_hash_is_the_same_only_when_every_byte_is() {
        let one = hashed("token");
        assert!(same(&one, &one.clone()));
        assert!(!same(&one, &hashed("tokem")));
        assert!(!same(&one, &one[..63]));
        assert_eq!(one.len(), 64);
        assert_ne!(one, "token");
    }
    #[test]
    fn a_fresh_token_is_64_hex_characters_and_never_the_same_twice() {
        let one = fresh_token().expect("token");
        let two = fresh_token().expect("token");
        assert_eq!(one.len(), TOKEN_BYTES * 2);
        assert!(one.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(one, two);
    }
    #[test]
    fn an_id_comes_from_the_name_and_is_free() {
        assert_eq!(free_id("Claude Code", &[]), "claude-code");
        assert_eq!(free_id("Claude Code", &["claude-code"]), "claude-code-2");
        assert_eq!(free_id("Claude Code", &["claude-code", "claude-code-2"]), "claude-code-3");
        assert_eq!(free_id("  ", &[]), "agent");
        assert_eq!(free_id("orden-anthropic", &[]), "agent-orden-anthropic");
        assert_eq!(free_id("orden", &["agent-orden"]), "agent-orden-2");
        assert_eq!(free_id("ORDEN ", &["orden"]), "agent-orden");
        assert_eq!(free_id("Orden · Claude", &[]), "agent-orden-claude");
        assert_eq!(free_id("orden", &[]), "agent-orden");
        assert_eq!(free_id("ordentlich", &[]), "ordentlich");
        assert_eq!(free_id("Codex (CLI)", &[]), "codex-cli");
        assert_eq!(free_id("日本", &[]), "agent");
    }
}
