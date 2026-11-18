use crate::web_state::cookies::Cookie;

pub fn keep(view: &tauri::Webview, done: impl FnOnce() + Send + 'static) {
    use serde_json::json;

    use crate::engine::devtools::call;
    use crate::web_state::cookies::{engine::cookies_in, now};

    let view = view.clone();
    std::thread::spawn(move || {
        if let Ok(said) = call(&view, None, "Network.getAllCookies", &json!({}), PATIENCE) {
            for (method, params) in asks(&cookies_in(&said), now()) {
                let _ = call(&view, None, method, &params, PATIENCE);
            }
        }
        done();
    });
}

fn asks(all: &[Cookie], now: f64) -> Vec<(&'static str, serde_json::Value)> {
    use crate::web_state::cookies::engine::to_devtools;

    let kept = all
        .iter()
        .filter(|one| one.expires.is_none())
        .map(|one| ("Network.setCookie", to_devtools(one, now)));

    kept.collect()
}

const PATIENCE: std::time::Duration = std::time::Duration::from_secs(2);

static LEAVING: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub fn leaving(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    if pages(window).is_empty() {
        return;
    }

    let label = window.label().to_string();
    {
        let Ok(mut leaving) = LEAVING.lock() else {
            return;
        };
        if let Some(at) = leaving.iter().position(|one| *one == label) {
            leaving.remove(at);
            return;
        }
        leaving.push(label);
    }

    api.prevent_close();

    let closing = window.clone();
    kept(window, move || {
        let _ = closing.close();
    });
}

fn pages(window: &tauri::Window) -> Vec<tauri::Webview> {
    window
        .webviews()
        .into_iter()
        .filter(|one| crate::web_tabs::is_page(one.label()))
        .filter(|one| !crate::web_tabs::is_private(one.label()))
        .collect()
}

pub fn kept(window: &tauri::Window, then: impl FnOnce() + Send + 'static) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    type Then = Mutex<Option<Box<dyn FnOnce() + Send>>>;

    let pages = pages(window);
    if pages.is_empty() {
        then();
        return;
    }

    let then: Arc<Then> = Arc::new(Mutex::new(Some(Box::new(then))));
    let go = move |then: &Then| {
        let taken = then.lock().ok().and_then(|mut then| then.take());
        if let Some(then) = taken {
            then();
        }
    };

    let left = Arc::new(AtomicUsize::new(pages.len()));
    for page in pages {
        let (waiting, going) = (left.clone(), then.clone());
        let answered = move || {
            if waiting.fetch_sub(1, Ordering::SeqCst) == 1 {
                go(&going);
            }
        };
        keep(&page, answered);
    }

    std::thread::spawn(move || {
        std::thread::sleep(PATIENCE);
        go(&then);
    });
}

#[cfg(test)]
mod tests {
    use crate::web_state::cookies::{now, KEPT_FOR};

    #[test]
    fn a_session_cookie_is_kept_for_four_hundred_days_from_now() {
        assert!((KEPT_FOR - 34_560_000.0).abs() < f64::EPSILON);
        assert!(now() > 1_700_000_000.0, "the clock reads a real day");
    }

    #[test]
    fn chromium_s_session_cookies_are_written_back_to_last() {
        use crate::web_state::cookies::engine::cookies_in;
        use serde_json::json;

        let one = |name: &str, session: bool, partition: Option<&str>| {
            let mut cookie = json!({
                "name": name, "value": "v", "domain": "a.example", "path": "/",
                "secure": true, "httpOnly": false, "session": session,
                "expires": if session { -1.0 } else { 1_900_000_000.0 },
            });
            if let Some(site) = partition {
                cookie["partitionKey"] =
                    json!({ "topLevelSite": site, "hasCrossSiteAncestor": true });
            }
            cookie
        };
        let all = cookies_in(&json!({ "cookies": [
            one("sid", true, None),
            one("part", true, Some("https://news.example")),
            one("pid", false, None),
        ] }));
        let asks = super::asks(&all, 1000.0);

        assert_eq!(asks.len(), 2, "{asks:?}");
        assert!(asks
            .iter()
            .all(|(method, _)| *method == "Network.setCookie"));
        assert_eq!(asks[0].1["name"], "sid");
        assert!(
            (asks[0].1["expires"].as_f64().expect("an expiry") - (1000.0 + KEPT_FOR)).abs() < 1.0
        );
        assert_eq!(asks[1].1["name"], "part");
        assert_eq!(
            asks[1].1["partitionKey"]["topLevelSite"],
            "https://news.example"
        );
    }
}
