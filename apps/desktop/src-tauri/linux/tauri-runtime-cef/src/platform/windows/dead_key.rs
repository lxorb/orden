use std::sync::atomic::{AtomicBool, Ordering};

use windows::Win32::UI::Input::KeyboardAndMouse::{
  GetKeyboardLayout, GetKeyboardState, HKL, MAPVK_VK_TO_VSC, MapVirtualKeyExW, ToUnicodeEx, VK_SPACE,
};

const KEEP_STATE: u32 = 0x4;

static PENDING: AtomicBool = AtomicBool::new(false);

pub(crate) fn keep_dead_key(sent: &cef::sys::MSG, event: &cef::KeyEvent) {
  let down: cef::KeyEventType = cef::sys::cef_key_event_type_t::KEYEVENT_RAWKEYDOWN.into();
  if event.type_ != down {
    return;
  }
  let layout = unsafe { GetKeyboardLayout(0) };
  let scan = u32::try_from((sent.lParam >> 16) & 0xff).unwrap_or(0);
  let Ok(key) = u32::try_from(sent.wParam) else {
    return;
  };
  let mut state = [0u8; 256];
  if unsafe { GetKeyboardState(&mut state) }.is_err() {
    return;
  }
  let was_pending = PENDING.load(Ordering::Relaxed);
  if lost(was_pending, dead_key_held(layout), is_dead(key, scan, &state, layout)) {
    press_again(key, scan, &state, layout);
  }
  PENDING.store(dead_key_held(layout), Ordering::Relaxed);
}

fn lost(was_pending: bool, held: bool, dead: bool) -> bool {
  dead && !held && !was_pending
}

fn is_dead(key: u32, scan: u32, state: &[u8; 256], layout: HKL) -> bool {
  let mut said = [0u16; 8];
  unsafe { ToUnicodeEx(key, scan, state, &mut said, KEEP_STATE, Some(layout)) < 0 }
}

pub(crate) fn dead_key_held(layout: HKL) -> bool {
  let space = u32::from(VK_SPACE.0);
  let scan = unsafe { MapVirtualKeyExW(space, MAPVK_VK_TO_VSC, Some(layout)) };
  let mut said = [0u16; 8];
  let written = unsafe { ToUnicodeEx(space, scan, &[0u8; 256], &mut said, KEEP_STATE, Some(layout)) };
  written > 0 && said[0] != u16::from(b' ')
}

pub(crate) fn press_again(key: u32, scan: u32, state: &[u8; 256], layout: HKL) -> i32 {
  let mut said = [0u16; 8];
  unsafe { ToUnicodeEx(key, scan, state, &mut said, 0, Some(layout)) }
}

#[cfg(test)]
mod tests {
  use super::*;
  use windows::Win32::UI::Input::KeyboardAndMouse::{
    ActivateKeyboardLayout, KLF_ACTIVATE, LoadKeyboardLayoutW, VK_E, VK_OEM_7,
  };
  use windows::core::w;

  fn typed(key: u32, layout: HKL) -> (i32, Vec<u16>) {
    let scan = unsafe { MapVirtualKeyExW(key, MAPVK_VK_TO_VSC, Some(layout)) };
    let mut said = [0u16; 8];
    let written = unsafe { ToUnicodeEx(key, scan, &[0u8; 256], &mut said, 0, Some(layout)) };
    (written, said[..usize::try_from(written.max(0)).unwrap_or(0)].to_vec())
  }

  #[test]
  fn only_a_dead_key_lost_with_nothing_pending_is_pressed_again() {
    assert!(lost(false, false, true));
    assert!(!lost(true, false, true));
    assert!(!lost(false, true, true));
    assert!(!lost(false, false, false));
  }

  #[test]
  fn a_dead_key_cleared_by_a_lookup_of_the_layout_is_pressed_again_once() {
    let Ok(layout) = (unsafe { LoadKeyboardLayoutW(w!("00020409"), KLF_ACTIVATE) }) else {
      return;
    };
    let _ = unsafe { ActivateKeyboardLayout(layout, Default::default()) };
    let acute = u32::from(VK_OEM_7.0);
    let e = u32::from(VK_E.0);
    let scan = unsafe { MapVirtualKeyExW(acute, MAPVK_VK_TO_VSC, Some(layout)) };
    let _ = typed(u32::from(VK_SPACE.0), layout);
    assert!(is_dead(acute, scan, &[0u8; 256], layout));
    assert!(!dead_key_held(layout));
    assert!(!is_dead(e, 0, &[0u8; 256], layout));
    assert_eq!(typed(acute, layout).0, -1);
    assert!(dead_key_held(layout));
    assert!(dead_key_held(layout));
    let _ = typed(u32::from(VK_SPACE.0), layout);
    assert!(!dead_key_held(layout));
    assert_eq!(press_again(acute, scan, &[0u8; 256], layout), -1);
    assert!(dead_key_held(layout));
    assert_eq!(typed(e, layout), (1, vec![0xE9]));
  }
}
