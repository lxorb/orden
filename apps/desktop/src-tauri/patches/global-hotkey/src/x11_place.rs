use keyboard_types::Code;

pub fn keycode_in(keysyms: &[u32], per_keycode: usize, min_keycode: u8, keysym: u32, key: Code) -> Option<u8> {
    if per_keycode > 0 {
        if let Some(at) = keysyms.chunks(per_keycode).position(|one| one.contains(&keysym)) {
            return u8::try_from(usize::from(min_keycode) + at).ok();
        }
    }
    evdev(key).map(|code| code + 8)
}
fn evdev(key: Code) -> Option<u8> {
    Some(match key {
        Code::Digit1 => 2,
        Code::Digit2 => 3,
        Code::Digit3 => 4,
        Code::Digit4 => 5,
        Code::Digit5 => 6,
        Code::Digit6 => 7,
        Code::Digit7 => 8,
        Code::Digit8 => 9,
        Code::Digit9 => 10,
        Code::Digit0 => 11,
        Code::Minus => 12,
        Code::Equal => 13,
        Code::KeyQ => 16,
        Code::KeyW => 17,
        Code::KeyE => 18,
        Code::KeyR => 19,
        Code::KeyT => 20,
        Code::KeyY => 21,
        Code::KeyU => 22,
        Code::KeyI => 23,
        Code::KeyO => 24,
        Code::KeyP => 25,
        Code::BracketLeft => 26,
        Code::BracketRight => 27,
        Code::KeyA => 30,
        Code::KeyS => 31,
        Code::KeyD => 32,
        Code::KeyF => 33,
        Code::KeyG => 34,
        Code::KeyH => 35,
        Code::KeyJ => 36,
        Code::KeyK => 37,
        Code::KeyL => 38,
        Code::Semicolon => 39,
        Code::Quote => 40,
        Code::Backquote => 41,
        Code::Backslash => 43,
        Code::KeyZ => 44,
        Code::KeyX => 45,
        Code::KeyC => 46,
        Code::KeyV => 47,
        Code::KeyB => 48,
        Code::KeyN => 49,
        Code::KeyM => 50,
        Code::Comma => 51,
        Code::Period => 52,
        Code::Slash => 53,
        _ => return None,
    })
}
