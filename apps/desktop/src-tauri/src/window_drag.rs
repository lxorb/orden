#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SCRIPT: &str = include_str!("window_drag.js");

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

#[tauri::command(async)]
#[cfg_attr(
    not(feature = "cef"),
    allow(
        clippy::unnecessary_wraps,
        reason = "a command's answer, the same on every engine"
    )
)]
pub fn window_frame(webview: tauri::Webview) -> Result<(), String> {
    #[cfg(feature = "cef")]
    {
        let window = webview.window();
        if !window.is_resizable().unwrap_or(false) {
            return Ok(());
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let xid = x11::xid(&window)?;
        crate::page_hide::no_ground_in(xid);
        x11::frame(xid, scale)
    }
    #[cfg(not(feature = "cef"))]
    {
        let _ = webview;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub struct Pressed {
    x: i32,
    y: i32,
}

const MOVE: u32 = 8;

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

    static FRAMED: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Mutex::default);

    fn framed<T>(look: impl FnOnce(&mut HashSet<u32>) -> T) -> T {
        look(&mut FRAMED.lock().unwrap_or_else(PoisonError::into_inner))
    }

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

    const EDGE: f64 = 5.0;
    const CORNER: f64 = 14.0;

    struct Edge {
        id: u32,
        direction: u32,
    }

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

        fn raise(&self) -> Result<(), Box<dyn std::error::Error>> {
            for (edge, _) in &self.edges {
                self.x.configure_window(
                    edge.id,
                    &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE),
                )?;
            }
            Ok(())
        }

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
        let _ = let_chromium_go(&x, root, xid, &pointer, button);
        let _ = x.ungrab_pointer(CURRENT_TIME);
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

    #[test]
    fn the_edges_are_the_ewmh_s() {
        let edges = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
        for (word, edge) in edges.iter().enumerate() {
            assert_eq!(direction_of(edge), u32::try_from(word).ok());
        }
        assert_eq!(direction_of("north"), None);
        assert_eq!(MOVE, 8);
    }

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

    #[test]
    fn the_script_asks_by_the_command_s_names() {
        assert!(SCRIPT.contains("'window_move_resize'"));
        assert!(SCRIPT.contains("event.button !== 0"));
        for edge in ["'nw'", "'ne'", "'se'", "'sw'"] {
            assert!(SCRIPT.contains(edge), "{edge}");
        }
    }
}
