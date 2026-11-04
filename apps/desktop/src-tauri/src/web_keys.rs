//! The keys a page in a web tab never gets: the browser's own.
//!
//! Emil, 2026-09-27: *"if I press Ctrl+T right now while I'm in a browser window,
//! nothing happens."* A web tab's page is a webview of its own, so once a click has put
//! the keyboard in it every key went to the site and none to the app. Ctrl+T, Ctrl+W,
//! Ctrl+Tab - the keys a hand in a browser reaches for without looking - did nothing at
//! all.
//!
//! Chrome's rule is the one kept here. A handful of chords are the browser's and a page
//! is never offered them: a new tab, closing one, going round them, moving one along,
//! reopening the last, a new window - and F6, which a hand in a browser presses to get
//! out of the page to the address field. And Orden's own Alt and a digit, the tabs by
//! number, which Chrome keeps from a page on Linux, and Shift+F11, the tab filling Orden's
//! window, which no browser binds and so no site is used to having. And F11, full screen,
//! which is Chrome's own as well - except while a video in the page holds the screen,
//! when F11 gives it back, which `web_page.rs` hears first. Everything else is
//! the page's, which is what lets a site's own Ctrl+K work, so nothing else is touched.
//! Reloading needs nothing here on `WebView2`: F5 and Ctrl+R pressed in a page are the
//! engine's own, as they are in Chrome. Not on the other two, which have no such key of
//! their own: see `reloading`, and the Mac's Reload row (native-menu-bar.svelte.ts). See
//! docs/web-tabs.md.
//!
//! Finding and the address field's other two keys are not among them, because Chrome
//! asks the page first: Google Docs, Notion and VS Code on the web have a find of their
//! own on Ctrl+F, and many a site its own Ctrl+L. The browser's answer comes only when
//! the page let the key go by. So the page has Ctrl+F, Ctrl+G, F3, Ctrl+L and Alt+D, and
//! a line of script in it asks for Orden's answer when nothing in the page took them; see
//! `web_opens.rs`. Ctrl+D too, Chrome's bookmark and nib's Deselect tab: Sheets fills
//! down with it and Figma duplicates. And Ctrl+Space and Ctrl+Shift+Space, Orden's space
//! switcher, which Sheets selects a column and everything with.
//!
//! **How they get out.** `WebView2` tells the host about every key pressed with Ctrl or
//! Alt held before the page sees it (`AcceleratorKeyPressed`), and a key the host marks
//! handled never reaches the page. So a reserved chord is marked, the keyboard is handed
//! back to the app's own page - the chord is about the browser, and the next key a hand
//! presses is too - and the window is told the key as if it had been pressed there. The
//! window replays it on itself, so the one handler every other key goes through answers
//! this one too, rebinding and all; see `lib/web-tab/keys.ts`.
//!
//! The release of a modifier is told as well, and not taken from the page: Ctrl+T held
//! is Alt+Tab's shape, and a Ctrl let go of inside the page is the release that
//! chooses. So is Alt going down on its own, and whatever key goes down while it is
//! held, as `Unidentified` and never as the key: the window shows each tab's number
//! and each Essential's letter for as long as Alt is held, through any key, and puts
//! them away at its release (`told`; lib/tab-strip/numbers.svelte.ts). Nothing else is
//! said, so a site cannot be read through this and cannot speak through it either: the
//! event is the engine's, raised in this process, and nothing in the page can raise it.
//!
//! **The app's own chords.** Alt and a digit is fixed, above. The rest of what the app
//! takes while Alt is held changes as a person works - an Essential's letter (#1051) is
//! given as the Essential is made - so the window says which they are (`web_keys_take`)
//! and every engine takes exactly those from a page as it takes Alt and a digit: the page
//! never has them and the window is told each as itself (`app_s`). Any other key with
//! Alt is still the page's. A chord the window asks for must be held with Ctrl or with
//! Alt, and not both: a key without either is typing, and Ctrl with Alt is `AltGr`.
//!
//! On Orden's own Chromium, on Linux, the same comes by way of the X server; see
//! `grabbed`. A Mac needs none of it: Option and a letter types a character there, so the
//! app shows no numbers or letters and takes no such key.
//!
//! **A Mac needs none of this.** There the chords are rows of the menu bar across the
//! top of the screen - Cmd+T, Cmd+W, Ctrl+Tab and the rest are key equivalents - and
//! `AppKit` offers a key equivalent to the menu bar before a web tab's page: wry's child
//! webview declines every one (tauri-apps/tauri#9426), so the page never sees them. The
//! menu's row runs the command in the app's own page and hands the keyboard back to it,
//! which is what this file does by hand on Windows. See native-menu.ts in the frontend.

use serde::Serialize;

/// The event the window hears a key on.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub const PRESSED: &str = "nib://web-key";

/// The modifiers held with a key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Held {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// A key the page did not get, the way `KeyboardEvent` would have named it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Pressed {
    key: &'static str,
    code: &'static str,
    #[serde(flatten)]
    held: Held,
    /// A key held down, arriving again.
    repeat: bool,
    /// Pressed rather than let go of.
    down: bool,
}

impl Pressed {
    /// Whether the page keeps the keyboard after this key. Every other chord here is about
    /// the browser, and the next key a hand presses is too; a tab filling the window is no
    /// reason to take the caret out of what fills it.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn keeps_page(&self) -> bool {
        self.code == "F11"
    }

    /// A key pressed with Ctrl, and Shift where `shift` says, once: a chord the page was
    /// offered first and let go by, said in the same words as the ones here. Ctrl+D and
    /// Ctrl+Shift+D, which Chrome gives the page first as well, and Ctrl+Space with and
    /// without Shift; see `web_opens.rs`.
    #[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
    pub const fn with_ctrl(key: &'static str, code: &'static str, shift: bool) -> Self {
        Self {
            key,
            code,
            held: Held {
                ctrl: true,
                shift,
                alt: false,
            },
            repeat: false,
            down: true,
        }
    }
}

/// What a key means here, from the virtual key code Windows names it by and the
/// modifiers held with it: a chord the page may not have, the release of a modifier,
/// or nothing - which is every other key, and the page's.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn meaning(vk: u32, held: Held, down: bool, repeat: bool) -> Option<Pressed> {
    let pressed = |key, code| Pressed {
        key,
        code,
        held,
        repeat,
        down,
    };

    if !down {
        return match vk {
            0x11 => Some(pressed("Control", "ControlLeft")),
            0x10 => Some(pressed("Shift", "ShiftLeft")),
            0x12 => Some(pressed("Alt", "AltLeft")),
            _ => None,
        };
    }

    // F6, the address field's key no page has a use for: Chrome keeps it, and it is not a
    // character on any keyboard.
    if vk == 0x75 && !held.ctrl && !held.shift && !held.alt {
        return Some(pressed("F6", "F6"));
    }

    // F11, full screen, and Shift+F11, the tab filling Orden's window: F11 is Chrome's own,
    // the second is bound by no browser, and neither is a character, so a page loses
    // nothing a site relies on. A page whose video holds the screen is the exception, and
    // the caller asks about it; see `listen`.
    if vk == 0x7A && !held.ctrl && !held.alt {
        return Some(pressed("F11", "F11"));
    }

    // Alt and a digit, Orden's own way to the tabs by number, and Chrome's and Firefox's on
    // Linux. Alt alone is not a character on Windows - AltGr is Ctrl and Alt together,
    // which is the page's below - so the one thing a page loses is a digit `accesskey`,
    // as it does in those two.
    if held.alt && !held.ctrl && !held.shift {
        return digit(vk).map(|(key, code)| pressed(key, code));
    }

    // Chrome's reserved chords are all Ctrl and never Alt: Ctrl+Alt is AltGr on half
    // the keyboards in Europe, and a character typed with it is the page's.
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
        // Going round the strip and moving a tab along it, with Shift.
        (0x21, _) => Some(pressed("PageUp", "PageUp")),
        (0x22, _) => Some(pressed("PageDown", "PageDown")),
        (0x31..=0x39, false) => digit(vk).map(|(key, code)| pressed(key, code)),
        _ => None,
    }
}

/// A key the page keeps that the window is only told of: Alt going down on its own, and
/// any key going down while it is held, named for nothing but that. The window shows each
/// tab's number the moment Alt goes down and keeps them through such a key, as through
/// every key while Alt is held (see `lib/tab-strip/numbers.svelte.ts`); the page has
/// both keys, as it always did. `AltGr` is Ctrl and Alt on Windows and is never said, and
/// Alt with Shift is the system's switch between keyboards. Asked only of a key `meaning`
/// and `app_s` left to the page.
#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
pub fn told(vk: u32, held: Held, down: bool, repeat: bool) -> Option<Pressed> {
    if !down || repeat || held.ctrl {
        return None;
    }
    let pressed = |key, code| Pressed {
        key,
        code,
        held,
        repeat,
        down,
    };

    if vk == 0x12 {
        return (!held.shift).then(|| pressed("Alt", "AltLeft"));
    }
    held.alt.then(|| pressed("Unidentified", ""))
}

/// A digit on the top row, which a browser jumps between its tabs with: Ctrl+1 to
/// Ctrl+9, and here Alt+0 to Alt+9 as well.
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

/// A letter or a digit as `KeyboardEvent` names it, from its virtual key: the letter
/// in capitals with Shift.
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

    let letter = vk
        .checked_sub(0x41)
        .and_then(|at| usize::try_from(at).ok())
        .and_then(|at| LETTERS.get(at));
    match letter {
        Some(&(small, capital, code)) => Some((if shift { capital } else { small }, code)),
        None => digit(vk),
    }
}

/// A chord the app takes from a page while it is the app's: a letter or a digit on the
/// top row, by its virtual key, and what is held with it. See the top of this file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Chord {
    vk: u32,
    held: Held,
}

/// A chord as the window asks for it: `KeyboardEvent`'s `code` and its modifiers.
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
    /// The chord asked for, or `None` for one no page may lose: a key without Ctrl or
    /// Alt is typing, Ctrl with Alt is `AltGr`'s character, and a key that is no letter
    /// and no digit is none of the app's.
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
        Some(Self {
            vk,
            held: Held {
                ctrl: asked.ctrl,
                shift: asked.shift,
                alt: asked.alt,
            },
        })
    }
}

/// The chords the window has said are the app's now; see `web_keys_take`.
static TAKEN: std::sync::RwLock<Vec<Chord>> = std::sync::RwLock::new(Vec::new());

#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
fn app_chords() -> Vec<Chord> {
    TAKEN
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

/// One of the chords the window has said are the app's, pressed: the page never has it,
/// and the window is told it as itself. A key let go of is `meaning`'s.
#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
fn app_s(vk: u32, held: Held, down: bool, repeat: bool, taken: &[Chord]) -> Option<Pressed> {
    if !down || !taken.contains(&Chord { vk, held }) {
        return None;
    }
    let (key, code) = named(vk, held.shift)?;
    Some(Pressed {
        key,
        code,
        held,
        repeat,
        down,
    })
}

/// What a key pressed or let go of inside a page means, on an engine that hears every key
/// apart from its chords: every chord here is the browser's or the app's and comes by its
/// own way (the grab on Linux), so of the rest only what `told` says of a key going down
/// is said, and a modifier let go of. `page` is whether a page has the keyboard - the
/// app's own page hears its keys itself - asked only when the answer matters; `grabbing`
/// whether a chord holds the keyboard, whose release nothing else hears.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
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
        let said = if chord {
            None
        } else {
            told(vk, held, true, repeat)
        };
        return said.filter(|_| page());
    }
    let said = meaning(vk, held, false, repeat)?;
    (grabbing || page()).then_some(said)
}

/// The chords the app takes from a page from now on, in place of the ones before (see
/// the top of this file); said by the window whenever they change. Answers whether a
/// page says Alt held and let go of, which the window then hears in place of the
/// keyboard going into the page.
#[tauri::command(async)]
pub fn web_keys_take(app: tauri::AppHandle, chords: Vec<Asked>) -> bool {
    let chords: Vec<Chord> = chords.iter().filter_map(Chord::of).collect();
    *TAKEN
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = chords;
    tells_alt(&app)
}

/// `WebView2` says every key pressed with Alt and asks for the taken ones afresh at
/// each, so nothing is to be done but answer.
#[cfg(all(windows, not(feature = "cef")))]
fn tells_alt(_app: &tauri::AppHandle) -> bool {
    true
}

#[cfg(feature = "cef")]
fn tells_alt(app: &tauri::AppHandle) -> bool {
    grabbed::retake(app)
}

/// A Mac's engine says nothing of Alt, and has no chords to take.
#[cfg(not(any(windows, feature = "cef")))]
fn tells_alt(_app: &tauri::AppHandle) -> bool {
    false
}

/// Starts listening on one page. Called on the window's thread, once, as the page is
/// built; `window` is the label of the window it is in, which is also the label of
/// that window's own page.
#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a key pressed in a page is one of WebView2's own events, and its objects are reached through COM"
)]
pub fn listen(webview: &tauri::webview::PlatformWebview, app: tauri::AppHandle, window: String) {
    use tauri::{Emitter, Manager};
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    // Whether a modifier was down with the key. The event names the key and not the
    // hand around it, so it is asked two ways: as the input this thread shares with the
    // page's window had it when the key arrived, which is the answer that belongs to
    // this key, and as the keyboard has it now, for a page whose window keeps its input
    // to itself. Either says a hand is on it.
    let held = |key: VIRTUAL_KEY| {
        let code = i32::from(key.0);
        unsafe { GetKeyState(code) < 0 || GetAsyncKeyState(code) < 0 }
    };

    // Safe: the controller is the one this window owns, every object below is used only
    // on this thread, and the handler outlives the call because WebView2 holds it.
    unsafe {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else {
                return Ok(());
            };

            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            let mut vk = 0u32;
            let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
            args.KeyEventKind(&raw mut kind)?;
            args.VirtualKey(&raw mut vk)?;
            args.PhysicalKeyStatus(&raw mut status)?;

            let down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
            let now = Held {
                ctrl: held(VK_CONTROL),
                shift: held(VK_SHIFT),
                alt: held(VK_MENU),
            };
            let repeat = status.WasKeyDown.as_bool();
            // F11 while a video in the page holds the screen gives the screen back,
            // which the page's own handler does; see `web_page.rs`.
            if vk == 0x7A && sender.is_some_and(|one| crate::web_page::holds_screen(&one)) {
                return Ok(());
            }
            let pressed = meaning(vk, now, down, repeat)
                .or_else(|| app_s(vk, now, down, repeat, &app_chords()));
            let Some(pressed) = pressed else {
                // Alt held on its own, which the page keeps and the window is told of.
                if let Some(said) = told(vk, now, down, repeat) {
                    let _ = app.emit_to(window.as_str(), PRESSED, said);
                }
                return Ok(());
            };

            // A chord is the browser's: the page never hears it, and the keyboard goes
            // back to the app, where the rest of the gesture - T again, the arrows, the
            // release - is a key like any other; see `keeps_page` for the one that does
            // not. A release is only told: the page gets its own as well.
            if down {
                args.SetHandled(true)?;
                if !pressed.keeps_page() {
                    if let Some(ours) = app.get_webview(&window) {
                        crate::placement::keyboard_to(&ours);
                    }
                }
            }

            let _ = app.emit_to(window.as_str(), PRESSED, pressed);
            Ok(())
        }));

        let mut token = 0i64;
        let _ = webview
            .controller()
            .add_AcceleratorKeyPressed(&handler, &raw mut token);
    }
}

/// Reloading, which `WebView2` does itself for a page holding the keyboard and nothing
/// else does: F5, Ctrl+R, and with Shift or Ctrl+F5 the hard reload. Said to the window
/// as the key it was, where the bar answers it (`web.reload`, `web.fresh` in the
/// registry). Without it a page reloaded by the key once had the keyboard after it, and
/// every press after the first went into the page and did nothing (#344).
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn reloading(vk: u32, held: Held) -> Option<Pressed> {
    if held.alt {
        return None;
    }
    let pressed = |key, code| Pressed {
        key,
        code,
        held,
        repeat: false,
        down: true,
    };
    match (vk, held.ctrl, held.shift) {
        (0x74, _, false) => Some(pressed("F5", "F5")),
        (0x52, true, false) => Some(pressed("r", "KeyR")),
        (0x52, true, true) => Some(pressed("R", "KeyR")),
        _ => None,
    }
}

/// The virtual key Windows names a key by, from the one X11 names it by (its keysym), for
/// the keys `meaning` and `reloading` read: letters, digits, Tab, the page keys, F5, F6
/// and F11, and the three modifiers.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn vk_of(keyval: u32) -> Option<u32> {
    match keyval {
        0x61..=0x7A => Some(keyval - 0x20),
        0x41..=0x5A | 0x30..=0x39 => Some(keyval),
        // Tab, and Shift+Tab, which GDK names apart.
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

/// A Mac's engine: a page keeps every key, and the menu bar takes the browser's own
/// chords before the page is asked; see the top of this file.
#[cfg(not(any(windows, feature = "cef")))]
pub fn listen(_webview: &tauri::webview::PlatformWebview, _app: tauri::AppHandle, _window: String) {
}

/// Whether the X server's `FocusIn` on a page's browser window, by its mode and its
/// detail, is the page taking the keyboard (#1036; see keyboard.rs). Not one of the chords
/// below being grabbed or let go of, which moves nothing, and not the keyboard following
/// the pointer over the page while a window round it holds it: neither is a press into
/// the page or the page being handed it.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
fn page_took_focus(mode: u8, detail: u8) -> bool {
    // `NotifyGrab` and `NotifyUngrab`; `NotifyPointer`, `NotifyPointerRoot`, `NotifyDetailNone`.
    !matches!(mode, 1 | 2) && !matches!(detail, 5..=7)
}

/// CEF, on Linux: the chords taken from the page by the window system; see `grabbed`.
/// And, from the same connection to it, which page has the keyboard (keyboard.rs).
#[cfg(feature = "cef")]
pub use grabbed::{focus_in, listen, x11_window};

/// The browser's chords in a web tab's page on CEF, on Linux.
///
/// Chromium keeps Ctrl+T, Ctrl+W, Ctrl+Tab and the rest from a page before the page is
/// asked - they are its reserved accelerators - and the runtime then swallows the command
/// they stand for, since the Chrome window they belong to is not there. So pressed with
/// the keyboard in a web tab they reached nothing at all, and the runtime offers no event
/// for a key, as `WebView2` does.
///
/// Every CEF browser on Linux is an X11 window inside the app's own (under `XWayland` in
/// a Wayland session), and X11 lets a client take a key combination on a window before
/// whoever has the keyboard in it: a passive grab. So each web tab's browser window has
/// every chord `meaning` and `reloading` say is the browser's grabbed on it, from a
/// connection of this crate's own: pressed while the keyboard is in that page, the chord
/// comes here and never to the page - the same moment `WebView2`'s event is raised - the
/// keyboard goes back to the app's page, and the window is told the key, as on `WebView2`.
/// A modifier let go of while the grab lasts is told as well, which is the release that
/// chooses in Ctrl+Tab. The app's own page is a browser beside the tabs' and not inside
/// them, so its keys are never taken.
///
/// The chords the window says are the app's (`web_keys_take`) are grabbed the same way,
/// and grabbed afresh whenever it says new ones.
///
/// Nothing else is taken, and the page keeps every key that is not a chord, Alt alone
/// included. But the window is told Alt going down and let go of inside a page, as on
/// `WebView2`, so the tabs' numbers and the Essentials' letters stay up while Alt is held
/// there (#1053): X11's input extension says every key raw to a client that asks on the
/// root window, whoever has the keyboard and whatever holds it, and never takes a key from
/// anyone. Said only while a page has the keyboard - the app's own page hears its own -
/// and through `heard_raw`, which leaves every chord to its grab. A modifier let go of
/// while a grab holds the keyboard is said from there too, and no longer from the grab,
/// so it is said once. Where the extension is not there, the grab says those releases,
/// as it did, and nothing says Alt. F11 is taken even while a video in the page holds
/// the screen, which `WebView2` gives back; Escape leaves it there.
#[cfg(feature = "cef")]
mod grabbed {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock, PoisonError};

    use tauri::{AppHandle, Emitter, Manager};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xinput::{
        self, ConnectionExt as _, Device, KeyEventFlags, RawKeyPressEvent, XIEventMask,
    };
    use x11rb::protocol::xproto::{
        ChangeWindowAttributesAux, ConnectionExt as _, EventMask, Grab, GrabMode, Keycode, Keysym,
        ModMask, Window,
    };
    use x11rb::protocol::Event;
    use x11rb::rust_connection::RustConnection;

    use super::{
        app_chords, app_s, heard_raw, meaning, page_took_focus, reloading, vk_of, Chord, Held,
        Pressed, PRESSED,
    };

    /// The keys a chord is made with, as X11 names them: T, W, N and R, Tab, Page Up and
    /// Page Down, the digits on the top row, F5, F6 and F11.
    const KEYS: [Keysym; 20] = [
        0x74, 0x77, 0x6E, 0x72, 0xFF09, 0xFF55, 0xFF56, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36,
        0x37, 0x38, 0x39, 0xFFC2, 0xFFC3, 0xFFC8,
    ];

    /// The modifiers a grab must be made under as well as its own, since X11 matches a
    /// grab only with exactly its modifiers down: Caps Lock and Num Lock, either or both.
    const LOCKS: [u16; 4] = [0, 0x02, 0x10, 0x12];

    /// What a chord is held with, from X11's modifier mask: Shift, Control and Mod1 (Alt).
    fn held_by(state: u16) -> Held {
        Held {
            shift: state & 0x01 != 0,
            ctrl: state & 0x04 != 0,
            alt: state & 0x08 != 0,
        }
    }

    /// X11's modifier mask for `held`.
    fn mask_of(held: Held) -> u16 {
        u16::from(held.shift) | (u16::from(held.ctrl) << 2) | (u16::from(held.alt) << 3)
    }

    /// Every chord the page may not have, as a key and the modifiers held with it: what
    /// `meaning` and `reloading` say is the browser's, and what the window says is the
    /// app's (`taken`), and nothing else.
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
            // A letter's keysym is the small one, which is what the map's first column
            // has; a digit's is its own virtual key.
            let key = if (0x41..=0x5A).contains(&one.vk) {
                one.vk + 0x20
            } else {
                one.vk
            };
            let chord = (key, mask_of(one.held));
            if !every.contains(&chord) {
                every.push(chord);
            }
        }
        every
    }

    /// One connection to the X server for every grab, and the keyboard's map with it.
    struct Grabs {
        x: RustConnection,
        /// The screen's root window, where raw keys are asked for.
        root: Window,
        /// Whether the server says raw keys; see the top of this module.
        raw: bool,
        /// Each grabbed page's browser window, and the label of the app window it is in.
        pages: Mutex<HashMap<u32, String>>,
        /// Which keysym each keycode is without modifiers, from the server's own map.
        map: Mutex<Map>,
    }

    /// The server's keyboard map, as far as a grab needs it.
    #[derive(Default)]
    struct Map {
        first: Keycode,
        per: usize,
        syms: Vec<Keysym>,
    }

    impl Map {
        /// The first of a keycode's keysyms that is a key a chord is made with: on AZERTY
        /// the top row's digit is under Shift, after `&`, `é`, ...
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
        /// The server's keyboard map read again: at the start, and when it changes.
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
                *self.map.lock().unwrap_or_else(PoisonError::into_inner) = Map {
                    first,
                    per: usize::from(read.keysyms_per_keycode),
                    syms: read.keysyms,
                };
            }
        }

        /// Every chord grabbed on `page`'s browser window, in place of the ones before:
        /// the window's chords change, and so does the keyboard's map. A window that has
        /// gone already is an error the server sends back as an event, read and dropped
        /// below.
        fn grab(&self, page: u32) {
            let _ = self.x.ungrab_key(Grab::ANY, page, ModMask::ANY);
            let map = self.map.lock().unwrap_or_else(PoisonError::into_inner);
            for (sym, mask) in chords(&app_chords()) {
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

        /// Every grabbed page's browser window.
        fn pages(&self) -> Vec<u32> {
            self.pages
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .keys()
                .copied()
                .collect()
        }

        /// Which of `pages` - browser windows - has the keyboard, or holds the window that
        /// has it: the window with the input focus, and its parents up to the root.
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

        /// A key the server says raw: said to the window where `heard_raw` says so, the
        /// modifiers held read from the server as they are now. `grabbing` is the app
        /// window whose page a chord's grab holds the keyboard of, if one does.
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
            let sym = self
                .map
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .keysym(code);
            let Some(vk) = sym.and_then(vk_of) else {
                return;
            };
            let Some(state) = self
                .x
                .query_pointer(self.root)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
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
                &app_chords(),
                grabbing.is_some(),
                || {
                    let page = self.focused(&self.pages()).and_then(|page| {
                        self.pages
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .get(&page)
                            .cloned()
                    });
                    let found = page.is_some();
                    holder = holder.take().or(page);
                    found
                },
            );
            if let (Some(said), Some(holder)) = (said, holder) {
                // Only told: the page has the key as well, and keeps the keyboard.
                let _ = app.emit_to(holder.as_str(), PRESSED, said);
            }
        }

        /// What the server says, for as long as it says anything: a chord pressed in a
        /// page, a key raw, a modifier let go of while the chord holds the keyboard, and
        /// a new map.
        fn hear(&self, app: &AppHandle) {
            // The key whose grab holds the keyboard, and the window of the page it holds.
            let mut grabbing: Option<(Keycode, String)> = None;
            while let Ok(event) = self.x.wait_for_event() {
                let (window, code, state, down) = match event {
                    Event::XinputRawKeyPress(key) => {
                        self.heard(app, &key, true, grabbing.as_ref().map(|one| one.1.as_str()));
                        continue;
                    }
                    Event::XinputRawKeyRelease(key) => {
                        self.heard(
                            app,
                            &key,
                            false,
                            grabbing.as_ref().map(|one| one.1.as_str()),
                        );
                        continue;
                    }
                    // A page's browser window took the keyboard: the app's own page lets
                    // go of it, whether or not CEF tells it; see keyboard.rs.
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
                let holder = self
                    .pages
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .get(&window)
                    .cloned();
                let sym = self
                    .map
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .keysym(code);
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
                        .or_else(|| app_s(vk, held, true, false, &app_chords()))
                } else if self.raw {
                    // Said raw, above.
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

    /// The window told the key, and the keyboard handed back to its own page for a chord
    /// about the browser; on the app's own thread, where a webview is given the keyboard.
    fn told(app: &AppHandle, window: String, said: Pressed) {
        let telling = app.clone();
        let _ = app.run_on_main_thread(move || {
            if said.down && !said.keeps_page() {
                if let Some(ours) = telling.get_webview(&window) {
                    crate::placement::keyboard_to(&ours);
                }
            }
            let _ = telling.emit_to(window.as_str(), PRESSED, said);
        });
    }

    /// The connection, made the first time a page asks: `None` where there is no X server
    /// to reach, and then no page has its chords taken.
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

    /// Every key asked for raw, on the root window: true where the server has the input
    /// extension at 2.2 or later and took the asking.
    fn raw_keys(x: &RustConnection, root: Window) -> bool {
        let version = x
            .xinput_xi_query_version(2, 2)
            .ok()
            .and_then(|cookie| cookie.reply().ok());
        if version.is_none_or(|one| (one.major_version, one.minor_version) < (2, 2)) {
            return false;
        }
        let keys = xinput::EventMask {
            deviceid: Device::ALL_MASTER.into(),
            mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
        };
        x.xinput_xi_select_events(root, &[keys])
            .is_ok_and(|cookie| cookie.check().is_ok())
    }

    /// The window's chords taken afresh on every page; see `web_keys_take`. Answers
    /// whether a page says Alt held and let go of.
    pub(super) fn retake(app: &AppHandle) -> bool {
        let Some(grabs) = grabs(app) else {
            return false;
        };
        for page in grabs.pages() {
            grabs.grab(page);
        }
        grabs.raw
    }

    /// A page's browser window, as the X server knows it; `None` before CEF has made it.
    pub fn x11_window(webview: &tauri::webview::PlatformWebview) -> Option<u32> {
        use cef::{ImplBrowser as _, ImplBrowserHost as _};

        webview
            .downcast_ref::<tauri_runtime_cef::Webview>()
            .and_then(|view| view.browser().host())
            .map(|host| host.window_handle())
            .and_then(|handle| u32::try_from(handle).ok())
            .filter(|handle| *handle != 0)
    }

    /// Which of `pages` - browser windows - has the keyboard, or holds the window that has
    /// it, as the X server says: the window with the input focus, and its parents up to the
    /// root. `None` where no X server was reached.
    pub fn focus_in(pages: &[u32]) -> Option<u32> {
        GRABS.get()?.as_ref()?.focused(pages)
    }

    /// Starts taking the browser's chords on one page. Called on the window's thread,
    /// once, as the page is built; `window` is the label of the window it is in, which is
    /// also the label of that window's own page.
    pub fn listen(webview: &tauri::webview::PlatformWebview, app: AppHandle, window: String) {
        let Some(page) = x11_window(webview) else {
            return;
        };
        let Some(grabs) = grabs(&app) else { return };
        grabs
            .pages
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(page, window);
        // And told as the page takes the keyboard, on this connection's own mask, which
        // leaves CEF's on the same window as it is.
        let focus = ChangeWindowAttributesAux::new().event_mask(EventMask::FOCUS_CHANGE);
        let _ = grabs.x.change_window_attributes(page, &focus);
        grabs.grab(page);
    }

    #[cfg(test)]
    mod tests {
        use super::{chords, Map};
        use crate::web_keys::{Asked, Chord};

        /// The window's chords are grabbed with the browser's, a letter by its small
        /// keysym under Mod1, and each only once.
        #[test]
        fn the_app_s_chords_are_grabbed_with_the_browser_s() {
            let asked = |code: &str| {
                Chord::of(&Asked {
                    code: code.into(),
                    ctrl: false,
                    shift: false,
                    alt: true,
                })
                .expect("a chord")
            };
            let before = chords(&[]);
            assert!(!before.contains(&(0x65, 0x08)));
            let with = chords(&[asked("KeyE"), asked("Digit1")]);
            assert!(with.contains(&(0x65, 0x08)));
            // Alt and 1 is the browser's already, and grabbed once.
            assert_eq!(with.iter().filter(|one| **one == (0x31, 0x08)).count(), 1);
            assert_eq!(with.len(), before.len() + 1);
        }

        /// AZERTY's top row is `&`, `é`, ... with the digits under Shift, as the server's
        /// map has it: two keysyms a keycode, from keycode 10 on.
        #[test]
        fn a_digit_under_shift_is_still_the_key_s() {
            let map = Map {
                first: 10,
                per: 2,
                syms: vec![0x26, 0x31, 0xE9, 0x32, 0x61, 0x41],
            };
            assert_eq!(map.keycodes(0x31), vec![10]);
            assert_eq!(map.keysym(10), Some(0x31));
            assert_eq!(map.keycodes(0x61), vec![12]);
            assert_eq!(map.keysym(12), Some(0x61));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{app_s, heard_raw, meaning, page_took_focus, told, Asked, Chord, Held};

    const ALT: Held = Held {
        ctrl: false,
        shift: false,
        alt: true,
    };

    fn asked(code: &str, ctrl: bool, shift: bool, alt: bool) -> Option<Chord> {
        Chord::of(&Asked {
            code: code.into(),
            ctrl,
            shift,
            alt,
        })
    }

    /// #1051, #1053: an Essential's letter, asked for by the window, is taken from the
    /// page and said as itself; every other letter with Alt is still the page's.
    #[test]
    fn a_chord_the_window_asks_for_is_taken_and_said_as_itself() {
        let taken = [asked("KeyE", false, false, true).expect("Alt and E")];
        let said = app_s(0x45, ALT, true, false, &taken).expect("taken");
        assert_eq!((said.key, said.code), ("e", "KeyE"));
        assert!(said.held.alt && said.down && !said.keeps_page());
        // Held, it repeats as itself.
        assert!(app_s(0x45, ALT, true, true, &taken).is_some_and(|one| one.repeat));
        // Another letter, the same letter with Shift or Ctrl too, and its release are not.
        assert_eq!(app_s(0x46, ALT, true, false, &taken), None);
        assert_eq!(
            app_s(0x45, Held { shift: true, ..ALT }, true, false, &taken),
            None
        );
        assert_eq!(
            app_s(0x45, Held { ctrl: true, ..ALT }, true, false, &taken),
            None
        );
        assert_eq!(app_s(0x45, ALT, false, false, &taken), None);
        // Nothing is taken that was not asked for.
        assert_eq!(app_s(0x45, ALT, true, false, &[]), None);
    }

    #[test]
    fn a_page_keeps_typing_and_altgr_whatever_the_window_asks() {
        // A letter alone, with Shift alone, and AltGr (Ctrl and Alt) are never taken.
        assert_eq!(asked("KeyE", false, false, false), None);
        assert_eq!(asked("KeyE", false, true, false), None);
        assert_eq!(asked("KeyE", true, false, true), None);
        // Nor a key that is no letter and no digit.
        assert_eq!(asked("ArrowLeft", false, false, true), None);
        assert_eq!(asked("Keye", false, false, true), None);
        assert_eq!(asked("KeyAB", false, false, true), None);
        assert_eq!(asked("Digit10", false, false, true), None);
        // A digit and a letter with Ctrl are, by their virtual keys.
        let digit = asked("Digit7", false, false, true).expect("Alt and 7");
        assert!(app_s(0x37, ALT, true, false, &[digit]).is_some_and(|one| one.key == "7"));
        let ctrl = asked("KeyJ", true, true, false).expect("Ctrl, Shift and J");
        let held = Held {
            ctrl: true,
            shift: true,
            alt: false,
        };
        assert!(app_s(0x4A, held, true, false, &[ctrl]).is_some_and(|one| one.key == "J"));
    }

    /// #1053 on Linux: what the X server's raw keys say of a key in a page. Alt and its
    /// release, and a key while it is held; never a chord, which its grab says.
    #[test]
    fn a_raw_key_says_alt_in_a_page_and_leaves_every_chord_to_its_grab() {
        let taken = [asked("KeyE", false, false, true).expect("Alt and E")];
        let raw = |vk, held, down, grabbing, page: bool| {
            heard_raw(vk, held, down, false, &taken, grabbing, || page)
                .map(|one| (one.key, one.down))
        };

        // Alt going down and let go of in a page.
        assert_eq!(raw(0x12, ALT, true, false, true), Some(("Alt", true)));
        assert_eq!(
            raw(0x12, Held::default(), false, false, true),
            Some(("Alt", false))
        );
        // A key while it is held, named for nothing.
        assert_eq!(
            raw(0x44, ALT, true, false, true),
            Some(("Unidentified", true))
        );
        // In the app's own page, which hears its own keys, nothing.
        assert_eq!(raw(0x12, ALT, true, false, false), None);
        assert_eq!(raw(0x12, Held::default(), false, false, false), None);
        // A chord is its grab's: Alt and a digit, Ctrl and T, F5, an Essential's letter.
        assert_eq!(raw(0x31, ALT, true, false, true), None);
        let ctrl = Held {
            ctrl: true,
            ..Held::default()
        };
        assert_eq!(raw(0x54, ctrl, true, false, true), None);
        assert_eq!(raw(0x74, Held::default(), true, false, true), None);
        assert_eq!(raw(0x45, ALT, true, false, true), None);
        // A modifier let go of while a grab holds the keyboard is said wherever the
        // keyboard is now: the release that chooses in Ctrl+Tab.
        assert_eq!(
            raw(0x11, Held::default(), false, true, false),
            Some(("Control", false))
        );
        // Any other key let go of is nothing.
        assert_eq!(raw(0x45, Held::default(), false, true, true), None);
        // Shift with Alt, a repeat and AltGr are never a hold.
        let shift = Held { shift: true, ..ALT };
        assert_eq!(raw(0x12, shift, true, false, true), None);
        assert_eq!(
            heard_raw(0x12, ALT, true, true, &taken, false, || true),
            None
        );
        assert_eq!(
            raw(0x12, Held { ctrl: true, ..ALT }, true, false, true),
            None
        );
    }

    /// The page is asked about only when the answer matters: it is a round trip to the
    /// X server for every key.
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
        // A plain letter typed, and a chord, are not asked about.
        assert!(!asked(0x45, Held::default(), true, false));
        assert!(!asked(0x31, ALT, true, false));
        // A release under a grab is said without asking.
        assert!(!asked(0x11, Held::default(), false, true));
        assert!(asked(0x12, ALT, true, false));
        assert!(asked(0x12, Held::default(), false, false));
    }

    /// Every engine that hears a page's keys takes the window's chords, by the one rule.
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
        assert!(webview2.contains("app_s(vk, now, down, repeat, &app_chords())"));
        let cef = body("mod grabbed {");
        assert!(cef.contains("app_s(vk, held, true, false, &app_chords())"));
        assert!(cef.contains("chords(&app_chords())"));
        assert!(cef.contains("heard_raw("));
        assert!(include_str!("lib.rs").contains("web_keys::web_keys_take,"));
    }

    /// #1036: a press into the page, or the page handed the keyboard, is told to the app's
    /// own page; a chord's grab and the pointer merely crossing the page are not.
    #[test]
    fn a_page_takes_the_keyboard_on_a_real_focus_in_only() {
        // NotifyNormal and NotifyWhileGrabbed, with the focus on the page's window, inside
        // it, or coming to it from inside.
        for mode in [0, 3] {
            for detail in 0..=4 {
                assert!(
                    page_took_focus(mode, detail),
                    "mode {mode}, detail {detail}"
                );
            }
        }
        // NotifyGrab and NotifyUngrab: a chord taken from the page and given back.
        assert!(!page_took_focus(1, 3));
        assert!(!page_took_focus(2, 3));
        // NotifyPointer, NotifyPointerRoot and NotifyDetailNone.
        for detail in 5..=7 {
            assert!(!page_took_focus(0, detail));
        }
    }

    const CTRL: Held = Held {
        ctrl: true,
        shift: false,
        alt: false,
    };

    fn down(vk: u32, shift: bool) -> Option<(&'static str, &'static str)> {
        meaning(vk, Held { shift, ..CTRL }, true, false).map(|one| (one.key, one.code))
    }

    #[test]
    fn a_new_tab_and_the_last_one_closed_are_the_browser_s() {
        assert_eq!(down(0x54, false), Some(("t", "KeyT")));
        assert_eq!(down(0x54, true), Some(("T", "KeyT")));
    }

    #[test]
    fn so_are_closing_going_round_and_a_new_window() {
        assert_eq!(down(0x57, false), Some(("w", "KeyW")));
        assert_eq!(down(0x09, false), Some(("Tab", "Tab")));
        assert_eq!(down(0x09, true), Some(("Tab", "Tab")));
        assert_eq!(down(0x4E, true), Some(("N", "KeyN")));
        assert_eq!(down(0x22, false), Some(("PageDown", "PageDown")));
        assert_eq!(down(0x21, true), Some(("PageUp", "PageUp")));
    }

    #[test]
    fn and_the_nine_tabs_by_number() {
        assert_eq!(down(0x31, false), Some(("1", "Digit1")));
        assert_eq!(down(0x39, false), Some(("9", "Digit9")));
        // Shift turns a digit into a character on most layouts, and that is the page's.
        assert_eq!(down(0x31, true), None);
        assert_eq!(down(0x30, false), None);
    }

    #[test]
    fn and_f6_to_the_address_field() {
        let alone = |vk, held| meaning(vk, held, true, false).map(|one| one.key);
        assert_eq!(alone(0x75, Held::default()), Some("F6"));

        // Shift+F6 and Ctrl+F6 are the page's.
        let shift = Held {
            shift: true,
            ..Held::default()
        };
        assert_eq!(alone(0x75, shift), None);
        assert_eq!(alone(0x75, CTRL), None);
    }

    #[test]
    fn finding_and_the_address_field_s_other_keys_are_the_page_s_first() {
        // Ctrl+F, Ctrl+G and Ctrl+Shift+G, F3 either way, Ctrl+L and Alt+D: a site's own
        // answer has them before nib's does; see web_opens.rs.
        for (vk, shift) in [
            (0x46, false),
            (0x47, false),
            (0x47, true),
            (0x46, true),
            (0x4C, false),
        ] {
            assert_eq!(down(vk, shift), None, "{vk:#x}");
        }
        for shift in [false, true] {
            let bare = Held {
                shift,
                ..Held::default()
            };
            assert_eq!(meaning(0x72, bare, true, false), None);
        }
        let alt = Held {
            alt: true,
            ..Held::default()
        };
        assert_eq!(meaning(0x44, alt, true, false), None);
    }

    #[test]
    fn ctrl_d_is_the_page_s_first_as_in_chrome() {
        // Chrome reserves only the tab and window chords, so Sheets fills down, Figma
        // duplicates and vscode.dev selects the next one on Ctrl+D. Orden's Deselect tab
        // comes after the page, by way of web_opens.rs.
        assert_eq!(down(0x44, false), None);
        assert_eq!(down(0x44, true), None);
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
    fn ctrl_shift_space_is_the_page_s_first() {
        // The space switcher, asked for by web_opens.rs once the page let it go by.
        assert_eq!(down(0x20, true), None);
        assert_eq!(down(0x20, false), None);
    }

    #[test]
    fn reloading_is_f5_and_ctrl_r_with_shift_for_the_hard_one() {
        use super::reloading;
        let key = |vk, held| reloading(vk, held).map(|one| (one.key, one.code, one.held.shift));
        assert_eq!(key(0x74, Held::default()), Some(("F5", "F5", false)));
        assert_eq!(key(0x52, CTRL), Some(("r", "KeyR", false)));
        let shifted = Held {
            shift: true,
            ..CTRL
        };
        assert_eq!(key(0x52, shifted), Some(("R", "KeyR", true)));
        // Ctrl+F5, the hard reload's second key, comes as F5 with Ctrl held.
        assert_eq!(key(0x74, CTRL).map(|one| one.0), Some("F5"));
        // R alone is typing, and AltGr+R is a character.
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
        // Ctrl+L, Ctrl+K, Ctrl+F, Ctrl+P, Ctrl+R: a site's own shortcuts, and the reason
        // there is a rule. F5 and Ctrl+R reach the engine's own reload.
        for vk in [0x4C, 0x4B, 0x46, 0x50, 0x52] {
            assert_eq!(down(vk, false), None, "{vk:#x}");
        }
        assert_eq!(meaning(0x74, Held::default(), true, false), None);
        // A letter with no Ctrl is typing.
        assert_eq!(meaning(0x54, Held::default(), true, false), None);
    }

    #[test]
    fn alt_held_on_its_own_is_told_and_left_to_the_page() {
        let alt = Held {
            alt: true,
            ..Held::default()
        };
        let said = |vk, held, repeat| told(vk, held, true, repeat).map(|one| one.key);

        // Alt going down, whether or not the engine has it as held yet.
        assert_eq!(said(0x12, Held::default(), false), Some("Alt"));
        assert_eq!(said(0x12, alt, false), Some("Alt"));
        // Held, it repeats, and a repeat is the same hold.
        assert_eq!(said(0x12, alt, true), None);
        // Any other key while it is held puts the numbers away, named for nothing.
        assert_eq!(said(0x25, alt, false), Some("Unidentified"));
        assert_eq!(said(0x44, alt, false), Some("Unidentified"));
        // Nor is a key without Alt said at all.
        assert_eq!(said(0x44, Held::default(), false), None);
        // And none of it is taken from the page: `meaning` leaves these alone.
        assert_eq!(meaning(0x12, alt, true, false), None);
        // Let go of, Alt is `meaning`'s release as it always was.
        assert_eq!(told(0x12, alt, false, false), None);
    }

    #[test]
    fn altgr_and_alt_with_shift_are_never_a_hold() {
        // AltGr is Ctrl and Alt on Windows: a Swiss `@` and a German `{`.
        assert_eq!(told(0x12, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(told(0x32, Held { alt: true, ..CTRL }, true, false), None);
        // Alt with Shift is the switch between keyboards.
        let shift = Held {
            shift: true,
            ..Held::default()
        };
        assert_eq!(told(0x12, shift, true, false), None);
        // Shift pressed while Alt is held ends the hold like any other key.
        let held = Held {
            alt: true,
            shift: true,
            ..Held::default()
        };
        assert_eq!(
            told(0x10, held, true, false).map(|one| one.key),
            Some("Unidentified")
        );
    }

    #[test]
    fn a_chord_with_alt_is_a_character_on_altgr_keyboards() {
        assert_eq!(meaning(0x54, Held { alt: true, ..CTRL }, true, false), None);
        // AltGr and a digit too: a Swiss `@`, a German `{`.
        assert_eq!(meaning(0x32, Held { alt: true, ..CTRL }, true, false), None);
        assert_eq!(meaning(0x37, Held { alt: true, ..CTRL }, true, false), None);
    }

    #[test]
    fn alt_and_a_digit_are_the_tabs_by_number_nought_included() {
        let alt = |shift| Held {
            ctrl: false,
            shift,
            alt: true,
        };
        let pressed = |vk, held| meaning(vk, held, true, false).map(|one| (one.key, one.code));

        assert_eq!(pressed(0x31, alt(false)), Some(("1", "Digit1")));
        assert_eq!(pressed(0x33, alt(false)), Some(("3", "Digit3")));
        assert_eq!(pressed(0x39, alt(false)), Some(("9", "Digit9")));
        assert_eq!(pressed(0x30, alt(false)), Some(("0", "Digit0")));
        // Said with the Alt it was pressed with, so the window reads Alt and the digit.
        assert!(meaning(0x30, alt(false), true, false).is_some_and(|one| one.held.alt));

        // With Shift it is a character on some layout, and the page's.
        assert_eq!(pressed(0x31, alt(true)), None);
        // A letter with Alt is the page's: Alt+D asks the page first; see web_opens.rs.
        assert_eq!(pressed(0x44, alt(false)), None);
        // And the digits on the number pad are numbers, not places.
        assert_eq!(pressed(0x61, alt(false)), None);
        // Ctrl and the nought is still the page's zoom.
        assert_eq!(down(0x30, false), None);
    }

    #[test]
    fn f11_and_shift_f11_are_the_window_s_and_leave_the_page_its_keyboard() {
        let shift = Held {
            shift: true,
            ..Held::default()
        };
        let filled = meaning(0x7A, shift, true, false);
        let named = filled.as_ref().map(|one| (one.key, one.code));
        assert_eq!(named, Some(("F11", "F11")));
        // Said with its Shift, so the window reads Shift+F11 rather than full screen.
        assert!(filled.as_ref().is_some_and(|one| one.held.shift));
        assert!(filled.is_some_and(|one| one.keeps_page()));

        // F11 alone is full screen, Chrome's own; said without Shift, it is read as that.
        let full = meaning(0x7A, Held::default(), true, false);
        assert!(full
            .as_ref()
            .is_some_and(|one| one.code == "F11" && !one.held.shift && one.keeps_page()));
        // With Ctrl or Alt it is the page's.
        let with = |ctrl, alt| Held {
            ctrl,
            shift: true,
            alt,
        };
        assert_eq!(meaning(0x7A, with(true, false), true, false), None);
        assert_eq!(meaning(0x7A, with(false, true), true, false), None);

        // Every other chord hands the keyboard back to the app.
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

    #[test]
    fn a_key_held_down_says_so() {
        let again = meaning(0x54, CTRL, true, true);
        assert!(again.is_some_and(|one| one.repeat && one.down));
    }
}
