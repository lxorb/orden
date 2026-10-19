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
//!
//! The edges are not only the app's page's, though: a web tab's page is a browser of its
//! own, an X11 window over the app's, and where it reaches the window's edge a press
//! there was the site's, and the window could not be resized by that edge at all. So
//! the edges are the window's own as well: eight thin windows of nothing but input along
//! the window's edges and corners, inside it and above every page in it, each with a
//! border's cursor, which ask for the resize themselves (`window_frame`, which the
//! script asks for once the page is up). Taken away while the window is maximised or
//! fills the screen, where it has no edges.

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
pub fn window_move_resize(
    webview: tauri::Webview,
    edge: Option<String>,
    at: Option<Pressed>,
) -> Result<(), String> {
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
        let done = x11::move_resize(&window, direction, at.map(|at| (at.x, at.y)));
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
        let _ = (webview, direction, at);
        Ok(())
    }
}

/// Gives the window `webview` is in its edges (see the top of this file), once: asked by
/// `SCRIPT` each time the app's page in it loads. Nothing for a window that cannot be
/// resized, or where there is no X11 window (any platform but Linux).
#[tauri::command(async)]
pub fn window_frame(webview: tauri::Webview) -> Result<(), String> {
    #[cfg(feature = "cef")]
    {
        let window = webview.window();
        if !window.is_resizable().unwrap_or(false) {
            return Ok(());
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let xid = x11::xid(&window)?;
        x11::frame(xid, scale)
    }
    #[cfg(not(feature = "cef"))]
    {
        let _ = webview;
        Ok(())
    }
}

/// Where a press was on the screen, in its own pixels.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub struct Pressed {
    x: i32,
    y: i32,
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
    use std::collections::HashSet;
    use std::sync::{LazyLock, Mutex, PoisonError};

    use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{
        AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConfigureWindowAux,
        ConnectionExt as _, CreateWindowAux, EventMask, KeyButMask, StackMode, WindowClass,
    };
    use x11rb::protocol::Event;
    use x11rb::rust_connection::RustConnection;
    use x11rb::wrapper::ConnectionExt as _;
    use x11rb::CURRENT_TIME;

    /// The window's own X11 window: the one the window manager frames.
    pub fn xid(window: &tauri::Window<crate::Engine>) -> Result<u32, String> {
        window
            .window_handle()
            .ok()
            .and_then(|handle| match handle.as_raw() {
                RawWindowHandle::Xlib(x) => u32::try_from(x.window).ok(),
                RawWindowHandle::Xcb(x) => Some(x.window.get()),
                _ => None,
            })
            .ok_or_else(|| "the window has no X11 window to move".to_owned())
    }

    /// The windows given their edges, so a page loaded again does not give them twice.
    static FRAMED: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Mutex::default);

    fn framed<T>(look: impl FnOnce(&mut HashSet<u32>) -> T) -> T {
        look(&mut FRAMED.lock().unwrap_or_else(PoisonError::into_inner))
    }

    /// Gives `window` its edges, at `scale`, on a thread and a connection of their own
    /// that last as long as it does.
    pub fn frame(window: u32, scale: f64) -> Result<(), String> {
        if !framed(|all| all.insert(window)) {
            return Ok(());
        }
        let started = x11rb::connect(None)
            .map_err(|error| error.to_string())
            .and_then(|(x, screen)| {
                std::thread::Builder::new()
                    .name("window edges".into())
                    .spawn(move || {
                        let _ = Frame::run(&x, screen, window, scale);
                        framed(|all| all.remove(&window));
                    })
                    .map_err(|error| error.to_string())
            });
        if started.is_err() {
            framed(|all| all.remove(&window));
        }
        started.map(|_| ())
    }

    /// How thick an edge is, and how far along the window's sides a corner reaches, in
    /// the page's own pixels: as `SCRIPT` has them.
    const EDGE: f64 = 5.0;
    const CORNER: f64 = 14.0;

    /// One of the window's edges: an input-only window inside it, and the direction a
    /// press on it resizes in. A corner is two, one along each side.
    struct Edge {
        id: u32,
        direction: u32,
    }

    /// Where an edge goes in a window `wide` by `tall`, thick `edge` and with corners
    /// `corner` long: left, top, width, height.
    pub(super) fn place(
        direction: u32,
        arm: bool,
        wide: i32,
        tall: i32,
        edge: i32,
        corner: i32,
    ) -> (i32, i32, i32, i32) {
        let (c, e) = (corner, edge);
        match (direction, arm) {
            // nw, ne, se, sw: along the top or bottom, then along the side.
            (0, false) => (0, 0, c, e),
            (0, true) => (0, 0, e, c),
            (2, false) => (wide - c, 0, c, e),
            (2, true) => (wide - e, 0, e, c),
            (4, false) => (wide - c, tall - e, c, e),
            (4, true) => (wide - e, tall - c, e, c),
            (6, false) => (0, tall - e, c, e),
            (6, true) => (0, tall - c, e, c),
            (1, _) => (c, 0, wide - 2 * c, e),
            (3, _) => (wide - e, c, e, tall - 2 * c),
            (5, _) => (c, tall - e, wide - 2 * c, e),
            _ => (0, c, e, tall - 2 * c),
        }
    }

    /// The cursor a border shows, by the direction it resizes in.
    const CURSORS: [&str; 8] = [
        "top_left_corner",
        "top_side",
        "top_right_corner",
        "right_side",
        "bottom_right_corner",
        "bottom_side",
        "bottom_left_corner",
        "left_side",
    ];

    struct Frame<'a> {
        x: &'a RustConnection,
        root: u32,
        window: u32,
        edges: Vec<(Edge, bool)>,
        edge: i32,
        corner: i32,
        size: (i32, i32),
        moveresize: u32,
        state: u32,
        filling: [u32; 3],
        shown: bool,
    }

    impl Frame<'_> {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "an edge is a few pixels at any scale"
        )]
        fn run(
            x: &RustConnection,
            screen: usize,
            window: u32,
            scale: f64,
        ) -> Result<(), Box<dyn std::error::Error>> {
            let root = x.setup().roots[screen].root;
            let atom = |name: &[u8]| -> Result<u32, Box<dyn std::error::Error>> {
                Ok(x.intern_atom(false, name)?.reply()?.atom)
            };
            let database = x11rb::resource_manager::new_from_default(x)?;
            let cursors = x11rb::cursor::Handle::new(x, screen, &database)?.reply()?;
            x.change_window_attributes(
                window,
                &ChangeWindowAttributesAux::new().event_mask(
                    EventMask::STRUCTURE_NOTIFY
                        | EventMask::SUBSTRUCTURE_NOTIFY
                        | EventMask::PROPERTY_CHANGE,
                ),
            )?;
            let mut edges = Vec::new();
            for direction in 0..8_u32 {
                let cursor = cursors.load_cursor(x, CURSORS[direction as usize])?;
                let arms: &[bool] = if direction % 2 == 0 {
                    &[false, true]
                } else {
                    &[false]
                };
                for &arm in arms {
                    let id = x.generate_id()?;
                    x.create_window(
                        0,
                        id,
                        window,
                        0,
                        0,
                        1,
                        1,
                        0,
                        WindowClass::INPUT_ONLY,
                        0,
                        &CreateWindowAux::new()
                            .event_mask(EventMask::BUTTON_PRESS)
                            .cursor(cursor),
                    )?;
                    edges.push((Edge { id, direction }, arm));
                }
            }
            let mut edges = Frame {
                x,
                root,
                window,
                edges,
                edge: (EDGE * scale).round().max(2.0) as i32,
                corner: (CORNER * scale).round().max(4.0) as i32,
                size: (0, 0),
                moveresize: atom(b"_NET_WM_MOVERESIZE")?,
                state: atom(b"_NET_WM_STATE")?,
                filling: [
                    atom(b"_NET_WM_STATE_MAXIMIZED_VERT")?,
                    atom(b"_NET_WM_STATE_MAXIMIZED_HORZ")?,
                    atom(b"_NET_WM_STATE_FULLSCREEN")?,
                ],
                shown: false,
            };
            let geometry = x.get_geometry(window)?.reply()?;
            edges.fit(i32::from(geometry.width), i32::from(geometry.height))?;
            edges.show()?;
            x.flush()?;
            edges.hear()
        }

        fn ours(&self, id: u32) -> bool {
            self.edges.iter().any(|(edge, _)| edge.id == id)
        }

        /// Each edge put where it goes in a window `wide` by `tall`.
        fn fit(&mut self, wide: i32, tall: i32) -> Result<(), Box<dyn std::error::Error>> {
            if (wide, tall) == self.size {
                return Ok(());
            }
            self.size = (wide, tall);
            for (edge, arm) in &self.edges {
                let (left, top, width, height) =
                    place(edge.direction, *arm, wide, tall, self.edge, self.corner);
                self.x.configure_window(
                    edge.id,
                    &ConfigureWindowAux::new()
                        .x(left)
                        .y(top)
                        .width(u32::try_from(width.max(1)).unwrap_or(1))
                        .height(u32::try_from(height.max(1)).unwrap_or(1))
                        .stack_mode(StackMode::ABOVE),
                )?;
            }
            Ok(())
        }

        /// The edges above every other window inside the window: a page's browser made or
        /// moved goes on top of its siblings, and the edges then go back above it.
        fn raise(&self) -> Result<(), Box<dyn std::error::Error>> {
            for (edge, _) in &self.edges {
                self.x.configure_window(
                    edge.id,
                    &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE),
                )?;
            }
            Ok(())
        }

        /// Shown where the window has edges, and taken away where it is maximised or
        /// fills the screen.
        fn show(&mut self) -> Result<(), Box<dyn std::error::Error>> {
            let state = self
                .x
                .get_property(false, self.window, self.state, AtomEnum::ATOM, 0, 32)?
                .reply()?;
            let held: Vec<u32> = state.value32().map(Iterator::collect).unwrap_or_default();
            let filling = held.contains(&self.filling[2])
                || (held.contains(&self.filling[0]) && held.contains(&self.filling[1]));
            if filling != self.shown {
                return Ok(());
            }
            self.shown = !filling;
            for (edge, _) in &self.edges {
                if self.shown {
                    self.x.map_window(edge.id)?;
                } else {
                    self.x.unmap_window(edge.id)?;
                }
            }
            if self.shown {
                self.raise()?;
            }
            Ok(())
        }

        fn hear(&mut self) -> Result<(), Box<dyn std::error::Error>> {
            loop {
                let event = self.x.wait_for_event()?;
                match event {
                    Event::DestroyNotify(gone) if gone.window == self.window => return Ok(()),
                    Event::ConfigureNotify(moved) if moved.window == self.window => {
                        self.fit(i32::from(moved.width), i32::from(moved.height))?;
                    }
                    Event::ConfigureNotify(moved)
                        if moved.event == self.window && !self.ours(moved.window) =>
                    {
                        self.raise()?;
                    }
                    Event::MapNotify(shown)
                        if shown.event == self.window && !self.ours(shown.window) =>
                    {
                        self.raise()?;
                    }
                    Event::CreateNotify(made)
                        if made.parent == self.window && !self.ours(made.window) =>
                    {
                        self.raise()?;
                    }
                    Event::PropertyNotify(changed)
                        if changed.window == self.window && changed.atom == self.state =>
                    {
                        self.show()?;
                    }
                    Event::ButtonPress(pressed) if pressed.detail == 1 => {
                        let Some((edge, _)) =
                            self.edges.iter().find(|(edge, _)| edge.id == pressed.event)
                        else {
                            continue;
                        };
                        // The press is this connection's grab until it lets go of it,
                        // which the window manager's own grab for the resize needs.
                        self.x.ungrab_pointer(CURRENT_TIME)?;
                        self.x.send_event(
                            false,
                            self.root,
                            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                            ClientMessageEvent::new(
                                32,
                                self.window,
                                self.moveresize,
                                [
                                    u32::try_from(pressed.root_x).unwrap_or(0),
                                    u32::try_from(pressed.root_y).unwrap_or(0),
                                    edge.direction,
                                    1,
                                    1,
                                ],
                            ),
                        )?;
                    }
                    _ => {}
                }
                self.x.flush()?;
            }
        }
    }

    /// A release of `button` sent to the deepest window under the pointer inside
    /// `window`, which is Chromium's own, and the wait for Chromium to let go.
    fn let_chromium_go(
        x: &RustConnection,
        root: u32,
        window: u32,
        pointer: &x11rb::protocol::xproto::QueryPointerReply,
        button: u8,
    ) -> Result<(), String> {
        use x11rb::protocol::xproto::{
            ButtonReleaseEvent, GrabMode, GrabStatus, BUTTON_RELEASE_EVENT,
        };

        let fail = |error: &dyn std::fmt::Display| error.to_string();
        let mut under = window;
        for _ in 0..16 {
            let child = x
                .query_pointer(under)
                .map_err(|e| fail(&e))?
                .reply()
                .map_err(|e| fail(&e))?
                .child;
            if child == x11rb::NONE {
                break;
            }
            under = child;
        }
        if under == window {
            return Ok(());
        }
        let at = x
            .translate_coordinates(root, under, pointer.root_x, pointer.root_y)
            .map_err(|e| fail(&e))?
            .reply()
            .map_err(|e| fail(&e))?;
        let release = ButtonReleaseEvent {
            response_type: BUTTON_RELEASE_EVENT,
            detail: button,
            sequence: 0,
            time: CURRENT_TIME,
            root,
            event: under,
            child: x11rb::NONE,
            root_x: pointer.root_x,
            root_y: pointer.root_y,
            event_x: at.dst_x,
            event_y: at.dst_y,
            state: pointer.mask,
            same_screen: true,
        };
        x.send_event(false, under, EventMask::BUTTON_RELEASE, release)
            .map_err(|e| fail(&e))?;
        x.sync().map_err(|e| fail(&e))?;
        // Chromium has let go once a grab of this connection's own is taken, and no
        // longer than that is waited: every moment waited is a moment the pointer goes
        // on without the window, which the window manager then never makes up.
        for _ in 0..50 {
            let status = x
                .grab_pointer(
                    false,
                    root,
                    EventMask::NO_EVENT,
                    GrabMode::ASYNC,
                    GrabMode::ASYNC,
                    x11rb::NONE,
                    x11rb::NONE,
                    CURRENT_TIME,
                )
                .map_err(|e| fail(&e))?
                .reply()
                .map_err(|e| fail(&e))?
                .status;
            if status == GrabStatus::SUCCESS {
                x.ungrab_pointer(CURRENT_TIME).map_err(|e| fail(&e))?;
                x.sync().map_err(|e| fail(&e))?;
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        Err("the pointer was still held after 100 ms".into())
    }

    /// The message, for the window `window` is: where the pointer is on the screen now,
    /// and the first button held, which is the one the press was made with.
    pub fn move_resize(
        window: &tauri::Window<crate::Engine>,
        direction: u32,
        pressed: Option<(i32, i32)>,
    ) -> Result<String, String> {
        let xid = xid(window)?;
        let (x, screen) = x11rb::connect(None).map_err(|error| error.to_string())?;
        let root = x.setup().roots[screen].root;
        let pointer = x
            .query_pointer(root)
            .map_err(|error| error.to_string())?
            .reply()
            .map_err(|error| error.to_string())?;
        let held = u16::from(pointer.mask);
        let button: u8 = [
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
        // client holds it - and Chromium holds it from the press on, its own grab for
        // a drag inside the page, on a connection of its own this one cannot let go of
        // for it. KWin then took the resize and refused the move (#427). So Chromium is
        // told the button went up, as an event sent to the window the pointer is over,
        // and lets go of its grab itself, as it does at a real release; the page hears a
        // release where the press was, which ends nothing but the press. This
        // connection's own grab, if it had one, goes too.
        let _ = let_chromium_go(&x, root, xid, &pointer, button);
        let _ = x.ungrab_pointer(CURRENT_TIME);
        // From where the press was, where the page says it, and otherwise from here.
        let from = pressed.unwrap_or((i32::from(pointer.root_x), i32::from(pointer.root_y)));
        let message = ClientMessageEvent::new(
            32,
            xid,
            atom,
            [
                u32::try_from(from.0).unwrap_or(0),
                u32::try_from(from.1).unwrap_or(0),
                direction,
                u32::from(button),
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
            "_NET_WM_MOVERESIZE {direction} for {xid:#x} from {},{} with button {button} (held {held:#x})",
            from.0, from.1
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

    /// The window's edges, at 900 by 600 with edges of 5 and corners of 14: each side
    /// between its corners, and each corner along both sides.
    #[cfg(feature = "cef")]
    #[test]
    fn the_edges_go_round_the_window() {
        use super::x11::place;
        assert_eq!(place(1, false, 900, 600, 5, 14), (14, 0, 872, 5));
        assert_eq!(place(3, false, 900, 600, 5, 14), (895, 14, 5, 572));
        assert_eq!(place(5, false, 900, 600, 5, 14), (14, 595, 872, 5));
        assert_eq!(place(7, false, 900, 600, 5, 14), (0, 14, 5, 572));
        assert_eq!(place(4, false, 900, 600, 5, 14), (886, 595, 14, 5));
        assert_eq!(place(4, true, 900, 600, 5, 14), (895, 586, 5, 14));
        assert_eq!(place(0, true, 900, 600, 5, 14), (0, 0, 5, 14));
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
