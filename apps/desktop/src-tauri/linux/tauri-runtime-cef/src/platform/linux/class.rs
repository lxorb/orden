//! The name the desktop knows the application's windows by: `WM_CLASS`, which a desktop
//! matches against a desktop entry's `StartupWMClass` to put the window under the
//! application's own name and icon (lxorb/orden#1148).
//!
//! Two kinds of window carry it, and each left it wrong. GTK's own name theirs after
//! `g_get_prgname`, which `g_application_run` sets from `argv[0]`; the event loop only
//! registers its `GtkApplication` and never runs it, so the name was never set and every
//! window said `"", ""` - an application GNOME knows nothing of. Chromium names the
//! windows it makes itself - a popup, DevTools - after the desktop entry `CHROME_DESKTOP`
//! names, and with none, after Chromium's own, `chromium-browser`: GNOME showed them as
//! Chromium, and a `CHROME_DESKTOP` inherited from the program that started this one -
//! Chrome, or an Electron editor - put them under that program.
//!
//! Both are named after the command the application was started as, which is what every
//! package's desktop entry names in `StartupWMClass`. And a popup's window CEF makes by
//! itself, a bare Views one, carries no `WM_CLASS` at all, so it is named once it is there.

use std::{
  ffi::{CString, OsStr},
  os::raw::c_ulong,
  path::Path,
};
use x11_dl::xlib;

use super::{
  utils::{top_level, with_cef_display},
  webview::known,
};

/// The command `argv0` names, without its folder.
fn program_name(argv0: &OsStr) -> Option<String> {
  let name = Path::new(argv0).file_name()?.to_str()?;
  (!name.is_empty()).then(|| name.to_owned())
}

/// Before GTK and CEF start, and before any other thread: GTK's windows and Chromium's
/// named after this program.
pub(crate) fn name_windows() {
  let Some(name) = std::env::args_os()
    .next()
    .and_then(|argv0| program_name(&argv0))
  else {
    return;
  };
  gtk::glib::set_prgname(Some(name.as_str()));
  // SAFETY: as for `GDK_BACKEND` beside the caller: runtime initialization, before any
  // thread that could read the environment exists. Chromium reads it each time it makes
  // a window, so it stays set.
  unsafe { std::env::set_var("CHROME_DESKTOP", format!("{name}.desktop")) };
}

/// The window CEF made for a popup, whose browser's own X window is `browser`, named as
/// GTK's are: the window the window manager has, which is that one or one above it.
pub(crate) fn name_popup(browser: c_ulong) {
  let Some(window) = known(browser) else {
    return;
  };
  let Some(name) = gtk::glib::prgname().and_then(|name| CString::new(name.as_str()).ok()) else {
    return;
  };
  with_cef_display((), |xlib, display| unsafe {
    let Some(window) = top_level(xlib, display, window) else {
      return;
    };
    let mut hint = xlib::XClassHint {
      res_name: name.as_ptr().cast_mut(),
      res_class: name.as_ptr().cast_mut(),
    };
    (xlib.XSetClassHint)(display, window, &mut hint);
  });
}

#[cfg(test)]
mod tests {
  use super::program_name;
  use std::ffi::OsStr;

  #[test]
  fn the_name_is_the_command_without_its_folder() {
    assert_eq!(
      program_name(OsStr::new("/usr/bin/nib")).as_deref(),
      Some("nib")
    );
    assert_eq!(
      program_name(OsStr::new("/tmp/.mount_OrdenX/bin/nib")).as_deref(),
      Some("nib")
    );
    assert_eq!(
      program_name(OsStr::new("orden-unstable")).as_deref(),
      Some("orden-unstable")
    );
    assert_eq!(program_name(OsStr::new("")), None);
    assert_eq!(program_name(OsStr::new("/")), None);
  }
}
