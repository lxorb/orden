use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter as _};

#[cfg(target_os = "linux")]
mod portal;
#[cfg(any(target_os = "linux", test))]
mod trigger;

const EVENT: &str = "orden://global-keys";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Which {
    QuickAdd,
    StopAgents,
}

impl Which {
    const ALL: [Self; 2] = [Self::QuickAdd, Self::StopAgents];

    fn id(self) -> &'static str {
        match self {
            Self::QuickAdd => "app.quick-add",
            Self::StopAgents => "agents.stop",
        }
    }

    fn flag(self) -> &'static str {
        match self {
            Self::QuickAdd => "--quick-add",
            Self::StopAgents => "--stop-agents",
        }
    }

    pub fn asked_by<A: AsRef<std::ffi::OsStr>>(argv: &[A]) -> Vec<Self> {
        Self::ALL
            .into_iter()
            .filter(|which| argv.iter().skip(1).any(|one| one.as_ref() == which.flag()))
            .collect()
    }

    pub fn is_flag(arg: &str) -> bool {
        Self::ALL.iter().any(|which| which.flag() == arg)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reach {
    System,
    Portal,
    #[cfg_attr(
        not(target_os = "linux"),
        allow(dead_code, reason = "only a Wayland session goes without")
    )]
    None,
}

#[derive(Clone, Debug, Serialize)]
pub struct Keys {
    reach: Reach,
    change: bool,
    held: BTreeMap<&'static str, String>,
    refused: Vec<&'static str>,
    run: String,
}

struct State {
    #[cfg_attr(
        not(target_os = "linux"),
        allow(dead_code, reason = "only the portal binds every key at once")
    )]
    wanted: BTreeMap<Which, String>,
    held: BTreeMap<Which, String>,
    refused: BTreeSet<Which>,
    reach: Option<Reach>,
    change: bool,
}

static HELD: Mutex<State> = Mutex::new(State {
    wanted: BTreeMap::new(),
    held: BTreeMap::new(),
    refused: BTreeSet::new(),
    reach: None,
    change: false,
});

fn with_state<T>(on_held: impl FnOnce(&mut State) -> T) -> T {
    on_held(&mut HELD.lock().unwrap_or_else(PoisonError::into_inner))
}

pub fn hold(app: &AppHandle, which: Which, key: Option<String>) -> Option<String> {
    let key = key.filter(|key| !key.trim().is_empty() && allowed(key, cfg!(target_os = "macos")));
    #[cfg(target_os = "linux")]
    if crate::linux::wayland_session() {
        return by_portal(app, which, key);
    }
    by_plugin(app, which, key)
}

#[cfg(target_os = "linux")]
fn by_portal(app: &AppHandle, which: Which, key: Option<String>) -> Option<String> {
    let changed = with_state(|held| {
        let was = held.wanted.get(&which).cloned();
        if was == key {
            return None;
        }
        match key {
            Some(key) => held.wanted.insert(which, key),
            None => held.wanted.remove(&which),
        };
        Some(held.wanted.clone())
    });
    if let Some(wanted) = changed {
        portal::want_keys(app, wanted);
    }
    with_state(|held| held.held.get(&which).cloned())
}

fn by_plugin(app: &AppHandle, which: Which, key: Option<String>) -> Option<String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};

    let old = with_state(|held| held.held.get(&which).cloned());
    if old == key {
        return old;
    }
    if let Some(old) = &old {
        let _ = app.global_shortcut().unregister(old.as_str());
    }
    let now = key.filter(|key| {
        plugin_added(app)
            && app
                .global_shortcut()
                .on_shortcut(key.as_str(), move |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        pressed(app, which, None);
                    }
                })
                .is_ok()
    });
    with_state(|held| {
        held.reach = Some(Reach::System);
        match &now {
            Some(now) => held.held.insert(which, now.clone()),
            None => held.held.remove(&which),
        };
    });
    told_page(app);
    now
}

fn allowed(accelerator: &str, mac: bool) -> bool {
    mac || !accelerator.split('+').any(|part| {
        ["super", "meta", "win", "command", "cmd", "logo"]
            .contains(&part.trim().to_ascii_lowercase().as_str())
    })
}

fn plugin_added(app: &AppHandle) -> bool {
    static READY: OnceLock<bool> = OnceLock::new();
    *READY.get_or_init(|| {
        app.plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .is_ok()
    })
}

pub fn pressed(app: &AppHandle, which: Which, token: Option<String>) {
    match which {
        Which::QuickAdd => crate::quick_add::bring_up(app, token),
        Which::StopAgents => {
            crate::agents::stop::stop(app);
        }
    }
}

#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only a Wayland session asks a portal")
)]
fn reached(app: &AppHandle, reach: Reach, change: bool) {
    with_state(|held| {
        held.reach = Some(reach);
        held.change = change;
    });
    told_page(app);
}

#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only a Wayland session asks a portal")
)]
fn bound(app: &AppHandle, now: BTreeMap<Which, String>, refused: BTreeSet<Which>) {
    with_state(|held| {
        held.held = now;
        held.refused = refused;
    });
    told_page(app);
}

#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only a Wayland session asks a portal")
)]
fn changed(app: &AppHandle, shown: BTreeMap<Which, String>) {
    with_state(|held| {
        for (which, said) in shown {
            if let Some(now) = held.held.get_mut(&which) {
                *now = said;
            }
        }
    });
    told_page(app);
}

fn told_page(app: &AppHandle) {
    let _ = app.emit(EVENT, keys_now());
}

fn keys_now() -> Keys {
    with_state(|held| Keys {
        reach: held.reach.unwrap_or(if wayland() {
            Reach::Portal
        } else {
            Reach::System
        }),
        change: held.change,
        held: held
            .held
            .iter()
            .map(|(which, said)| (which.id(), said.clone()))
            .collect(),
        refused: held.refused.iter().map(|which| which.id()).collect(),
        run: started_by(
            std::env::var("FLATPAK_ID").ok(),
            std::env::var("APPIMAGE").ok(),
            std::env::var("SNAP_NAME").ok(),
            std::env::args_os()
                .next()
                .map(|first| first.to_string_lossy().into_owned()),
        ),
    })
}

fn wayland() -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::linux::wayland_session()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn started_by(
    flatpak: Option<String>,
    appimage: Option<String>,
    snap: Option<String>,
    first: Option<String>,
) -> String {
    if let Some(id) = flatpak.filter(|id| !id.is_empty()) {
        return format!("flatpak run {id}");
    }
    if let Some(path) = appimage.filter(|path| !path.is_empty()) {
        return path;
    }
    if let Some(name) = snap.filter(|name| !name.is_empty()) {
        return name;
    }
    first
        .as_deref()
        .and_then(|first| std::path::Path::new(first).file_name())
        .map_or_else(
            || "nib".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        )
}

#[tauri::command]
pub fn global_keys(app: AppHandle) -> Keys {
    #[cfg(target_os = "linux")]
    if crate::linux::wayland_session() {
        portal::wake(&app);
    }
    let _ = &app;
    keys_now()
}

#[tauri::command]
pub fn global_keys_change(app: AppHandle) {
    #[cfg(target_os = "linux")]
    if crate::linux::wayland_session() {
        portal::reconfigure(&app);
    }
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_line_presses_the_keys_it_names() {
        let argv: Vec<String> = ["nib", "--quick-add"].map(String::from).into();
        assert_eq!(Which::asked_by(&argv), vec![Which::QuickAdd]);
        let argv: Vec<String> = ["nib", "--stop-agents", "--quick-add"]
            .map(String::from)
            .into();
        assert_eq!(
            Which::asked_by(&argv),
            vec![Which::QuickAdd, Which::StopAgents]
        );
        let argv: Vec<String> = ["--quick-add"].map(String::from).into();
        assert!(Which::asked_by(&argv).is_empty());
        assert!(Which::is_flag("--stop-agents"));
        assert!(!Which::is_flag("https://orden.so"));
    }

    #[test]
    fn the_command_is_the_one_this_install_is_started_by() {
        let some = |text: &str| Some(text.to_owned());
        assert_eq!(
            started_by(some("ch.emilvinu.nib"), None, None, some("/app/bin/nib")),
            "flatpak run ch.emilvinu.nib"
        );
        assert_eq!(
            started_by(
                None,
                some("/home/e/Orden.AppImage"),
                None,
                some("/tmp/.mount/nib")
            ),
            "/home/e/Orden.AppImage"
        );
        assert_eq!(
            started_by(None, None, some("orden"), some("/snap/x/nib")),
            "orden"
        );
        assert_eq!(started_by(None, None, None, some("/usr/bin/nib")), "nib");
        assert_eq!(started_by(None, None, None, some("orden")), "orden");
        assert_eq!(started_by(None, None, None, None), "nib");
    }

    #[test]
    fn the_windows_key_is_never_held_outside_a_mac() {
        assert!(!allowed("Super+Space", false));
        assert!(!allowed("Control+Super+Alt+K", false));
        assert!(!allowed("Meta+Q", false));
        assert!(allowed("Control+Alt+Space", false));
        assert!(allowed("Control+Super+Alt+K", true));
    }

    #[test]
    fn the_page_knows_each_key_by_the_registry_id() {
        assert_eq!(Which::QuickAdd.id(), "app.quick-add");
        assert_eq!(Which::StopAgents.id(), "agents.stop");
    }
}
