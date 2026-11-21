use std::sync::Mutex;

use windows::Win32::{
  Foundation::{HWND, LPARAM, LRESULT, WPARAM},
  UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
  UI::WindowsAndMessaging::{
    CBT_CREATEWNDW, CallNextHookEx, GetClassNameW, GetWindowThreadProcessId, HCBT_CREATEWND,
    IsWindow, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SetWindowPos,
    SetWindowsHookExW, UnhookWindowsHookEx, WH_CBT, WINDOWPOS, WM_WINDOWPOSCHANGING, WS_VISIBLE,
  },
};

const HELD: usize = 126;
const WIDGET: &str = "Chrome_WidgetWin_1";

#[derive(Clone, Copy)]
struct Asked {
  parent: isize,
  child: isize,
  at: [i32; 4],
}

static ASKED: Mutex<Option<Asked>> = Mutex::new(None);

fn asked() -> Option<Asked> {
  *ASKED.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn inside(at: [i32; 4]) -> [i32; 4] {
  [0, 0, at[2], at[3]]
}

fn class_of(window: HWND) -> String {
  let mut name = [0u16; 64];
  let length = unsafe { GetClassNameW(window, &mut name) };
  String::from_utf16_lossy(&name[..usize::try_from(length).unwrap_or(0)])
}

unsafe extern "system" fn held(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _subclass_id: usize,
  _data: usize,
) -> LRESULT {
  unsafe {
    if msg == WM_WINDOWPOSCHANGING
      && lparam.0 != 0
      && let Some(asked) = asked()
    {
      let pos = &mut *(lparam.0 as *mut WINDOWPOS);
      pos.flags = (pos.flags & !(SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE)) | SWP_NOACTIVATE;
      let [x, y, cx, cy] = inside(asked.at);
      (pos.x, pos.y, pos.cx, pos.cy) = (x, y, cx, cy);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
  }
}

unsafe extern "system" fn creating(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  unsafe {
    if u32::try_from(code).is_ok_and(|code| code == HCBT_CREATEWND) && lparam.0 != 0 {
      let made = &*(lparam.0 as *const CBT_CREATEWNDW);
      let child = HWND(wparam.0 as _);
      let mut kept = ASKED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
      if let Some(asked) = kept.as_mut()
        && asked.child == 0
        && !made.lpcs.is_null()
        && (*made.lpcs).hwndParent.0 as isize == asked.parent
        && class_of(child) == WIDGET
      {
        let cs = &mut *made.lpcs;
        cs.style &= !(WS_VISIBLE.0 as i32);
        [cs.x, cs.y, cs.cx, cs.cy] = inside(asked.at);
        asked.child = child.0 as isize;
        drop(kept);
        let _ = SetWindowSubclass(child, Some(held), HELD, 0);
      }
    }
    CallNextHookEx(None, code, wparam, lparam)
  }
}

pub(crate) fn born_where_asked<T>(
  parent: isize,
  bounds: &cef::Rect,
  create: impl FnOnce() -> T,
) -> T {
  let parent = HWND(parent as _);
  let thread = unsafe { GetWindowThreadProcessId(parent, None) };
  *ASKED.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Asked {
    parent: parent.0 as isize,
    child: 0,
    at: [bounds.x, bounds.y, bounds.width, bounds.height],
  });
  let hook = (thread != 0)
    .then(|| unsafe { SetWindowsHookExW(WH_CBT, Some(creating), None, thread) }.ok())
    .flatten();
  let made = create();
  if let Some(hook) = hook {
    let _ = unsafe { UnhookWindowsHookEx(hook) };
  }
  let born = ASKED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
  if let Some(born) = born.filter(|one| one.child != 0) {
    let child = HWND(born.child as _);
    unsafe {
      let _ = RemoveWindowSubclass(child, Some(held), HELD);
      if IsWindow(Some(child)).as_bool() {
        let [x, y, cx, cy] = born.at;
        let _ = SetWindowPos(
          child,
          None,
          x,
          y,
          cx,
          cy,
          SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
      }
    }
  }
  made
}

#[cfg(test)]
mod tests {
  use super::inside;

  #[test]
  fn a_page_is_born_inside_its_window_at_the_size_asked_whatever_place_was_asked() {
    assert_eq!(inside([-20000, -20000, 1024, 645]), [0, 0, 1024, 645]);
    assert_eq!(inside([353, 75, 25, 25]), [0, 0, 25, 25]);
  }
}
