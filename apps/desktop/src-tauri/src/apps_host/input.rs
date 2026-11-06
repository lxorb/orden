use std::collections::HashMap;

use x11rb::connection::Connection as _;
use x11rb::protocol::xproto::{
    ConnectionExt as _, Keycode, Keysym, Window, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT,
    KEY_PRESS_EVENT, KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

pub use super::events::InputEvent;

const MOST_TEXT: usize = 1000;

pub fn x_button(button: u8) -> Option<u8> {
    match button {
        0 => Some(1),
        1 => Some(2),
        2 => Some(3),
        3 => Some(8),
        4 => Some(9),
        _ => None,
    }
}

pub fn keysym(key: &str) -> Option<Keysym> {
    let mut chars = key.chars();
    if let (Some(one), None) = (chars.next(), chars.next()) {
        let point = u32::from(one);
        return match point {
            0x20..=0x7e | 0xa0..=0xff => Some(point),
            0..=0x1f | 0x7f..=0x9f => None,
            _ => Some(0x0100_0000 + point),
        };
    }
    let named = match key {
        "Enter" => 0xff0d,
        "Backspace" => 0xff08,
        "Tab" => 0xff09,
        "Escape" => 0xff1b,
        "Delete" => 0xffff,
        "Insert" => 0xff63,
        "Home" => 0xff50,
        "End" => 0xff57,
        "PageUp" => 0xff55,
        "PageDown" => 0xff56,
        "ArrowLeft" => 0xff51,
        "ArrowUp" => 0xff52,
        "ArrowRight" => 0xff53,
        "ArrowDown" => 0xff54,
        "Shift" => 0xffe1,
        "Control" => 0xffe3,
        "Alt" => 0xffe9,
        "Meta" | "OS" => 0xffeb,
        "CapsLock" => 0xffe5,
        "NumLock" => 0xff7f,
        "ScrollLock" => 0xff14,
        "Pause" => 0xff13,
        "PrintScreen" => 0xff61,
        "ContextMenu" => 0xff67,
        _ => return function_key(key),
    };
    Some(named)
}

fn function_key(key: &str) -> Option<Keysym> {
    let number: u32 = key.strip_prefix('F')?.parse().ok()?;
    (1..=24).contains(&number).then(|| 0xffbe + number - 1)
}

fn sided(keysym: Keysym, code: &str) -> Keysym {
    if !code.ends_with("Right") {
        return keysym;
    }
    match keysym {
        0xffe1 => 0xffe2,
        0xffe3 => 0xffe4,
        0xffe9 => 0xffea,
        0xffeb => 0xffec,
        other => other,
    }
}

#[derive(Debug, Default)]
pub struct Keymap {
    keys: HashMap<(Keysym, bool), Keycode>,
    spare: Vec<Keycode>,
    lent: HashMap<Keysym, Keycode>,
    next: usize,
}

impl Keymap {
    pub fn of(first: Keycode, per_key: u8, keysyms: &[Keysym]) -> Keymap {
        let mut keymap = Keymap::default();
        let per_key = usize::from(per_key.max(1));
        for (at, syms) in keysyms.chunks(per_key).enumerate() {
            let Some(keycode) = u8::try_from(at).ok().and_then(|at| first.checked_add(at)) else {
                break;
            };
            if syms.iter().all(|&one| one == 0) {
                keymap.spare.push(keycode);
                continue;
            }
            for (level, &sym) in syms.iter().take(2).enumerate() {
                if sym != 0 {
                    keymap.keys.entry((sym, level == 1)).or_insert(keycode);
                }
            }
            if syms.get(1).is_none_or(|&one| one == 0) && syms[0] != 0 {
                keymap.keys.entry((syms[0], true)).or_insert(keycode);
            }
        }
        keymap
    }

    pub fn key_for(&mut self, sym: Keysym, shifted: bool) -> Option<(Keycode, bool)> {
        let known = self.keys.get(&(sym, shifted)).copied();
        if let Some(keycode) = known.or_else(|| self.lent.get(&sym).copied()) {
            return Some((keycode, false));
        }
        if self.spare.is_empty() {
            return None;
        }
        let keycode = self.spare[self.next % self.spare.len()];
        self.next += 1;
        self.lent.retain(|_, lent| *lent != keycode);
        self.lent.insert(sym, keycode);
        Some((keycode, true))
    }
}

pub struct Input {
    connection: RustConnection,
    root: Window,
    keymap: Keymap,
    per_key: u8,
    held_keys: HashMap<String, Keycode>,
    held_buttons: Vec<u8>,
}

impl Input {
    pub fn open(display: &str) -> Result<Input, String> {
        let connected = x11rb::connect(Some(display));
        let (connection, screen) = connected.map_err(|error| error.to_string())?;
        let root = connection
            .setup()
            .roots
            .get(screen)
            .ok_or("the display has no screen")?
            .root;
        let first = connection.setup().min_keycode;
        let count = connection.setup().max_keycode - first + 1;
        let mapping = connection
            .get_keyboard_mapping(first, count)
            .map_err(|error| error.to_string())?
            .reply()
            .map_err(|error| error.to_string())?;
        let keymap = Keymap::of(first, mapping.keysyms_per_keycode, &mapping.keysyms);
        Ok(Input {
            connection,
            root,
            keymap,
            per_key: mapping.keysyms_per_keycode,
            held_keys: HashMap::new(),
            held_buttons: Vec::new(),
        })
    }

    pub fn play(&mut self, event: InputEvent) {
        match event {
            InputEvent::Move { x, y } => {
                self.fake(MOTION_NOTIFY_EVENT, 0, coordinate(x), coordinate(y));
            }
            InputEvent::Button { button, down } => {
                let Some(button) = x_button(button) else {
                    return;
                };
                self.held_buttons.retain(|&one| one != button);
                if down {
                    self.held_buttons.push(button);
                }
                let kind = if down {
                    BUTTON_PRESS_EVENT
                } else {
                    BUTTON_RELEASE_EVENT
                };
                self.fake(kind, button, 0, 0);
            }
            InputEvent::Wheel { x, y } => {
                for (clicks, less, more) in [(y, 4, 5), (x, 6, 7)] {
                    let button = if clicks < 0 { less } else { more };
                    for _ in 0..clicks.unsigned_abs().min(20) {
                        self.fake(BUTTON_PRESS_EVENT, button, 0, 0);
                        self.fake(BUTTON_RELEASE_EVENT, button, 0, 0);
                    }
                }
            }
            InputEvent::Key { key, code, down } => self.key(&key, code, down),
            InputEvent::Text { text } => self.text(&text),
            InputEvent::Clipboard { .. } | InputEvent::Share { .. } | InputEvent::Ping { .. } => {}
        }
        let _ = self.connection.flush();
    }

    fn key(&mut self, key: &str, code: String, down: bool) {
        if !down {
            if let Some(keycode) = self.held_keys.remove(&code) {
                self.fake(KEY_RELEASE_EVENT, keycode, 0, 0);
            }
            return;
        }
        let Some(sym) = keysym(key).map(|sym| sided(sym, &code)) else {
            return;
        };
        let Some(keycode) = self.key_giving(sym) else {
            return;
        };
        if let Some(was) = self.held_keys.insert(code, keycode) {
            if was != keycode {
                self.fake(KEY_RELEASE_EVENT, was, 0, 0);
            }
        }
        self.fake(KEY_PRESS_EVENT, keycode, 0, 0);
    }

    fn key_giving(&mut self, sym: Keysym) -> Option<Keycode> {
        let shifted = self
            .held_keys
            .keys()
            .any(|held| held == "ShiftLeft" || held == "ShiftRight");
        let (keycode, lent) = self.keymap.key_for(sym, shifted)?;
        if lent {
            let syms = vec![sym; usize::from(self.per_key.max(1))];
            let _ = self
                .connection
                .change_keyboard_mapping(1, keycode, self.per_key.max(1), &syms);
        }
        Some(keycode)
    }

    fn text(&mut self, text: &str) {
        for one in text.chars().take(MOST_TEXT) {
            let Some(sym) = keysym(one.encode_utf8(&mut [0; 4])) else {
                continue;
            };
            let Some(keycode) = self.key_giving(sym) else {
                continue;
            };
            self.fake(KEY_PRESS_EVENT, keycode, 0, 0);
            self.fake(KEY_RELEASE_EVENT, keycode, 0, 0);
        }
    }

    pub fn let_go(&mut self) {
        let keys: Vec<Keycode> = self.held_keys.drain().map(|(_, keycode)| keycode).collect();
        for keycode in keys {
            self.fake(KEY_RELEASE_EVENT, keycode, 0, 0);
        }
        for button in std::mem::take(&mut self.held_buttons) {
            self.fake(BUTTON_RELEASE_EVENT, button, 0, 0);
        }
        let _ = self.connection.flush();
    }

    fn fake(&self, kind: u8, detail: u8, x: i16, y: i16) {
        let _ = self
            .connection
            .xtest_fake_input(kind, detail, 0, self.root, x, y, 0);
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        self.let_go();
    }
}

#[allow(
    clippy::cast_possible_truncation,
    reason = "clamped to what X takes first"
)]
fn coordinate(value: f64) -> i16 {
    if value.is_finite() {
        value.round().clamp(0.0, f64::from(i16::MAX)) as i16
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_holder_did() {
        let read = |text: &str| serde_json::from_str::<InputEvent>(text).ok();
        assert_eq!(
            read(r#"{"t":"move","x":10.5,"y":3}"#),
            Some(InputEvent::Move { x: 10.5, y: 3.0 })
        );
        assert_eq!(
            read(r#"{"t":"key","key":"a","code":"KeyA","down":true}"#),
            Some(InputEvent::Key {
                key: "a".to_owned(),
                code: "KeyA".to_owned(),
                down: true,
            })
        );
        assert_eq!(
            read(r#"{"t":"text","text":"日本"}"#),
            Some(InputEvent::Text {
                text: "日本".to_owned()
            })
        );
        assert_eq!(
            read(r#"{"t":"clipboard","text":"x"}"#),
            Some(InputEvent::Clipboard {
                text: "x".to_owned()
            })
        );
        assert_eq!(
            read(r#"{"t":"share","clipboard":false}"#),
            Some(InputEvent::Share { clipboard: false })
        );
        assert_eq!(read(r#"{"t":"run","line":"rm -rf ~"}"#), None);
    }

    #[test]
    fn presses_the_button_the_pointer_pressed() {
        assert_eq!(x_button(0), Some(1));
        assert_eq!(x_button(1), Some(2));
        assert_eq!(x_button(2), Some(3));
        assert_eq!(x_button(7), None);
    }

    #[test]
    fn gives_each_key_its_keysym() {
        assert_eq!(keysym("a"), Some(0x61));
        assert_eq!(keysym("é"), Some(0xe9));
        assert_eq!(keysym("€"), Some(0x0100_20ac));
        assert_eq!(keysym("中"), Some(0x0100_4e2d));
        assert_eq!(keysym("Enter"), Some(0xff0d));
        assert_eq!(keysym("F12"), Some(0xffc9));
        assert_eq!(keysym("F25"), None);
        assert_eq!(keysym("\u{7}"), None);
        assert_eq!(keysym("Unidentified"), None);
        assert_eq!(sided(0xffe1, "ShiftRight"), 0xffe2);
        assert_eq!(sided(0xffe1, "ShiftLeft"), 0xffe1);
    }

    #[test]
    fn finds_a_keysym_on_its_key_or_lends_it_a_spare_one() {
        let mut keymap = Keymap::of(8, 2, &[0x61, 0x41, 0xff0d, 0, 0, 0, 0, 0]);
        assert_eq!(keymap.key_for(0x41, true), Some((8, false)));
        assert_eq!(keymap.key_for(0x61, false), Some((8, false)));
        assert_eq!(keymap.key_for(0xff0d, true), Some((9, false)));
        assert_eq!(keymap.key_for(0x41, false), Some((10, true)));
        assert_eq!(keymap.key_for(0x0100_4e2d, false), Some((11, true)));
        assert_eq!(keymap.key_for(0x0100_4e2d, true), Some((11, false)));
        assert_eq!(keymap.key_for(0xfc, false), Some((10, true)));
        assert_eq!(keymap.key_for(0x41, false), Some((11, true)));
        assert_eq!(Keymap::of(8, 1, &[0x61]).key_for(0xe9, false), None);
    }

    #[test]
    fn puts_a_point_where_x_can_take_it() {
        assert_eq!(coordinate(12.6), 13);
        assert_eq!(coordinate(-4.0), 0);
        assert_eq!(coordinate(1e9), i16::MAX);
        assert_eq!(coordinate(f64::NAN), 0);
    }
}
