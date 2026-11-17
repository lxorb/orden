use windows::Win32::{
  Foundation::{HWND, LPARAM, LRESULT, WPARAM},
  UI::Shell::{DefSubclassProc, SetWindowSubclass},
  UI::WindowsAndMessaging::{
    GA_ROOT, GWL_EXSTYLE, GetAncestor, GetWindowLongW, IsWindow, SW_HIDE, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SetWindowLongW, SetWindowPos, ShowWindow,
    WINDOWPOS, WM_WINDOWPOSCHANGING, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
  },
};

const AWAY: i32 = -32_000;

const KEPT_AWAY: usize = 125;

unsafe extern "system" fn kept_away(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _subclass_id: usize,
  _data: usize,
) -> LRESULT {
  unsafe {
    if msg == WM_WINDOWPOSCHANGING && lparam.0 != 0 {
      let pos = &mut *(lparam.0 as *mut WINDOWPOS);
      pos.flags = (pos.flags & !(SWP_SHOWWINDOW | SWP_NOMOVE)) | SWP_NOACTIVATE;
      pos.x = AWAY;
      pos.y = AWAY;
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
  }
}

pub(crate) fn put_out_of_sight(browser: cef::sys::cef_window_handle_t) {
  let browser = HWND(browser.0 as _);
  unsafe {
    if browser.0.is_null() || !IsWindow(Some(browser)).as_bool() {
      return;
    }
    let window = GetAncestor(browser, GA_ROOT);
    if window.0.is_null() {
      return;
    }
    let _ = SetWindowSubclass(window, Some(kept_away), KEPT_AWAY, 0);
    let style = GetWindowLongW(window, GWL_EXSTYLE);
    let _ = SetWindowLongW(
      window,
      GWL_EXSTYLE,
      (style | WS_EX_TOOLWINDOW.0 as i32) & !(WS_EX_APPWINDOW.0 as i32),
    );
    let _ = ShowWindow(window, SW_HIDE);
    let _ = SetWindowPos(
      window,
      None,
      AWAY,
      AWAY,
      0,
      0,
      SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
  }
}
