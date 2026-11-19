use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use orden_base::Held as _;
use tauri::{Manager as _, Webview};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetParent, GetWindowRect, IsWindowVisible, WM_NCHITTEST,
};

use super::Cut;

const THROUGH: usize = 2224;
struct Page {
    label: String,
    host: isize,
    cut: Option<Cut>,
    wide: f64,
}
static PAGES: LazyLock<Mutex<HashMap<isize, Page>>> = LazyLock::new(Mutex::default);
fn native(platform: &tauri::webview::PlatformWebview) -> Option<isize> {
    crate::host::page_id(platform).and_then(|one| isize::try_from(one.0).ok())
}
fn hwnd(at: isize) -> HWND {
    HWND(at as _)
}
pub fn lower(window: &tauri::Window, view: &Webview) {
    if !view.label().starts_with(crate::web_tabs::LABEL) {
        return;
    }
    let Some(own) = window.app_handle().get_webview(window.label()) else {
        return;
    };
    let page = view.clone();
    let _ = crate::engine::with_platform!(own, move |platform| {
        let Some(host) = native(&platform) else {
            return;
        };
        let label = page.label().to_owned();
        let _ = crate::engine::with_platform!(page, move |platform| {
            let Some(page) = native(&platform) else {
                return;
            };
            if !beside(page, host) {
                return;
            }
            let mut all = PAGES.held();
            let kept = all.remove(&page);
            let (cut, wide) = kept.map_or((None, 0.0), |one| (one.cut, one.wide));
            all.insert(page, Page { label: label.clone(), host, cut, wide });
            drop(all);
            super::lay_under(&label, true);
        });
    });
}
#[allow(unsafe_code)]
fn beside(page: isize, host: isize) -> bool {
    let (mine, theirs) = unsafe { (GetParent(hwnd(page)), GetParent(hwnd(host))) };
    if !matches!((mine, theirs), (Ok(one), Ok(other)) if one == other) {
        return false;
    }
    through(host);
    true
}
#[allow(unsafe_code)]
fn through(host: isize) {
    unsafe {
        let _ = SetWindowSubclass(hwnd(host), Some(passed), THROUGH, host.cast_unsigned());
        let _ = EnumChildWindows(hwnd(host), Some(each), LPARAM(host));
    }
}
#[allow(unsafe_code)]
unsafe extern "system" fn each(child: HWND, host: LPARAM) -> BOOL {
    unsafe {
        let _ = SetWindowSubclass(child, Some(passed), THROUGH, host.0.cast_unsigned());
    }
    BOOL::from(true)
}
#[allow(
    unsafe_code,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss
)]
unsafe extern "system" fn passed(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    host: usize,
) -> LRESULT {
    if message == WM_NCHITTEST {
        let x = i32::from((lparam.0 & 0xffff) as u16 as i16);
        let y = i32::from(((lparam.0 >> 16) & 0xffff) as u16 as i16);
        if over_a_page(host.cast_signed(), x, y) {
            return LRESULT(-1);
        }
    }
    unsafe { DefSubclassProc(window, message, wparam, lparam) }
}
#[allow(unsafe_code)]
fn over_a_page(host: isize, x: i32, y: i32) -> bool {
    let pages: Vec<(isize, Option<Cut>, f64)> = PAGES
        .held()
        .iter()
        .filter(|(_, one)| one.host == host)
        .map(|(at, one)| (*at, one.cut.clone(), one.wide))
        .collect();
    for (page, cut, wide) in pages {
        let mut rect = RECT::default();
        let shown = unsafe { IsWindowVisible(hwnd(page)).as_bool() };
        if !shown || unsafe { GetWindowRect(hwnd(page), &raw mut rect) }.is_err() {
            continue;
        }
        if x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom {
            continue;
        }
        let across = f64::from(rect.right - rect.left).max(1.0);
        let by = if wide > 0.0 { wide / across } else { 1.0 };
        return super::takes(
            cut.as_ref(),
            f64::from(x - rect.left) * by,
            f64::from(y - rect.top) * by,
        );
    }
    false
}
pub fn cut(view: &Webview, cut: Option<Cut>, wide: f64) {
    let label = view.label().to_owned();
    let mut all = PAGES.held();
    let mut host = None;
    for one in all.values_mut().filter(|one| one.label == label) {
        one.cut.clone_from(&cut);
        one.wide = wide;
        host = Some(one.host);
    }
    drop(all);
    if let Some(host) = host {
        through(host);
    }
}
pub fn forget(label: &str) {
    PAGES.held().retain(|_, one| one.label != label);
}
pub fn opacity(view: &Webview, opacity: f64) {
    let _ = (view, opacity);
}
