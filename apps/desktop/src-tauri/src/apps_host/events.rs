use serde::Deserialize;

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum InputEvent {
    Move {
        x: f64,
        y: f64,
    },
    Button {
        button: u8,
        down: bool,
    },
    Wheel {
        x: i32,
        y: i32,
    },
    Key {
        key: String,
        code: String,
        down: bool,
    },
    Text {
        text: String,
    },
    Clipboard {
        text: String,
    },
    Share {
        clipboard: bool,
    },
    Ping {
        at: f64,
    },
}
