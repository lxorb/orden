// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use cef::ImplBrowserHost;
use std::os::raw::c_ulong;
use tauri_runtime::dpi::{PhysicalPosition, PhysicalSize, Rect};
use tauri_utils::config::Color;
use x11_dl::xlib;

use crate::{webview::AppWebview, window::AppWindow};

use super::utils::{atom, with_cef_display};

impl AppWebview {
  pub(crate) fn native_parent_matches(&self, parent: &AppWindow) -> Option<bool> {
    let xid = self.xid()?;
    with_cef_display(None, |xlib, display| unsafe {
      let mut root = 0;
      let mut native_parent = 0;
      let mut children = std::ptr::null_mut();
      let mut count = 0;
      let status = (xlib.XQueryTree)(
        display,
        xid,
        &mut root,
        &mut native_parent,
        &mut children,
        &mut count,
      );
      if !children.is_null() {
        (xlib.XFree)(children.cast());
      }
      // Browsers are created under (and reparented into) the X11 host, not the GTK toplevel.
      (status != 0).then_some(native_parent == parent.cef_host_handle() as xlib::Window)
    })
  }

  pub(crate) fn native_visible(&self) -> Option<bool> {
    let xid = self.xid()?;
    with_cef_display(None, |xlib, display| unsafe {
      let mut attributes = std::mem::MaybeUninit::<xlib::XWindowAttributes>::uninit();
      if (xlib.XGetWindowAttributes)(display, xid, attributes.as_mut_ptr()) == 0 {
        return None;
      }
      // XGetWindowAttributes initializes the complete structure on success.
      Some(attributes.assume_init().map_state == xlib::IsViewable)
    })
  }

  /// The browser's own X window, or `None` while it has none.
  ///
  /// Orden's patch (lxorb/orden#1085): this asserted the window was there, and a browser
  /// being closed has none - CEF destroys it before the browser is gone - so a placement,
  /// a show or a hide that reached a web tab's browser as it closed stopped the app. A
  /// browser is built by `browser_host_create_browser_sync`, which hands it back with its
  /// window made, so no window means one that is going: there is nothing left to place,
  /// show or hide, and each caller does nothing.
  fn xid(&self) -> Option<xlib::Window> {
    known(self.host.window_handle())
  }

  pub(crate) fn set_background_color(&self, color: Option<Color>) {
    let _ = (self, color);
    // Native child-window background is not equivalent to Chromium's rendered
    // background. Creation still applies BrowserSettings.
  }

  pub(crate) fn bounds(&self) -> Option<Rect> {
    if let Some(view) = &self.offscreen {
      return Some(view.bounds());
    }
    let xid = self.xid()?;

    with_cef_display(None, |xlib, display| unsafe {
      let mut root: xlib::Window = 0;
      let mut x: i32 = 0;
      let mut y: i32 = 0;
      let mut width: u32 = 0;
      let mut height: u32 = 0;
      let mut border_width: u32 = 0;
      let mut depth: u32 = 0;

      if (xlib.XGetGeometry)(
        display,
        xid,
        &mut root,
        &mut x,
        &mut y,
        &mut width,
        &mut height,
        &mut border_width,
        &mut depth,
      ) == 0
      {
        return None;
      }

      Some(Rect {
        position: PhysicalPosition::new(x, y).into(),
        size: PhysicalSize::new(width, height).into(),
      })
    })
  }

  pub(crate) fn reparent(&self, parent: &AppWindow) {
    let Some(xid) = self.xid() else {
      return;
    };
    // Linux reparents into the GTK content-area X11 host, unlike Windows/macOS
    // where the CEF host handle is the native window/view.
    let parent_xid = parent.cef_host_handle();

    with_cef_display((), |xlib, display| unsafe {
      (xlib.XReparentWindow)(display, xid, parent_xid as xlib::Window, 0, 0);
      (xlib.XMapRaised)(display, xid);
    });
  }

  pub(crate) fn apply_visible(&self, visible: bool) {
    let Some(xid) = self.xid() else {
      return;
    };

    with_cef_display((), |xlib, display| unsafe {
      let net_wm_state = atom(xlib, display, "_NET_WM_STATE");
      const PROP_MODE_REPLACE: i32 = 0;

      if visible {
        (xlib.XChangeProperty)(
          display,
          xid,
          net_wm_state,
          xlib::XA_ATOM,
          32,
          PROP_MODE_REPLACE,
          std::ptr::null(),
          0,
        );
        (xlib.XMapWindow)(display, xid);
      } else {
        let hidden: [c_ulong; 1] = [atom(xlib, display, "_NET_WM_STATE_HIDDEN")];
        (xlib.XChangeProperty)(
          display,
          xid,
          net_wm_state,
          xlib::XA_ATOM,
          32,
          PROP_MODE_REPLACE,
          hidden.as_ptr() as *const u8,
          1,
        );
        (xlib.XUnmapWindow)(display, xid);
      }
    });
  }

  pub(crate) fn apply_physical_bounds(&self, _scale: f64, x: i32, y: i32, width: i32, height: i32) {
    let Some(xid) = self.xid() else {
      return;
    };

    with_cef_display((), |xlib, display| unsafe {
      (xlib.XMoveResizeWindow)(
        display,
        xid,
        x,
        y,
        width.max(1) as u32,
        height.max(1) as u32,
      );
      // `with_cef_display` issues an `XFlush` once the closure returns, so a
      // blocking `XSync` round-trip here just stalls every resize frame.
    });
  }
}

/// An X window handle as CEF or winit hands it over: none at all is `0`. Orden's patch
/// (lxorb/orden#1085), the one place every X window this module asks for is read through.
pub(super) fn known(handle: c_ulong) -> Option<xlib::Window> {
  (handle != 0).then_some(handle as xlib::Window)
}

#[cfg(test)]
mod tests {
  use super::known;

  #[test]
  fn no_window_is_none_rather_than_a_crash() {
    assert_eq!(known(0), None);
    assert_eq!(known(0x2a0_0007), Some(0x2a0_0007));
  }
}
