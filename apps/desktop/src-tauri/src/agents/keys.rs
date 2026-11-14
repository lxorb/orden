use serde_json::{json, Value};

const ALT: u8 = 1;
const CONTROL: u8 = 2;
const META: u8 = 4;
const SHIFT: u8 = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Key {
    pub name: String,
    pub code: String,
    pub windows_code: u32,
    pub text: Option<String>,
    pub modifiers: u8,
}

impl Key {
    pub fn events(&self) -> [Value; 2] {
        let down = json!({
            "type": if self.text.is_some() { "keyDown" } else { "rawKeyDown" },
            "modifiers": self.modifiers,
            "key": self.name,
            "code": self.code,
            "windowsVirtualKeyCode": self.windows_code,
            "nativeVirtualKeyCode": self.windows_code,
            "text": self.text.clone().unwrap_or_default(),
            "unmodifiedText": self.text.clone().unwrap_or_default(),
        });
        let up = json!({
            "type": "keyUp",
            "modifiers": self.modifiers,
            "key": self.name,
            "code": self.code,
            "windowsVirtualKeyCode": self.windows_code,
            "nativeVirtualKeyCode": self.windows_code,
        });
        [down, up]
    }

    pub fn opens_a_picker(&self) -> bool {
        matches!(self.name.as_str(), " " | "Enter" | "F4")
            || (matches!(self.name.as_str(), "ArrowDown" | "ArrowUp") && self.modifiers & ALT != 0)
    }

    pub fn changes_words(&self) -> bool {
        self.text.is_some()
            || matches!(self.name.as_str(), "Backspace" | "Delete")
            || (self.modifiers & (CONTROL | META) != 0
                && matches!(self.name.to_ascii_lowercase().as_str(), "v" | "x"))
    }

    pub fn submits(&self) -> bool {
        self.name == "Enter" && self.modifiers & (CONTROL | ALT | META) == 0
    }

    pub fn judged_by_the_page(&self) -> bool {
        self.changes_words() || self.sends() || self.submits() || self.presses()
    }

    pub fn presses(&self) -> bool {
        matches!(self.name.as_str(), " " | "Enter")
    }

    pub fn sends(&self) -> bool {
        self.name == "Enter" && self.modifiers & (ALT | SHIFT) == 0
    }
}

pub fn chord(said: &str) -> Result<Key, String> {
    let said = said.trim();
    if said.is_empty() {
        return Err("say which key".into());
    }
    let (held, last) = match said.strip_suffix("++") {
        Some(front) => (front, "+"),
        None => match said.rsplit_once('+') {
            Some((front, last)) if !last.is_empty() => (front, last),
            _ => ("", said),
        },
    };
    let mut modifiers = 0u8;
    for one in held.split('+').filter(|one| !one.is_empty()) {
        modifiers |= match one.to_ascii_lowercase().as_str() {
            "alt" | "option" => ALT,
            "control" | "ctrl" | "controlormeta" => CONTROL,
            "meta" | "command" | "cmd" | "win" | "super" => META,
            "shift" => SHIFT,
            _ => {
                return Err(format!(
                    "{one} is not a modifier: Alt, Control, Meta or Shift"
                ))
            }
        };
    }
    let mut key = named(last).ok_or_else(|| format!("{last} is not a key name"))?;
    key.modifiers = modifiers;
    if modifiers & (CONTROL | ALT | META) != 0 {
        key.text = None;
    } else if modifiers & SHIFT != 0 {
        key.text = key.text.map(|text| text.to_uppercase());
        if key.name.chars().count() == 1 {
            key.name = key.name.to_uppercase();
        }
    }
    Ok(key)
}

fn named(name: &str) -> Option<Key> {
    let plain = |name: &str, code: &str, windows_code: u32, text: Option<&str>| Key {
        name: name.to_string(),
        code: code.to_string(),
        windows_code,
        text: text.map(str::to_string),
        modifiers: 0,
    };
    let lower = name.to_ascii_lowercase();
    Some(match lower.as_str() {
        "enter" | "return" => plain("Enter", "Enter", 13, Some("\r")),
        "tab" => plain("Tab", "Tab", 9, None),
        "escape" | "esc" => plain("Escape", "Escape", 27, None),
        "backspace" => plain("Backspace", "Backspace", 8, None),
        "delete" | "del" => plain("Delete", "Delete", 46, None),
        "insert" => plain("Insert", "Insert", 45, None),
        "space" | " " => plain(" ", "Space", 32, Some(" ")),
        "arrowup" | "up" => plain("ArrowUp", "ArrowUp", 38, None),
        "arrowdown" | "down" => plain("ArrowDown", "ArrowDown", 40, None),
        "arrowleft" | "left" => plain("ArrowLeft", "ArrowLeft", 37, None),
        "arrowright" | "right" => plain("ArrowRight", "ArrowRight", 39, None),
        "home" => plain("Home", "Home", 36, None),
        "end" => plain("End", "End", 35, None),
        "pageup" => plain("PageUp", "PageUp", 33, None),
        "pagedown" => plain("PageDown", "PageDown", 34, None),
        _ => return function_key(&lower).or_else(|| character(name)),
    })
}

fn function_key(lower: &str) -> Option<Key> {
    let number: u32 = lower.strip_prefix('f')?.parse().ok()?;
    (1..=12).contains(&number).then(|| Key {
        name: format!("F{number}"),
        code: format!("F{number}"),
        windows_code: 111 + number,
        text: None,
        modifiers: 0,
    })
}

fn character(name: &str) -> Option<Key> {
    let mut chars = name.chars();
    let one = chars.next()?.to_ascii_lowercase();
    if chars.next().is_some() {
        return None;
    }
    let (code, windows_code) = if one.is_ascii_alphabetic() {
        let upper = one.to_ascii_uppercase();
        (format!("Key{upper}"), u32::from(upper))
    } else if one.is_ascii_digit() {
        (format!("Digit{one}"), u32::from(one))
    } else {
        match one {
            '+' | '=' => ("Equal".into(), 187),
            '-' => ("Minus".into(), 189),
            ',' => ("Comma".into(), 188),
            '.' => ("Period".into(), 190),
            '/' => ("Slash".into(), 191),
            ';' => ("Semicolon".into(), 186),
            '\'' => ("Quote".into(), 222),
            '[' => ("BracketLeft".into(), 219),
            ']' => ("BracketRight".into(), 221),
            '\\' => ("Backslash".into(), 220),
            '`' => ("Backquote".into(), 192),
            _ => (String::new(), 0),
        }
    };
    Some(Key {
        name: one.to_string(),
        code,
        windows_code,
        text: Some(one.to_string()),
        modifiers: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_changes_a_fields_words_is_told_from_what_moves_about() {
        for words in [
            "a",
            "Shift+B",
            "Enter",
            "Backspace",
            "Delete",
            "Control+V",
            "Meta+x",
        ] {
            assert!(chord(words).expect(words).changes_words(), "{words}");
        }
        for moving in [
            "Tab",
            "Shift+Tab",
            "Escape",
            "ArrowDown",
            "Control+A",
            "Control+C",
        ] {
            assert!(!chord(moving).expect(moving).changes_words(), "{moving}");
        }
    }

    #[test]
    fn enter_types_a_return_and_submits() {
        let key = chord("Enter").expect("key");
        assert_eq!(key.windows_code, 13);
        assert_eq!(key.text.as_deref(), Some("\r"));
        assert!(key.submits());
        let [down, up] = key.events();
        assert_eq!(down["type"], "keyDown");
        assert_eq!(up["type"], "keyUp");
    }

    #[test]
    fn a_chord_holds_its_modifiers_and_types_nothing() {
        let key = chord("Control+A").expect("key");
        assert_eq!(key.name, "a");
        assert_eq!(key.code, "KeyA");
        assert_eq!(key.windows_code, 65);
        assert_eq!(key.modifiers, CONTROL);
        assert_eq!(key.text, None);
        assert_eq!(key.events()[0]["type"], "rawKeyDown");

        let shifted = chord("Shift+Tab").expect("key");
        assert_eq!(shifted.modifiers, SHIFT);
        assert_eq!(chord("Shift+a").expect("key").text.as_deref(), Some("A"));
        assert_eq!(chord("Control++").expect("key").name, "+");
        assert_eq!(
            chord("Control+Shift+R").expect("key").modifiers,
            CONTROL | SHIFT
        );
    }

    #[test]
    fn a_name_that_is_not_a_key_is_refused() {
        assert!(chord("").is_err());
        assert!(chord("Hyper+A").is_err());
        assert!(chord("Banana").is_err());
        assert_eq!(chord("F5").expect("key").windows_code, 116);
        assert!(chord("F13").is_err());
    }

    #[test]
    fn the_presses_that_open_a_picker_are_known() {
        assert!(chord("Space").expect("key").opens_a_picker());
        assert!(chord("Alt+ArrowDown").expect("key").opens_a_picker());
        assert!(!chord("ArrowDown").expect("key").opens_a_picker());
        assert!(!chord("Control+Enter").expect("key").submits());
    }

    #[test]
    fn a_key_that_presses_is_asked_of_the_page_whatever_is_held() {
        for said in [
            "Control+Space",
            "Alt+Space",
            "Meta+Space",
            "Space",
            "Enter",
            "a",
        ] {
            assert!(chord(said).expect("key").judged_by_the_page(), "{said}");
        }
        for said in ["Tab", "Escape", "ArrowDown"] {
            assert!(!chord(said).expect("key").judged_by_the_page(), "{said}");
        }
    }

    #[test]
    fn space_and_enter_press_what_has_the_keyboard() {
        for said in [
            "Space",
            "Enter",
            "Shift+Enter",
            "Control+Enter",
            "Control+Space",
        ] {
            assert!(chord(said).expect("key").presses(), "{said}");
        }
        for said in ["Tab", "a", "Escape", "ArrowDown"] {
            assert!(!chord(said).expect("key").presses(), "{said}");
        }
    }

    #[test]
    fn enter_and_control_enter_send_and_shift_enter_is_a_new_line() {
        assert!(chord("Enter").expect("key").sends());
        assert!(chord("Control+Enter").expect("key").sends());
        assert!(chord("Meta+Enter").expect("key").sends());
        assert!(!chord("Shift+Enter").expect("key").sends());
        assert!(chord("Shift+Enter").expect("key").submits());
        assert!(!chord("Alt+Enter").expect("key").sends());
        assert!(!chord("a").expect("key").sends());
    }
}
