//! What a Linux desktop needs of the app beyond what the engine does by itself.
//!
//! Linux runs on CEF (Chromium) through `tauri-runtime-cef`, whose windows are GTK 4
//! windows on X11 - under `XWayland` in a Wayland session, which the runtime asks for
//! itself (`--ozone-platform=x11`, `GDK_BACKEND=x11`) because CEF parents its browsers
//! into X11 windows. So the window is an X11 window everywhere: the app may place it,
//! and Chromium draws on the GPU in both sessions, which is what the `WebKitGTK`
//! workarounds this file used to hold (DMA-BUF off on NVIDIA, accelerated compositing
//! off on Wayland, an `AppImage`'s own `GStreamer`) are no longer needed for.
//!
//! **Coming forward.** A launcher hands the program it starts the press's token as
//! `XDG_ACTIVATION_TOKEN`; an X11 window shows it to the window manager as its startup
//! id, which GTK reads under its X11 name, `DESKTOP_STARTUP_ID`, so the first window is
//! handed it under that one (`prepare`). A second launch's token travels with its
//! arguments to the app already running (`handover.rs`).
//!
//! **Keys from any app.** Under a Wayland session no app hears a key pressed in another,
//! an `XWayland` one included, so a global shortcut there is the desktop portal's
//! (`wayland_session`, hotkeys/portal.rs).

use std::sync::OnceLock;

/// The token a launcher hands the program it starts, and the name GTK reads it by on X11.
const TOKEN: &str = "XDG_ACTIVATION_TOKEN";
const STARTUP_ID: &str = "DESKTOP_STARTUP_ID";

/// The launcher's token, read before GTK took it.
static LAUNCHED_WITH: OnceLock<Option<String>> = OnceLock::new();

/// Before GTK and before any thread: the launcher's token where GTK looks for it.
pub fn prepare() {
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

/// The token this launch was started with, if the launcher gave one.
pub fn launched_with() -> Option<&'static str> {
    LAUNCHED_WITH.get().and_then(Option::as_deref)
}

/// Whether this is a Wayland session, whatever the window is drawn with: under one, no
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

/// Says to the window manager that `window` is a utility window - a small one of the
/// app's own, over the others - which a tiling one floats rather than tiles, as quick
/// add wants. Its X11 window exists from the moment it is built, since CEF parents the
/// page into it, and this is said before it is first shown, which is when a window
/// manager decides. Nothing where there is no X server or no X11 window to say it of.
pub fn float(window: &tauri::WebviewWindow<crate::Engine>) {
    use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, PropMode};
    use x11rb::wrapper::ConnectionExt as _;

    let Some(xid) = window
        .window_handle()
        .ok()
        .and_then(|handle| match handle.as_raw() {
            RawWindowHandle::Xlib(x) => u32::try_from(x.window).ok(),
            RawWindowHandle::Xcb(x) => Some(x.window.get()),
            _ => None,
        })
    else {
        return;
    };
    let Ok((x, _)) = x11rb::connect(None) else {
        return;
    };
    let atom = |name: &[u8]| {
        x.intern_atom(false, name)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| reply.atom)
    };
    if let (Some(kind), Some(utility)) = (
        atom(b"_NET_WM_WINDOW_TYPE"),
        atom(b"_NET_WM_WINDOW_TYPE_UTILITY"),
    ) {
        let _ = x.change_property32(PropMode::REPLACE, xid, kind, AtomEnum::ATOM, &[utility]);
        let _ = x.flush();
        let _ = x.sync();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_wayland_by_its_display_or_its_type() {
        assert!(session_is_wayland(Some("wayland-0"), None));
        assert!(session_is_wayland(None, Some("wayland")));
        assert!(!session_is_wayland(Some(""), Some("x11")));
        assert!(!session_is_wayland(None, None));
    }
}
