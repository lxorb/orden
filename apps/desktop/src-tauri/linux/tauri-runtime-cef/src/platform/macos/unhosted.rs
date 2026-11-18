use objc2::rc::Retained;
use objc2_app_kit::{NSView, NSWindowCollectionBehavior};
use objc2_foundation::NSPoint;

const AWAY: f64 = -32_000.0;

pub(crate) fn put_out_of_sight(browser: cef::sys::cef_window_handle_t) {
  let Some(view) = (unsafe { Retained::<NSView>::retain(browser.cast::<NSView>()) }) else {
    return;
  };
  let Some(window) = view.window() else {
    view.setHidden(true);
    return;
  };
  window.setAlphaValue(0.0);
  window.setIgnoresMouseEvents(true);
  window.setExcludedFromWindowsMenu(true);
  window.setCollectionBehavior(
    NSWindowCollectionBehavior::Transient | NSWindowCollectionBehavior::IgnoresCycle,
  );
  window.setFrameOrigin(NSPoint::new(AWAY, AWAY));
  window.orderOut(None);
}
