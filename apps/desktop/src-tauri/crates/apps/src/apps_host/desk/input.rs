use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetDoubleClickTime, GetKeyboardState, MapVirtualKeyW, SetKeyboardState, VkKeyScanW,
    MAPVK_VK_TO_VSC,
};
use windows::Win32::UI::WindowsAndMessaging::{
    ChildWindowFromPointEx, GetAncestor, GetClassLongW, GetGUIThreadInfo, GetWindowThreadProcessId,
    PostMessageW, CS_DBLCLKS, CWP_SKIPINVISIBLE, CWP_SKIPTRANSPARENT, GA_ROOT, GCL_STYLE,
    GUITHREADINFO, WM_CHAR, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MBUTTONDBLCLK, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL,
    WM_RBUTTONDBLCLK, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDBLCLK,
    WM_XBUTTONDOWN, WM_XBUTTONUP,
};

pub use super::super::events::InputEvent;
use super::{place_of, shown};

const MK_LBUTTON: u32 = 0x0001;
const MK_RBUTTON: u32 = 0x0002;
const MK_SHIFT: u32 = 0x0004;
const MK_CONTROL: u32 = 0x0008;
const MK_MBUTTON: u32 = 0x0010;
const MK_XBUTTON1: u32 = 0x0020;
const MK_XBUTTON2: u32 = 0x0040;
const WHEEL_DELTA: i32 = 120;
const DOUBLE_NEAR: i32 = 4;
const MOST_TEXT: usize = 1000;

const VK_SHIFT: u8 = 0x10;
const VK_CONTROL: u8 = 0x11;
const VK_MENU: u8 = 0x12;
const VK_LWIN: u8 = 0x5B;

pub struct Input {
    tell: Sender<InputEvent>,
}

impl Input {
    pub fn open(display: &str) -> Result<Input, String> {
        let desk = super::desk(display).ok_or("no such desktop")?;
        let (tell, heard) = mpsc::channel::<InputEvent>();
        std::thread::spawn(move || {
            if desk.enter().is_err() {
                return;
            }
            let mut player = Player::default();
            while let Ok(event) = heard.recv() {
                if desk.ended() {
                    break;
                }
                player.play(event);
            }
            player.let_go();
        });
        Ok(Input { tell })
    }

    pub fn play(&mut self, event: InputEvent) {
        let _ = self.tell.send(event);
    }
}

pub fn virtual_key(key: &str) -> Option<(u8, bool)> {
    let named = match key {
        "Enter" => (0x0D, false),
        "Backspace" => (0x08, false),
        "Tab" => (0x09, false),
        "Escape" => (0x1B, false),
        "Delete" => (0x2E, true),
        "Insert" => (0x2D, true),
        "Home" => (0x24, true),
        "End" => (0x23, true),
        "PageUp" => (0x21, true),
        "PageDown" => (0x22, true),
        "ArrowLeft" => (0x25, true),
        "ArrowUp" => (0x26, true),
        "ArrowRight" => (0x27, true),
        "ArrowDown" => (0x28, true),
        "Shift" => (VK_SHIFT, false),
        "Control" => (VK_CONTROL, false),
        "Alt" => (VK_MENU, false),
        "Meta" | "OS" => (VK_LWIN, true),
        "CapsLock" => (0x14, false),
        "NumLock" => (0x90, true),
        "ScrollLock" => (0x91, false),
        "Pause" => (0x13, false),
        "PrintScreen" => (0x2C, true),
        "ContextMenu" => (0x5D, true),
        " " => (0x20, false),
        _ => {
            let number: u8 = key.strip_prefix('F')?.parse().ok()?;
            return (1..=24).contains(&number).then_some((0x6F + number, false));
        }
    };
    Some(named)
}

pub fn key_lparam(scan: u32, extended: bool, down: bool) -> isize {
    let mut bits: u32 = 1 | ((scan & 0xff) << 16);
    if extended {
        bits |= 1 << 24;
    }
    if !down {
        bits |= (1 << 30) | (1 << 31);
    }
    isize::try_from(i32::from_ne_bytes(bits.to_ne_bytes())).unwrap_or(0)
}

pub fn point_lparam(x: i32, y: i32) -> isize {
    let low = u32::from(u16::from_ne_bytes(
        i16::try_from(x).unwrap_or(0).to_ne_bytes(),
    ));
    let high = u32::from(u16::from_ne_bytes(
        i16::try_from(y).unwrap_or(0).to_ne_bytes(),
    ));
    isize::try_from(i32::from_ne_bytes((low | (high << 16)).to_ne_bytes())).unwrap_or(0)
}

pub fn wheel_wparam(delta: i32, buttons: u32) -> usize {
    let turn = u32::from(u16::from_ne_bytes(
        i16::try_from(delta.clamp(-32768, 32767))
            .unwrap_or(0)
            .to_ne_bytes(),
    ));
    usize::try_from((turn << 16) | (buttons & 0xffff)).unwrap_or(0)
}

fn button_messages(button: u8) -> Option<(u32, u32, u32, u32, u32)> {
    Some(match button {
        0 => (
            WM_LBUTTONDOWN,
            WM_LBUTTONUP,
            WM_LBUTTONDBLCLK,
            MK_LBUTTON,
            0,
        ),
        1 => (
            WM_MBUTTONDOWN,
            WM_MBUTTONUP,
            WM_MBUTTONDBLCLK,
            MK_MBUTTON,
            0,
        ),
        2 => (
            WM_RBUTTONDOWN,
            WM_RBUTTONUP,
            WM_RBUTTONDBLCLK,
            MK_RBUTTON,
            0,
        ),
        3 => (
            WM_XBUTTONDOWN,
            WM_XBUTTONUP,
            WM_XBUTTONDBLCLK,
            MK_XBUTTON1,
            1,
        ),
        4 => (
            WM_XBUTTONDOWN,
            WM_XBUTTONUP,
            WM_XBUTTONDBLCLK,
            MK_XBUTTON2,
            2,
        ),
        _ => return None,
    })
}

#[derive(Default)]
struct Player {
    at: (i32, i32),
    buttons: u32,
    pressed: Option<isize>,
    last: Option<(Instant, u8, (i32, i32))>,
    front: Option<isize>,
    modifiers: HashMap<String, (u8, bool)>,
    keys: HashMap<String, (u8, bool, bool)>,
    attached: Option<u32>,
}

impl Player {
    #[allow(
        clippy::cast_possible_truncation,
        reason = "a point of a view of at most 16K pixels"
    )]
    fn play(&mut self, event: InputEvent) {
        match event {
            InputEvent::Move { x, y } => {
                if !(x.is_finite() && y.is_finite()) {
                    return;
                }
                self.at = (x.round() as i32, y.round() as i32);
                let target = self
                    .pressed
                    .map(|one| HWND(one as _))
                    .or_else(|| under(self.at));
                if let Some(window) = target {
                    let (cx, cy) = client(window, self.at);
                    post(
                        window,
                        WM_MOUSEMOVE,
                        self.mouse_keys() as usize,
                        point_lparam(cx, cy),
                    );
                }
            }
            InputEvent::Button { button, down } => self.button(button, down),
            InputEvent::Wheel { x, y } => {
                let Some(window) = under(self.at) else {
                    return;
                };
                let place = point_lparam(self.at.0, self.at.1);
                if y != 0 {
                    let wparam = wheel_wparam(-y * WHEEL_DELTA, self.mouse_keys());
                    post(window, WM_MOUSEWHEEL, wparam, place);
                }
                if x != 0 {
                    let wparam = wheel_wparam(x * WHEEL_DELTA, self.mouse_keys());
                    post(window, WM_MOUSEHWHEEL, wparam, place);
                }
            }
            InputEvent::Key { key, code, down } => self.key(&key, code, down),
            InputEvent::Text { text } => {
                if let Some(window) = self.keyboard() {
                    for unit in text
                        .chars()
                        .take(MOST_TEXT)
                        .collect::<String>()
                        .encode_utf16()
                    {
                        post(window, WM_CHAR, usize::from(unit), 1);
                    }
                }
            }
            InputEvent::Clipboard { .. } | InputEvent::Share { .. } | InputEvent::Ping { .. } => {}
        }
    }

    fn mouse_keys(&self) -> u32 {
        let mut bits = self.buttons;
        if self.held(VK_SHIFT) {
            bits |= MK_SHIFT;
        }
        if self.held(VK_CONTROL) {
            bits |= MK_CONTROL;
        }
        bits
    }

    fn held(&self, key: u8) -> bool {
        self.modifiers.values().any(|&(one, _)| one == key)
    }

    fn button(&mut self, button: u8, down: bool) {
        let Some((press, release, double, bit, x)) = button_messages(button) else {
            return;
        };
        let target = if down {
            under(self.at)
        } else {
            self.pressed
                .map(|one| HWND(one as _))
                .or_else(|| under(self.at))
        };
        let Some(window) = target else {
            return;
        };
        let (cx, cy) = client(window, self.at);
        let message = if down {
            self.buttons |= bit;
            self.pressed = Some(window.0 as isize);
            self.front = Some(root(window).0 as isize);
            let now = Instant::now();
            let near = self.last.is_some_and(|(at, which, (px, py))| {
                which == button
                    && now.duration_since(at) <= double_click_time()
                    && (px - self.at.0).abs() <= DOUBLE_NEAR
                    && (py - self.at.1).abs() <= DOUBLE_NEAR
            });
            if near && wants_double_clicks(window) {
                self.last = None;
                double
            } else {
                self.last = Some((now, button, self.at));
                press
            }
        } else {
            self.buttons &= !bit;
            if self.buttons == 0 {
                self.pressed = None;
            }
            release
        };
        let wparam = (self.mouse_keys() as usize) | (usize::try_from(x).unwrap_or(0) << 16);
        post(window, message, wparam, point_lparam(cx, cy));
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "the key's name is kept by what it was"
    )]
    fn key(&mut self, key: &str, code: String, down: bool) {
        if matches!(key, "Shift" | "Control" | "Alt" | "Meta" | "OS") {
            let Some((vk, extended)) = virtual_key(key) else {
                return;
            };
            if down {
                self.modifiers.insert(code.clone(), (vk, extended));
            } else {
                self.modifiers.remove(&code);
            }
            self.set_state();
            self.press(vk, extended, down);
            return;
        }
        let chord = self.held(VK_CONTROL) || self.held(VK_MENU) || self.held(VK_LWIN);
        if !down {
            if let Some((vk, extended, pressed)) = self.keys.remove(&code) {
                if pressed {
                    self.press(vk, extended, false);
                }
            }
            return;
        }
        let mut chars = key.chars();
        let single = match (chars.next(), chars.next()) {
            (Some(one), None) if key != " " || chord => Some(one),
            _ => None,
        };
        if let Some(character) = single.filter(|_| !chord) {
            if let Some(window) = self.keyboard() {
                let mut units = [0_u16; 2];
                for unit in character.encode_utf16(&mut units) {
                    post(window, WM_CHAR, usize::from(*unit), 1);
                }
            }
            self.keys.insert(code, (0, false, false));
            return;
        }
        let pressed = single
            .and_then(key_of_character)
            .map(|vk| (vk, false))
            .or_else(|| virtual_key(key));
        if let Some((vk, extended)) = pressed {
            self.set_state();
            self.press(vk, extended, true);
            self.keys.insert(code, (vk, extended, true));
        }
    }

    fn press(&mut self, vk: u8, extended: bool, down: bool) {
        let Some(window) = self.keyboard() else {
            return;
        };
        let system = self.held(VK_MENU) && !self.held(VK_CONTROL);
        let message = match (down, system) {
            (true, true) => WM_SYSKEYDOWN,
            (true, false) => WM_KEYDOWN,
            (false, true) => WM_SYSKEYUP,
            (false, false) => WM_KEYUP,
        };
        post(
            window,
            message,
            usize::from(vk),
            key_lparam(scan_of(vk), extended, down),
        );
    }

    #[allow(unsafe_code, reason = "a thread's keyboard is asked of Win32")]
    fn keyboard(&mut self) -> Option<HWND> {
        let front = self
            .front
            .map(|one| HWND(one as _))
            .or_else(|| shown().into_iter().next())?;
        let thread = unsafe { GetWindowThreadProcessId(front, None) };
        let mut info = GUITHREADINFO {
            cbSize: u32::try_from(std::mem::size_of::<GUITHREADINFO>()).unwrap_or(0),
            ..Default::default()
        };
        let focused = unsafe { GetGUIThreadInfo(thread, &raw mut info) }
            .ok()
            .map(|()| info.hwndFocus)
            .filter(|one| !one.is_invalid());
        Some(focused.unwrap_or(front))
    }

    #[allow(
        unsafe_code,
        reason = "a thread's keyboard state is shared and set with Win32 calls"
    )]
    fn set_state(&mut self) {
        let Some(window) = self.keyboard() else {
            return;
        };
        unsafe {
            let theirs = GetWindowThreadProcessId(window, None);
            let ours = GetCurrentThreadId();
            if self.attached != Some(theirs) {
                if let Some(was) = self.attached.take() {
                    let _ = AttachThreadInput(ours, was, false);
                }
                if AttachThreadInput(ours, theirs, true).as_bool() {
                    self.attached = Some(theirs);
                }
            }
            let mut state = [0_u8; 256];
            if GetKeyboardState(&mut state).is_err() {
                return;
            }
            for vk in [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN] {
                state[usize::from(vk)] = if self.held(vk) { 0x80 } else { 0 };
            }
            for (side, of) in [(0xA0, VK_SHIFT), (0xA2, VK_CONTROL), (0xA4, VK_MENU)] {
                state[side] = state[usize::from(of)];
            }
            let _ = SetKeyboardState(&state);
        }
    }

    #[allow(
        unsafe_code,
        reason = "a shared input state is let go with a Win32 call"
    )]
    fn let_go(&mut self) {
        let keys: Vec<(u8, bool, bool)> = self.keys.drain().map(|(_, one)| one).collect();
        for (vk, extended, pressed) in keys {
            if pressed {
                self.press(vk, extended, false);
            }
        }
        let modifiers: Vec<(u8, bool)> = self.modifiers.drain().map(|(_, one)| one).collect();
        for (vk, extended) in modifiers {
            self.press(vk, extended, false);
        }
        self.set_state();
        for button in 0..5 {
            if let Some((_, _, _, bit, _)) = button_messages(button) {
                if self.buttons & bit != 0 {
                    self.button(button, false);
                }
            }
        }
        if let Some(was) = self.attached.take() {
            let _ = unsafe { AttachThreadInput(GetCurrentThreadId(), was, false) };
        }
    }
}

#[allow(unsafe_code, reason = "the layout is asked with a Win32 call")]
fn key_of_character(character: char) -> Option<u8> {
    let mut units = [0_u16; 2];
    let encoded = character.encode_utf16(&mut units);
    if encoded.len() != 1 {
        return None;
    }
    let said = unsafe { VkKeyScanW(units[0]) };
    let [low, _] = said.to_le_bytes();
    (said != -1 && low != 0xff).then_some(low)
}

#[allow(unsafe_code, reason = "the layout is asked with a Win32 call")]
fn scan_of(vk: u8) -> u32 {
    unsafe { MapVirtualKeyW(u32::from(vk), MAPVK_VK_TO_VSC) }
}

#[allow(unsafe_code, reason = "a setting is asked of Win32")]
fn double_click_time() -> Duration {
    Duration::from_millis(u64::from(unsafe { GetDoubleClickTime() }))
}

#[allow(unsafe_code, reason = "a window's class is asked of Win32")]
fn wants_double_clicks(window: HWND) -> bool {
    let style = unsafe { GetClassLongW(window, GCL_STYLE) };
    style & CS_DBLCLKS.0 != 0
}

#[allow(unsafe_code, reason = "a window's ancestor is asked of Win32")]
fn root(window: HWND) -> HWND {
    let top = unsafe { GetAncestor(window, GA_ROOT) };
    if top.is_invalid() {
        window
    } else {
        top
    }
}

#[allow(unsafe_code, reason = "windows under a point are asked of Win32")]
fn under(at: (i32, i32)) -> Option<HWND> {
    let top = shown().into_iter().find(|&window| {
        place_of(window).is_some_and(|place| {
            at.0 >= place.left && at.0 < place.right && at.1 >= place.top && at.1 < place.bottom
        })
    })?;
    let mut window = top;
    for _ in 0..32 {
        let (x, y) = client(window, at);
        let child = unsafe {
            ChildWindowFromPointEx(
                window,
                POINT { x, y },
                CWP_SKIPINVISIBLE | CWP_SKIPTRANSPARENT,
            )
        };
        if child.is_invalid() || child == window {
            break;
        }
        window = child;
    }
    Some(window)
}

#[allow(unsafe_code, reason = "a point is mapped into a window by Win32")]
fn client(window: HWND, at: (i32, i32)) -> (i32, i32) {
    let mut point = POINT { x: at.0, y: at.1 };
    let _ = unsafe { ScreenToClient(window, &raw mut point) };
    (point.x, point.y)
}

#[allow(unsafe_code, reason = "a message is posted with a Win32 call")]
fn post(window: HWND, message: u32, wparam: usize, lparam: isize) {
    let _ = unsafe { PostMessageW(window, message, WPARAM(wparam), LPARAM(lparam)) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_virtual_keys() {
        assert_eq!(virtual_key("Enter"), Some((0x0D, false)));
        assert_eq!(virtual_key("ArrowLeft"), Some((0x25, true)));
        assert_eq!(virtual_key("F1"), Some((0x70, false)));
        assert_eq!(virtual_key("F24"), Some((0x87, false)));
        assert_eq!(virtual_key("F25"), None);
        assert_eq!(virtual_key("Dead"), None);
    }

    #[test]
    fn packs_the_messages_words() {
        assert_eq!(point_lparam(10, 20), 0x0014_000a);
        assert_eq!(point_lparam(-1, 2) & 0xffff, 0xffff);
        assert_eq!(wheel_wparam(-120, MK_LBUTTON), 0xff88_0001);
        assert_eq!(key_lparam(0x1c, false, true), 0x001c_0001);
        let released = i32::from_ne_bytes(0xc14b_0001_u32.to_ne_bytes());
        assert_eq!(
            key_lparam(0x4b, true, false),
            isize::try_from(released).unwrap()
        );
    }
}
