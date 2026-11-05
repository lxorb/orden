//! What the host's platform halves share (issue 1063; docs/apps.md): what the holder's
//! tab sends of its input, and what the picture's reader hears of its display. The
//! display, its capture and the input played into it are each platform's own
//! (`capture.rs`, `input.rs` and the rest on Linux, `mac/` on a Mac); these are not.

use serde::Deserialize;

/// What the thread that reads the picture hears: what the display's thread saw, and
/// what the connection to the tab asked.
#[derive(Debug, PartialEq)]
pub enum News {
    /// Something was drawn.
    Drawn,
    /// The screen was made another size.
    Resized,
    /// The pointer's shape changed: the message the tab is sent. Not read on a Mac yet.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Pointer(String),
    /// The holder's tab asked for a whole picture, its last having been lost on the way.
    Whole,
    /// The display has gone.
    Gone,
}

/// One thing the holder did, as its tab sends it.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum InputEvent {
    /// The pointer, at a point of the display in its own pixels.
    Move { x: f64, y: f64 },
    /// A button pressed or let go: 0 the main one, 1 the middle, 2 the other, as a
    /// `PointerEvent`'s `button` says.
    Button { button: u8, down: bool },
    /// The wheel, in clicks: down and right are positive.
    Wheel { x: i32, y: i32 },
    /// A key pressed or let go: the character it gave or its name (`KeyboardEvent.key`),
    /// and the key it was (`KeyboardEvent.code`).
    Key {
        key: String,
        code: String,
        down: bool,
    },
    /// Text an input method made, typed character by character.
    Text { text: String },
    /// The holder's clipboard, given to the application's next paste (step 6;
    /// `clipboard.rs`, not played here).
    Clipboard { text: String },
    /// Whether the holder shares its clipboard with the application (step 6).
    Share { clipboard: bool },
    /// The tab's ping, to set its clock beside the host's (step 9; `stream.rs`).
    Ping { at: f64 },
}
