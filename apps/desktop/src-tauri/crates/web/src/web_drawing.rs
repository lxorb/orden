use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use orden_base::Held as _;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter as _, Webview};

pub const DREW: &str = "orden://web-drew";
const EVERY: Duration = Duration::from_millis(200);
const QUALITY: u8 = 60;
struct Watched {
    window: String,
    session: Option<String>,
    last: Option<Instant>,
    waiting: Option<String>,
    flushing: bool,
    unacked: VecDeque<Value>,
}
impl Watched {
    fn new(window: String) -> Self {
        Self {
            window,
            session: None,
            last: None,
            waiting: None,
            flushing: false,
            unacked: VecDeque::new(),
        }
    }
}
#[derive(Debug, Default, PartialEq)]
struct Turn {
    say: Option<String>,
    acks: Vec<Value>,
    after: Option<Duration>,
}
fn take(one: &mut Watched, now: Instant, data: String, ack: Option<Value>) -> Turn {
    one.unacked.extend(ack);
    one.waiting = Some(data);
    if one.flushing {
        return Turn::default();
    }
    one.flushing = true;
    if due(one.last, now) {
        one.last = Some(now);
        return Turn { say: one.waiting.take(), acks: Vec::new(), after: Some(EVERY) };
    }
    let wait =
        one.last.map_or(Duration::ZERO, |last| (last + EVERY).saturating_duration_since(now));
    Turn { after: Some(wait), ..Turn::default() }
}
fn tick(one: &mut Watched, now: Instant) -> Turn {
    one.flushing = false;
    let say = one.waiting.take();
    let acks: Vec<Value> = one.unacked.pop_front().into_iter().collect();
    if say.is_none() && acks.is_empty() {
        return Turn::default();
    }
    one.last = Some(now);
    one.flushing = !one.unacked.is_empty() || one.waiting.is_some();
    Turn { say, acks, after: one.flushing.then_some(EVERY) }
}
static WATCHED: LazyLock<Mutex<HashMap<String, Watched>>> = LazyLock::new(Mutex::default);
static HEARD: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Drew {
    pub tab: String,
    pub picture: String,
}
fn asked(width: f64) -> Value {
    let half = (width / 2.0).round().max(1.0);
    json!({ "format": "jpeg", "quality": QUALITY, "maxWidth": half, "maxHeight": 4096, "everyNthFrame": 1 })
}
fn due(last: Option<Instant>, now: Instant) -> bool {
    last.is_none_or(|last| now.duration_since(last) >= EVERY)
}
fn told(tab: &str, data: &str) -> Drew {
    Drew { tab: tab.to_owned(), picture: format!("data:image/jpeg;base64,{data}") }
}
fn turned(app: &AppHandle, view: &Webview, label: &str, tab: &str, mut turn: Turn) {
    loop {
        let Some((window, session)) =
            WATCHED.held().get(label).map(|one| (one.window.clone(), one.session.clone()))
        else {
            return;
        };
        if let Some(data) = turn.say.take() {
            let _ = app.emit_to(&window, DREW, told(tab, &data));
        }
        for ack in turn.acks.drain(..) {
            crate::engine::devtools::tell(
                view,
                session.as_deref(),
                vec![("Page.screencastFrameAck", json!({ "sessionId": ack }))],
            );
        }
        let Some(wait) = turn.after else {
            return;
        };
        std::thread::sleep(wait);
        let Some(next) = WATCHED.held().get_mut(label).map(|one| tick(one, Instant::now())) else {
            return;
        };
        turn = next;
    }
}
fn heard(app: &AppHandle, view: &Webview, tab: &str, session: Option<&str>, params: &Value) {
    let Some(data) = params.get("data").and_then(Value::as_str) else {
        return;
    };
    let label = view.label().to_owned();
    let turn = {
        let mut all = WATCHED.held();
        let Some(one) = all.get_mut(&label) else {
            return;
        };
        one.session = session.map(str::to_owned);
        take(one, Instant::now(), data.to_owned(), params.get("sessionId").cloned())
    };
    if turn == Turn::default() {
        return;
    }
    let (app, view, tab) = (app.clone(), view.clone(), tab.to_owned());
    std::thread::spawn(move || turned(&app, &view, &label, &tab, turn));
}
#[tauri::command]
pub async fn web_watch_drawing(app: AppHandle, tab: String, on: bool) -> Result<(), String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    let label = view.label().to_owned();
    if !on {
        WATCHED.held().remove(&label);
        crate::engine::devtools::tell(&view, None, vec![("Page.stopScreencast", json!({}))]);
        return Ok(());
    }
    if HEARD.held().insert(label.clone()) {
        let (hearing, page, named) = (app.clone(), view.clone(), tab.clone());
        crate::engine::devtools::hear(&view, move |method, session, params| {
            if method == "Page.screencastFrame" {
                heard(&hearing, &page, &named, session, params);
            }
        })?;
    }
    let window = view.window().label().to_owned();
    WATCHED.held().insert(label, Watched::new(window));
    let measuring = view.clone();
    let width = tauri::async_runtime::spawn_blocking(move || {
        crate::engine::devtools::call(
            &measuring,
            None,
            "Page.getLayoutMetrics",
            &json!({}),
            Duration::from_secs(2),
        )
        .ok()
        .and_then(|metrics| {
            metrics.pointer("/cssVisualViewport/clientWidth").and_then(Value::as_f64)
        })
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(1024.0);
    crate::engine::devtools::tell(&view, None, vec![("Page.startScreencast", asked(width))]);
    Ok(())
}
pub fn forget(label: &str) {
    WATCHED.held().remove(label);
    HEARD.held().remove(label);
}
#[cfg(test)]
mod tests {
    use super::{asked, due, take, tick, told, Drew, Turn, Watched, DREW};
    use serde_json::json;
    use std::time::{Duration, Instant};

    #[test]
    fn a_page_that_drew_is_said_as_orden_web_drew_with_its_picture() {
        assert_eq!(DREW, "orden://web-drew");
        assert_eq!(
            told("t1", "abc"),
            Drew { tab: "t1".into(), picture: "data:image/jpeg;base64,abc".into() }
        );
        assert_eq!(
            serde_json::to_value(told("t1", "abc")).expect("json"),
            serde_json::json!({ "tab": "t1", "picture": "data:image/jpeg;base64,abc" })
        );
    }
    #[test]
    fn the_watch_asks_a_half_size_jpeg_and_says_it_at_most_every_200_ms() {
        let picture = asked(1200.0);
        assert_eq!(picture["format"], "jpeg");
        assert_eq!(picture["maxWidth"], 600.0);
        assert_eq!(picture["quality"], 60);
        let now = Instant::now();
        assert_eq!(super::EVERY, Duration::from_millis(200));
        assert!(due(None, now));
        assert!(!due(Some(now), now + Duration::from_millis(150)));
        assert!(due(Some(now), now + Duration::from_millis(200)));
    }
    #[test]
    fn a_busy_page_is_paced_to_one_picture_and_one_ack_each_200_ms_and_the_newest_is_said() {
        let now = Instant::now();
        let at = |ms: u64| now + Duration::from_millis(ms);
        let ms = |n: u64| Some(Duration::from_millis(n));
        let turn = |say: Option<&str>, acks: &[i64], after: Option<Duration>| Turn {
            say: say.map(str::to_owned),
            acks: acks.iter().map(|n| json!(n)).collect(),
            after,
        };
        let mut one = Watched::new("w".into());
        assert_eq!(
            take(&mut one, at(0), "a".into(), Some(json!(1))),
            turn(Some("a"), &[], ms(200))
        );
        assert_eq!(take(&mut one, at(20), "b".into(), Some(json!(2))), Turn::default());
        assert_eq!(tick(&mut one, at(200)), turn(Some("b"), &[1], ms(200)));
        assert_eq!(take(&mut one, at(216), "c".into(), Some(json!(3))), Turn::default());
        assert_eq!(tick(&mut one, at(400)), turn(Some("c"), &[2], ms(200)));
        assert_eq!(tick(&mut one, at(600)), turn(None, &[3], None));
        assert_eq!(tick(&mut one, at(800)), Turn::default());
        assert_eq!(take(&mut one, at(700), "d".into(), Some(json!(4))), turn(None, &[], ms(100)));
        assert_eq!(tick(&mut one, at(800)), turn(Some("d"), &[4], None));
        assert!(one.unacked.is_empty());
        assert_eq!(
            take(&mut one, at(1500), "e".into(), Some(json!(5))),
            turn(Some("e"), &[], ms(200))
        );
    }
}
