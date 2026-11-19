use serde::Serialize;

pub const PRESSED: &str = "orden://web-key";
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Held {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Pressed {
    key: &'static str,
    code: &'static str,
    #[serde(flatten)]
    held: Held,
    repeat: bool,
    down: bool,
}
impl Pressed {
    #[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
    fn keeps_page(&self) -> bool {
        self.code == "F11"
    }
    pub const fn with_ctrl(key: &'static str, code: &'static str, shift: bool) -> Self {
        Self { key, code, held: Held { ctrl: true, shift, alt: false }, repeat: false, down: true }
    }
}
pub fn meaning(vk: u32, held: Held, down: bool, repeat: bool) -> Option<Pressed> {
    let pressed = |key, code| Pressed { key, code, held, repeat, down };
    if !down {
        return match vk {
            0x11 => Some(pressed("Control", "ControlLeft")),
            0x10 => Some(pressed("Shift", "ShiftLeft")),
            0x12 => Some(pressed("Alt", "AltLeft")),
            _ => None,
        };
    }
    if vk == 0x75 && !held.ctrl && !held.shift && !held.alt {
        return Some(pressed("F6", "F6"));
    }
    if vk == 0x7A && !held.ctrl && !held.alt {
        return Some(pressed("F11", "F11"));
    }
    if held.alt && !held.ctrl && !held.shift {
        return digit(vk).map(|(key, code)| pressed(key, code));
    }
    if !held.ctrl || held.alt {
        return None;
    }
    match (vk, held.shift) {
        (0x54, false) => Some(pressed("t", "KeyT")),
        (0x54, true) => Some(pressed("T", "KeyT")),
        (0x57, false) => Some(pressed("w", "KeyW")),
        (0x57, true) => Some(pressed("W", "KeyW")),
        (0x4E, false) => Some(pressed("n", "KeyN")),
        (0x4E, true) => Some(pressed("N", "KeyN")),
        (0x09, _) => Some(pressed("Tab", "Tab")),
        (0x21, _) => Some(pressed("PageUp", "PageUp")),
        (0x22, _) => Some(pressed("PageDown", "PageDown")),
        (0x31..=0x39, false) => digit(vk).map(|(key, code)| pressed(key, code)),
        _ => None,
    }
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn told(vk: u32, held: Held, down: bool, repeat: bool) -> Option<Pressed> {
    if !down || repeat || held.ctrl {
        return None;
    }
    let pressed = |key, code| Pressed { key, code, held, repeat, down };
    if vk == 0x12 {
        return (!held.shift).then(|| pressed("Alt", "AltLeft"));
    }
    held.alt.then(|| pressed("Unidentified", ""))
}
fn digit(vk: u32) -> Option<(&'static str, &'static str)> {
    const DIGITS: [(&str, &str); 10] = [
        ("0", "Digit0"),
        ("1", "Digit1"),
        ("2", "Digit2"),
        ("3", "Digit3"),
        ("4", "Digit4"),
        ("5", "Digit5"),
        ("6", "Digit6"),
        ("7", "Digit7"),
        ("8", "Digit8"),
        ("9", "Digit9"),
    ];
    let at = usize::try_from(vk.checked_sub(0x30)?).ok()?;
    DIGITS.get(at).copied()
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn named(vk: u32, shift: bool) -> Option<(&'static str, &'static str)> {
    const LETTERS: [(&str, &str, &str); 26] = [
        ("a", "A", "KeyA"),
        ("b", "B", "KeyB"),
        ("c", "C", "KeyC"),
        ("d", "D", "KeyD"),
        ("e", "E", "KeyE"),
        ("f", "F", "KeyF"),
        ("g", "G", "KeyG"),
        ("h", "H", "KeyH"),
        ("i", "I", "KeyI"),
        ("j", "J", "KeyJ"),
        ("k", "K", "KeyK"),
        ("l", "L", "KeyL"),
        ("m", "M", "KeyM"),
        ("n", "N", "KeyN"),
        ("o", "O", "KeyO"),
        ("p", "P", "KeyP"),
        ("q", "Q", "KeyQ"),
        ("r", "R", "KeyR"),
        ("s", "S", "KeyS"),
        ("t", "T", "KeyT"),
        ("u", "U", "KeyU"),
        ("v", "V", "KeyV"),
        ("w", "W", "KeyW"),
        ("x", "X", "KeyX"),
        ("y", "Y", "KeyY"),
        ("z", "Z", "KeyZ"),
    ];
    let letter =
        vk.checked_sub(0x41).and_then(|at| usize::try_from(at).ok()).and_then(|at| LETTERS.get(at));
    match letter {
        Some(&(small, capital, code)) => Some((if shift { capital } else { small }, code)),
        None => digit(vk),
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Chord {
    vk: u32,
    held: Held,
}
#[derive(Debug, serde::Deserialize)]
pub struct Asked {
    code: String,
    #[serde(default)]
    ctrl: bool,
    #[serde(default)]
    shift: bool,
    #[serde(default)]
    alt: bool,
}
impl Chord {
    fn of(asked: &Asked) -> Option<Self> {
        if asked.ctrl == asked.alt {
            return None;
        }
        let (letters, at) = match asked.code.strip_prefix("Key") {
            Some(letter) => (b'A'..=b'Z', letter),
            None => (b'0'..=b'9', asked.code.strip_prefix("Digit")?),
        };
        let [one] = at.as_bytes() else {
            return None;
        };
        if !letters.contains(one) {
            return None;
        }
        let vk = u32::from(*one);
        Some(Self { vk, held: Held { ctrl: asked.ctrl, shift: asked.shift, alt: asked.alt } })
    }
}
static TAKEN: std::sync::RwLock<Vec<(String, Vec<Chord>)>> = std::sync::RwLock::new(Vec::new());
fn take(window: &str, chords: Vec<Chord>) {
    let mut taken = TAKEN.write().unwrap_or_else(std::sync::PoisonError::into_inner);
    taken.retain(|(one, _)| one != window);
    taken.push((window.to_owned(), chords));
}
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn app_chords(window: &str) -> Vec<Chord> {
    TAKEN
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .find(|(one, _)| one == window)
        .map(|(_, chords)| chords.clone())
        .unwrap_or_default()
}
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn every_chord() -> Vec<Chord> {
    TAKEN
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .flat_map(|(_, chords)| chords.iter().copied())
        .collect()
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn app_s(vk: u32, held: Held, down: bool, repeat: bool, taken: &[Chord]) -> Option<Pressed> {
    if !down || !taken.contains(&Chord { vk, held }) {
        return None;
    }
    let (key, code) = named(vk, held.shift)?;
    Some(Pressed { key, code, held, repeat, down })
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn heard_raw(
    vk: u32,
    held: Held,
    down: bool,
    repeat: bool,
    taken: &[Chord],
    grabbing: bool,
    page: impl FnOnce() -> bool,
) -> Option<Pressed> {
    if down {
        let chord = meaning(vk, held, true, repeat).is_some()
            || reloading(vk, held).is_some()
            || app_s(vk, held, true, repeat, taken).is_some();
        let said = if chord { None } else { told(vk, held, true, repeat) };
        return said.filter(|_| page());
    }
    let said = meaning(vk, held, false, repeat)?;
    (grabbing || page()).then_some(said)
}
#[tauri::command(async)]
pub fn web_keys_take(app: tauri::AppHandle, window: tauri::Window, chords: Vec<Asked>) -> bool {
    take(window.label(), chords.iter().filter_map(Chord::of).collect());
    tells_alt(&app)
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct AppKey {
    key: String,
    code: String,
    #[serde(flatten)]
    held: Holds,
    #[serde(default)]
    meta: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize)]
struct Holds {
    #[serde(default)]
    ctrl: bool,
    #[serde(default)]
    shift: bool,
    #[serde(default)]
    alt: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Press {
    pub vk: u32,
    pub held: Held,
    pub meta: bool,
    pub altgr: bool,
    pub repeat: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Played {
    key: String,
    code: String,
    #[serde(flatten)]
    held: Held,
    meta: bool,
    repeat: bool,
    down: bool,
}
impl Played {
    pub fn keeps_page(&self) -> bool {
        self.code == "F11"
    }
}
impl AppKey {
    fn chorded(&self) -> bool {
        self.held.ctrl || self.held.alt || self.meta || function_key(&self.code).is_some()
    }
    fn heard(&self, vk: u32, press: Press) -> bool {
        let (asked, held) = (self.held, press.held);
        let shifted = asked.shift == held.shift || (!asked.shift && self.code.starts_with("Digit"));
        vk == press.vk
            && shifted
            && asked.ctrl == held.ctrl
            && asked.alt == held.alt
            && self.meta == press.meta
    }
}
fn function_key(code: &str) -> Option<u32> {
    let at: u32 = code.strip_prefix('F')?.parse().ok()?;
    (1..=24).contains(&at).then_some(0x6F + at)
}
fn vk_of_code(code: &str) -> Option<u32> {
    const NAMED: [(&str, u32); 28] = [
        ("Backspace", 0x08),
        ("Tab", 0x09),
        ("Enter", 0x0D),
        ("Escape", 0x1B),
        ("Space", 0x20),
        ("PageUp", 0x21),
        ("PageDown", 0x22),
        ("End", 0x23),
        ("Home", 0x24),
        ("ArrowLeft", 0x25),
        ("ArrowUp", 0x26),
        ("ArrowRight", 0x27),
        ("ArrowDown", 0x28),
        ("Insert", 0x2D),
        ("Delete", 0x2E),
        ("ContextMenu", 0x5D),
        ("Semicolon", 0xBA),
        ("Equal", 0xBB),
        ("Comma", 0xBC),
        ("Minus", 0xBD),
        ("Period", 0xBE),
        ("Slash", 0xBF),
        ("Backquote", 0xC0),
        ("BracketLeft", 0xDB),
        ("Backslash", 0xDC),
        ("BracketRight", 0xDD),
        ("Quote", 0xDE),
        ("IntlBackslash", 0xE2),
    ];
    if let Some(&(_, vk)) = NAMED.iter().find(|(name, _)| *name == code) {
        return Some(vk);
    }
    if let Some(vk) = function_key(code) {
        return Some(vk);
    }
    let (range, rest) = match code.strip_prefix("Key") {
        Some(letter) => (b'A'..=b'Z', letter),
        None => (b'0'..=b'9', code.strip_prefix("Digit")?),
    };
    match rest.as_bytes() {
        [one] if range.contains(one) => Some(u32::from(*one)),
        _ => None,
    }
}
type Keyed = Vec<(u32, AppKey)>;
static APP_KEYS: std::sync::RwLock<Vec<(String, Keyed)>> = std::sync::RwLock::new(Vec::new());
fn hand_keys(window: &str, keys: Vec<AppKey>) {
    let keys = keys
        .into_iter()
        .filter(AppKey::chorded)
        .filter_map(|one| Some((vk_of_code(&one.code)?, one)))
        .collect();
    let mut all = APP_KEYS.write().unwrap_or_else(std::sync::PoisonError::into_inner);
    all.retain(|(one, _)| one != window);
    all.push((window.to_owned(), keys));
}
pub fn app_key(window: &str, press: Press) -> Option<Played> {
    if press.altgr {
        return None;
    }
    let all = APP_KEYS.read().unwrap_or_else(std::sync::PoisonError::into_inner);
    let (_, keys) = all.iter().find(|(one, _)| one == window)?;
    let (_, one) = keys.iter().find(|(vk, one)| one.heard(*vk, press))?;
    Some(Played {
        key: one.key.clone(),
        code: one.code.clone(),
        held: press.held,
        meta: press.meta,
        repeat: press.repeat,
        down: true,
    })
}
#[tauri::command(async)]
pub fn web_keys_app(window: tauri::Window, keys: Vec<AppKey>) {
    hand_keys(window.label(), keys);
}
#[cfg(target_os = "linux")]
fn tells_alt(app: &tauri::AppHandle) -> bool {
    grabbed::retake(app)
}
#[cfg(not(target_os = "linux"))]
fn tells_alt(_app: &tauri::AppHandle) -> bool {
    false
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn reloading(vk: u32, held: Held) -> Option<Pressed> {
    if held.alt {
        return None;
    }
    let pressed = |key, code| Pressed { key, code, held, repeat: false, down: true };
    match (vk, held.ctrl, held.shift) {
        (0x74, _, false) => Some(pressed("F5", "F5")),
        (0x52, true, false) => Some(pressed("r", "KeyR")),
        (0x52, true, true) => Some(pressed("R", "KeyR")),
        _ => None,
    }
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn vk_of(keyval: u32) -> Option<u32> {
    match keyval {
        0x61..=0x7A => Some(keyval - 0x20),
        0x41..=0x5A | 0x30..=0x39 => Some(keyval),
        0xFF09 | 0xFE20 => Some(0x09),
        0xFF55 => Some(0x21),
        0xFF56 => Some(0x22),
        0xFFC2 => Some(0x74),
        0xFFC3 => Some(0x75),
        0xFFC8 => Some(0x7A),
        0xFFE1 | 0xFFE2 => Some(0x10),
        0xFFE3 | 0xFFE4 => Some(0x11),
        0xFFE9 | 0xFFEA => Some(0x12),
        _ => None,
    }
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn page_took_focus(mode: u8, detail: u8) -> bool {
    !matches!(mode, 1 | 2) && !matches!(detail, 5..=7)
}
#[cfg(target_os = "linux")]
pub use grabbed::{focus_in, focus_to, listen};

#[cfg(not(target_os = "linux"))]
pub fn listen(_webview: &tauri::webview::PlatformWebview, _app: tauri::AppHandle, _window: String) {
}
#[cfg(not(target_os = "linux"))]
pub fn focus_to(_page: u32) {}
#[cfg(not(target_os = "linux"))]
pub fn focus_in(_pages: &[u32]) -> Option<u32> {
    None
}
#[cfg(target_os = "linux")]
mod grabbed {
    use orden_base::Held as _;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};

    use tauri::{AppHandle, Emitter, Manager};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xinput::{
        self, ConnectionExt as _, Device, KeyEventFlags, RawKeyPressEvent, XIEventMask,
    };
    use x11rb::protocol::xproto::{
        ChangeWindowAttributesAux, ConnectionExt as _, EventMask, Grab, GrabMode, InputFocus,
        Keycode, Keysym, ModMask, Window,
    };
    use x11rb::protocol::Event;
    use x11rb::rust_connection::RustConnection;

    use super::{
        app_chords, app_s, every_chord, heard_raw, meaning, page_took_focus, reloading, vk_of,
        Chord, Held, Pressed, PRESSED,
    };

    const KEYS: [Keysym; 20] = [
        0x74, 0x77, 0x6E, 0x72, 0xFF09, 0xFF55, 0xFF56, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36,
        0x37, 0x38, 0x39, 0xFFC2, 0xFFC3, 0xFFC8,
    ];
    const LOCKS: [u16; 4] = [0, 0x02, 0x10, 0x12];
    fn held_by(state: u16) -> Held {
        Held { shift: state & 0x01 != 0, ctrl: state & 0x04 != 0, alt: state & 0x08 != 0 }
    }
    fn mask_of(held: Held) -> u16 {
        u16::from(held.shift) | (u16::from(held.ctrl) << 2) | (u16::from(held.alt) << 3)
    }
    pub(super) fn chords(taken: &[Chord]) -> Vec<(Keysym, u16)> {
        let mut every = Vec::new();
        for key in KEYS {
            let Some(vk) = vk_of(key) else { continue };
            for state in 0..8u16 {
                let held = held_by((state & 1) | ((state & 2) << 1) | ((state & 4) << 1));
                if meaning(vk, held, true, false).is_some() || reloading(vk, held).is_some() {
                    every.push((key, mask_of(held)));
                }
            }
        }
        for one in taken {
            let key = if (0x41..=0x5A).contains(&one.vk) { one.vk + 0x20 } else { one.vk };
            let chord = (key, mask_of(one.held));
            if !every.contains(&chord) {
                every.push(chord);
            }
        }
        every
    }
    struct Grabs {
        x: RustConnection,
        root: Window,
        raw: bool,
        pages: Mutex<HashMap<u32, String>>,
        map: Mutex<Map>,
    }
    #[derive(Default)]
    struct Map {
        first: Keycode,
        per: usize,
        syms: Vec<Keysym>,
    }
    impl Map {
        fn keysym(&self, code: Keycode) -> Option<Keysym> {
            let at = usize::from(code.checked_sub(self.first)?) * self.per;
            let row = self.syms.get(at..at + self.per)?;
            row.iter().copied().find(|sym| vk_of(*sym).is_some())
        }
        fn keycodes(&self, sym: Keysym) -> Vec<Keycode> {
            (0..self.syms.len() / self.per.max(1))
                .filter_map(|code| Keycode::try_from(code).ok()?.checked_add(self.first))
                .filter(|code| self.keysym(*code) == Some(sym))
                .collect()
        }
    }
    static GRABS: OnceLock<Option<Arc<Grabs>>> = OnceLock::new();
    impl Grabs {
        fn read_map(&self) {
            let setup = self.x.setup();
            let (first, last) = (setup.min_keycode, setup.max_keycode);
            let count = last.saturating_sub(first).saturating_add(1);
            let read = self
                .x
                .get_keyboard_mapping(first, count)
                .ok()
                .and_then(|cookie| cookie.reply().ok());
            if let Some(read) = read {
                *self.map.held() =
                    Map { first, per: usize::from(read.keysyms_per_keycode), syms: read.keysyms };
            }
        }
        fn grab(&self, page: u32) {
            let _ = self.x.ungrab_key(Grab::ANY, page, ModMask::ANY);
            let holder = self.pages.held().get(&page).cloned().unwrap_or_default();
            let map = self.map.held();
            for (sym, mask) in chords(&app_chords(&holder)) {
                for code in map.keycodes(sym) {
                    for lock in LOCKS {
                        let _ = self.x.grab_key(
                            false,
                            page,
                            ModMask::from(mask | lock),
                            code,
                            GrabMode::ASYNC,
                            GrabMode::ASYNC,
                        );
                    }
                }
            }
            drop(map);
            let _ = self.x.flush();
        }
        fn pages(&self) -> Vec<u32> {
            self.pages.held().keys().copied().collect()
        }
        fn focused(&self, pages: &[u32]) -> Option<u32> {
            let mut at = self.x.get_input_focus().ok()?.reply().ok()?.focus;
            for _ in 0..16 {
                if pages.contains(&at) {
                    return Some(at);
                }
                let tree = self.x.query_tree(at).ok()?.reply().ok()?;
                if tree.parent == 0 || tree.parent == tree.root {
                    return None;
                }
                at = tree.parent;
            }
            None
        }
        fn heard(
            &self,
            app: &AppHandle,
            key: &RawKeyPressEvent,
            down: bool,
            grabbing: Option<&str>,
        ) {
            let Ok(code) = Keycode::try_from(key.detail) else {
                return;
            };
            let sym = self.map.held().keysym(code);
            let Some(vk) = sym.and_then(vk_of) else {
                return;
            };
            let Some(state) =
                self.x.query_pointer(self.root).ok().and_then(|cookie| cookie.reply().ok())
            else {
                return;
            };
            let repeat = key.flags.contains(KeyEventFlags::KEY_REPEAT);
            let mut holder = grabbing.map(str::to_owned);
            let said = heard_raw(
                vk,
                held_by(u16::from(state.mask)),
                down,
                repeat,
                &every_chord(),
                grabbing.is_some(),
                || {
                    let page = self
                        .focused(&self.pages())
                        .and_then(|page| self.pages.held().get(&page).cloned());
                    let found = page.is_some();
                    holder = holder.take().or(page);
                    found
                },
            );
            if let (Some(said), Some(holder)) = (said, holder) {
                let _ = app.emit_to(holder.as_str(), PRESSED, said);
            }
        }
        fn hear(&self, app: &AppHandle) {
            let mut grabbing: Option<(Keycode, String)> = None;
            while let Ok(event) = self.x.wait_for_event() {
                let (window, code, state, down) = match event {
                    Event::XinputRawKeyPress(key) => {
                        self.heard(app, &key, true, grabbing.as_ref().map(|one| one.1.as_str()));
                        continue;
                    }
                    Event::XinputRawKeyRelease(key) => {
                        self.heard(app, &key, false, grabbing.as_ref().map(|one| one.1.as_str()));
                        continue;
                    }
                    Event::FocusIn(focus) => {
                        if page_took_focus(u8::from(focus.mode), u8::from(focus.detail)) {
                            crate::keyboard::x11_took(app, focus.event);
                        }
                        continue;
                    }
                    Event::KeyPress(key) => (key.event, key.detail, u16::from(key.state), true),
                    Event::KeyRelease(key) => (key.event, key.detail, u16::from(key.state), false),
                    Event::MappingNotify(_) => {
                        self.read_map();
                        for page in self.pages() {
                            self.grab(page);
                        }
                        continue;
                    }
                    _ => continue,
                };
                let holder = self.pages.held().get(&window).cloned();
                let sym = self.map.held().keysym(code);
                let (Some(holder), Some(vk)) = (holder, sym.and_then(vk_of)) else {
                    continue;
                };
                let held = held_by(state);
                if !down && grabbing.as_ref().is_some_and(|one| one.0 == code) {
                    grabbing = None;
                }
                let said = if down {
                    meaning(vk, held, true, false)
                        .or_else(|| reloading(vk, held))
                        .or_else(|| app_s(vk, held, true, false, &app_chords(&holder)))
                } else if self.raw {
                    None
                } else {
                    meaning(vk, held, false, false)
                };
                if let Some(said) = said {
                    if said.down {
                        grabbing = Some((code, holder.clone()));
                    }
                    told(app, holder, said);
                }
            }
        }
    }
    fn told(app: &AppHandle, window: String, said: Pressed) {
        let telling = app.clone();
        let _ = app.run_on_main_thread(move || {
            if said.down && !said.keeps_page() {
                if let Some(ours) = telling.get_webview(&window) {
                    orden_placement::placement::keyboard_to(&ours);
                }
            }
            let _ = telling.emit_to(window.as_str(), PRESSED, said);
        });
    }
    fn grabs(app: &AppHandle) -> Option<Arc<Grabs>> {
        GRABS
            .get_or_init(|| {
                let (x, _) = x11rb::connect(None)
                    .map_err(|error| eprintln!("web keys: no X server to take chords on: {error}"))
                    .ok()?;
                let root = x.setup().roots.first()?.root;
                let raw = raw_keys(&x, root);
                let grabs = Arc::new(Grabs {
                    x,
                    root,
                    raw,
                    pages: Mutex::new(HashMap::new()),
                    map: Mutex::new(Map::default()),
                });
                grabs.read_map();
                let (hearing, app) = (grabs.clone(), app.clone());
                std::thread::Builder::new()
                    .name("web keys".into())
                    .spawn(move || hearing.hear(&app))
                    .ok()?;
                Some(grabs)
            })
            .clone()
    }
    fn raw_keys(x: &RustConnection, root: Window) -> bool {
        let version = x.xinput_xi_query_version(2, 2).ok().and_then(|cookie| cookie.reply().ok());
        if version.is_none_or(|one| (one.major_version, one.minor_version) < (2, 2)) {
            return false;
        }
        let keys = xinput::EventMask {
            deviceid: Device::ALL_MASTER.into(),
            mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
        };
        x.xinput_xi_select_events(root, &[keys]).is_ok_and(|cookie| cookie.check().is_ok())
    }
    pub(super) fn retake(app: &AppHandle) -> bool {
        let Some(grabs) = grabs(app) else {
            return false;
        };
        for page in grabs.pages() {
            grabs.grab(page);
        }
        grabs.raw
    }
    pub fn focus_in(pages: &[u32]) -> Option<u32> {
        GRABS.get()?.as_ref()?.focused(pages)
    }
    pub fn focus_to(page: u32) {
        if let Some(Some(grabs)) = GRABS.get() {
            let _ = grabs.x.set_input_focus(InputFocus::PARENT, page, x11rb::CURRENT_TIME);
            let _ = grabs.x.flush();
        }
    }
    pub fn listen(webview: &tauri::webview::PlatformWebview, app: AppHandle, window: String) {
        let Some(page) = crate::host::x11_page(webview) else {
            return;
        };
        let Some(grabs) = grabs(&app) else { return };
        grabs.pages.held().insert(page, window);
        let focus = ChangeWindowAttributesAux::new().event_mask(EventMask::FOCUS_CHANGE);
        let _ = grabs.x.change_window_attributes(page, &focus);
        grabs.grab(page);
    }
    #[cfg(test)]
    mod tests {
        use super::{chords, Map};
        use crate::web_keys::{Asked, Chord};

        #[test]
        fn the_app_s_chords_are_grabbed_with_the_browser_s() {
            let asked = |code: &str| {
                Chord::of(&Asked { code: code.into(), ctrl: false, shift: false, alt: true })
                    .expect("a chord")
            };
            let before = chords(&[]);
            assert!(!before.contains(&(0x65, 0x08)));
            let with = chords(&[asked("KeyE"), asked("Digit1")]);
            assert!(with.contains(&(0x65, 0x08)));
            assert_eq!(with.iter().filter(|one| **one == (0x31, 0x08)).count(), 1);
            assert_eq!(with.len(), before.len() + 1);
        }
        #[test]
        fn a_digit_under_shift_is_still_the_key_s() {
            let map = Map { first: 10, per: 2, syms: vec![0x26, 0x31, 0xE9, 0x32, 0x61, 0x41] };
            assert_eq!(map.keycodes(0x31), vec![10]);
            assert_eq!(map.keysym(10), Some(0x31));
            assert_eq!(map.keycodes(0x61), vec![12]);
            assert_eq!(map.keysym(12), Some(0x61));
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{
        app_chords, app_key, app_s, every_chord, hand_keys, heard_raw, meaning, page_took_focus,
        take, told, vk_of_code, AppKey, Asked, Chord, Held, Press,
    };

    const ALT: Held = Held { ctrl: false, shift: false, alt: true };
    const SHIFT: Held = Held { ctrl: false, shift: true, alt: false };
    fn asked(code: &str, ctrl: bool, shift: bool, alt: bool) -> Option<Chord> {
        Chord::of(&Asked { code: code.into(), ctrl, shift, alt })
    }
    #[test]
    fn a_chord_the_window_asks_for_is_taken_and_said_as_itself() {
        let taken = [asked("KeyE", false, false, true).expect("Alt and E")];
        let said = app_s(0x45, ALT, true, false, &taken).expect("taken");
        assert_eq!((said.key, said.code), ("e", "KeyE"));
        assert!(said.held.alt && said.down && !said.keeps_page());
        assert!(app_s(0x45, ALT, true, true, &taken).is_some_and(|one| one.repeat));
        assert_eq!(app_s(0x46, ALT, true, false, &taken), None);
        assert_eq!(app_s(0x45, Held { shift: true, ..ALT }, true, false, &taken), None);
        assert_eq!(app_s(0x45, Held { ctrl: true, ..ALT }, true, false, &taken), None);
        assert_eq!(app_s(0x45, ALT, false, false, &taken), None);
        assert_eq!(app_s(0x45, ALT, true, false, &[]), None);
    }
    #[test]
    fn each_window_s_pages_hand_over_that_window_s_chords() {
        let e = asked("KeyE", false, false, true).expect("Alt and E");
        let f = asked("KeyF", false, false, true).expect("Alt and F");
        take("chords-first", vec![e]);
        take("chords-second", vec![f]);
        assert_eq!(app_chords("chords-first"), vec![e]);
        assert_eq!(app_chords("chords-second"), vec![f]);
        assert!(app_s(0x45, ALT, true, false, &app_chords("chords-first")).is_some());
        assert!(app_s(0x45, ALT, true, false, &app_chords("chords-second")).is_none());
        assert!(every_chord().contains(&e) && every_chord().contains(&f));
        take("chords-first", Vec::new());
        assert_eq!(app_chords("chords-first"), Vec::new());
        assert_eq!(app_chords("chords-second"), vec![f]);
        assert_eq!(app_chords("chords-never"), Vec::new());
    }
    #[test]
    fn a_page_keeps_typing_and_altgr_whatever_the_window_asks() {
        assert_eq!(asked("KeyE", false, false, false), None);
        assert_eq!(asked("KeyE", false, true, false), None);
        assert_eq!(asked("KeyE", true, false, true), None);
        assert_eq!(asked("ArrowLeft", false, false, true), None);
        assert_eq!(asked("Keye", false, false, true), None);
        assert_eq!(asked("KeyAB", false, false, true), None);
        assert_eq!(asked("Digit10", false, false, true), None);
        let digit = asked("Digit7", false, false, true).expect("Alt and 7");
        assert!(app_s(0x37, ALT, true, false, &[digit]).is_some_and(|one| one.key == "7"));
        let ctrl = asked("KeyJ", true, true, false).expect("Ctrl, Shift and J");
        let held = Held { ctrl: true, shift: true, alt: false };
        assert!(app_s(0x4A, held, true, false, &[ctrl]).is_some_and(|one| one.key == "J"));
    }
    #[test]
    fn a_raw_key_says_alt_in_a_page_and_leaves_every_chord_to_its_grab() {
        let taken = [asked("KeyE", false, false, true).expect("Alt and E")];
        let raw = |vk, held, down, grabbing, page: bool| {
            heard_raw(vk, held, down, false, &taken, grabbing, || page)
                .map(|one| (one.key, one.down))
        };
        assert_eq!(raw(0x12, ALT, true, false, true), Some(("Alt", true)));
        assert_eq!(raw(0x12, Held::default(), false, false, true), Some(("Alt", false)));
        assert_eq!(raw(0x44, ALT, true, false, true), Some(("Unidentified", true)));
        assert_eq!(raw(0x12, ALT, true, false, false), None);
        assert_eq!(raw(0x12, Held::default(), false, false, false), None);
        assert_eq!(raw(0x31, ALT, true, false, true), None);
        assert_eq!(raw(0x54, CTRL, true, false, true), None);
        assert_eq!(raw(0x74, Held::default(), true, false, true), None);
        assert_eq!(raw(0x45, ALT, true, false, true), None);
        assert_eq!(raw(0x11, Held::default(), false, true, false), Some(("Control", false)));
        assert_eq!(raw(0x45, Held::default(), false, true, true), None);
        let shift = Held { shift: true, ..ALT };
        assert_eq!(raw(0x12, shift, true, false, true), None);
        assert_eq!(heard_raw(0x12, ALT, true, true, &taken, false, || true), None);
        assert_eq!(raw(0x12, Held { ctrl: true, ..ALT }, true, false, true), None);
    }
    #[test]
    fn a_raw_key_asks_where_the_keyboard_is_only_when_it_has_to() {
        let asked = |vk, held, down, grabbing| {
            let mut asked = false;
            let _ = heard_raw(vk, held, down, false, &[], grabbing, || {
                asked = true;
                true
            });
            asked
        };
        assert!(!asked(0x45, Held::default(), true, false));
        assert!(!asked(0x31, ALT, true, false));
        assert!(!asked(0x11, Held::default(), false, true));
        assert!(asked(0x12, ALT, true, false));
        assert!(asked(0x12, Held::default(), false, false));
    }
    #[test]
    fn every_engine_takes_the_chords_the_window_asks_for() {
        let source = include_str!("web_keys.rs");
        let body = |mark: &str| {
            let from = source.find(mark).expect(mark);
            let rest = &source[from..];
            &rest[..rest.find("\n}\n").expect("its end")]
        };
        let webview2 =
            body("pub fn listen(webview: &tauri::webview::PlatformWebview, app: tauri::AppHandle");
        assert!(webview2.contains("app_s(vk, now, down, repeat, &app_chords(&window))"));
        let cef = body("mod grabbed {");
        assert!(cef.contains("app_s(vk, held, true, false, &app_chords(&holder))"));
        assert!(cef.contains("chords(&app_chords(&holder))"));
        assert!(cef.contains("heard_raw("));
        assert!(include_str!("../../../src/lib.rs").contains("orden_web::web_keys::web_keys_take,"));
    }
    #[test]
    fn a_page_takes_the_keyboard_on_a_real_focus_in_only() {
        for mode in [0, 3] {
            for detail in 0..=4 {
                assert!(page_took_focus(mode, detail), "mode {mode}, detail {detail}");
            }
        }
        assert!(!page_took_focus(1, 3));
        assert!(!page_took_focus(2, 3));
        for detail in 5..=7 {
            assert!(!page_took_focus(0, detail));
        }
    }
    const CTRL: Held = Held { ctrl: true, shift: false, alt: false };
    fn down(vk: u32, shift: bool) -> Option<(&'static str, &'static str)> {
        meaning(vk, Held { shift, ..CTRL }, true, false).map(|one| (one.key, one.code))
    }
    #[test]
    fn the_browser_s_own_ctrl_chords_are_taken_and_the_rest_left_to_the_page() {
        for (vk, shift, taken) in [
            (0x54, false, Some(("t", "KeyT"))),
            (0x54, true, Some(("T", "KeyT"))),
            (0x57, false, Some(("w", "KeyW"))),
            (0x09, false, Some(("Tab", "Tab"))),
            (0x09, true, Some(("Tab", "Tab"))),
            (0x4E, true, Some(("N", "KeyN"))),
            (0x22, false, Some(("PageDown", "PageDown"))),
            (0x21, true, Some(("PageUp", "PageUp"))),
            (0x31, false, Some(("1", "Digit1"))),
            (0x39, false, Some(("9", "Digit9"))),
            (0x31, true, None),
            (0x30, false, None),
            (0x46, false, None),
            (0x47, false, None),
            (0x47, true, None),
            (0x46, true, None),
            (0x4C, false, None),
            (0x44, false, None),
            (0x44, true, None),
            (0x20, true, None),
            (0x20, false, None),
            (0x4B, false, None),
            (0x50, false, None),
            (0x52, false, None),
        ] {
            assert_eq!(down(vk, shift), taken, "{vk:#x} {shift}");
        }
    }
    #[test]
    fn and_f6_to_the_address_field() {
        let alone = |vk, held| meaning(vk, held, true, false).map(|one| one.key);
        assert_eq!(alone(0x75, Held::default()), Some("F6"));
        assert_eq!(alone(0x75, SHIFT), None);
        assert_eq!(alone(0x75, CTRL), None);
    }
    #[test]
    fn finding_and_the_address_field_s_other_keys_are_the_page_s_first() {
        for shift in [false, true] {
            let bare = Held { shift, ..Held::default() };
            assert_eq!(meaning(0x72, bare, true, false), None);
        }
        assert_eq!(meaning(0x44, ALT, true, false), None);
    }
    #[test]
    fn a_chord_let_go_by_is_said_as_one_of_these() {
        let said =
            serde_json::to_value(super::Pressed::with_ctrl("d", "KeyD", false)).expect("a key");
        assert_eq!(said["key"], "d");
        assert_eq!(said["code"], "KeyD");
        assert_eq!(said["ctrl"], true);
        assert_eq!(said["shift"], false);
        assert_eq!(said["alt"], false);
        assert_eq!(said["repeat"], false);
        assert_eq!(said["down"], true);
    }
    #[test]
    fn reloading_is_f5_and_ctrl_r_with_shift_for_the_hard_one() {
        use super::reloading;
        let key = |vk, held| reloading(vk, held).map(|one| (one.key, one.code, one.held.shift));
        assert_eq!(key(0x74, Held::default()), Some(("F5", "F5", false)));
        assert_eq!(key(0x52, CTRL), Some(("r", "KeyR", false)));
        let shifted = Held { shift: true, ..CTRL };
        assert_eq!(key(0x52, shifted), Some(("R", "KeyR", true)));
        assert_eq!(key(0x74, CTRL).map(|one| one.0), Some("F5"));
        assert_eq!(key(0x52, Held::default()), None);
        assert_eq!(key(0x52, Held { alt: true, ..CTRL }), None);
    }
    #[test]
    fn gdk_names_the_keys_windows_does() {
        use super::vk_of;
        assert_eq!(vk_of(u32::from(b'r')), Some(0x52));
        assert_eq!(vk_of(u32::from(b'R')), Some(0x52));
        assert_eq!(vk_of(u32::from(b'5')), Some(0x35));
        assert_eq!(vk_of(0xFFC2), Some(0x74));
        assert_eq!(vk_of(0xFE20), Some(0x09));
        assert_eq!(vk_of(0xFFE3), Some(0x11));
        assert_eq!(vk_of(0x20AC), None);
    }
    #[test]
    fn everything_else_is_the_page_s() {
        assert_eq!(meaning(0x74, Held::default(), true, false), None);
        assert_eq!(meaning(0x54, Held::default(), true, false), None);
    }
    #[test]
    fn alt_held_on_its_own_is_told_and_left_to_the_page() {
        let said = |vk, held, repeat| told(vk, held, true, repeat).map(|one| one.key);
        assert_eq!(said(0x12, Held::default(), false), Some("Alt"));
        assert_eq!(said(0x12, ALT, false), Some("Alt"));
        assert_eq!(said(0x12, ALT, true), None);
        assert_eq!(said(0x25, ALT, false), Some("Unidentified"));
        assert_eq!(said(0x44, ALT, false), Some("Unidentified"));
        assert_eq!(said(0x44, Held::default(), false), None);
        assert_eq!(meaning(0x12, ALT, true, false), None);
        assert_eq!(told(0x12, ALT, false, false), None);
    }
    #[test]
    fn altgr_and_alt_with_shift_are_never_a_hold() {
        assert_eq!(told(0x12, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(told(0x32, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(told(0x12, SHIFT, true, false), None);
        let held = Held { alt: true, shift: true, ..Held::default() };
        assert_eq!(told(0x10, held, true, false).map(|one| one.key), Some("Unidentified"));
    }
    #[test]
    fn a_chord_with_alt_is_a_character_on_altgr_keyboards() {
        assert_eq!(meaning(0x54, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(meaning(0x32, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(meaning(0x37, Held { alt: true, ..CTRL }, true, false), None);
    }
    #[test]
    fn alt_and_a_digit_are_the_tabs_by_number_nought_included() {
        let alt = |shift| Held { ctrl: false, shift, alt: true };
        let pressed = |vk, held| meaning(vk, held, true, false).map(|one| (one.key, one.code));
        assert_eq!(pressed(0x31, alt(false)), Some(("1", "Digit1")));
        assert_eq!(pressed(0x33, alt(false)), Some(("3", "Digit3")));
        assert_eq!(pressed(0x39, alt(false)), Some(("9", "Digit9")));
        assert_eq!(pressed(0x30, alt(false)), Some(("0", "Digit0")));
        assert!(meaning(0x30, alt(false), true, false).is_some_and(|one| one.held.alt));
        assert_eq!(pressed(0x31, alt(true)), None);
        assert_eq!(pressed(0x44, alt(false)), None);
        assert_eq!(pressed(0x61, alt(false)), None);
        assert_eq!(down(0x30, false), None);
    }
    #[test]
    fn f11_and_shift_f11_are_the_window_s_and_leave_the_page_its_keyboard() {
        let filled = meaning(0x7A, SHIFT, true, false);
        let named = filled.as_ref().map(|one| (one.key, one.code));
        assert_eq!(named, Some(("F11", "F11")));
        assert!(filled.as_ref().is_some_and(|one| one.held.shift));
        assert!(filled.is_some_and(|one| one.keeps_page()));
        let full = meaning(0x7A, Held::default(), true, false);
        assert!(full
            .as_ref()
            .is_some_and(|one| one.code == "F11" && !one.held.shift && one.keeps_page()));
        let with = |ctrl, alt| Held { ctrl, shift: true, alt };
        assert_eq!(meaning(0x7A, with(true, false), true, false), None);
        assert_eq!(meaning(0x7A, with(false, true), true, false), None);
        assert!(meaning(0x54, CTRL, true, false).is_some_and(|one| !one.keeps_page()));
        assert!(meaning(0x75, Held::default(), true, false).is_some_and(|one| !one.keeps_page()));
    }
    #[test]
    fn a_modifier_let_go_of_is_told_and_nothing_else_released_is() {
        let up = |vk| meaning(vk, Held::default(), false, false).map(|one| one.key);
        assert_eq!(up(0x11), Some("Control"));
        assert_eq!(up(0x10), Some("Shift"));
        assert_eq!(up(0x12), Some("Alt"));
        assert_eq!(up(0x54), None);
    }
    fn held(ctrl: bool, shift: bool, alt: bool) -> Held {
        Held { ctrl, shift, alt }
    }
    fn app_key_of(key: &str, code: &str, held: Held, meta: bool) -> AppKey {
        let Held { ctrl, shift, alt } = held;
        AppKey { key: key.into(), code: code.into(), held: super::Holds { ctrl, shift, alt }, meta }
    }
    fn press(vk: u32, held: Held, meta: bool) -> Press {
        Press { vk, held, meta, altgr: false, repeat: false }
    }
    #[test]
    fn every_key_of_the_app_s_table_is_taken_from_a_page_and_said_as_the_app_names_it() {
        let none = Held::default();
        hand_keys(
            "keys-window",
            vec![
                app_key_of("o", "KeyO", CTRL, false),
                app_key_of("p", "KeyP", held(true, true, false), false),
                app_key_of("ArrowDown", "ArrowDown", held(true, false, true), false),
                app_key_of("1", "Digit1", none, true),
                app_key_of("F11", "F11", SHIFT, false),
                app_key_of("Tab", "Tab", CTRL, false),
                app_key_of(",", "Comma", held(true, true, false), false),
                app_key_of("e", "KeyE", none, false),
                app_key_of("Shift Shift", "", none, false),
            ],
        );
        let heard = |vk, held, meta| {
            app_key("keys-window", press(vk, held, meta)).map(|one| (one.key, one.code))
        };
        let named = |key: &str, code: &str| Some((key.to_string(), code.to_string()));
        assert_eq!(heard(0x4F, CTRL, false), named("o", "KeyO"));
        assert_eq!(heard(0x50, held(true, true, false), false), named("p", "KeyP"));
        assert_eq!(heard(0x50, CTRL, false), None);
        assert_eq!(heard(0x28, held(true, false, true), false), named("ArrowDown", "ArrowDown"));
        assert_eq!(heard(0x31, none, true), named("1", "Digit1"));
        assert_eq!(heard(0x31, SHIFT, true), named("1", "Digit1"));
        assert_eq!(heard(0x31, CTRL, false), None);
        assert_eq!(heard(0x7A, SHIFT, false), named("F11", "F11"));
        assert_eq!(heard(0x09, CTRL, false), named("Tab", "Tab"));
        assert_eq!(heard(0xBC, held(true, true, false), false), named(",", "Comma"));
        assert_eq!(heard(0x45, none, false), None);
        assert_eq!(heard(0x46, CTRL, false), None);
        assert_eq!(app_key("another-window", press(0x4F, CTRL, false)), None);
        let altgr = Press { altgr: true, ..press(0x4F, CTRL, false) };
        assert_eq!(app_key("keys-window", altgr), None);
        let again = Press { repeat: true, ..press(0x4F, CTRL, false) };
        assert!(app_key("keys-window", again).is_some_and(|one| one.repeat && one.down));
        let full = app_key("keys-window", press(0x7A, SHIFT, false));
        assert!(full.is_some_and(|one| one.keeps_page() && one.held.shift));
        let said =
            serde_json::to_value(app_key("keys-window", press(0x31, none, true))).expect("a key");
        assert_eq!(said["meta"], true);
        assert_eq!(said["ctrl"], false);
        let asked: AppKey =
            serde_json::from_str(r#"{"key":"o","code":"KeyO","ctrl":true}"#).expect("a key");
        assert_eq!(asked, app_key_of("o", "KeyO", CTRL, false));
        hand_keys("keys-window", Vec::new());
        assert_eq!(heard(0x4F, CTRL, false), None);
    }
    #[test]
    fn a_key_s_code_names_the_key_the_engine_reports() {
        for (code, vk) in [
            ("KeyA", Some(0x41)),
            ("KeyZ", Some(0x5A)),
            ("Digit0", Some(0x30)),
            ("Digit9", Some(0x39)),
            ("F1", Some(0x70)),
            ("F11", Some(0x7A)),
            ("F24", Some(0x87)),
            ("ArrowLeft", Some(0x25)),
            ("PageDown", Some(0x22)),
            ("Slash", Some(0xBF)),
            ("BracketRight", Some(0xDD)),
            ("F25", None),
            ("F0", None),
            ("Keya", None),
            ("KeyAB", None),
            ("Digit10", None),
            ("", None),
        ] {
            assert_eq!(vk_of_code(code), vk, "{code}");
        }
    }
    #[test]
    fn a_key_held_down_says_so() {
        let again = meaning(0x54, CTRL, true, true);
        assert!(again.is_some_and(|one| one.repeat && one.down));
    }
}
