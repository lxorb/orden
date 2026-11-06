use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::args::{model_ok, Effort};
use super::run::Ended;

const LONGEST_TEXT: usize = 4 << 20;

const LONGEST_IMAGE: usize = 20 << 20;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Image {
    pub mime: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "do", rename_all = "camelCase")]
pub enum GoalSay {
    Set {
        objective: String,
        #[serde(default)]
        budget: Option<u64>,
    },
    Pause,
    Resume,
    Clear,
    Get,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Say {
    Turn {
        text: String,
        #[serde(default)]
        images: Vec<Image>,
    },
    Steer {
        text: String,
    },
    Interrupt,
    Model {
        model: String,
    },
    Effort {
        effort: Option<Effort>,
    },
    Fast {
        on: bool,
    },
    Compact {
        #[serde(default)]
        focus: String,
    },
    Context,
    Goal {
        goal: GoalSay,
    },
}

impl Say {
    pub fn checked(self) -> Result<Self, String> {
        match &self {
            Self::Turn { text, images } => {
                fits(text)?;
                for image in images {
                    picture(image)?;
                }
            }
            Self::Steer { text } => fits(text)?,
            Self::Model { model } if !model_ok(model) => {
                return Err(format!("{model:?} is not a model name"))
            }
            Self::Compact { focus } => fits(focus)?,
            Self::Goal {
                goal: GoalSay::Set { objective, .. },
            } => fits(objective)?,
            _ => {}
        }
        Ok(self)
    }
}

fn fits(text: &str) -> Result<(), String> {
    if text.len() > LONGEST_TEXT {
        return Err("the message is too long".to_owned());
    }
    Ok(())
}

fn picture(image: &Image) -> Result<(), String> {
    let kind = matches!(
        image.mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    );
    let base64 = image.data.len() <= LONGEST_IMAGE
        && image
            .data
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='));
    if kind && base64 && !image.data.is_empty() {
        Ok(())
    } else {
        Err("not a picture".to_owned())
    }
}

pub fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Message {
    Line {
        line: String,
    },
    Reply {
        to: String,
        result: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    End(Ended),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn said(value: Value) -> Result<Say, String> {
        serde_json::from_value::<Say>(value)
            .map_err(|error| error.to_string())
            .and_then(Say::checked)
    }

    #[test]
    fn a_turn_is_words_and_pictures() {
        let turn = said(json!({
            "kind": "turn",
            "text": "what is a heron",
            "images": [{ "mime": "image/png", "data": "iVBORw0KGgo=" }],
        }))
        .expect("a turn");
        assert!(matches!(turn, Say::Turn { ref images, .. } if images.len() == 1));
    }

    #[test]
    fn nothing_but_the_named_things_can_be_said() {
        for odd in [
            json!({ "kind": "exec", "command": "rm -rf /" }),
            json!({ "kind": "raw", "line": "{}" }),
            json!({ "kind": "permissions", "mode": "bypassPermissions" }),
            json!({ "kind": "model", "model": "--dangerously-skip-permissions" }),
            json!({ "kind": "effort", "effort": "ultra" }),
            json!({ "kind": "turn", "text": "x", "images": [{ "mime": "text/html", "data": "PGI+" }] }),
            json!({ "kind": "turn", "text": "x", "images": [{ "mime": "image/png", "data": "a\"b" }] }),
        ] {
            assert!(said(odd.clone()).is_err(), "{odd} was taken");
        }
        assert!(said(json!({ "kind": "effort", "effort": null })).is_ok());
        assert!(said(
            json!({ "kind": "goal", "goal": { "do": "set", "objective": "file the inbox" } })
        )
        .is_ok());
    }

    #[test]
    fn a_long_message_is_refused() {
        let long = "a".repeat(LONGEST_TEXT + 1);
        assert!(said(json!({ "kind": "turn", "text": long })).is_err());
    }

    #[test]
    fn a_command_s_argument_stays_on_its_line() {
        assert_eq!(one_line("keep the\n/clear  dates"), "keep the /clear dates");
    }
}
