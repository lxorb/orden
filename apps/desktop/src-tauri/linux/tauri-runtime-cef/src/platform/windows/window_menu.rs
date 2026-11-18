use std::sync::atomic::{AtomicBool, Ordering};

use windows::Win32::{
  Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
  UI::Shell::{DefSubclassProc, SetWindowSubclass},
  UI::WindowsAndMessaging::{
    EnableMenuItem, GA_ROOT, GWL_STYLE, GetAncestor, GetSystemMenu, GetWindowLongW, GetWindowRect,
    IsIconic, IsWindow, IsZoomed, MF_BYCOMMAND, MF_ENABLED, MF_GRAYED, PostMessageW, SC_KEYMENU,
    SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE, TPM_RETURNCMD, TPM_RIGHTBUTTON,
    TrackPopupMenu, WM_SYSCOMMAND, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_THICKFRAME,
  },
};

const KEY_MENU: usize = 126;

const ALONE: isize = 0;

const SPACE: isize = 0x20;

static SHOWING: AtomicBool = AtomicBool::new(false);

pub(crate) fn key_pressed(browser: cef::sys::cef_window_handle_t, event: &cef::KeyEvent) -> bool {
  let browser = HWND(browser.0 as _);
  unsafe {
    if browser.0.is_null() || !IsWindow(Some(browser)).as_bool() {
      return false;
    }
    let window = GetAncestor(browser, GA_ROOT);
    if window.0.is_null() {
      return false;
    }
    let _ = SetWindowSubclass(window, Some(key_menu), KEY_MENU, 0);
    if !asks_window_menu(event) {
      return false;
    }
    let _ = PostMessageW(
      Some(window),
      WM_SYSCOMMAND,
      WPARAM(SC_KEYMENU as usize),
      LPARAM(SPACE),
    );
  }
  true
}

fn asks_window_menu(event: &cef::KeyEvent) -> bool {
  use cef::sys::{cef_event_flags_t, cef_key_event_type_t};
  let typed: cef::KeyEventType = cef_key_event_type_t::KEYEVENT_CHAR.into();
  let modifiers = event.modifiers as i32;
  let held = |flag: cef_event_flags_t| modifiers & flag.0 != 0;
  event.type_ == typed
    && event.windows_key_code == SPACE as i32
    && held(cef_event_flags_t::EVENTFLAG_ALT_DOWN)
    && !held(cef_event_flags_t::EVENTFLAG_CONTROL_DOWN)
}

unsafe extern "system" fn key_menu(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _subclass_id: usize,
  _data: usize,
) -> LRESULT {
  unsafe {
    if msg == WM_SYSCOMMAND && wparam.0 & 0xFFF0 == SC_KEYMENU as usize {
      match lparam.0 {
        ALONE => return LRESULT(0),
        SPACE => {
          if !SHOWING.swap(true, Ordering::SeqCst) {
            shown(hwnd);
            SHOWING.store(false, Ordering::SeqCst);
          }
          return LRESULT(0);
        }
        _ => {}
      }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
  }
}

unsafe fn shown(hwnd: HWND) {
  unsafe {
    let menu = GetSystemMenu(hwnd, false);
    if menu.is_invalid() {
      return;
    }
    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    let (zoomed, iconic) = (IsZoomed(hwnd).as_bool(), IsIconic(hwnd).as_bool());
    let placed = !zoomed && !iconic;
    for (item, on) in [
      (SC_RESTORE, zoomed || iconic),
      (SC_MOVE, placed),
      (SC_SIZE, placed && style & WS_THICKFRAME.0 != 0),
      (SC_MINIMIZE, !iconic && style & WS_MINIMIZEBOX.0 != 0),
      (SC_MAXIMIZE, !zoomed && style & WS_MAXIMIZEBOX.0 != 0),
    ] {
      let _ = EnableMenuItem(
        menu,
        item,
        MF_BYCOMMAND | if on { MF_ENABLED } else { MF_GRAYED },
      );
    }
    let mut at = RECT::default();
    if GetWindowRect(hwnd, &mut at).is_err() {
      return;
    }
    let chosen = TrackPopupMenu(
      menu,
      TPM_RETURNCMD | TPM_RIGHTBUTTON,
      at.left,
      at.top,
      None,
      hwnd,
      None,
    );
    if let Ok(command) = usize::try_from(chosen.0)
      && command != 0
    {
      let _ = PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(command), LPARAM(0));
    }
  }
}
