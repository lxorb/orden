const KEYS: [(&str, u16, char); 47] = [
    ("KeyA", 0x00, 'a'),
    ("KeyS", 0x01, 's'),
    ("KeyD", 0x02, 'd'),
    ("KeyF", 0x03, 'f'),
    ("KeyH", 0x04, 'h'),
    ("KeyG", 0x05, 'g'),
    ("KeyZ", 0x06, 'z'),
    ("KeyX", 0x07, 'x'),
    ("KeyC", 0x08, 'c'),
    ("KeyV", 0x09, 'v'),
    ("KeyB", 0x0b, 'b'),
    ("KeyQ", 0x0c, 'q'),
    ("KeyW", 0x0d, 'w'),
    ("KeyE", 0x0e, 'e'),
    ("KeyR", 0x0f, 'r'),
    ("KeyY", 0x10, 'y'),
    ("KeyT", 0x11, 't'),
    ("Digit1", 0x12, '1'),
    ("Digit2", 0x13, '2'),
    ("Digit3", 0x14, '3'),
    ("Digit4", 0x15, '4'),
    ("Digit6", 0x16, '6'),
    ("Digit5", 0x17, '5'),
    ("Equal", 0x18, '='),
    ("Digit9", 0x19, '9'),
    ("Digit7", 0x1a, '7'),
    ("Minus", 0x1b, '-'),
    ("Digit8", 0x1c, '8'),
    ("Digit0", 0x1d, '0'),
    ("BracketRight", 0x1e, ']'),
    ("KeyO", 0x1f, 'o'),
    ("KeyU", 0x20, 'u'),
    ("BracketLeft", 0x21, '['),
    ("KeyI", 0x22, 'i'),
    ("KeyP", 0x23, 'p'),
    ("KeyL", 0x25, 'l'),
    ("KeyJ", 0x26, 'j'),
    ("Quote", 0x27, '\''),
    ("KeyK", 0x28, 'k'),
    ("Semicolon", 0x29, ';'),
    ("Backslash", 0x2a, '\\'),
    ("Comma", 0x2b, ','),
    ("Slash", 0x2c, '/'),
    ("KeyN", 0x2d, 'n'),
    ("KeyM", 0x2e, 'm'),
    ("Period", 0x2f, '.'),
    ("Backquote", 0x32, '`'),
];
fn named(key: &str) -> Option<(&'static str, char)> {
    let mut chars = key.chars();
    let one = chars.next().filter(|_| chars.next().is_none()).map(|one| one.to_ascii_lowercase());
    KEYS.iter()
        .find(|(name, _, typed)| name.eq_ignore_ascii_case(key) || one == Some(*typed))
        .map(|&(name, _, typed)| (name, typed))
}
pub fn placed(accelerator: &str, typed: impl Fn(u16) -> Option<char>) -> String {
    let (mods, key) = accelerator.rsplit_once('+').unwrap_or(("", accelerator));
    let Some((own, wanted)) = named(key) else {
        return accelerator.to_owned();
    };
    let typed_by = |name: &str| {
        KEYS.iter()
            .find(|one| one.0 == name)
            .and_then(|one| typed(one.1))
            .map(|one| one.to_lowercase().next().unwrap_or(one))
    };
    if typed_by(own) == Some(wanted) {
        return accelerator.to_owned();
    }
    match KEYS.iter().find(|one| typed_by(one.0) == Some(wanted)) {
        Some((name, _, _)) if mods.is_empty() => (*name).to_owned(),
        Some((name, _, _)) => format!("{mods}+{name}"),
        None => accelerator.to_owned(),
    }
}
#[cfg(target_os = "macos")]
pub fn placed_here(accelerator: &str) -> String {
    if objc2::MainThreadMarker::new().is_none() {
        return accelerator.to_owned();
    }
    match mac::Layout::now() {
        Some(layout) => placed(accelerator, |code| layout.typed(code)),
        None => accelerator.to_owned(),
    }
}
#[cfg(target_os = "macos")]
pub fn watch(then: fn()) {
    mac::watch(then);
}
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod mac {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    type Ref = *const c_void;
    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        static kTISPropertyUnicodeKeyLayoutData: Ref;
        static kTISNotifySelectedKeyboardInputSourceChanged: Ref;
        fn TISCopyCurrentASCIICapableKeyboardLayoutInputSource() -> Ref;
        fn TISGetInputSourceProperty(source: Ref, key: Ref) -> Ref;
        fn LMGetKbdType() -> u8;
        fn UCKeyTranslate(
            layout: *const c_void,
            code: u16,
            action: u16,
            modifiers: u32,
            keyboard: u32,
            options: u32,
            dead: *mut u32,
            most: usize,
            length: *mut usize,
            chars: *mut u16,
        ) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDataGetBytePtr(data: Ref) -> *const u8;
        fn CFRelease(object: Ref);
        fn CFNotificationCenterGetDistributedCenter() -> Ref;
        fn CFNotificationCenterAddObserver(
            center: Ref,
            observer: Ref,
            callback: extern "C" fn(Ref, *mut c_void, Ref, Ref, Ref),
            name: Ref,
            object: Ref,
            behavior: isize,
        );
    }
    const DELIVER_AT_ONCE: isize = 4;
    static THEN: OnceLock<fn()> = OnceLock::new();
    extern "C" fn heard(_: Ref, _: *mut c_void, _: Ref, _: Ref, _: Ref) {
        if let Some(then) = THEN.get() {
            then();
        }
    }
    pub fn watch(then: fn()) {
        if THEN.set(then).is_err() {
            return;
        }
        unsafe {
            CFNotificationCenterAddObserver(
                CFNotificationCenterGetDistributedCenter(),
                (&raw const THEN).cast(),
                heard,
                kTISNotifySelectedKeyboardInputSourceChanged,
                std::ptr::null(),
                DELIVER_AT_ONCE,
            );
        }
    }
    const DISPLAY: u16 = 3;
    const NO_DEAD_KEYS: u32 = 1;
    pub struct Layout {
        source: Ref,
        data: *const u8,
    }
    impl Layout {
        pub fn now() -> Option<Layout> {
            let source = unsafe { TISCopyCurrentASCIICapableKeyboardLayoutInputSource() };
            if source.is_null() {
                return None;
            }
            let held =
                unsafe { TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) };
            let data =
                if held.is_null() { std::ptr::null() } else { unsafe { CFDataGetBytePtr(held) } };
            let layout = Layout { source, data };
            (!layout.data.is_null()).then_some(layout)
        }
        pub fn typed(&self, code: u16) -> Option<char> {
            let mut dead = 0_u32;
            let mut length = 0_usize;
            let mut chars = [0_u16; 4];
            let status = unsafe {
                UCKeyTranslate(
                    self.data.cast(),
                    code,
                    DISPLAY,
                    0,
                    u32::from(LMGetKbdType()),
                    NO_DEAD_KEYS,
                    &raw mut dead,
                    chars.len(),
                    &raw mut length,
                    chars.as_mut_ptr(),
                )
            };
            if status != 0 || length != 1 {
                return None;
            }
            char::from_u32(u32::from(chars[0]))
        }
    }
    impl Drop for Layout {
        fn drop(&mut self) {
            unsafe { CFRelease(self.source) };
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{placed, KEYS};
    use std::collections::HashMap;

    const ROWS: [&str; 4] = [
        "Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal",
        "KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight",
        "KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backslash",
        "KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash",
    ];
    fn layout(rows: [&str; 4]) -> impl Fn(u16) -> Option<char> {
        let mut typed: HashMap<u16, char> = HashMap::new();
        for (names, chars) in ROWS.iter().zip(rows) {
            for (name, one) in names.split(' ').zip(chars.chars()) {
                let code = KEYS.iter().find(|key| key.0 == name).map(|key| key.1).expect("a key");
                typed.insert(code, one);
            }
        }
        move |code| typed.get(&code).copied()
    }
    const US: [&str; 4] = ["1234567890-=", "qwertyuiop[]", "asdfghjkl;'\\", "zxcvbnm,./"];
    const COLEMAK: [&str; 4] = ["1234567890-=", "qwfpgjluy;[]", "arstdhneio'\\", "zxcvbkm,./"];
    const DVORAK: [&str; 4] = ["1234567890[]", "',.pyfgcrl/=", "aoeuidhtns-\\", ";qjkxbmwvz"];
    const AZERTY: [&str; 4] = ["&é\"'(-è_çà)=", "azertyuiop^$", "qsdfghjklmù*", "wxcvbn,;:!"];
    const QWERTZ: [&str; 4] = ["1234567890ß´", "qwertzuiopü+", "asdfghjklöä#", "yxcvbnm,.-"];
    const CYRILLIC: [&str; 4] = ["1234567890-=", "йцукенгшщзхъ", "фывапролджэ\\", "ячсмитьбю."];

    #[test]
    fn a_key_is_held_where_the_layout_types_its_letter() {
        assert_eq!(placed("Control+T", layout(COLEMAK)), "Control+KeyF");
        assert_eq!(placed("Control+F", layout(COLEMAK)), "Control+KeyE");
        assert_eq!(placed("Control+Alt+T", layout(DVORAK)), "Control+Alt+KeyK");
        assert_eq!(placed("Control+A", layout(AZERTY)), "Control+KeyQ");
        assert_eq!(placed("Control+Minus", layout(AZERTY)), "Control+Digit6");
        assert_eq!(placed("Control+Z", layout(QWERTZ)), "Control+KeyY");
        assert_eq!(placed("Alt+KeyY", layout(QWERTZ)), "Alt+KeyZ");
    }
    #[test]
    fn a_key_the_layout_types_where_it_sits_or_not_at_all_stays_in_its_place() {
        assert_eq!(placed("Control+Alt+T", layout(US)), "Control+Alt+T");
        assert_eq!(placed("Control+T", layout(CYRILLIC)), "Control+T");
        assert_eq!(placed("Control+Alt+K", layout(CYRILLIC)), "Control+Alt+K");
        assert_eq!(placed("Control+1", layout(AZERTY)), "Control+1");
        assert_eq!(placed("Control+Alt+Space", layout(COLEMAK)), "Control+Alt+Space");
        assert_eq!(placed("F5", layout(DVORAK)), "F5");
        assert_eq!(placed("T", layout(COLEMAK)), "KeyF");
    }
    #[cfg(target_os = "windows")]
    #[test]
    #[allow(unsafe_code)]
    fn windows_holds_a_key_by_what_the_layout_types_and_a_layout_without_it_by_its_place() {
        use windows::core::w;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            LoadKeyboardLayoutW, MapVirtualKeyExW, VkKeyScanExW, KLF_NOTELLSHELL, MAPVK_VK_TO_VSC,
        };
        let on = |id, wanted: char| {
            let layout = unsafe { LoadKeyboardLayoutW(id, KLF_NOTELLSHELL) }.expect("a layout");
            let asked = u16::try_from(u32::from(wanted)).expect("a letter");
            let virtual_key = unsafe { VkKeyScanExW(asked, layout) };
            let named = u32::from(wanted.to_ascii_uppercase());
            (virtual_key, unsafe { MapVirtualKeyExW(named, MAPVK_VK_TO_VSC, layout) })
        };
        assert_eq!(on(w!("00000409"), 't'), (0x54, 0x14));
        assert_eq!(on(w!("00010409"), 't'), (0x54, 0x25));
        assert_eq!(on(w!("0000040C"), 'a'), (0x41, 0x10));
        assert_eq!(on(w!("00000407"), 'z'), (0x5A, 0x15));
        assert_eq!(on(w!("00000419"), 't'), (-1, 0x14));
    }
}
