use std::collections::HashMap;
use std::io;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};

use super::args::{Effort, Tool};
use super::run::{self, Heard, Running};
use super::say::{one_line, GoalSay, Image, Message, Say};

enum Asked {
    Window(&'static str),
    Crate(mpsc::Sender<Result<Value, String>>),
}

type Waiting = Arc<Mutex<HashMap<String, Asked>>>;

fn waiting(held: &Waiting) -> MutexGuard<'_, HashMap<String, Asked>> {
    held.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct Claude {
    running: Running,
    next: AtomicU64,
    waiting: Waiting,
}

impl Claude {
    pub fn start(
        command: Command,
        idle: Duration,
        output: impl Fn(Message) + Send + 'static,
    ) -> io::Result<Self> {
        let held: Waiting = Arc::default();
        let heard_by = Arc::clone(&held);
        let answering: Arc<Mutex<Option<Running>>> = Arc::default();
        let answer_with = Arc::clone(&answering);
        let running = run::open(command, idle, move |heard| match heard {
            Heard::Line(line) => {
                let writer = answer_with
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                if let Some(message) = read(&line, &heard_by, writer.as_ref()) {
                    output(message);
                }
            }
            Heard::End(ended) => {
                for (_, asked) in waiting(&heard_by).drain() {
                    if let Asked::Crate(sent) = asked {
                        let _ = sent.send(Err("Claude Code ended".to_owned()));
                    }
                }
                output(Message::End(ended));
            }
        })?;
        *answering.lock().unwrap_or_else(PoisonError::into_inner) = Some(running.clone());
        Ok(Self {
            running,
            next: AtomicU64::new(1),
            waiting: held,
        })
    }

    pub fn stop(&self) {
        self.running.stop();
    }

    pub fn say(&self, say: &Say) -> Result<(), String> {
        let line = match say {
            Say::Turn { text, images } => user(text, images),
            Say::Steer { text } => user(text, &[]),
            Say::Interrupt => self.control(json!({ "subtype": "interrupt" }), None),
            Say::Model { model } => self.control(
                json!({ "subtype": "set_model", "model": model }),
                Some("model"),
            ),
            Say::Effort { effort } => effort_line(*effort)?,
            Say::Fast { .. } => return Err("Claude Code has no fast mode headless".into()),
            Say::Compact { focus } => command(format!("/compact {}", one_line(focus)).trim_end()),
            Say::Context => {
                self.control(json!({ "subtype": "get_context_usage" }), Some("context"))
            }
            Say::Goal { goal } => goal_line(goal)?,
        };
        self.running
            .write_line(&line)
            .map_err(|error| format!("Claude Code is not listening: {error}"))
    }

    pub fn ask(&self, request: Value, patience: Duration) -> Result<Value, String> {
        let (sent, answer) = mpsc::channel();
        let id = self.id();
        waiting(&self.waiting).insert(id.clone(), Asked::Crate(sent));
        self.running
            .write_line(&control_line(&id, request))
            .map_err(|error| error.to_string())?;
        answer
            .recv_timeout(patience)
            .map_err(|_| "Claude Code did not answer".to_owned())?
    }

    pub fn close_input(&self) {
        self.running.close_input();
    }

    fn id(&self) -> String {
        format!("nib-{}", self.next.fetch_add(1, Ordering::SeqCst))
    }

    fn control(&self, request: Value, to: Option<&'static str>) -> String {
        let id = self.id();
        if let Some(to) = to {
            waiting(&self.waiting).insert(id.clone(), Asked::Window(to));
        }
        control_line(&id, request)
    }
}

fn control_line(id: &str, request: Value) -> String {
    json!({ "type": "control_request", "request_id": id, "request": request }).to_string()
}

fn user(text: &str, images: &[Image]) -> String {
    let mut content: Vec<Value> = images
        .iter()
        .map(|image| {
            json!({
                "type": "image",
                "source": { "type": "base64", "media_type": image.mime, "data": image.data },
            })
        })
        .collect();
    let words = if text.trim_start().starts_with('/') {
        format!(" {}", text.trim_start())
    } else {
        text.to_owned()
    };
    content.push(json!({ "type": "text", "text": words }));
    message(Value::Array(content))
}

fn goal_line(goal: &GoalSay) -> Result<String, String> {
    match goal {
        GoalSay::Set { objective, .. } => Ok(command(&format!("/goal {}", one_line(objective)))),
        GoalSay::Clear => Ok(command("/goal clear")),
        GoalSay::Pause | GoalSay::Resume => {
            Err("Claude Code's goal is set or cleared, never paused".into())
        }
        GoalSay::Get => Err("Claude Code says where a goal is as it goes".into()),
    }
}

fn command(line: &str) -> String {
    message(json!([{ "type": "text", "text": line }]))
}

fn message(content: Value) -> String {
    json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
    })
    .to_string()
}

fn read(line: &str, held: &Waiting, writer: Option<&Running>) -> Option<Message> {
    let event: Value = match serde_json::from_str(line) {
        Ok(event) => event,
        Err(_) => {
            return Some(Message::Line {
                line: line.to_owned(),
            })
        }
    };
    match event["type"].as_str() {
        Some("control_response") => {
            let response = &event["response"];
            let id = response["request_id"].as_str().unwrap_or_default();
            let asked = waiting(held).remove(id)?;
            let error = (response["subtype"] == "error").then(|| {
                response["error"]
                    .as_str()
                    .unwrap_or("Claude Code refused")
                    .to_owned()
            });
            let result = response.get("response").cloned().unwrap_or(Value::Null);
            match asked {
                Asked::Window(to) => Some(Message::Reply {
                    to: to.to_owned(),
                    result,
                    error,
                }),
                Asked::Crate(sent) => {
                    let _ = sent.send(error.map_or(Ok(result), Err));
                    None
                }
            }
        }
        Some("control_request") => {
            if let (Some(writer), Some(id)) = (writer, event["request_id"].as_str()) {
                let _ = writer.write_line(&refusal(id, &event["request"]));
            }
            None
        }
        _ => Some(Message::Line {
            line: line.to_owned(),
        }),
    }
}

fn refusal(id: &str, request: &Value) -> String {
    let response = if request["subtype"] == "can_use_tool" {
        json!({
            "subtype": "success",
            "request_id": id,
            "response": { "behavior": "deny", "message": "nib asks at its own tools" },
        })
    } else {
        json!({ "subtype": "error", "request_id": id, "error": "not answered by nib" })
    };
    json!({ "type": "control_response", "response": response }).to_string()
}

fn effort_line(effort: Option<Effort>) -> Result<String, String> {
    let word = effort
        .map(|one| one.word(Tool::ClaudeCode))
        .transpose()?
        .unwrap_or("auto");
    Ok(command(&format!("/effort {word}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(line: &str) -> Value {
        serde_json::from_str(line).expect("JSON")
    }

    #[test]
    fn a_goal_is_set_or_cleared_and_never_paused() {
        let text = |goal: &GoalSay| {
            goal_line(goal).map(|line| parsed(&line)["message"]["content"][0]["text"].clone())
        };
        let set = GoalSay::Set {
            objective: "tests\npass".into(),
            budget: Some(9),
        };
        assert_eq!(text(&set), Ok(json!("/goal tests pass")));
        assert_eq!(text(&GoalSay::Clear), Ok(json!("/goal clear")));
        assert!(text(&GoalSay::Pause).is_err());
        assert!(text(&GoalSay::Resume).is_err());
        assert!(text(&GoalSay::Get).is_err());
    }

    #[test]
    fn a_turn_is_a_user_message_with_its_pictures_first() {
        let line = user(
            "what is this",
            &[Image {
                mime: "image/png".into(),
                data: "iVBO".into(),
            }],
        );
        let message = parsed(&line);
        assert_eq!(message["type"], "user");
        let content = &message["message"]["content"];
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        assert_eq!(content[1]["text"], "what is this");
    }

    #[test]
    fn the_reader_s_slash_is_words_not_a_command() {
        let message = parsed(&user("/clear everything", &[]));
        assert_eq!(
            message["message"]["content"][0]["text"],
            " /clear everything"
        );
        let message = parsed(&user("  /model opus", &[]));
        assert_eq!(message["message"]["content"][0]["text"], " /model opus");
    }

    #[test]
    fn effort_is_typed_as_claude_code_s_own_command() {
        let line = effort_line(Some(Effort::Xhigh)).expect("line");
        assert_eq!(
            parsed(&line)["message"]["content"][0]["text"],
            "/effort xhigh"
        );
        let line = effort_line(None).expect("line");
        assert_eq!(
            parsed(&line)["message"]["content"][0]["text"],
            "/effort auto"
        );
        assert!(effort_line(Some(Effort::Off)).is_err());
    }

    #[test]
    fn a_reply_goes_to_who_asked_and_a_request_of_its_own_is_refused() {
        let held: Waiting = Arc::default();
        waiting(&held).insert("nib-1".into(), Asked::Window("context"));
        let said = read(
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"nib-1","response":{"totalTokens":5}}}"#,
            &held,
            None,
        );
        assert_eq!(
            said,
            Some(Message::Reply {
                to: "context".into(),
                result: json!({ "totalTokens": 5 }),
                error: None,
            })
        );
        assert!(read(
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"nib-1"}}"#,
            &held,
            None
        )
        .is_none());

        let refused = parsed(&refusal("x", &json!({ "subtype": "can_use_tool" })));
        assert_eq!(refused["response"]["response"]["behavior"], "deny");
        assert!(read(
            r#"{"type":"control_request","request_id":"x","request":{"subtype":"can_use_tool"}}"#,
            &held,
            None
        )
        .is_none());

        let line = r#"{"type":"assistant","message":{"content":[]}}"#;
        assert_eq!(
            read(line, &held, None),
            Some(Message::Line { line: line.into() })
        );
    }
}
