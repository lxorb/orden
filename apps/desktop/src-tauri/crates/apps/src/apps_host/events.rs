use serde::{Deserialize, Deserializer};

const MOST_CLICKS: i64 = 20;

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
        #[serde(deserialize_with = "clicks")]
        x: i32,
        #[serde(deserialize_with = "clicks")]
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

fn clicks<'de, D: Deserializer<'de>>(said: D) -> Result<i32, D::Error> {
    let clicks = i64::deserialize(said)?.clamp(-MOST_CLICKS, MOST_CLICKS);
    Ok(i32::try_from(clicks).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::InputEvent;

    #[test]
    fn a_wheel_turns_at_most_a_few_clicks_however_far_it_is_asked() {
        let far: InputEvent =
            serde_json::from_str(r#"{"t":"wheel","x":-2147483648,"y":99999999999}"#)
                .expect("a wheel");
        assert_eq!(far, InputEvent::Wheel { x: -20, y: 20 });
        let near: InputEvent =
            serde_json::from_str(r#"{"t":"wheel","x":0,"y":-3}"#).expect("a wheel");
        assert_eq!(near, InputEvent::Wheel { x: 0, y: -3 });
    }
}
