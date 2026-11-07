use std::collections::HashSet;

use objc2_core_foundation::{CGPoint, CGRect};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGEvent, CGEventField, CGEventFlags, CGEventTapLocation,
    CGEventType, CGMouseButton, CGScrollEventUnit, CGWarpMouseCursorPosition,
};

pub use super::super::events::InputEvent;

const MOST_TEXT: usize = 1000;
const DOUBLE_WITHIN: std::time::Duration = std::time::Duration::from_millis(500);

pub struct Input {
    display: CGDirectDisplayID,
    pid: i32,
    at: CGPoint,
    buttons: HashSet<u32>,
    keys: HashSet<u16>,
    reader_was: Option<CGPoint>,
    last_press: Option<(std::time::Instant, CGPoint, u32, i64)>,
}

impl Input {
    pub fn open(name: &str) -> Result<Input, String> {
        let (display, pid) = super::capture::parse(name).ok_or("not an application's display")?;
        let origin = CGDisplayBounds(display).origin;
        Ok(Input {
            display,
            pid,
            at: origin,
            buttons: HashSet::new(),
            keys: HashSet::new(),
            reader_was: None,
            last_press: None,
        })
    }

    pub fn play(&mut self, event: InputEvent) {
        match event {
            InputEvent::Move { x, y } => {
                self.at = self.point(x, y);
                if let Some(&button) = self.buttons.iter().next() {
                    self.post_global(dragged(button), button, 0);
                } else {
                    self.post_to_app(mouse(CGEventType::MouseMoved, self.at, 0, self.flags()));
                }
            }
            InputEvent::Button { button, down } => {
                if let Some(button) = mac_button(button) {
                    self.button(button, down);
                }
            }
            InputEvent::Wheel { x, y } => {
                let event =
                    CGEvent::new_scroll_wheel_event2(None, CGScrollEventUnit::Line, 2, -y, -x, 0);
                if let Some(event) = event {
                    CGEvent::set_location(Some(&event), self.at);
                    CGEvent::set_flags(Some(&event), self.flags());
                    CGEvent::post_to_pid(self.pid, Some(&event));
                }
            }
            InputEvent::Key { key, code, down } => self.key(&key, &code, down),
            InputEvent::Text { text } => {
                for one in text.chars().take(MOST_TEXT) {
                    self.typed(0, Some(one), true);
                    self.typed(0, Some(one), false);
                }
            }
            InputEvent::Clipboard { .. } | InputEvent::Share { .. } | InputEvent::Ping { .. } => {}
        }
    }

    pub fn let_go(&mut self) {
        for code in std::mem::take(&mut self.keys) {
            self.typed(code, None, false);
        }
        let held: Vec<u32> = self.buttons.iter().copied().collect();
        for button in held {
            self.button(button, false);
        }
    }

    fn point(&self, x: f64, y: f64) -> CGPoint {
        let bounds = CGDisplayBounds(self.display);
        let (width, height) = super::display::pixels_of(self.display);
        global(bounds, (width, height), x, y)
    }

    fn flags(&self) -> CGEventFlags {
        let mut flags = CGEventFlags::empty();
        for &code in &self.keys {
            flags |= match code {
                0x38 | 0x3C => CGEventFlags::MaskShift,
                0x3B | 0x3E => CGEventFlags::MaskControl,
                0x3A | 0x3D => CGEventFlags::MaskAlternate,
                0x37 | 0x36 => CGEventFlags::MaskCommand,
                _ => CGEventFlags::empty(),
            };
        }
        flags
    }

    fn button(&mut self, button: u32, down: bool) {
        if down {
            if self.buttons.is_empty() && self.reader_was.is_none() {
                self.reader_was = CGEvent::new(None).map(|now| CGEvent::location(Some(&now)));
            }
            if !self.buttons.insert(button) {
                return;
            }
            let count = self.click_count(button);
            self.post_global(pressed(button), button, count);
        } else {
            if !self.buttons.remove(&button) {
                return;
            }
            let count = self.last_press.map_or(1, |(_, _, _, count)| count);
            self.post_global(released(button), button, count);
            if self.buttons.is_empty() {
                if let Some(was) = self.reader_was.take() {
                    let _ = CGWarpMouseCursorPosition(was);
                }
            }
        }
    }

    fn click_count(&mut self, button: u32) -> i64 {
        let now = std::time::Instant::now();
        let count = match self.last_press {
            Some((when, at, which, count))
                if which == button
                    && now.duration_since(when) < DOUBLE_WITHIN
                    && (at.x - self.at.x).abs() < 4.0
                    && (at.y - self.at.y).abs() < 4.0 =>
            {
                count + 1
            }
            _ => 1,
        };
        self.last_press = Some((now, self.at, button, count));
        count
    }

    fn post_global(&self, kind: CGEventType, button: u32, count: i64) {
        let Some(event) = mouse(kind, self.at, button, self.flags()) else {
            return;
        };
        if count > 0 {
            CGEvent::set_integer_value_field(
                Some(&event),
                CGEventField::MouseEventClickState,
                count,
            );
        }
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&event));
    }

    fn post_to_app(&self, event: Option<objc2_core_foundation::CFRetained<CGEvent>>) {
        if let Some(event) = event {
            CGEvent::post_to_pid(self.pid, Some(&event));
        }
    }

    fn key(&mut self, key: &str, code: &str, down: bool) {
        let Some(virtual_key) = key_code(code) else {
            let mut chars = key.chars();
            if let (Some(one), None) = (chars.next(), chars.next()) {
                if down {
                    self.typed(0, Some(one), true);
                    self.typed(0, Some(one), false);
                }
            }
            return;
        };
        if down {
            self.keys.insert(virtual_key);
        } else if !self.keys.remove(&virtual_key) {
            return;
        }
        let mut chars = key.chars();
        let character = match (chars.next(), chars.next()) {
            (Some(one), None) if !one.is_control() => Some(one),
            _ => None,
        };
        self.typed(virtual_key, character, down);
    }

    #[allow(
        unsafe_code,
        reason = "an event's Unicode string is written from a buffer the call reads only"
    )]
    fn typed(&self, virtual_key: u16, character: Option<char>, down: bool) {
        let Some(event) = CGEvent::new_keyboard_event(None, virtual_key, down) else {
            return;
        };
        CGEvent::set_flags(Some(&event), self.flags());
        if let Some(one) = character {
            let mut units = [0_u16; 2];
            let units = one.encode_utf16(&mut units);
            unsafe {
                CGEvent::keyboard_set_unicode_string(
                    Some(&event),
                    units.len() as _,
                    units.as_ptr(),
                );
            }
        }
        CGEvent::post_to_pid(self.pid, Some(&event));
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        self.let_go();
    }
}

pub fn global(bounds: CGRect, pixels: (usize, usize), x: f64, y: f64) -> CGPoint {
    #[allow(
        clippy::cast_precision_loss,
        reason = "display sizes are far below 2^52"
    )]
    let (width, height) = (pixels.0.max(1) as f64, pixels.1.max(1) as f64);
    let inside = |value: f64, most: f64| {
        if value.is_finite() {
            value.clamp(0.0, most - 1.0)
        } else {
            0.0
        }
    };
    CGPoint::new(
        bounds.origin.x + inside(x, width) * bounds.size.width / width,
        bounds.origin.y + inside(y, height) * bounds.size.height / height,
    )
}

pub fn mac_button(button: u8) -> Option<u32> {
    match button {
        0 => Some(0),
        1 => Some(2),
        2 => Some(1),
        3 => Some(3),
        4 => Some(4),
        _ => None,
    }
}

fn pressed(button: u32) -> CGEventType {
    match button {
        0 => CGEventType::LeftMouseDown,
        1 => CGEventType::RightMouseDown,
        _ => CGEventType::OtherMouseDown,
    }
}

fn released(button: u32) -> CGEventType {
    match button {
        0 => CGEventType::LeftMouseUp,
        1 => CGEventType::RightMouseUp,
        _ => CGEventType::OtherMouseUp,
    }
}

fn dragged(button: u32) -> CGEventType {
    match button {
        0 => CGEventType::LeftMouseDragged,
        1 => CGEventType::RightMouseDragged,
        _ => CGEventType::OtherMouseDragged,
    }
}

fn mouse(
    kind: CGEventType,
    at: CGPoint,
    button: u32,
    flags: CGEventFlags,
) -> Option<objc2_core_foundation::CFRetained<CGEvent>> {
    let event = CGEvent::new_mouse_event(None, kind, at, CGMouseButton(button))?;
    CGEvent::set_flags(Some(&event), flags);
    Some(event)
}

#[allow(clippy::too_many_lines, reason = "one table, a row a key")]
pub fn key_code(code: &str) -> Option<u16> {
    let found = match code {
        "KeyA" => 0x00,
        "KeyS" => 0x01,
        "KeyD" => 0x02,
        "KeyF" => 0x03,
        "KeyH" => 0x04,
        "KeyG" => 0x05,
        "KeyZ" => 0x06,
        "KeyX" => 0x07,
        "KeyC" => 0x08,
        "KeyV" => 0x09,
        "IntlBackslash" => 0x0A,
        "KeyB" => 0x0B,
        "KeyQ" => 0x0C,
        "KeyW" => 0x0D,
        "KeyE" => 0x0E,
        "KeyR" => 0x0F,
        "KeyY" => 0x10,
        "KeyT" => 0x11,
        "Digit1" => 0x12,
        "Digit2" => 0x13,
        "Digit3" => 0x14,
        "Digit4" => 0x15,
        "Digit6" => 0x16,
        "Digit5" => 0x17,
        "Equal" => 0x18,
        "Digit9" => 0x19,
        "Digit7" => 0x1A,
        "Minus" => 0x1B,
        "Digit8" => 0x1C,
        "Digit0" => 0x1D,
        "BracketRight" => 0x1E,
        "KeyO" => 0x1F,
        "KeyU" => 0x20,
        "BracketLeft" => 0x21,
        "KeyI" => 0x22,
        "KeyP" => 0x23,
        "Enter" => 0x24,
        "KeyL" => 0x25,
        "KeyJ" => 0x26,
        "Quote" => 0x27,
        "KeyK" => 0x28,
        "Semicolon" => 0x29,
        "Backslash" => 0x2A,
        "Comma" => 0x2B,
        "Slash" => 0x2C,
        "KeyN" => 0x2D,
        "KeyM" => 0x2E,
        "Period" => 0x2F,
        "Tab" => 0x30,
        "Space" => 0x31,
        "Backquote" => 0x32,
        "Backspace" => 0x33,
        "Escape" => 0x35,
        "MetaRight" | "OSRight" => 0x36,
        "MetaLeft" | "OSLeft" => 0x37,
        "ShiftLeft" => 0x38,
        "CapsLock" => 0x39,
        "AltLeft" => 0x3A,
        "ControlLeft" => 0x3B,
        "ShiftRight" => 0x3C,
        "AltRight" => 0x3D,
        "ControlRight" => 0x3E,
        "F17" => 0x40,
        "NumpadDecimal" => 0x41,
        "NumpadMultiply" => 0x43,
        "NumpadAdd" => 0x45,
        "NumLock" => 0x47,
        "NumpadDivide" => 0x4B,
        "NumpadEnter" => 0x4C,
        "NumpadSubtract" => 0x4E,
        "F18" => 0x4F,
        "F19" => 0x50,
        "NumpadEqual" => 0x51,
        "Numpad0" => 0x52,
        "Numpad1" => 0x53,
        "Numpad2" => 0x54,
        "Numpad3" => 0x55,
        "Numpad4" => 0x56,
        "Numpad5" => 0x57,
        "Numpad6" => 0x58,
        "Numpad7" => 0x59,
        "F20" => 0x5A,
        "Numpad8" => 0x5B,
        "Numpad9" => 0x5C,
        "F5" => 0x60,
        "F6" => 0x61,
        "F7" => 0x62,
        "F3" => 0x63,
        "F8" => 0x64,
        "F9" => 0x65,
        "F11" => 0x67,
        "F13" => 0x69,
        "F16" => 0x6A,
        "F14" => 0x6B,
        "F10" => 0x6D,
        "ContextMenu" => 0x6E,
        "F12" => 0x6F,
        "F15" => 0x71,
        "Insert" | "Help" => 0x72,
        "Home" => 0x73,
        "PageUp" => 0x74,
        "Delete" => 0x75,
        "F4" => 0x76,
        "End" => 0x77,
        "F2" => 0x78,
        "PageDown" => 0x79,
        "F1" => 0x7A,
        "ArrowLeft" => 0x7B,
        "ArrowRight" => 0x7C,
        "ArrowDown" => 0x7D,
        "ArrowUp" => 0x7E,
        _ => return None,
    };
    Some(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_core_foundation::CGSize;

    #[test]
    fn puts_a_pixel_of_the_display_at_its_point_among_the_displays() {
        let bounds = CGRect::new(CGPoint::new(3000.0, 1000.0), CGSize::new(800.0, 600.0));
        let at = global(bounds, (1600, 1200), 400.0, 300.0);
        assert!((at.x - 3200.0).abs() < 1e-9);
        assert!((at.y - 1150.0).abs() < 1e-9);
        let outside = global(bounds, (1600, 1200), -5.0, 99_999.0);
        assert!((outside.x - 3000.0).abs() < 1e-9);
        assert!(outside.y < 1600.0);
    }

    #[test]
    fn presses_the_button_the_pointer_pressed() {
        assert_eq!(mac_button(0), Some(0));
        assert_eq!(mac_button(2), Some(1));
        assert_eq!(mac_button(1), Some(2));
        assert_eq!(mac_button(9), None);
    }

    #[test]
    fn knows_a_keys_place_on_a_mac() {
        assert_eq!(key_code("KeyA"), Some(0x00));
        assert_eq!(key_code("Enter"), Some(0x24));
        assert_eq!(key_code("MetaLeft"), Some(0x37));
        assert_eq!(key_code("Unidentified"), None);
    }
}
