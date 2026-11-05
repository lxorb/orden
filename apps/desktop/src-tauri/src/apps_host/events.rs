//! What the device holding an application does, as its tab sends it over the picture's data
//! channel (issue 1063, steps 4 to 9; `InputEvent` in `@orden/online/apps`): one JSON
//! message for each thing done, played into the application's own display by `input.rs`
//! on Linux and `desk/input.rs` on Windows.

use serde::Deserialize;

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
