//! The window moved by its own title bar and resized by its edges, on Linux.
//!
//! Orden draws its own frame (`decorations: false`), so the window manager has no title
//! bar or border of the app's to take a press on: a press on the app's tab strip asks
//! for a move (`data-tauri-drag-region`, which Tauri's own script answers with
//! `start_dragging`), and the edges ask for a resize. On CEF neither reached the window
//! manager (#427, Fedora 44 under KDE): the runtime moves a window through GTK's
//! `begin_move`, which needs the press GTK saw, and GTK sees none - every press lands
//! on Chromium's own X11 window inside GTK's, the app's page covering all of it.
//!
//! So the press is told to the window manager directly, as Chromium does for a window
//! of its own and GTK for one of its: `_NET_WM_MOVERESIZE`, sent to the root window
//! with where the pointer is on the screen and the button that is held, after this
//! connection lets go of any grab of its own. Every window manager that follows the
//! EWMH takes it - `KWin`, Mutter, Xfwm, Openbox - and so does a Wayland compositor for
//! an `XWayland` window, which is what Orden's is (see linux.rs). The page asks through
//! `SCRIPT`, put into the app's own page before anything of it runs: it hears the
//! presses Tauri's script hands to `start_dragging` first, and asks for the move once
//! the pointer has gone a few pixels with the button held, as GTK's own title bar does;
//! it finds the edges itself, and shows the cursor a border shows there. A double click
//! on the tab strip is still Tauri's: it maximises the window, which needs no press.

/// What the app's own page runs on CEF, before any of its own scripts: see the top of
/// this file.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SCRIPT: &str = include_str!("window_drag.js");

/// Moves the window `webview` is in with the pointer, or resizes it by `edge` - `n`,
/// `ne`, `e`, `se`, `s`, `sw`, `w` or `nw` - for as long as the button that was pressed
/// on it is held: asked by `SCRIPT` the moment the press lands. A resize is refused
/// where the window is maximised or fills the screen, and nothing happens where there
/// is no X11 window to move (any platform but Linux, which moves its own).
#[tauri::command(async)]
pub fn window_move_resize(webview: tauri::Webview, edge: Option<String>) -> Result<(), String> {
    let direction = match edge.as_deref() {
        None => MOVE,
        Some(edge) => direction_of(edge).ok_or_else(|| format!("{edge} is not an edge"))?,
    };
    #[cfg(feature = "cef")]
    {
        use tauri::Manager as _;
        let window = webview.window();
        if direction != MOVE
            && (window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false))
        {
            return Ok(());
        }
        let done = x11::move_resize(&window, direction);
        // Said in the log, which is the one place a window manager that took no notice
        // can be told apart from a press that never asked.
        crate::logs::say(
            webview.app_handle(),
            if done.is_ok() { "info" } else { "error" },
            &match &done {
                Ok(said) => format!("window: {said}"),
                Err(error) => format!("window: no move or resize ({error})"),
            },
        );
        done.map(|_| ())
    }
    #[cfg(not(feature = "cef"))]
    {
        let _ = (webview, direction);
        Ok(())
    }
}

/// `_NET_WM_MOVERESIZE`'s word for a move.
const MOVE: u32 = 8;

/// `_NET_WM_MOVERESIZE`'s word for a resize by `edge`: from the top left corner round.
fn direction_of(edge: &str) -> Option<u32> {
    Some(match edge {
        "nw" => 0,
        "n" => 1,
        "ne" => 2,
        "e" => 3,
        "se" => 4,
        "s" => 5,
        "sw" => 6,
        "w" => 7,
        _ => return None,
    })
}

#[cfg(feature = "cef")]
mod x11 {
    use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{ClientMessageEvent, ConnectionExt as _, EventMask, KeyButMask};
    use x11rb::wrapper::ConnectionExt as _;
    use x11rb::CURRENT_TIME;

    /// The message, for the window `window` is: where the pointer is on the screen now,
    /// and the first button held, which is the one the press was made with.
    pub fn move_resize(
        window: &tauri::Window<crate::Engine>,
        direction: u32,
    ) -> Result<String, String> {
        let xid = window
            .window_handle()
            .ok()
            .and_then(|handle| match handle.as_raw() {
                RawWindowHandle::Xlib(x) => u32::try_from(x.window).ok(),
                RawWindowHandle::Xcb(x) => Some(x.window.get()),
                _ => None,
            })
            .ok_or("the window has no X11 window to move")?;
        let (x, screen) = x11rb::connect(None).map_err(|error| error.to_string())?;
        let root = x.setup().roots[screen].root;
        let pointer = x
            .query_pointer(root)
            .map_err(|error| error.to_string())?
            .reply()
            .map_err(|error| error.to_string())?;
        let held = u16::from(pointer.mask);
        let button = [
            (KeyButMask::BUTTON1, 1),
            (KeyButMask::BUTTON2, 2),
            (KeyButMask::BUTTON3, 3),
        ]
        .into_iter()
        .find(|(mask, _)| held & u16::from(*mask) != 0)
        .map_or(1, |(_, button)| button);
        let atom = x
            .intern_atom(false, b"_NET_WM_MOVERESIZE")
            .map_err(|error| error.to_string())?
            .reply()
            .map_err(|error| error.to_string())?
            .atom;
        // The window manager grabs the pointer for the move, which it cannot while a
        // client holds it; this connection's own grab, if it had one, goes first.
        let _ = x.ungrab_pointer(CURRENT_TIME);
        let message = ClientMessageEvent::new(
            32,
            xid,
            atom,
            [
                u32::try_from(pointer.root_x).unwrap_or(0),
                u32::try_from(pointer.root_y).unwrap_or(0),
                direction,
                button,
                // Said by an application, as against a pager.
                1,
            ],
        );
        x.send_event(
            false,
            root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            message,
        )
        .map_err(|error| error.to_string())?;
        x.flush().map_err(|error| error.to_string())?;
        x.sync().map_err(|error| error.to_string())?;
        Ok(format!(
            "_NET_WM_MOVERESIZE {direction} for {xid:#x} at {},{} with button {button} (held {held:#x})",
            pointer.root_x, pointer.root_y
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{direction_of, MOVE, SCRIPT};

    /// The eight edges are the EWMH's eight sizes, from the top left round, and the
    /// move is the ninth word.
    #[test]
    fn the_edges_are_the_ewmh_s() {
        let edges = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
        for (word, edge) in edges.iter().enumerate() {
            assert_eq!(direction_of(edge), u32::try_from(word).ok());
        }
        assert_eq!(direction_of("north"), None);
        assert_eq!(MOVE, 8);
    }

    /// The script asks for every edge it finds by a name the command takes, and only
    /// for a press of the first button.
    #[test]
    fn the_script_asks_by_the_command_s_names() {
        assert!(SCRIPT.contains("'window_move_resize'"));
        assert!(SCRIPT.contains("event.button !== 0"));
        for edge in ["'nw'", "'ne'", "'se'", "'sw'"] {
            assert!(SCRIPT.contains(edge), "{edge}");
        }
    }
}
