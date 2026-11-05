//! The window manager of an application's own display (issue 1063, step 5; docs/apps.md):
//! what makes the application fill the holder's tab, and the keyboard reach it.
//!
//! An Xvfb has no window manager, so an application's window opens at whatever size it
//! likes in a corner of the screen, and keeps it when the screen changes. This is the
//! least one that serves a tab:
//!
//! - **A main window fills the screen**, and fills it again whenever the screen is made
//!   another size (`display.rs`): a window that is not transient for another, not a
//!   dialog, splash, utility or other kind of its own, and that may be as large as the
//!   screen. What such a window asks for its size is answered with the screen's, as a
//!   tiling window manager answers it.
//! - **Any other window keeps its size**, within the screen, and opens in the middle of
//!   it. Menus and tooltips, which no window manager places, are left alone.
//! - **The keyboard goes to the newest window**, and to whichever one is clicked, which
//!   comes to the front; a window that goes gives it back to the one below.
//! - **The ratio is told to the toolkits** as a desktop tells it: GTK reads the scale and
//!   the dots an inch from XSETTINGS, which this owns and changes live, and Qt, Electron
//!   and the rest read `Xft.dpi` from the screen's resources.
//!
//! It draws no frames: a tab is the frame. Its thread hands the clipboard its events
//! too (`clipboard.rs`, step 6).

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use x11rb::connection::Connection as _;
use x11rb::properties::{WmHints, WmSizeHints};
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ButtonIndex, ChangeWindowAttributesAux, ClientMessageEvent,
    ConfigureNotifyEvent, ConfigureWindowAux, ConnectionExt as _, CreateWindowAux, EventMask,
    GrabMode, InputFocus, ModMask, PropMode, StackMode, Window, WindowClass,
    CONFIGURE_NOTIFY_EVENT,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;
use x11rb::{CURRENT_TIME, NONE};

use super::clipboard::Clipboard;

x11rb::atom_manager! {
    /// The names this asks the server for once.
    pub Atoms: AtomsCookie {
        WM_PROTOCOLS,
        WM_TAKE_FOCUS,
        WM_TRANSIENT_FOR,
        MANAGER,
        _NET_WM_WINDOW_TYPE,
        _NET_WM_WINDOW_TYPE_NORMAL,
        _XSETTINGS_S0,
        _XSETTINGS_SETTINGS,
        RESOURCE_MANAGER,
        UTF8_STRING,
    }
}

/// A display's window manager: its connection, which the display's resizing shares, and
/// the window that owns its settings. Its thread ends with the display.
pub struct Desk {
    connection: Arc<RustConnection>,
    root: Window,
    owner: Window,
    atoms: Atoms,
    /// Counted up by every change of the settings, as XSETTINGS asks.
    serial: AtomicU32,
    clipboard: Arc<Clipboard>,
}

impl Desk {
    /// Becomes the display's window manager and its settings' owner, at this ratio.
    pub fn open(display: &str, dpr: f64) -> Result<Desk, String> {
        let said = |error: &dyn std::fmt::Display| error.to_string();
        let (connection, screen) = x11rb::connect(Some(display)).map_err(|e| said(&e))?;
        let root = connection
            .setup()
            .roots
            .get(screen)
            .ok_or("the display has no screen")?
            .root;
        let atoms = Atoms::new(&connection)
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;
        // Only one client may redirect the root's children: the window manager.
        connection
            .change_window_attributes(
                root,
                &ChangeWindowAttributesAux::new().event_mask(
                    EventMask::SUBSTRUCTURE_REDIRECT
                        | EventMask::SUBSTRUCTURE_NOTIFY
                        | EventMask::STRUCTURE_NOTIFY,
                ),
            )
            .map_err(|e| said(&e))?
            .check()
            .map_err(|_| "the display has a window manager already")?;
        let owner = connection.generate_id().map_err(|e| said(&e))?;
        connection
            .create_window(
                0,
                owner,
                root,
                -1,
                -1,
                1,
                1,
                0,
                WindowClass::INPUT_ONLY,
                0,
                &CreateWindowAux::new(),
            )
            .map_err(|e| said(&e))?;
        let connection = Arc::new(connection);
        let clipboard = Arc::new(Clipboard::open(connection.clone(), root)?);
        let desk = Desk {
            connection,
            root,
            owner,
            atoms,
            serial: AtomicU32::new(0),
            clipboard,
        };
        desk.scale(dpr);
        let x = &desk.connection;
        let claimed = x
            .set_selection_owner(owner, atoms._XSETTINGS_S0, CURRENT_TIME)
            .and_then(|_| {
                x.send_event(
                    false,
                    root,
                    EventMask::STRUCTURE_NOTIFY,
                    ClientMessageEvent::new(
                        32,
                        root,
                        atoms.MANAGER,
                        [CURRENT_TIME, atoms._XSETTINGS_S0, owner, 0, 0],
                    ),
                )
            })
            .and_then(|_| x.flush());
        claimed.map_err(|e| said(&e))?;
        let managing = desk.connection.clone();
        let clipboard = desk.clipboard.clone();
        std::thread::spawn(move || manage(&managing, root, atoms, &clipboard));
        Ok(desk)
    }

    /// The display's clipboard.
    pub fn clipboard(&self) -> &Arc<Clipboard> {
        &self.clipboard
    }

    /// The connection, as the display's resizing uses it.
    pub fn connection(&self) -> &RustConnection {
        &self.connection
    }

    /// The screen's root window.
    pub fn root(&self) -> Window {
        self.root
    }

    /// Tells the toolkits the ratio: XSETTINGS for GTK, which follows it live, and the
    /// screen's resources for the rest.
    pub fn scale(&self, dpr: f64) {
        let serial = self.serial.fetch_add(1, Ordering::SeqCst) + 1;
        let x = &self.connection;
        let resources = format!("Xft.dpi:\t{}\n", super::display::dpi(dpr));
        let _ = x.change_property8(
            PropMode::REPLACE,
            self.root,
            self.atoms.RESOURCE_MANAGER,
            AtomEnum::STRING,
            resources.as_bytes(),
        );
        let _ = x.change_property8(
            PropMode::REPLACE,
            self.owner,
            self.atoms._XSETTINGS_SETTINGS,
            self.atoms._XSETTINGS_SETTINGS,
            &settings(dpr, serial),
        );
        let _ = x.flush();
    }
}

/// The scale GTK draws at, a whole number, and the dots an inch it lays text out at
/// within it, as a desktop says them for a ratio: 1.5 is a scale of 1 at 144 dots, 2 a
/// scale of 2 at 96.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a ratio the wire holds to at most 8"
)]
pub fn gtk_scale(dpr: f64) -> (u32, f64) {
    let dpr = super::display::ratio(dpr);
    let scale = (dpr.floor() as u32).max(1);
    (scale, 96.0 * dpr / f64::from(scale))
}

/// The XSETTINGS property for a ratio (the XSETTINGS specification): its byte order,
/// serial and settings, each a type, a name, the serial it last changed at and a value.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    reason = "values of at most 8 times 96 times 1024"
)]
pub fn settings(dpr: f64, serial: u32) -> Vec<u8> {
    let (scale, unscaled) = gtk_scale(dpr);
    let dots = f64::from(super::display::dpi(dpr));
    let all: [(&str, i32); 3] = [
        ("Gdk/WindowScalingFactor", scale as i32),
        ("Gdk/UnscaledDPI", (unscaled * 1024.0).round() as i32),
        ("Xft/DPI", (dots * 1024.0).round() as i32),
    ];
    let order = u8::from(cfg!(target_endian = "big"));
    let mut out = vec![order, 0, 0, 0];
    out.extend_from_slice(&serial.to_ne_bytes());
    out.extend_from_slice(&u32::try_from(all.len()).unwrap_or(0).to_ne_bytes());
    for (name, value) in all {
        out.extend_from_slice(&[0, 0]);
        out.extend_from_slice(&u16::try_from(name.len()).unwrap_or(0).to_ne_bytes());
        out.extend_from_slice(name.as_bytes());
        out.resize(out.len().next_multiple_of(4), 0);
        out.extend_from_slice(&serial.to_ne_bytes());
        out.extend_from_slice(&value.to_ne_bytes());
    }
    out
}

/// One window this manages: whether it fills the screen.
#[derive(Clone, Copy, Debug)]
struct Managed {
    window: Window,
    fills: bool,
}

/// The window manager's loop, until the display ends.
fn manage(x: &RustConnection, root: Window, atoms: Atoms, clipboard: &Clipboard) {
    let Some(at) = x.get_geometry(root).ok().and_then(|one| one.reply().ok()) else {
        return;
    };
    let mut screen = (at.width, at.height);
    // In stacking order: the last is in front.
    let mut managed: Vec<Managed> = Vec::new();
    loop {
        let Ok(event) = x.wait_for_event() else {
            return;
        };
        if clipboard.heard(&event) {
            continue;
        }
        match event {
            Event::MapRequest(asked) => {
                let window = asked.window;
                let fills = fills(x, &atoms, window, screen);
                managed.retain(|one| one.window != window);
                managed.push(Managed { window, fills });
                place(x, window, fills, screen);
                // A click on it brings it forward and gives it the keyboard; the click
                // itself goes on to the window.
                let _ = x.grab_button(
                    false,
                    window,
                    EventMask::BUTTON_PRESS,
                    GrabMode::SYNC,
                    GrabMode::ASYNC,
                    NONE,
                    NONE,
                    ButtonIndex::ANY,
                    ModMask::ANY,
                );
                let _ = x.map_window(window);
                focus(x, &atoms, window);
            }
            Event::ConfigureRequest(asked) => {
                if let Some(one) = managed.iter().find(|one| one.window == asked.window) {
                    if one.fills {
                        place(x, one.window, true, screen);
                        tell_where(x, one.window, screen);
                        let _ = x.flush();
                        continue;
                    }
                }
                let _ = x.configure_window(
                    asked.window,
                    &ConfigureWindowAux::from_configure_request(&asked),
                );
            }
            Event::ConfigureNotify(changed) if changed.window == root => {
                if (changed.width, changed.height) != screen {
                    screen = (changed.width, changed.height);
                    for one in &managed {
                        place(x, one.window, one.fills, screen);
                    }
                }
            }
            Event::ButtonPress(pressed) => {
                if let Some(at) = managed.iter().position(|one| one.window == pressed.event) {
                    let one = managed.remove(at);
                    managed.push(one);
                    focus(x, &atoms, one.window);
                }
                let _ =
                    x.allow_events(x11rb::protocol::xproto::Allow::REPLAY_POINTER, CURRENT_TIME);
            }
            Event::UnmapNotify(gone) if gone.event == root => {
                forget(x, &atoms, &mut managed, gone.window);
            }
            Event::DestroyNotify(gone) if gone.event == root => {
                forget(x, &atoms, &mut managed, gone.window);
            }
            _ => {}
        }
        let _ = x.flush();
    }
}

/// A window gone: the keyboard back to the one in front of what is left.
fn forget(x: &RustConnection, atoms: &Atoms, managed: &mut Vec<Managed>, window: Window) {
    let was = managed.len();
    managed.retain(|one| one.window != window);
    if managed.len() != was {
        if let Some(front) = managed.last() {
            focus(x, atoms, front.window);
        }
    }
}

/// Whether a window is a main one, which fills the screen: not transient for another,
/// of no kind but the normal one, and allowed to be as large as the screen.
fn fills(x: &RustConnection, atoms: &Atoms, window: Window, screen: (u16, u16)) -> bool {
    let transient = x
        .get_property(
            false,
            window,
            atoms.WM_TRANSIENT_FOR,
            AtomEnum::WINDOW,
            0,
            1,
        )
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .and_then(|reply| reply.value32().and_then(|mut values| values.next()))
        .is_some_and(|parent| parent != NONE);
    if transient {
        return false;
    }
    let kind = x
        .get_property(
            false,
            window,
            atoms._NET_WM_WINDOW_TYPE,
            AtomEnum::ATOM,
            0,
            1,
        )
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .and_then(|reply| reply.value32().and_then(|mut values| values.next()));
    if kind.is_some_and(|kind| kind != atoms._NET_WM_WINDOW_TYPE_NORMAL) {
        return false;
    }
    let hints = WmSizeHints::get_normal_hints(x, window)
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .flatten();
    let most = hints.and_then(|hints| hints.max_size);
    may_fill(most, screen)
}

/// Whether a window whose hints say it may be at most `most` may fill the screen.
fn may_fill(most: Option<(i32, i32)>, screen: (u16, u16)) -> bool {
    most.is_none_or(|(wide, high)| {
        (wide <= 0 || wide >= i32::from(screen.0)) && (high <= 0 || high >= i32::from(screen.1))
    })
}

/// Where a window goes: the whole screen, or its own size within it, in the middle.
pub fn placed(fills: bool, size: (u16, u16), screen: (u16, u16)) -> (i16, i16, u16, u16) {
    if fills {
        return (0, 0, screen.0.max(1), screen.1.max(1));
    }
    let wide = size.0.clamp(1, screen.0.max(1));
    let high = size.1.clamp(1, screen.1.max(1));
    let left = i16::try_from((screen.0 - wide) / 2).unwrap_or(0);
    let top = i16::try_from((screen.1 - high) / 2).unwrap_or(0);
    (left, top, wide, high)
}

fn place(x: &RustConnection, window: Window, fills: bool, screen: (u16, u16)) {
    let size = x
        .get_geometry(window)
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .map_or(screen, |at| (at.width, at.height));
    let (left, top, wide, high) = placed(fills, size, screen);
    let _ = x.configure_window(
        window,
        &ConfigureWindowAux::new()
            .x(i32::from(left))
            .y(i32::from(top))
            .width(u32::from(wide))
            .height(u32::from(high))
            .border_width(0),
    );
}

/// What a window that asked for another size is told it has, as ICCCM asks of a
/// window manager that does not do what it asked.
fn tell_where(x: &RustConnection, window: Window, screen: (u16, u16)) {
    let event = ConfigureNotifyEvent {
        response_type: CONFIGURE_NOTIFY_EVENT,
        sequence: 0,
        event: window,
        window,
        above_sibling: NONE,
        x: 0,
        y: 0,
        width: screen.0,
        height: screen.1,
        border_width: 0,
        override_redirect: false,
    };
    let _ = x.send_event(false, window, EventMask::STRUCTURE_NOTIFY, event);
}

/// Brings a window forward and gives it the keyboard, as it asks to be given it: by the
/// server, or by being told to take it (`WM_TAKE_FOCUS`), or both.
fn focus(x: &RustConnection, atoms: &Atoms, window: Window) {
    let _ = x.configure_window(
        window,
        &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE),
    );
    let takes = x
        .get_property(false, window, atoms.WM_PROTOCOLS, AtomEnum::ATOM, 0, 32)
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .and_then(|reply| {
            reply
                .value32()
                .map(|mut all| all.any(|one: Atom| one == atoms.WM_TAKE_FOCUS))
        })
        .unwrap_or(false);
    let input = WmHints::get(x, window)
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .flatten()
        .and_then(|hints| hints.input)
        .unwrap_or(true);
    if input {
        let _ = x.set_input_focus(InputFocus::PARENT, window, CURRENT_TIME);
    }
    if takes {
        let _ = x.send_event(
            false,
            window,
            EventMask::NO_EVENT,
            ClientMessageEvent::new(
                32,
                window,
                atoms.WM_PROTOCOLS,
                [atoms.WM_TAKE_FOCUS, CURRENT_TIME, 0, 0, 0],
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_a_main_window_over_the_screen_and_any_other_in_its_middle() {
        assert_eq!(placed(true, (300, 200), (1280, 800)), (0, 0, 1280, 800));
        assert_eq!(placed(false, (300, 200), (1280, 800)), (490, 300, 300, 200));
        assert_eq!(placed(false, (3000, 200), (1280, 800)), (0, 300, 1280, 200));
    }

    #[test]
    fn lets_a_window_fill_the_screen_unless_its_hints_hold_it_smaller() {
        assert!(may_fill(None, (1280, 800)));
        assert!(may_fill(Some((4096, 4096)), (1280, 800)));
        assert!(may_fill(Some((0, 0)), (1280, 800)));
        assert!(!may_fill(Some((400, 300)), (1280, 800)));
        assert!(!may_fill(Some((4096, 300)), (1280, 800)));
    }

    #[test]
    fn says_the_ratio_as_a_desktop_says_it_to_gtk() {
        assert_eq!(gtk_scale(1.0), (1, 96.0));
        assert_eq!(gtk_scale(1.5), (1, 144.0));
        assert_eq!(gtk_scale(2.0), (2, 96.0));
        assert_eq!(gtk_scale(2.5), (2, 120.0));
        let bytes = settings(2.0, 7);
        assert_eq!(bytes[0], u8::from(cfg!(target_endian = "big")));
        assert_eq!(&bytes[4..8], &7_u32.to_ne_bytes());
        assert_eq!(&bytes[8..12], &3_u32.to_ne_bytes());
        // The first setting: an integer, its name, padded to four, its serial, its value.
        assert_eq!(bytes[12], 0);
        assert_eq!(&bytes[14..16], &23_u16.to_ne_bytes());
        assert_eq!(&bytes[16..39], b"Gdk/WindowScalingFactor");
        assert_eq!(&bytes[40..44], &7_u32.to_ne_bytes());
        assert_eq!(&bytes[44..48], &2_i32.to_ne_bytes());
        assert_eq!(bytes.len() % 4, 0);
        let end = bytes.len();
        assert_eq!(&bytes[end - 4..], &(192 * 1024_i32).to_ne_bytes());
    }

    /// On a real Xvfb: a main window opened in a corner fills the screen, and fills it
    /// again when the screen changes; a dialog keeps its size in the middle; the newest
    /// has the keyboard, and the one below has it back when it goes. CI installs Xvfb;
    /// elsewhere the test says nothing without it.
    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "one display's windows, told in the order they come and go"
    )]
    fn fills_the_screen_with_the_main_window_and_follows_it() {
        if !super::super::display::available() {
            assert!(
                std::env::var_os("CI").is_none(),
                "CI installs xvfb for this test"
            );
            return;
        }
        let display = super::super::display::Display::start(800, 600, 1.0).unwrap();
        let (x, screen) = x11rb::connect(Some(display.name().as_str())).unwrap();
        let root = x.setup().roots[screen].root;
        let atoms = Atoms::new(&x).unwrap().reply().unwrap();
        let open = |width: u16, height: u16, transient_for: Option<Window>| {
            let window = x.generate_id().unwrap();
            x.create_window(
                0,
                window,
                root,
                5,
                5,
                width,
                height,
                0,
                WindowClass::INPUT_OUTPUT,
                0,
                &CreateWindowAux::new(),
            )
            .unwrap();
            if let Some(parent) = transient_for {
                x.change_property32(
                    PropMode::REPLACE,
                    window,
                    atoms.WM_TRANSIENT_FOR,
                    AtomEnum::WINDOW,
                    &[parent],
                )
                .unwrap();
            }
            x.map_window(window).unwrap();
            x.flush().unwrap();
            window
        };
        let geometry = |window: Window| {
            let at = x.get_geometry(window).unwrap().reply().unwrap();
            (at.x, at.y, at.width, at.height)
        };
        let settle = |window: Window, want: (i16, i16, u16, u16)| {
            let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while geometry(window) != want && std::time::Instant::now() < until {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            geometry(window)
        };
        let focused = || x.get_input_focus().unwrap().reply().unwrap().focus;

        let main = open(300, 200, None);
        assert_eq!(settle(main, (0, 0, 800, 600)), (0, 0, 800, 600));
        assert_eq!(focused(), main);
        // Asking for another size is answered with the screen's.
        x.configure_window(main, &ConfigureWindowAux::new().width(100).height(100))
            .unwrap();
        x.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(geometry(main), (0, 0, 800, 600));

        let dialog = open(200, 100, Some(main));
        assert_eq!(settle(dialog, (300, 250, 200, 100)), (300, 250, 200, 100));
        assert_eq!(focused(), dialog);

        display.fit(1024, 768, 1.0).unwrap();
        assert_eq!(settle(main, (0, 0, 1024, 768)), (0, 0, 1024, 768));
        assert_eq!(settle(dialog, (412, 334, 200, 100)), (412, 334, 200, 100));

        x.destroy_window(dialog).unwrap();
        x.flush().unwrap();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while focused() != main && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(focused(), main);

        // The ratio, as GTK reads it.
        let owner = x
            .get_selection_owner(atoms._XSETTINGS_S0)
            .unwrap()
            .reply()
            .unwrap()
            .owner;
        assert_ne!(owner, NONE);
        display.fit(1024, 768, 2.0).unwrap();
        let read = x
            .get_property(
                false,
                owner,
                atoms._XSETTINGS_SETTINGS,
                atoms._XSETTINGS_SETTINGS,
                0,
                1024,
            )
            .unwrap()
            .reply()
            .unwrap();
        assert_eq!(read.value[44..48], 2_i32.to_ne_bytes());
        let resources = x
            .get_property(
                false,
                root,
                atoms.RESOURCE_MANAGER,
                AtomEnum::STRING,
                0,
                1024,
            )
            .unwrap()
            .reply()
            .unwrap();
        assert_eq!(resources.value, b"Xft.dpi:\t192\n");
    }
}
