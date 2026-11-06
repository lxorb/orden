//! The clipboard between an application's display and the device holding it (issue
//! 1063, step 6; docs/apps.md): text, both ways, while the holder shares it.
//!
//! **The application copies**: whoever owns the display's `CLIPBOARD` changes (XFIXES
//! says so), and this asks the new owner for its text, which is handed to the picture's
//! connection, which sends it to the holder's tab.
//!
//! **The holder pastes**: the tab sends its clipboard's text as the paste is pressed,
//! and this takes the display's `CLIPBOARD` and gives that text to whoever asks for it,
//! as every X application asks: by `TARGETS`, `UTF8_STRING`, `STRING`, `TEXT` and the
//! MIME types.
//!
//! It runs on the window manager's connection and thread (`wm.rs`), which hand it every
//! event; nothing here waits.

use std::sync::{Arc, Mutex};

use x11rb::connection::Connection as _;
use x11rb::protocol::xfixes::{ConnectionExt as _, SelectionEventMask};
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ConnectionExt as _, CreateWindowAux, EventMask, PropMode, SelectionNotifyEvent,
    SelectionRequestEvent, Window, WindowClass, SELECTION_NOTIFY_EVENT,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;
use x11rb::{CURRENT_TIME, NONE};

/// The most text taken or given, in bytes: what one message on a data channel carries
/// in every engine (256 KiB), with room for its envelope.
pub const MOST: usize = 200 * 1024;

x11rb::atom_manager! {
    /// The names the clipboard asks the server for once.
    pub Atoms: AtomsCookie {
        CLIPBOARD,
        TARGETS,
        TEXT,
        UTF8_STRING,
        INCR,
        TEXT_PLAIN: b"text/plain",
        TEXT_PLAIN_UTF8: b"text/plain;charset=utf-8",
        ORDEN_CLIPBOARD,
    }
}

/// Who hears what the application copied.
pub type Listener = Arc<dyn Fn(String) + Send + Sync>;

/// The display's clipboard, as this computer holds it for the holder.
pub struct Clipboard {
    x: Arc<RustConnection>,
    window: Window,
    atoms: Atoms,
    /// The holder's text, given to whoever asks while this owns `CLIPBOARD`.
    given: Mutex<Option<String>>,
    listener: Mutex<Option<Listener>>,
}

impl Clipboard {
    /// The clipboard of the display `x` is connected to.
    pub fn open(x: Arc<RustConnection>, root: Window) -> Result<Clipboard, String> {
        let said = |error: &dyn std::fmt::Display| error.to_string();
        let atoms = Atoms::new(x.as_ref())
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;
        // XFIXES has to be asked its version on a connection before it is used there.
        x.xfixes_query_version(5, 0)
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;
        let window = x.generate_id().map_err(|e| said(&e))?;
        x.create_window(
            0,
            window,
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
        x.xfixes_select_selection_input(
            window,
            atoms.CLIPBOARD,
            SelectionEventMask::SET_SELECTION_OWNER,
        )
        .map_err(|e| said(&e))?;
        x.flush().map_err(|e| said(&e))?;
        Ok(Clipboard {
            x,
            window,
            atoms,
            given: Mutex::new(None),
            listener: Mutex::new(None),
        })
    }

    /// Who hears what the application copies from now on, or nobody.
    pub fn listen(&self, listener: Option<Listener>) {
        *self
            .listener
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = listener;
    }

    /// The holder's text, given to the application's paste: this takes `CLIPBOARD`.
    pub fn give(&self, text: &str) {
        let text: String = clipped(text).to_owned();
        *self
            .given
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(text);
        let _ = self
            .x
            .set_selection_owner(self.window, self.atoms.CLIPBOARD, CURRENT_TIME);
        let _ = self.x.flush();
    }

    /// One event of the display's; answers whether it was the clipboard's.
    pub fn heard(&self, event: &Event) -> bool {
        match event {
            Event::XfixesSelectionNotify(changed) if changed.selection == self.atoms.CLIPBOARD => {
                if changed.owner != NONE && changed.owner != self.window {
                    // Somebody else's now: ours is no longer what a paste gets.
                    *self
                        .given
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
                    let _ = self.x.convert_selection(
                        self.window,
                        self.atoms.CLIPBOARD,
                        self.atoms.UTF8_STRING,
                        self.atoms.ORDEN_CLIPBOARD,
                        changed.selection_timestamp,
                    );
                    let _ = self.x.flush();
                }
                true
            }
            Event::SelectionNotify(answered) if answered.requestor == self.window => {
                if answered.property != NONE {
                    if let Some(text) = self.read(answered.property) {
                        let listener = self
                            .listener
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .clone();
                        if let Some(listener) = listener {
                            listener(text);
                        }
                    }
                }
                true
            }
            Event::SelectionRequest(asked) if asked.owner == self.window => {
                self.serve(asked);
                true
            }
            Event::SelectionClear(lost) if lost.owner == self.window => true,
            _ => false,
        }
    }

    /// The text the owner put on our window's property, taken off it. A transfer in
    /// pieces (`INCR`), which only text larger than X's largest request needs, is let go.
    fn read(&self, property: Atom) -> Option<String> {
        let most = u32::try_from(MOST / 4).unwrap_or(u32::MAX);
        let reply = self
            .x
            .get_property(true, self.window, property, AtomEnum::ANY, 0, most)
            .ok()?
            .reply()
            .ok()?;
        if reply.type_ == self.atoms.INCR || reply.format != 8 {
            return None;
        }
        Some(String::from_utf8_lossy(&reply.value).into_owned())
    }

    /// Answers one application's paste: the text in the form it asked for, or a refusal.
    fn serve(&self, asked: &SelectionRequestEvent) {
        // A client of the oldest kind names no property; the target is used instead.
        let property = if asked.property == NONE {
            asked.target
        } else {
            asked.property
        };
        let given = self
            .given
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let a = &self.atoms;
        let served = given.is_some_and(|text| {
            let x = &self.x;
            let put = |kind: Atom, bytes: &[u8]| {
                x.change_property8(PropMode::REPLACE, asked.requestor, property, kind, bytes)
                    .is_ok()
            };
            if asked.target == a.TARGETS {
                let targets = [
                    a.TARGETS,
                    a.UTF8_STRING,
                    AtomEnum::STRING.into(),
                    a.TEXT,
                    a.TEXT_PLAIN_UTF8,
                    a.TEXT_PLAIN,
                ];
                x.change_property32(
                    PropMode::REPLACE,
                    asked.requestor,
                    property,
                    AtomEnum::ATOM,
                    &targets,
                )
                .is_ok()
            } else if asked.target == a.UTF8_STRING || asked.target == a.TEXT {
                put(a.UTF8_STRING, text.as_bytes())
            } else if asked.target == a.TEXT_PLAIN_UTF8 || asked.target == a.TEXT_PLAIN {
                put(asked.target, text.as_bytes())
            } else if asked.target == u32::from(AtomEnum::STRING) {
                put(AtomEnum::STRING.into(), &latin1(&text))
            } else {
                false
            }
        });
        let answer = SelectionNotifyEvent {
            response_type: SELECTION_NOTIFY_EVENT,
            sequence: 0,
            time: asked.time,
            requestor: asked.requestor,
            selection: asked.selection,
            target: asked.target,
            property: if served { property } else { NONE },
        };
        let _ = self
            .x
            .send_event(false, asked.requestor, EventMask::NO_EVENT, answer);
        let _ = self.x.flush();
    }
}

/// Text cut to `MOST` bytes, at a character's edge.
pub fn clipped(text: &str) -> &str {
    if text.len() <= MOST {
        return text;
    }
    let mut end = MOST;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Text as X's `STRING`, Latin-1: a character outside it is a question mark.
pub fn latin1(text: &str) -> Vec<u8> {
    text.chars()
        .map(|one| u8::try_from(u32::from(one)).unwrap_or(b'?'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_latin1_where_it_is_asked_for_and_keeps_to_the_most() {
        assert_eq!(latin1("Grüße €"), b"Gr\xfc\xdfe ?");
        let long = "é".repeat(MOST);
        assert_eq!(clipped(&long).len(), MOST);
        assert_eq!(clipped("short"), "short");
    }

    /// On a real Xvfb, against a client of the test's own as the application: what it
    /// copies is heard, and what the holder gives is what its paste gets. CI installs
    /// Xvfb; elsewhere the test says nothing without it.
    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "one copy and one paste, told in the order they happen"
    )]
    fn carries_text_both_ways_between_the_holder_and_the_application() {
        super::super::in_time(|| {
            use std::time::{Duration, Instant};

            if !super::super::display::available() {
                assert!(
                    std::env::var_os("CI").is_none(),
                    "CI installs xvfb for this test"
                );
                return;
            }
            let display = super::super::display::Display::start(320, 240, 1.0).unwrap();
            let clipboard = display.clipboard().unwrap();
            let (heard, copied) = std::sync::mpsc::channel();
            clipboard.listen(Some(Arc::new(move |text| {
                let _ = heard.send(text);
            })));

            let (x, screen) = x11rb::connect(Some(display.name().as_str())).unwrap();
            let root = x.setup().roots[screen].root;
            let atoms = Atoms::new(&x).unwrap().reply().unwrap();
            let window = x.generate_id().unwrap();
            x.create_window(
                0,
                window,
                root,
                0,
                0,
                1,
                1,
                0,
                WindowClass::INPUT_ONLY,
                0,
                &CreateWindowAux::new(),
            )
            .unwrap();

            // The application copies: it takes the clipboard and answers the request.
            x.set_selection_owner(window, atoms.CLIPBOARD, CURRENT_TIME)
                .unwrap();
            x.flush().unwrap();
            let until = Instant::now() + Duration::from_secs(5);
            let mut answered = false;
            while !answered && Instant::now() < until {
                if let Ok(Some(Event::SelectionRequest(asked))) = x.poll_for_event() {
                    x.change_property8(
                        PropMode::REPLACE,
                        asked.requestor,
                        asked.property,
                        atoms.UTF8_STRING,
                        "von der Anwendung".as_bytes(),
                    )
                    .unwrap();
                    x.send_event(
                        false,
                        asked.requestor,
                        EventMask::NO_EVENT,
                        SelectionNotifyEvent {
                            response_type: SELECTION_NOTIFY_EVENT,
                            sequence: 0,
                            time: asked.time,
                            requestor: asked.requestor,
                            selection: asked.selection,
                            target: asked.target,
                            property: asked.property,
                        },
                    )
                    .unwrap();
                    x.flush().unwrap();
                    answered = true;
                } else {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            assert!(answered, "the clipboard asked the application for its text");
            assert_eq!(
                copied.recv_timeout(Duration::from_secs(5)).as_deref(),
                Ok("von der Anwendung")
            );

            // The holder pastes: the application asks, and gets the holder's text.
            clipboard.give("vom Halter: 日本");
            let until = Instant::now() + Duration::from_secs(5);
            while x
                .get_selection_owner(atoms.CLIPBOARD)
                .unwrap()
                .reply()
                .unwrap()
                .owner
                == window
                && Instant::now() < until
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            let ask = |target: Atom| {
                x.convert_selection(
                    window,
                    atoms.CLIPBOARD,
                    target,
                    atoms.ORDEN_CLIPBOARD,
                    CURRENT_TIME,
                )
                .unwrap();
                x.flush().unwrap();
                let until = Instant::now() + Duration::from_secs(5);
                while Instant::now() < until {
                    match x.poll_for_event() {
                        Ok(Some(Event::SelectionNotify(answer))) => {
                            if answer.property == NONE {
                                return None;
                            }
                            let reply = x
                                .get_property(true, window, answer.property, AtomEnum::ANY, 0, 1024)
                                .unwrap()
                                .reply()
                                .unwrap();
                            return Some(reply.value);
                        }
                        _ => std::thread::sleep(Duration::from_millis(5)),
                    }
                }
                None
            };
            assert_eq!(
                ask(atoms.UTF8_STRING),
                Some("vom Halter: 日本".as_bytes().to_vec())
            );
            assert_eq!(
                ask(AtomEnum::STRING.into()),
                Some(b"vom Halter: ??".to_vec())
            );
            let targets = ask(atoms.TARGETS).unwrap();
            assert_eq!(targets.len() % 4, 0);
            assert!(targets
                .chunks(4)
                .any(|one| one == atoms.UTF8_STRING.to_ne_bytes()));
            assert_eq!(ask(atoms.INCR), None);
        });
    }
}
