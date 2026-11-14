use serde_json::{json, Value};

pub(crate) const WORLD: &str = "orden";

const MARK: &str = "void 0";

fn taken_back(last: &str) -> Option<std::ops::RangeInclusive<u32>> {
    let last = last.trim().parse::<u32>().ok().filter(|one| *one > 0)?;
    Some(1..=last)
}

fn registering(source: &str) -> String {
    json!({ "source": source, "worldName": WORLD }).to_string()
}

fn frame_of(tree: &str) -> Option<String> {
    let said: Value = serde_json::from_str(tree).ok()?;
    said.pointer("/frameTree/frame/id")?
        .as_str()
        .map(str::to_string)
}

fn world_in(frame: &str) -> String {
    json!({ "frameId": frame, "worldName": WORLD }).to_string()
}

fn context_of(world: &str) -> Option<i64> {
    let said: Value = serde_json::from_str(world).ok()?;
    said.get("executionContextId")?.as_i64()
}

fn evaluating(expression: &str, context: i64) -> String {
    json!({
        "expression": expression,
        "contextId": context,
        "awaitPromise": true,
        "returnByValue": true,
    })
    .to_string()
}

const IN_THE_PAGE: &[&str] = &["iframe", "worker"];

const IN_A_FRAME: &[&str] = &["iframe", "worker"];

fn attaching(kinds: &[&str]) -> String {
    let filter: Vec<Value> = kinds.iter().map(|kind| json!({ "type": kind })).collect();
    json!({
        "autoAttach": true,
        "waitForDebuggerOnStart": true,
        "flatten": true,
        "filter": filter,
    })
    .to_string()
}

#[derive(Debug, PartialEq, Eq)]
enum Attached {
    Frame(String),
    Held(String),
}

fn attached(event: &str) -> Option<Attached> {
    let said: Value = serde_json::from_str(event).ok()?;
    let session = said.get("sessionId")?.as_str()?.to_string();
    if said.pointer("/targetInfo/type").and_then(Value::as_str) == Some("iframe") {
        return Some(Attached::Frame(session));
    }
    said.get("waitingForDebugger")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        .then_some(Attached::Held(session))
}

fn pass_binding() -> Value {
    json!({ "name": crate::web_pass::BINDING, "executionContextName": WORLD })
}

fn let_go() -> (&'static str, String) {
    ("Runtime.runIfWaitingForDebugger", "{}".to_string())
}

fn in_frame(scripts: &str) -> [(&'static str, String); 4] {
    [
        ("Page.enable", "{}".to_string()),
        (
            "Page.addScriptToEvaluateOnNewDocument",
            registering(scripts),
        ),
        ("Target.setAutoAttach", attaching(IN_A_FRAME)),
        let_go(),
    ]
}

#[derive(Default)]
pub struct Cleared {
    swept: bool,
    counted: Option<usize>,
    ours: bool,
    frames: bool,
}

impl Cleared {
    pub fn said(&self) -> String {
        let swept = match (self.swept, self.counted) {
            (false, _) => "the runtime's scripts left in".to_string(),
            (true, Some(count)) => format!("{count} of the runtime's scripts taken back"),
            (true, None) => "the runtime's scripts taken back".to_string(),
        };
        let ours = if self.ours {
            "in Orden's world"
        } else {
            "missing"
        };
        let frames = if self.frames {
            ""
        } else {
            ", not in other sites' frames"
        };
        format!("{swept}, Orden's own {ours}{frames}")
    }
}

pub use engine::{asking, sent, value};

mod engine {
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{Url, Webview};

    use crate::engine::devtools;

    use super::{
        attached, attaching, context_of, evaluating, frame_of, in_frame, let_go, pass_binding,
        registering, taken_back, world_in, Attached, Cleared, IN_THE_PAGE, MARK,
    };

    const PATIENCE: Duration = Duration::from_secs(10);

    fn binding() -> Value {
        json!({ "name": crate::web_opens::BINDING, "executionContextName": super::WORLD })
    }

    pub(super) fn bound_again(method: &str) -> Vec<(&'static str, Value)> {
        if method == "Page.frameNavigated" {
            vec![
                ("Runtime.addBinding", binding()),
                ("Runtime.addBinding", pass_binding()),
            ]
        } else {
            Vec::new()
        }
    }

    pub fn asking(view: &Webview, app: &tauri::AppHandle, tab: &str, window: &str) {
        let (app, tab, window) = (app.clone(), tab.to_string(), window.to_string());
        let page = view.clone();
        let _ = devtools::hear(view, move |method, session, params| {
            if method != "Runtime.bindingCalled" {
                return;
            }
            let Some(payload) = params.get("payload").and_then(Value::as_str) else {
                return;
            };
            match params.get("name").and_then(Value::as_str) {
                Some(crate::web_opens::BINDING) => {
                    crate::web_opens::heard_on_chromium(&app, &window, &tab, payload);
                }
                Some(crate::web_swipe::BINDING) => {
                    crate::web_swipe::heard(&app, &window, &tab, payload);
                }
                Some(crate::web_pass::BINDING) => {
                    crate::web_pass::binding_called(&page, &app, &window, &tab, session, params);
                }
                _ => {}
            }
        });
    }

    fn called(view: &Webview, method: &str, params: &str) -> Option<Value> {
        let params: Value = serde_json::from_str(params).ok()?;
        devtools::call(view, None, method, &params, PATIENCE).ok()
    }

    pub fn sent(view: &Webview, url: &Url, scripts: &str) -> Cleared {
        let enabled = called(view, "Page.enable", "{}").is_some();
        let taken = called(
            view,
            "Page.addScriptToEvaluateOnNewDocument",
            &json!({ "source": MARK }).to_string(),
        )
        .and_then(|said| said.get("identifier")?.as_str().map(str::to_string))
        .as_deref()
        .and_then(taken_back)
        .map(|every| {
            every
                .filter(|id| {
                    called(
                        view,
                        "Page.removeScriptToEvaluateOnNewDocument",
                        &json!({ "identifier": id.to_string() }).to_string(),
                    )
                    .is_some()
                })
                .count()
        });

        let _ = called(view, "Runtime.addBinding", &binding().to_string());
        let _ = called(
            view,
            "Runtime.addBinding",
            &crate::web_swipe::binding().to_string(),
        );
        let _ = called(view, "Runtime.addBinding", &pass_binding().to_string());
        let ours = scripts.is_empty()
            || (enabled
                && called(
                    view,
                    "Page.addScriptToEvaluateOnNewDocument",
                    &registering(scripts),
                )
                .is_some());
        let frames = scripts.is_empty() || following(view, scripts);
        if !scripts.is_empty() {
            let _ = called(
                view,
                "Page.addScriptToEvaluateOnNewDocument",
                &json!({ "source": crate::web_opens::PAGE_SCRIPT }).to_string(),
            );
        }

        let _ = view.navigate(url.clone());
        Cleared {
            swept: taken.is_some(),
            counted: taken,
            ours,
            frames,
        }
    }

    fn following(view: &Webview, scripts: &str) -> bool {
        let telling = view.clone();
        let scripts = scripts.to_string();
        let heard = devtools::hear(view, move |method, session, params| {
            let again = bound_again(method);
            if !again.is_empty() {
                devtools::tell(&telling, session, again);
                return;
            }
            if method != "Target.attachedToTarget" {
                return;
            }
            let parsed = |(method, params): (&'static str, String)| {
                Some((method, serde_json::from_str(&params).ok()?))
            };
            let (session, said) = match attached(&params.to_string()) {
                Some(Attached::Frame(session)) => (
                    session,
                    [
                        ("Runtime.addBinding", binding()),
                        ("Runtime.addBinding", crate::web_swipe::binding()),
                        ("Runtime.addBinding", pass_binding()),
                    ]
                    .into_iter()
                    .chain(in_frame(&scripts).into_iter().filter_map(parsed))
                    .collect(),
                ),
                Some(Attached::Held(session)) => (session, parsed(let_go()).into_iter().collect()),
                None => return,
            };
            devtools::tell(&telling, Some(&session), said);
        });
        heard.is_ok() && called(view, "Target.setAutoAttach", &attaching(IN_THE_PAGE)).is_some()
    }

    pub fn value(view: &Webview, expression: &str) -> Option<Value> {
        let tree = called(view, "Page.getFrameTree", "{}")?;
        let frame = frame_of(&tree.to_string())?;
        let world = called(view, "Page.createIsolatedWorld", &world_in(&frame))?;
        let context = context_of(&world.to_string())?;
        called(view, "Runtime.evaluate", &evaluating(expression, context))?
            .pointer("/result/value")
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        attached, attaching, context_of, evaluating, frame_of, in_frame, let_go, registering,
        taken_back, world_in, Attached, Cleared, IN_A_FRAME, IN_THE_PAGE, WORLD,
    };

    #[test]
    fn the_trace_says_what_was_taken_back_and_what_was_put_in() {
        let all = Cleared {
            swept: true,
            counted: Some(14),
            ours: true,
            frames: true,
        };
        assert_eq!(
            all.said(),
            "14 of the runtime's scripts taken back, Orden's own in Orden's world"
        );
        let none = Cleared::default();
        assert_eq!(
            none.said(),
            "the runtime's scripts left in, Orden's own missing, not in other sites' frames"
        );
    }

    #[test]
    fn every_script_up_to_the_marker_is_taken_back() {
        assert_eq!(taken_back("7"), Some(1..=7));
        assert_eq!(taken_back("1"), Some(1..=1));
    }

    #[test]
    fn a_numbering_this_does_not_read_takes_nothing_back() {
        for said in ["", "0", "-3", "{A1B2}", "7a", "4294967296"] {
            assert_eq!(taken_back(said), None, "{said:?}");
        }
    }

    #[test]
    fn orden_s_scripts_are_registered_in_orden_s_world_and_never_the_page_s() {
        let asked: serde_json::Value =
            serde_json::from_str(&registering("(function () {})()")).expect("json");
        assert_eq!(asked["worldName"], WORLD);
        assert_eq!(asked["source"], "(function () {})()");
        assert!(!WORLD.is_empty());
    }

    #[test]
    fn the_world_is_asked_for_in_the_page_s_own_frame() {
        let tree =
            r#"{"frameTree":{"frame":{"id":"4F2A","url":"https://a.example/"},"childFrames":[]}}"#;
        assert_eq!(frame_of(tree).as_deref(), Some("4F2A"));
        assert_eq!(frame_of("{}"), None);
        assert_eq!(frame_of("not json"), None);

        let asked: serde_json::Value = serde_json::from_str(&world_in("4F2A")).expect("json");
        assert_eq!(asked["frameId"], "4F2A");
        assert_eq!(asked["worldName"], WORLD);
    }

    #[test]
    fn a_document_arriving_has_orden_s_binding_put_in_its_world() {
        let again = super::engine::bound_again("Page.frameNavigated");
        let names: Vec<&str> = again
            .iter()
            .map(|(method, params)| {
                assert_eq!(*method, "Runtime.addBinding");
                assert_eq!(params["executionContextName"], WORLD);
                params["name"].as_str().expect("a name")
            })
            .collect();
        assert_eq!(names, [crate::web_opens::BINDING, crate::web_pass::BINDING]);
        assert!(super::engine::bound_again("Runtime.bindingCalled").is_empty());
    }

    #[test]
    fn a_frame_from_another_site_is_followed_and_held_until_it_has_orden_s_world() {
        let asked: serde_json::Value = serde_json::from_str(&attaching(IN_THE_PAGE)).expect("json");
        assert_eq!(asked["autoAttach"], true);
        assert_eq!(asked["waitForDebuggerOnStart"], true);
        assert_eq!(asked["flatten"], true);
        assert_eq!(
            asked["filter"],
            serde_json::json!([{ "type": "iframe" }, { "type": "worker" }])
        );

        let frame = r#"{"sessionId":"S1","targetInfo":{"targetId":"T1","type":"iframe","url":"https://b.example/"},"waitingForDebugger":true}"#;
        assert_eq!(attached(frame), Some(Attached::Frame("S1".into())));
        assert_eq!(attached("{}"), None);
        assert_eq!(attached("not json"), None);
    }

    #[test]
    fn anything_else_held_at_its_start_is_let_go_and_given_nothing() {
        let worker = r#"{"sessionId":"S2","targetInfo":{"targetId":"T2","type":"worker","url":"blob:https://challenges.cloudflare.com/1"},"waitingForDebugger":true}"#;
        assert_eq!(attached(worker), Some(Attached::Held("S2".into())));
        assert_eq!(let_go().0, "Runtime.runIfWaitingForDebugger");

        let running = r#"{"sessionId":"S3","targetInfo":{"targetId":"T3","type":"worker"},"waitingForDebugger":false}"#;
        assert_eq!(attached(running), None);
        let unsaid = r#"{"sessionId":"S4","targetInfo":{"targetId":"T4","type":"service_worker"}}"#;
        assert_eq!(attached(unsaid), None);
    }

    #[test]
    fn a_frame_is_given_orden_s_world_and_always_let_go_last() {
        let sent = in_frame("(function () {})()");
        let methods: Vec<&str> = sent.iter().map(|(method, _)| *method).collect();
        assert_eq!(
            methods,
            [
                "Page.enable",
                "Page.addScriptToEvaluateOnNewDocument",
                "Target.setAutoAttach",
                let_go().0,
            ]
        );
        let registered: serde_json::Value = serde_json::from_str(&sent[1].1).expect("json");
        assert_eq!(registered["worldName"], WORLD);

        let following: serde_json::Value = serde_json::from_str(&sent[2].1).expect("json");
        assert_eq!(following["waitForDebuggerOnStart"], true);
        assert_eq!(
            following["filter"],
            serde_json::json!([{ "type": "iframe" }, { "type": "worker" }])
        );
        assert_eq!(sent[2].1, attaching(IN_A_FRAME));
    }

    #[test]
    fn an_expression_runs_in_that_world_and_answers_with_its_value() {
        assert_eq!(context_of(r#"{"executionContextId":12}"#), Some(12));
        assert_eq!(context_of(r#"{"executionContextId":"12"}"#), None);
        assert_eq!(context_of("{}"), None);

        let asked: serde_json::Value =
            serde_json::from_str(&evaluating("1 + 1", 12)).expect("json");
        assert_eq!(asked["contextId"], 12);
        assert_eq!(asked["expression"], "1 + 1");
        assert_eq!(asked["awaitPromise"], true);
        assert_eq!(asked["returnByValue"], true);
    }
}
