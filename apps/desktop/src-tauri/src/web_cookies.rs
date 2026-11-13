#[cfg(any(windows, feature = "cef"))]
use crate::web_state::cookies::Cookie;

#[cfg(all(windows, not(feature = "cef")))]
mod twins;

#[cfg(all(windows, not(feature = "cef")))]
pub fn keep(webview: &tauri::webview::PlatformWebview, done: impl FnOnce() + 'static) {
    use std::cell::Cell;
    use std::rc::Rc;

    use serde_json::json;

    use crate::agents::cdp;
    use crate::web_state::cookies::{engine::cookies_in, now};

    let Some(core) = cdp::core_of(webview) else {
        done();
        return;
    };
    let asking = core.clone();
    cdp::ask(&core, "Network.getAllCookies", &json!({}), move |answer| {
        let calls = answer
            .map(|said| asks(&cookies_in(&said), now()))
            .unwrap_or_default();
        if calls.is_empty() {
            done();
            return;
        }

        let left = Rc::new(Cell::new(calls.len()));
        let done = Rc::new(Cell::new(Some(Box::new(done) as Box<dyn FnOnce()>)));
        for (method, params) in calls {
            let (left, done) = (left.clone(), done.clone());
            cdp::ask(&asking, method, &params, move |_| {
                left.set(left.get().saturating_sub(1));
                if left.get() == 0 {
                    if let Some(said) = done.take() {
                        said();
                    }
                }
            });
        }
    });
}

#[cfg(feature = "cef")]
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

#[cfg(any(windows, feature = "cef"))]
fn asks(all: &[Cookie], now: f64) -> Vec<(&'static str, serde_json::Value)> {
    use crate::web_state::cookies::engine::to_devtools;

    let kept = all
        .iter()
        .filter(|one| one.expires.is_none())
        .map(|one| ("Network.setCookie", to_devtools(one, now)));

    #[cfg(all(windows, not(feature = "cef")))]
    {
        use crate::web_state::cookies::engine::deleting;
        twins::of(all)
            .map(|twin| ("Network.deleteCookies", deleting(twin)))
            .chain(kept)
            .collect()
    }
    #[cfg(not(all(windows, not(feature = "cef"))))]
    kept.collect()
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the cookie store is reached through WKWebView's Objective-C interface, from the pointer wry hands out"
)]
pub fn keep(webview: &tauri::webview::PlatformWebview, done: impl FnOnce() + 'static) {
    use std::cell::Cell;
    use std::ptr::NonNull;
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_foundation::{NSArray, NSHTTPCookie};
    use objc2_web_kit::WKWebView;

    type Said = Rc<Cell<Option<Box<dyn FnOnce()>>>>;
    fn say(done: &Said) {
        if let Some(said) = done.take() {
            said();
        }
    }

    let done: Said = Rc::new(Cell::new(Some(Box::new(done) as Box<dyn FnOnce()>)));

    let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
        say(&done);
        return;
    };

    let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
    let writing = store.clone();
    let answered = done.clone();

    let handler = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
        let cookies = unsafe { cookies.as_ref() };
        let kept: Vec<_> = cookies
            .iter()
            .filter(|cookie| cookie.isSessionOnly())
            .filter_map(|cookie| lasting(&cookie))
            .collect();

        if kept.is_empty() {
            say(&answered);
            return;
        }

        let left = Rc::new(Cell::new(kept.len()));
        for cookie in kept {
            let (left, answered) = (left.clone(), answered.clone());
            let stored = RcBlock::new(move || {
                left.set(left.get().saturating_sub(1));
                if left.get() == 0 {
                    say(&answered);
                }
            });
            unsafe { writing.setCookie_completionHandler(&cookie, Some(&stored)) };
        }
    });

    unsafe { store.getAllCookies(&handler) };
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a cookie's properties are a dictionary whose values the type system does not check"
)]
fn lasting(
    cookie: &objc2_foundation::NSHTTPCookie,
) -> Option<objc2::rc::Retained<objc2_foundation::NSHTTPCookie>> {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{
        NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieExpires, NSHTTPCookieMaximumAge,
        NSMutableCopying as _, NSString,
    };

    use crate::web_state::cookies::KEPT_FOR;

    let properties = cookie.properties()?.mutableCopy();
    let until = NSDate::dateWithTimeIntervalSinceNow(KEPT_FOR);
    unsafe {
        properties.insert(NSHTTPCookieExpires, until.as_ref() as &AnyObject);
        properties.insert(
            NSHTTPCookieMaximumAge,
            NSString::from_str(&format!("{KEPT_FOR:.0}")).as_ref() as &AnyObject,
        );
        properties.removeObjectForKey(NSHTTPCookieDiscard);
        if cookie.isHTTPOnly() {
            properties.insert(
                &*NSString::from_str("HttpOnly"),
                NSString::from_str("TRUE").as_ref() as &AnyObject,
            );
        }
        NSHTTPCookie::cookieWithProperties(&properties)
    }
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
        #[cfg(feature = "cef")]
        keep(&page, answered);
        #[cfg(not(feature = "cef"))]
        {
            let asked = page.with_webview(move |platform| keep(&platform, answered));
            if asked.is_err() && left.fetch_sub(1, Ordering::SeqCst) == 1 {
                go(&then);
            }
        }
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

    #[cfg(feature = "cef")]
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

    #[cfg(all(windows, not(feature = "cef")))]
    #[test]
    fn a_partitioned_session_cookie_is_kept_in_its_partition() {
        use super::twins::tests::cookie;

        let all = [
            cookie("part", Some("https://news.example"), None),
            cookie("sid", None, None),
            cookie("pid", None, Some(1_900_000_000.0)),
        ];
        let calls = super::asks(&all, 1000.0);

        assert_eq!(calls.len(), 2, "{calls:?}");
        assert!(calls
            .iter()
            .all(|(method, _)| *method == "Network.setCookie"));
        let (_, part) = &calls[0];
        assert_eq!(part["name"], "part");
        assert_eq!(part["partitionKey"]["topLevelSite"], "https://news.example");
        assert_eq!(part["partitionKey"]["hasCrossSiteAncestor"], true);
        assert_eq!(part["expires"], 1000.0 + KEPT_FOR);
        assert_eq!(part["secure"], true);
        let (_, sid) = &calls[1];
        assert_eq!(sid["name"], "sid");
        assert!(sid.get("partitionKey").is_none());
        assert_eq!(sid["expires"], 1000.0 + KEPT_FOR);
    }

    #[cfg(all(windows, not(feature = "cef")))]
    #[test]
    fn a_twin_is_taken_away_and_the_partitioned_cookie_kept() {
        use super::twins::tests::cookie;

        let all = [
            cookie("part", Some("https://news.example"), None),
            cookie("part", None, Some(1_790_700_000.0 + KEPT_FOR)),
        ];
        let calls = super::asks(&all, 1000.0);

        assert_eq!(calls.len(), 2, "{calls:?}");
        let (method, taken) = &calls[0];
        assert_eq!(*method, "Network.deleteCookies");
        assert_eq!(taken["name"], "part");
        assert_eq!(taken["domain"], "widget.example");
        assert_eq!(taken["path"], "/");
        assert!(taken.get("partitionKey").is_none());
        let (method, kept) = &calls[1];
        assert_eq!(*method, "Network.setCookie");
        assert_eq!(kept["partitionKey"]["topLevelSite"], "https://news.example");
    }

    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    #[test]
    #[allow(
        unsafe_code,
        reason = "a cookie's properties are a dictionary whose values the type system does not check"
    )]
    fn a_session_cookie_is_made_again_as_one_that_lasts() {
        use objc2::runtime::AnyObject;
        use objc2_foundation::{
            NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieDomain, NSHTTPCookieName,
            NSHTTPCookiePath, NSHTTPCookieValue, NSHTTPCookieVersion, NSMutableDictionary,
            NSString,
        };

        for version in ["0", "1"] {
            let properties = NSMutableDictionary::<NSString, AnyObject>::new();
            let session = unsafe {
                for (key, value) in [
                    (NSHTTPCookieName, "sessionid"),
                    (NSHTTPCookieValue, "1"),
                    (NSHTTPCookieDomain, "example.org"),
                    (NSHTTPCookiePath, "/"),
                    (NSHTTPCookieVersion, version),
                    (NSHTTPCookieDiscard, "TRUE"),
                ] {
                    properties.insert(key, NSString::from_str(value).as_ref() as &AnyObject);
                }
                NSHTTPCookie::cookieWithProperties(&properties).expect("a cookie")
            };
            assert!(
                session.isSessionOnly(),
                "version {version} starts as a session cookie"
            );

            let kept = super::lasting(&session).expect("made again");
            assert!(
                !kept.isSessionOnly(),
                "version {version} still ends with the session"
            );
            let left = kept
                .expiresDate()
                .map(|until| until.timeIntervalSinceDate(&NSDate::now()))
                .expect("an expiry");
            assert!(
                (left - KEPT_FOR).abs() < 60.0,
                "version {version} lasts {left} seconds"
            );
            assert_eq!(kept.name().to_string(), "sessionid");
        }
    }
}
