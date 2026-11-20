use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};

type Hresult = i32;
const OK: Hresult = 0;
const NO_INTERFACE: Hresult = 0x8000_4002_u32 as i32;
const BAD_POINTER: Hresult = 0x8000_4003_u32 as i32;
const UNKNOWN: [u8; 16] = guid(0x0000_0000);
const DROP_TARGET: [u8; 16] = guid(0x0000_0122);

const fn guid(first: u32) -> [u8; 16] {
  let head = first.to_le_bytes();
  [head[0], head[1], head[2], head[3], 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
  x: i32,
  y: i32,
}

#[repr(C)]
struct Vtbl {
  query_interface: unsafe extern "system" fn(*mut c_void, *const [u8; 16], *mut *mut c_void) -> Hresult,
  add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
  release: unsafe extern "system" fn(*mut c_void) -> u32,
  drag_enter: unsafe extern "system" fn(*mut c_void, *mut c_void, u32, Point, *mut u32) -> Hresult,
  drag_over: unsafe extern "system" fn(*mut c_void, u32, Point, *mut u32) -> Hresult,
  drag_leave: unsafe extern "system" fn(*mut c_void) -> Hresult,
  drop: unsafe extern "system" fn(*mut c_void, *mut c_void, u32, Point, *mut u32) -> Hresult,
}

#[repr(C)]
struct Holder {
  vtbl: &'static Vtbl,
  refs: AtomicU32,
  inner: *mut c_void,
}

fn vtbl_of(target: *mut c_void) -> *const Vtbl {
  unsafe { *target.cast::<*const Vtbl>() }
}

fn inner_of(this: *mut c_void) -> (*mut c_void, &'static Vtbl) {
  let inner = unsafe { (*this.cast::<Holder>()).inner };
  (inner, unsafe { &*vtbl_of(inner) })
}

unsafe extern "system" fn query_interface(
  this: *mut c_void,
  asked: *const [u8; 16],
  out: *mut *mut c_void,
) -> Hresult {
  if out.is_null() {
    return BAD_POINTER;
  }
  if unsafe { asked.as_ref() }.is_some_and(|iid| *iid == UNKNOWN || *iid == DROP_TARGET) {
    unsafe {
      add_ref(this);
      *out = this;
    }
    OK
  } else {
    unsafe { *out = std::ptr::null_mut() };
    NO_INTERFACE
  }
}

unsafe extern "system" fn add_ref(this: *mut c_void) -> u32 {
  unsafe { &*this.cast::<Holder>() }.refs.fetch_add(1, Ordering::SeqCst) + 1
}

unsafe extern "system" fn release(this: *mut c_void) -> u32 {
  let left = unsafe { &*this.cast::<Holder>() }.refs.fetch_sub(1, Ordering::SeqCst) - 1;
  if left == 0 {
    let holder = unsafe { Box::from_raw(this.cast::<Holder>()) };
    let vtbl = unsafe { &*vtbl_of(holder.inner) };
    unsafe { (vtbl.release)(holder.inner) };
  }
  left
}

unsafe extern "system" fn drag_enter(
  this: *mut c_void,
  data: *mut c_void,
  keys: u32,
  at: Point,
  effect: *mut u32,
) -> Hresult {
  let (inner, vtbl) = inner_of(this);
  unsafe { (vtbl.drag_enter)(inner, data, keys, at, effect) }
}

unsafe extern "system" fn drag_over(this: *mut c_void, keys: u32, at: Point, effect: *mut u32) -> Hresult {
  let (inner, vtbl) = inner_of(this);
  unsafe { (vtbl.drag_over)(inner, keys, at, effect) }
}

unsafe extern "system" fn drag_leave(this: *mut c_void) -> Hresult {
  let (inner, vtbl) = inner_of(this);
  unsafe { (vtbl.drag_leave)(inner) }
}

unsafe extern "system" fn drop(
  this: *mut c_void,
  data: *mut c_void,
  keys: u32,
  at: Point,
  effect: *mut u32,
) -> Hresult {
  let (inner, vtbl) = inner_of(this);
  let dropped = unsafe { (vtbl.drop)(inner, data, keys, at, effect) };
  unsafe { (vtbl.drag_leave)(inner) };
  dropped
}

static VTBL: Vtbl = Vtbl {
  query_interface,
  add_ref,
  release,
  drag_enter,
  drag_over,
  drag_leave,
  drop,
};

#[link(name = "ole32")]
unsafe extern "system" {
  fn RegisterDragDrop(window: *mut c_void, target: *mut c_void) -> Hresult;
  fn RevokeDragDrop(window: *mut c_void) -> Hresult;
}

#[link(name = "user32")]
unsafe extern "system" {
  fn GetPropW(window: *mut c_void, name: *const u16) -> *mut c_void;
  fn EnumChildWindows(
    parent: *mut c_void,
    each: unsafe extern "system" fn(*mut c_void, isize) -> i32,
    asked: isize,
  ) -> i32;
}

const PROPERTY: &[u16] = &[
  b'O' as u16, b'l' as u16, b'e' as u16, b'D' as u16, b'r' as u16, b'o' as u16, b'p' as u16,
  b'T' as u16, b'a' as u16, b'r' as u16, b'g' as u16, b'e' as u16, b't' as u16, b'I' as u16,
  b'n' as u16, b't' as u16, b'e' as u16, b'r' as u16, b'f' as u16, b'a' as u16, b'c' as u16,
  b'e' as u16, 0,
];

fn hold(window: *mut c_void) {
  let target = unsafe { GetPropW(window, PROPERTY.as_ptr()) };
  if target.is_null() || std::ptr::eq(vtbl_of(target), &VTBL) {
    return;
  }
  let vtbl = unsafe { &*vtbl_of(target) };
  unsafe { (vtbl.add_ref)(target) };
  if unsafe { RevokeDragDrop(window) } != OK {
    unsafe { (vtbl.release)(target) };
    return;
  }
  let holder = Box::into_raw(Box::new(Holder { vtbl: &VTBL, refs: AtomicU32::new(1), inner: target }));
  if unsafe { RegisterDragDrop(window, holder.cast()) } != OK {
    unsafe { RegisterDragDrop(window, target) };
  }
  unsafe { release(holder.cast()) };
}

unsafe extern "system" fn each(window: *mut c_void, _: isize) -> i32 {
  hold(window);
  1
}

pub(crate) fn let_go_of_drops_in_time(browser: cef::sys::cef_window_handle_t) {
  let window = browser.0 as *mut c_void;
  if window.is_null() {
    return;
  }
  hold(window);
  unsafe { EnumChildWindows(window, each, 0) };
}

#[cfg(test)]
mod tests {
  use super::{DROP_TARGET, PROPERTY, UNKNOWN};

  #[test]
  fn the_drop_target_is_named_as_ole_names_it() {
    assert_eq!(String::from_utf16_lossy(&PROPERTY[..PROPERTY.len() - 1]), "OleDropTargetInterface");
    assert_eq!(UNKNOWN, [0, 0, 0, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]);
    assert_eq!(DROP_TARGET, [0x22, 0x01, 0, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]);
  }
}
