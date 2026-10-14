//! What a Linux desktop needs of the app beyond what GTK does by itself, and Wayland
//! above all.
//!
//! **Before GTK starts** (`prepare`, the first thing a launch does). `WebKitGTK` draws
//! through DMA-BUF buffers, which NVIDIA's own driver does not hand it the way Mesa does:
//! the window opens blank, or the session's compositor drops it with a protocol error.
//! Every Tauri app on that driver sets `WEBKIT_DISABLE_DMABUF_RENDERER`, and every
//! package of one sets it again for itself; here the app sets it, once, where the driver
//! is NVIDIA's and the reader has not said otherwise, so every package gets it. One file
//! looked for, which is microseconds of a launch.
//!
//! **Coming forward.** A Wayland compositor gives the front only to a window that shows
//! a token from the press that asked for it (xdg-activation): the launcher's, handed to
//! a launch as `XDG_ACTIVATION_TOKEN`, or the portal's, handed with a key from any app.
//! GTK 3 reads the launcher's only under its old name, `DESKTOP_STARTUP_ID`, so the first
//! window is handed it under that one. A second launch's token is the second launch's,
//! so it travels with its arguments to the app already running (`handover.rs`), and
//! `placement::raised` gives it to GTK just before the window is brought forward. Without one the
//! compositor is right to refuse, and GNOME says the app is ready instead.
//!
//! **Where a window is.** Wayland never tells an app where its windows are and never
//! lets one put them anywhere: the compositor places every window itself. So a window's
//! size and whether it was maximised come back on a launch, and its place does not
//! (`places_windows`).
//!
//! **Drawing on Wayland** (`prepare_rendering`): `WebKitGTK`'s accelerated compositing
//! off. Where a web tab's page goes is web_overlay.rs's.

use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

/// The switch `WebKitGTK` reads to draw without DMA-BUF.
const DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Present only while NVIDIA's own kernel driver is loaded; nouveau has no such file.
const NVIDIA: &str = "/proc/driver/nvidia/version";

/// The token a launcher hands the program it starts, and the name GTK 3 reads it by.
const TOKEN: &str = "XDG_ACTIVATION_TOKEN";
const STARTUP_ID: &str = "DESKTOP_STARTUP_ID";

/// How long a token is worth holding on to: the compositor hands one out for a press,
/// and a press is answered at once or not at all.
const FRESH: Duration = Duration::from_secs(10);

/// The launcher's token, read before GTK took it.
static LAUNCHED_WITH: OnceLock<Option<String>> = OnceLock::new();

/// A token that arrived for the next window to come forward, and when.
static PENDING: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Whether GTK draws on Wayland, as it said on the event loop's thread; see `learn`.
static DRAWN_ON_WAYLAND: OnceLock<bool> = OnceLock::new();

/// Before GTK and before any thread: DMA-BUF off on NVIDIA's driver, and the launcher's
/// token where GTK 3 looks for it.
pub fn prepare() {
    if dmabuf_off(
        std::path::Path::new(NVIDIA).exists(),
        std::env::var_os(DMABUF).is_some(),
    ) {
        std::env::set_var(DMABUF, "1");
    }
    let token = std::env::var(TOKEN).ok().filter(|token| !token.is_empty());
    if let Some(token) = &token {
        if std::env::var_os(STARTUP_ID).is_none() {
            std::env::set_var(STARTUP_ID, token);
        }
        // Not handed on to a terminal's shells, whose programs would show a token that
        // was never theirs.
        std::env::remove_var(TOKEN);
    }
    let _ = LAUNCHED_WITH.set(token);
}

/// Whether to turn DMA-BUF off: NVIDIA's driver, and nobody having set it either way.
fn dmabuf_off(nvidia: bool, already_said: bool) -> bool {
    nvidia && !already_said
}

/// The token this launch was started with, if the launcher gave one.
pub fn launched_with() -> Option<&'static str> {
    LAUNCHED_WITH.get().and_then(Option::as_deref)
}

/// Whether this is a Wayland session, whatever GTK was told to draw with: under one, no
/// app hears a key pressed in another, `XWayland`'s included.
pub fn wayland_session() -> bool {
    static SESSION: OnceLock<bool> = OnceLock::new();
    *SESSION.get_or_init(|| {
        session_is_wayland(
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        )
    })
}

fn session_is_wayland(display: Option<&str>, kind: Option<&str>) -> bool {
    display.is_some_and(|display| !display.is_empty()) || kind == Some("wayland")
}

/// Asks GTK which display it opened. On the event loop's thread, once, before any window
/// is placed: GTK may be asked nothing anywhere else.
pub fn learn() {
    let _ = DRAWN_ON_WAYLAND.get_or_init(gdk_on_wayland);
}

fn gdk_on_wayland() -> bool {
    use gtk::glib::object::ObjectExt as _;
    gtk::gdk::Display::default()
        .is_some_and(|display| display.type_().name() == "GdkWaylandDisplay")
}

/// Whether the app may put its windows anywhere: not on Wayland, where the compositor
/// places them.
pub fn places_windows() -> bool {
    !DRAWN_ON_WAYLAND.get().copied().unwrap_or(false)
}

/// A token for the next window to come forward: a second launch's, or a key's from any
/// app.
pub fn token_arrived(token: String) {
    *PENDING.lock().unwrap_or_else(PoisonError::into_inner) = Some((token, Instant::now()));
}

/// The token waiting, where it is still fresh, taken.
fn fresh_token() -> Option<String> {
    let (token, at) = PENDING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()?;
    (at.elapsed() < FRESH).then_some(token)
}

/// The token waiting for the window coming forward now, where there is a compositor to
/// show it to; `raised` in placement.rs hands it to GTK on the event loop's thread, then
/// brings the window forward.
pub fn token_for_raise() -> Option<String> {
    if places_windows() {
        return None;
    }
    fresh_token()
}

/// The token handed to GTK, which shows it to the compositor with the next window that
/// asks to come forward.
#[allow(
    unsafe_code,
    reason = "GTK 3's Wayland display has no safe binding for its startup token"
)]
pub fn hand_gtk(token: &str) {
    use gtk::glib::object::{ObjectExt as _, ObjectType as _};

    let Some(display) = gtk::gdk::Display::default() else {
        return;
    };
    if display.type_().name() != "GdkWaylandDisplay" {
        return;
    }
    let Ok(token) = std::ffi::CString::new(token) else {
        return;
    };
    // SAFETY: the display is GDK's Wayland display, checked just above and alive for the
    // call, and GDK copies the string before it returns.
    unsafe {
        gdk_wayland_sys::gdk_wayland_display_set_startup_notification_id(
            display.as_ptr().cast(),
            token.as_ptr(),
        );
    }
}

/// Disable accelerated compositing for native Wayland sessions, before `WebKitGTK` starts.
///
/// `WebKitGTK`'s accelerated compositing has produced repeated blank or partially rendered
/// frames on Wayland. Its software compositing path avoids that surface handoff. Leave
/// X11 alone, and let a reader's explicit setting take precedence.
pub fn prepare_rendering() {
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some() {
        return;
    }

    let wayland = std::env::var_os("GDK_BACKEND").map_or_else(
        || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|display| !display.is_empty()),
        |backend| {
            backend
                .to_string_lossy()
                .split(',')
                .next()
                .is_some_and(|one| one.trim().eq_ignore_ascii_case("wayland"))
        },
    );
    if wayland {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dmabuf_goes_off_on_nvidia_unless_somebody_said() {
        assert!(dmabuf_off(true, false));
        assert!(!dmabuf_off(true, true));
        assert!(!dmabuf_off(false, false));
    }

    #[test]
    fn a_session_is_wayland_by_its_display_or_its_type() {
        assert!(session_is_wayland(Some("wayland-0"), None));
        assert!(session_is_wayland(None, Some("wayland")));
        assert!(!session_is_wayland(Some(""), Some("x11")));
        assert!(!session_is_wayland(None, None));
    }

    #[test]
    fn a_token_is_taken_once() {
        token_arrived("one".into());
        assert_eq!(fresh_token().as_deref(), Some("one"));
        assert_eq!(fresh_token(), None);
    }
}
