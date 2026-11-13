use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, PoisonError};

use orden_web_engine::{Edge, Failure, FailureKind, NativeWindow, Outcome, WindowSystem};
use x11rb::connection::Connection as _;
use x11rb::protocol::xproto::{
    AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConfigureWindowAux,
    ConnectionExt as _, CreateWindowAux, EventMask, KeyButMask, PropMode, StackMode, WindowClass,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;
use x11rb::CURRENT_TIME;

pub(super) struct X11;

fn failed(message: impl Into<String>) -> Failure {
    Failure::new("web-engine", FailureKind::Failed, message)
}

fn id_of(window: NativeWindow) -> Outcome<u32> {
    window
        .as_x11()
        .ok_or_else(|| Failure::new("web-engine", FailureKind::Invalid, "not an X11 window"))
}

static X: LazyLock<Option<RustConnection>> =
    LazyLock::new(|| x11rb::connect(None).ok().map(|(x, _)| x));

impl WindowSystem for X11 {
    fn name(&self) -> &'static str {
        "x11"
    }

    fn move_resize(
        &self,
        window: NativeWindow,
        edge: Edge,
        from: Option<(i32, i32)>,
    ) -> Outcome<String> {
        move_resize(id_of(window)?, edge.ewmh(), from).map_err(failed)
    }

    fn frame(&self, window: NativeWindow, scale: f64) -> Outcome<()> {
        frame(id_of(window)?, scale).map_err(failed)
    }

    fn float(&self, window: NativeWindow) -> Outcome<()> {
        let xid = id_of(window)?;
        let Some(x) = X.as_ref() else {
            return Err(failed("no X server"));
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
        Ok(())
    }

    fn bare(&self, page: NativeWindow) {
        let (Some(window), Some(x)) = (page.as_x11(), X.as_ref()) else {
            return;
        };
        let none = ChangeWindowAttributesAux::new().background_pixmap(x11rb::NONE);
        let mut todo = vec![window];
        let mut seen = 0;
        while let Some(one) = todo.pop() {
            seen += 1;
            if seen > 256 {
                break;
            }
            let _ = x.change_window_attributes(one, &none);
            let Ok(asked) = x.query_tree(one) else {
                continue;
            };
            if let Ok(tree) = asked.reply() {
                todo.extend(tree.children);
            }
        }
        let _ = x.flush();
    }

    fn hide(&self, page: NativeWindow) {
        let (Some(window), Some(x)) = (page.as_x11(), X.as_ref()) else {
            return;
        };
        let _ = x.unmap_window(window);
        let _ = x.sync();
    }

    fn desktop_scale(&self) -> Option<f64> {
        let (x, screen) = x11rb::connect(None).ok()?;
        let atom = |name: &str| {
            x.intern_atom(false, name.as_bytes())
                .ok()?
                .reply()
                .ok()
                .map(|reply| reply.atom)
        };
        let owner = x
            .get_selection_owner(atom(&format!("_XSETTINGS_S{screen}"))?)
            .ok()?
            .reply()
            .ok()?
            .owner;
        if owner == x11rb::NONE {
            return None;
        }
        let settings = atom("_XSETTINGS_SETTINGS")?;
        let data = x
            .get_property(false, owner, settings, AtomEnum::ANY, 0, u32::MAX / 4)
            .ok()?
            .reply()
            .ok()?
            .value;
        crate::page_scale::scale_of_dpi(crate::page_scale::xsettings_int(&data, "Xft/DPI")?)
    }
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

struct Border {
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
    edges: Vec<(Border, bool)>,
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
                edges.push((Border { id, direction }, arm));
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
    use x11rb::protocol::xproto::{ButtonReleaseEvent, GrabMode, GrabStatus, BUTTON_RELEASE_EVENT};

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
    xid: u32,
    direction: u32,
    pressed: Option<(i32, i32)>,
) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::place;

    #[test]
    fn the_edges_go_round_the_window() {
        assert_eq!(place(1, false, 900, 600, 5, 14), (14, 0, 872, 5));
        assert_eq!(place(3, false, 900, 600, 5, 14), (895, 14, 5, 572));
        assert_eq!(place(5, false, 900, 600, 5, 14), (14, 595, 872, 5));
        assert_eq!(place(7, false, 900, 600, 5, 14), (0, 14, 5, 572));
        assert_eq!(place(4, false, 900, 600, 5, 14), (886, 595, 14, 5));
        assert_eq!(place(4, true, 900, 600, 5, 14), (895, 586, 5, 14));
        assert_eq!(place(0, true, 900, 600, 5, 14), (0, 0, 5, 14));
    }
}
