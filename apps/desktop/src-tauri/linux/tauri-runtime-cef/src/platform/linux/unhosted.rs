//! The window Chrome's own UI makes for a browser it opens by itself - an extension's tab -
//! which the runtime closes as soon as its address is known (lxorb/orden#1161). Until then
//! it is a whole Chromium window, tab strip and all, and a desktop showed it as Chromium
//! for as long as it stood: so it is taken off the screen as it is made, out of the window
//! manager's hands, and closed from there.

use std::os::raw::c_ulong;
use x11_dl::xlib;

use super::{
  utils::{top_level, with_cef_display},
  webview::known,
};

/// Far past any screen.
const AWAY: i32 = -32_000;

/// The window of `browser`, whose own X window that is, unmapped and mapped again only
/// where no window manager sees it and no screen shows it.
pub(crate) fn put_out_of_sight(browser: c_ulong) {
  let Some(window) = known(browser) else {
    return;
  };
  with_cef_display((), |xlib, display| unsafe {
    let Some(window) = top_level(xlib, display, window) else {
      return;
    };
    (xlib.XUnmapWindow)(display, window);
    let mut attributes: xlib::XSetWindowAttributes = std::mem::zeroed();
    attributes.override_redirect = xlib::True;
    (xlib.XChangeWindowAttributes)(display, window, xlib::CWOverrideRedirect, &mut attributes);
    (xlib.XMoveWindow)(display, window, AWAY, AWAY);
  });
}
