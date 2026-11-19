use std::collections::{HashMap, HashSet};
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
    last: Option<Instant>,
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
fn heard(app: &AppHandle, view: &Webview, tab: &str, session: Option<&str>, params: &Value) {
    let now = Instant::now();
    let (window, last) = {
        let mut all = WATCHED.held();
        let Some(one) = all.get_mut(view.label()) else {
            return;
        };
        let last = one.last;
        if due(last, now) {
            one.last = Some(now);
        }
        (one.window.clone(), last)
    };
    if due(last, now) {
        if let Some(data) = params.get("data").and_then(Value::as_str) {
            let _ = app.emit_to(&window, DREW, told(tab, data));
        }
    }
    let Some(ack) = params.get("sessionId").cloned() else {
        return;
    };
    let wait = acked_after(last, now);
    let (acking, session) = (view.clone(), session.map(str::to_owned));
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        crate::engine::devtools::tell(
            &acking,
            session.as_deref(),
            vec![("Page.screencastFrameAck", json!({ "sessionId": ack }))],
        );
    });
}
fn acked_after(last: Option<Instant>, now: Instant) -> Duration {
    let from = if due(last, now) { Some(now) } else { last };
    from.map_or(Duration::ZERO, |from| (from + EVERY).saturating_duration_since(now))
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
    WATCHED.held().insert(label, Watched { window, last: None });
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
    use super::{asked, due, told, Drew, DREW};
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
        assert_eq!(super::acked_after(None, now), Duration::from_millis(200));
        assert_eq!(
            super::acked_after(Some(now), now + Duration::from_millis(50)),
            Duration::from_millis(150)
        );
    }
}
