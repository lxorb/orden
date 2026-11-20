use std::cell::RefCell;
use std::sync::OnceLock;

use cef::{
    browser_host_create_browser, quit_message_loop, Browser, BrowserSettings, CefString, ImplBrowser, ImplBrowserHost,
    KeyEvent, KeyEventType, MouseButtonType, MouseEvent, WindowInfo,
};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, CreateSolidBrush, EnumDisplaySettingsW, ScreenToClient, DEVMODEW, ENUM_CURRENT_SETTINGS, HBRUSH,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, ReleaseCapture, SetCapture, VK_CONTROL, VK_MENU, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::{comp, handlers, log};

pub const WM_PRESENT: u32 = WM_APP + 1;
const TIMER_FLUSH: usize = 1;
const TIMER_EXIT: usize = 2;
const TIMER_FORCE: usize = 3;

pub struct Config {
    pub composed: bool,
    pub url: String,
    pub app_url: String,
    pub log: String,
    pub w: i32,
    pub h: i32,
    pub x: i32,
    pub y: i32,
    pub hole: (i32, i32, i32, i32),
    pub fps: i32,
    pub exit_after: u32,
    pub warp: bool,
    pub software: bool,
    pub strip: bool,
    pub sync: u32,
}

pub static CFG: OnceLock<Config> = OnceLock::new();

pub fn cfg() -> &'static Config {
    CFG.get().expect("config")
}

impl Config {
    pub fn parse() -> Self {
        let mut cfg = Config {
            composed: false,
            url: "about:blank".into(),
            app_url: "about:blank".into(),
            log: "spike-log.jsonl".into(),
            w: 960,
            h: 640,
            x: 40,
            y: 40,
            hole: (0, 0, 0, 0),
            fps: 0,
            exit_after: 0,
            warp: false,
            software: false,
            strip: true,
            sync: 1,
        };
        let mut hole = None;
        for arg in std::env::args() {
            let Some(rest) = arg.strip_prefix("--spike-") else {
                continue;
            };
            let (key, value) = rest.split_once('=').unwrap_or((rest, ""));
            match key {
                "mode" => cfg.composed = value == "composed",
                "url" => cfg.url = value.into(),
                "app" => cfg.app_url = value.into(),
                "log" => cfg.log = value.into(),
                "size" => {
                    if let Some((w, h)) = value.split_once('x') {
                        cfg.w = w.parse().unwrap_or(cfg.w);
                        cfg.h = h.parse().unwrap_or(cfg.h);
                    }
                }
                "pos" => {
                    if let Some((x, y)) = value.split_once(',') {
                        cfg.x = x.parse().unwrap_or(cfg.x);
                        cfg.y = y.parse().unwrap_or(cfg.y);
                    }
                }
                "hole" => {
                    let v: Vec<i32> = value.split(',').filter_map(|n| n.parse().ok()).collect();
                    if v.len() == 4 {
                        hole = Some((v[0], v[1], v[2], v[3]));
                    }
                }
                "fps" => cfg.fps = value.parse().unwrap_or(0),
                "exit-after" => cfg.exit_after = value.parse().unwrap_or(0),
                "adapter" => cfg.warp = value == "warp",
                "software" => cfg.software = true,
                "no-strip" => cfg.strip = false,
                "sync" => cfg.sync = value.parse().unwrap_or(1),
                _ => {}
            }
        }
        cfg.hole = hole.unwrap_or((160, 48, cfg.w - 176, cfg.h - 64));
        if cfg.fps <= 0 {
            cfg.fps = refresh_rate();
        }
        cfg
    }
}

pub fn refresh_rate() -> i32 {
    let mut mode = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
    let ok = unsafe { EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, &mut mode) };
    let hz = mode.dmDisplayFrequency as i32;
    if ok.as_bool() && hz > 1 {
        hz
    } else {
        60
    }
}

pub fn dpi_aware() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

pub fn screen_size() -> (i32, i32) {
    unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
}

pub fn view_size(role: u8) -> (i32, i32) {
    let cfg = cfg();
    if role == 1 {
        (cfg.w, cfg.h + 1)
    } else {
        (cfg.hole.2, cfg.hole.3)
    }
}

#[derive(Default)]
struct State {
    hwnd: HWND,
    browsers: Vec<(u8, Browser)>,
    open: usize,
    hover: u8,
    capture: u8,
    focus: u8,
    closing: bool,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

pub fn hwnd() -> HWND {
    STATE.with(|s| s.borrow().hwnd)
}

fn host_of(role: u8) -> Option<cef::BrowserHost> {
    STATE.with(|s| s.borrow().browsers.iter().find(|(r, _)| *r == role).and_then(|(_, b)| b.host()))
}

pub fn created(role: u8, browser: Browser) {
    let focus = STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.browsers.push((role, browser.clone()));
        s.open += 1;
        if role != 1 && s.focus == 0 {
            s.focus = role;
            true
        } else {
            false
        }
    });
    log::line(format!(r#"{{"ev":"created","v":{role},"t":{}}}"#, log::qpc()));
    if focus {
        if let Some(host) = browser.host() {
            host.set_focus(1);
        }
    }
}

pub fn closed(role: u8) {
    let done = STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.open = s.open.saturating_sub(1);
        s.browsers.retain(|(r, _)| *r != role);
        s.open == 0 && s.closing
    });
    if done {
        log::flush();
        quit_message_loop();
    }
}

fn close_all() {
    let hosts: Vec<cef::BrowserHost> = STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.closing = true;
        s.browsers.iter().filter_map(|(_, b)| b.host()).collect()
    });
    log::line(format!(r#"{{"ev":"closing","t":{}}}"#, log::qpc()));
    log::flush();
    if hosts.is_empty() {
        quit_message_loop();
        return;
    }
    unsafe {
        SetTimer(Some(hwnd()), TIMER_FORCE, 4000, None);
    }
    for host in hosts {
        host.close_browser(1);
    }
}

pub fn start() {
    let cfg = cfg();
    let hwnd = unsafe { make_window(cfg) };
    STATE.with(|s| s.borrow_mut().hwnd = hwnd);
    let mut origin = POINT { x: 0, y: 0 };
    unsafe {
        let _ = ClientToScreen(hwnd, &mut origin);
    }
    log::line(format!(
        r#"{{"ev":"start","t":{},"freq":{},"mode":"{}","client":[{},{},{},{}],"hole":[{},{},{},{}],"fps":{},"refresh":{},"software":{},"warp":{},"sync":{}}}"#,
        log::qpc(),
        log::freq(),
        if cfg.composed { "composed" } else { "native" },
        origin.x,
        origin.y,
        cfg.w,
        cfg.h,
        cfg.hole.0,
        cfg.hole.1,
        cfg.hole.2,
        cfg.hole.3,
        cfg.fps,
        refresh_rate(),
        cfg.software,
        cfg.warp,
        cfg.sync
    ));
    unsafe {
        SetTimer(Some(hwnd), TIMER_FLUSH, 500, None);
        if cfg.exit_after > 0 {
            SetTimer(Some(hwnd), TIMER_EXIT, cfg.exit_after * 1000, None);
        }
    }
    let parent = cef::sys::HWND(hwnd.0 as _);
    if cfg.composed {
        if let Err(e) = comp::init(hwnd, cfg) {
            log::line(format!(r#"{{"ev":"error","what":"compositor","detail":"{}"}}"#, log::esc(&e.to_string())));
        }
        for (role, url, background) in [(1u8, &cfg.app_url, 0x0000_0000u32), (2u8, &cfg.url, 0xFFFF_FFFFu32)] {
            let mut info = WindowInfo::default().set_as_windowless(parent);
            info.shared_texture_enabled = i32::from(!cfg.software);
            let settings = BrowserSettings {
                windowless_frame_rate: cfg.fps,
                background_color: background,
                ..Default::default()
            };
            let mut client = handlers::SpikeClient::new(role);
            browser_host_create_browser(
                Some(&info),
                Some(&mut client),
                Some(&CefString::from(url.as_str())),
                Some(&settings),
                None,
                None,
            );
        }
    } else {
        let (x, y, w, h) = cfg.hole;
        let info = WindowInfo::default().set_as_child(parent, &cef::Rect { x, y, width: w, height: h });
        let settings = BrowserSettings::default();
        let mut client = handlers::SpikeClient::new(0);
        browser_host_create_browser(
            Some(&info),
            Some(&mut client),
            Some(&CefString::from(cfg.url.as_str())),
            Some(&settings),
            None,
            None,
        );
    }
}

unsafe fn make_window(cfg: &Config) -> HWND {
    let instance = GetModuleHandleW(None).unwrap_or_default();
    let class = w!("OsrSpike");
    let brush = if cfg.composed { HBRUSH::default() } else { CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x0030_241f)) };
    let wc = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: instance.into(),
        lpszClassName: class,
        hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
        hbrBackground: brush,
        ..Default::default()
    };
    RegisterClassW(&wc);
    let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE | WS_CLIPCHILDREN;
    let ex = if cfg.composed { WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST } else { WS_EX_TOPMOST };
    let mut rect = RECT { left: 0, top: 0, right: cfg.w, bottom: cfg.h };
    let _ = AdjustWindowRectEx(&mut rect, style, false, ex);
    let hwnd = CreateWindowExW(
        ex,
        class,
        w!("osr spike"),
        style,
        cfg.x,
        cfg.y,
        rect.right - rect.left,
        rect.bottom - rect.top,
        None,
        None,
        Some(instance.into()),
        None,
    )
    .expect("window");
    let _ = SetForegroundWindow(hwnd);
    hwnd
}

fn lparam_xy(lp: LPARAM) -> (i32, i32) {
    ((lp.0 & 0xffff) as u16 as i16 as i32, ((lp.0 >> 16) & 0xffff) as u16 as i16 as i32)
}

fn key_flags() -> u32 {
    let mut flags = 0;
    unsafe {
        if GetKeyState(VK_SHIFT.0 as i32) < 0 {
            flags |= 2;
        }
        if GetKeyState(VK_CONTROL.0 as i32) < 0 {
            flags |= 4;
        }
        if GetKeyState(VK_MENU.0 as i32) < 0 {
            flags |= 8;
        }
    }
    flags
}

fn mouse_flags(wp: WPARAM) -> u32 {
    let mut flags = key_flags();
    if wp.0 & 0x1 != 0 {
        flags |= 16;
    }
    if wp.0 & 0x10 != 0 {
        flags |= 32;
    }
    if wp.0 & 0x2 != 0 {
        flags |= 64;
    }
    flags
}

fn target(x: i32, y: i32, capture: u8) -> (u8, i32, i32) {
    let (hx, hy, hw, hh) = cfg().hole;
    let role = if capture != 0 {
        capture
    } else if x >= hx && y >= hy && x < hx + hw && y < hy + hh {
        2
    } else {
        1
    };
    if role == 2 {
        (2, x - hx, y - hy)
    } else {
        (1, x, y)
    }
}

fn mark_input(kind: &str, role: u8) {
    log::line(format!(r#"{{"ev":"in","k":"{kind}","v":{role},"t":{}}}"#, log::qpc()));
}

fn mouse(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) {
    let (x, y) = lparam_xy(lp);
    let (capture, hover, focus) = STATE.with(|s| {
        let s = s.borrow();
        (s.capture, s.hover, s.focus)
    });
    let (role, lx, ly) = target(x, y, capture);
    let Some(host) = host_of(role) else {
        return;
    };
    let event = MouseEvent { x: lx, y: ly, modifiers: mouse_flags(wp) };
    match msg {
        WM_MOUSEMOVE => {
            if hover != role && hover != 0 {
                if let Some(old) = host_of(hover) {
                    old.send_mouse_move_event(Some(&MouseEvent { x: -1, y: -1, modifiers: 0 }), 1);
                }
            }
            STATE.with(|s| s.borrow_mut().hover = role);
            host.send_mouse_move_event(Some(&event), 0);
        }
        WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
            mark_input("down", role);
            unsafe {
                SetCapture(hwnd);
            }
            if focus != role {
                if let Some(old) = host_of(focus) {
                    old.set_focus(0);
                }
                host.set_focus(1);
            }
            STATE.with(|s| {
                let mut s = s.borrow_mut();
                s.capture = role;
                s.focus = role;
            });
            host.send_mouse_click_event(Some(&event), button(msg), 0, 1);
        }
        WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP => {
            unsafe {
                let _ = ReleaseCapture();
            }
            STATE.with(|s| s.borrow_mut().capture = 0);
            host.send_mouse_click_event(Some(&event), button(msg), 1, 1);
        }
        _ => {}
    }
}

fn button(msg: u32) -> MouseButtonType {
    match msg {
        WM_RBUTTONDOWN | WM_RBUTTONUP => MouseButtonType::RIGHT,
        WM_MBUTTONDOWN | WM_MBUTTONUP => MouseButtonType::MIDDLE,
        _ => MouseButtonType::LEFT,
    }
}

fn wheel(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) {
    let (sx, sy) = lparam_xy(lp);
    let mut point = POINT { x: sx, y: sy };
    unsafe {
        let _ = ScreenToClient(hwnd, &mut point);
    }
    let (role, lx, ly) = target(point.x, point.y, 0);
    let Some(host) = host_of(role) else {
        return;
    };
    let delta = ((wp.0 >> 16) & 0xffff) as u16 as i16 as i32;
    mark_input("wheel", role);
    let event = MouseEvent { x: lx, y: ly, modifiers: mouse_flags(WPARAM(wp.0 & 0xffff)) };
    if msg == WM_MOUSEHWHEEL {
        host.send_mouse_wheel_event(Some(&event), delta, 0);
    } else {
        host.send_mouse_wheel_event(Some(&event), 0, delta);
    }
}

fn key(msg: u32, wp: WPARAM, lp: LPARAM) {
    let focus = STATE.with(|s| s.borrow().focus);
    let Some(host) = host_of(focus) else {
        return;
    };
    let type_ = match msg {
        WM_KEYDOWN | WM_SYSKEYDOWN => KeyEventType::RAWKEYDOWN,
        WM_KEYUP | WM_SYSKEYUP => KeyEventType::KEYUP,
        _ => KeyEventType::CHAR,
    };
    if type_ == KeyEventType::RAWKEYDOWN {
        mark_input("key", focus);
    }
    let event = KeyEvent {
        type_,
        modifiers: key_flags(),
        windows_key_code: wp.0 as i32,
        native_key_code: lp.0 as i32,
        is_system_key: i32::from(matches!(msg, WM_SYSKEYDOWN | WM_SYSKEYUP | WM_SYSCHAR)),
        character: wp.0 as u16,
        unmodified_character: wp.0 as u16,
        ..Default::default()
    };
    host.send_key_event(Some(&event));
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let composed = CFG.get().is_some_and(|c| c.composed);
    match msg {
        WM_CLOSE => {
            close_all();
            return LRESULT(0);
        }
        WM_TIMER => {
            match wp.0 {
                TIMER_EXIT => unsafe {
                    let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
                },
                TIMER_FORCE => {
                    log::flush();
                    quit_message_loop();
                }
                _ => log::flush(),
            }
            return LRESULT(0);
        }
        WM_PRESENT => {
            comp::on_present();
            return LRESULT(0);
        }
        WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN
        | WM_MBUTTONUP
            if composed =>
        {
            mouse(hwnd, msg, wp, lp);
            return LRESULT(0);
        }
        WM_MOUSEWHEEL | WM_MOUSEHWHEEL if composed => {
            wheel(hwnd, msg, wp, lp);
            return LRESULT(0);
        }
        WM_KEYDOWN | WM_KEYUP | WM_CHAR | WM_SYSKEYDOWN | WM_SYSKEYUP | WM_SYSCHAR if composed => {
            key(msg, wp, lp);
            if msg == WM_SYSKEYDOWN || msg == WM_SYSKEYUP {
                return unsafe { DefWindowProcW(hwnd, msg, wp, lp) };
            }
            return LRESULT(0);
        }
        WM_ERASEBKGND if composed => return LRESULT(1),
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}
