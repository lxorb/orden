//! A store's cookies, read and written through each engine's own cookie store: never the
//! cookie database on disk, which is encrypted to the machine. What folds a store a space
//! kept into the shared one (`merge.rs`) reads every cookie of one and writes some into the
//! other; `web_cookies.rs` keeps a store's logins on Windows through the same protocol.
//!
//! | engine | out | in |
//! | --- | --- | --- |
//! | `WebView2` | `Network.getAllCookies` over the `DevTools` Protocol, which keeps `partitionKey`, priority and the source scheme and port | `Network.setCookies` |
//! | `WKWebView` | `WKHTTPCookieStore`, through the webview's own `cookies()` | `setCookie` |
//! | `WebKitGTK` | the cookie manager's every cookie, the same way | the same |
//!
//! A Mac and Linux go through Tauri's own cookie calls, which are those stores and write
//! `HttpOnly` back by name, as `web_cookies.rs` does; what they have no word for (a
//! partition, a priority) is left out there.
//!
//! A session cookie is written with the four hundred days `web_cookies.rs` gives every
//! session cookie, so the login it carries survives the next restart. The cookie as the
//! protocol says it - read out of an answer, written for `setCookie`, named for
//! `deleteCookies` - is shared with `web_cookies.rs`, along with the four hundred days.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Webview;

/// A cookie, as every engine can say it and take it back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Cookie {
    pub name: String,
    pub value: String,
    /// As the engine said it: a leading dot for a cookie every subdomain is sent, none for
    /// one only its own host is.
    pub domain: String,
    pub path: String,
    /// Seconds since 1970, or none for a session cookie.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    #[serde(default)]
    pub http_only: bool,
    #[serde(default)]
    pub secure: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_site: Option<SameSite>,
    /// Chromium's own; the others have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    /// The top-level site a partitioned (CHIPS) cookie belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partition: Option<Partition>,
    /// Chromium's scheme binding, `Secure`, `NonSecure` or `Unset`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_scheme: Option<String>,
    /// Chromium's port binding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_port: Option<i64>,
}

/// A cookie's `SameSite`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SameSite {
    Strict,
    Lax,
    None,
}

/// A cookie's priority, which Chromium uses to choose what to evict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Priority {
    Low,
    Medium,
    High,
}

/// A partitioned cookie's partition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Partition {
    /// `https://example.com`.
    pub top_level_site: String,
    #[serde(default)]
    pub cross_site_ancestor: bool,
}

/// How long a session cookie is kept once it has been made to last, in seconds: four
/// hundred days, which is the longest Chrome lets any cookie live. Long enough that
/// nobody is signed out by it, and a cookie the site sets again starts a new four
/// hundred days rather than being stretched for ever. Here and in `web_cookies.rs`.
pub(crate) const KEPT_FOR: f64 = 400.0 * 24.0 * 60.0 * 60.0;

/// When a cookie written now should end: its own expiry, or four hundred days out for a
/// session cookie.
fn until(cookie: &Cookie, now: f64) -> f64 {
    cookie.expires.unwrap_or(now + KEPT_FOR)
}

/// Now, in seconds since 1970: the engines' own unit for an expiry.
pub(crate) fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |since| since.as_secs_f64())
}

/// Every cookie in the store `view` is in.
pub(crate) async fn every(view: &Webview) -> Result<Vec<Cookie>, String> {
    engine::all(view).await
}

/// Writes `cookies` into the store `view` is in, each over any cookie that is the same
/// one, and leaves every other cookie there as it was.
pub(crate) async fn put(view: &Webview, cookies: &[&Cookie]) -> Result<(), String> {
    engine::set(view, cookies, now()).await
}

#[cfg(windows)]
pub(crate) mod engine {
    use serde_json::{json, Map, Value};
    use tauri::Webview;

    use super::super::cdp;
    use super::{until, Cookie, Partition, Priority, SameSite};

    pub(super) async fn all(view: &Webview) -> Result<Vec<Cookie>, String> {
        let answered = cdp::call(view, "Network.getAllCookies", &json!({})).await?;
        Ok(cookies_in(&answered))
    }

    pub(super) async fn set(view: &Webview, cookies: &[&Cookie], now: f64) -> Result<(), String> {
        if cookies.is_empty() {
            return Ok(());
        }
        let list: Vec<Value> = cookies.iter().map(|one| to_devtools(one, now)).collect();
        cdp::call(view, "Network.setCookies", &json!({ "cookies": list }))
            .await
            .map(|_| ())
    }

    /// The cookies in `Network.getAllCookies`' answer.
    pub(crate) fn cookies_in(answered: &Value) -> Vec<Cookie> {
        answered["cookies"]
            .as_array()
            .map(|list| list.iter().filter_map(from_devtools).collect())
            .unwrap_or_default()
    }

    /// What `Network.deleteCookies` is asked to take exactly this cookie away: its name,
    /// domain and path, and its partition where it has one. Without a partition the engine
    /// takes only the unpartitioned cookie of that name, never one in a partition.
    pub(crate) fn deleting(cookie: &Cookie) -> Value {
        let mut asked = Map::new();
        asked.insert("name".into(), json!(cookie.name));
        asked.insert("domain".into(), json!(cookie.domain));
        asked.insert("path".into(), json!(cookie.path));
        if let Some(partition) = &cookie.partition {
            asked.insert("partitionKey".into(), partition_key(partition));
        }
        Value::Object(asked)
    }

    /// A partition as the protocol takes it now: an object. (Chromium before 119 said a
    /// string, which `from_devtools` still reads.)
    fn partition_key(partition: &Partition) -> Value {
        json!({
            "topLevelSite": partition.top_level_site,
            "hasCrossSiteAncestor": partition.cross_site_ancestor,
        })
    }

    /// One cookie out of the protocol's own shape.
    pub(crate) fn from_devtools(said: &Value) -> Option<Cookie> {
        let text = |key: &str| said[key].as_str().map(str::to_owned);
        let partition = match &said["partitionKey"] {
            Value::String(site) => Some(Partition {
                top_level_site: site.clone(),
                cross_site_ancestor: false,
            }),
            Value::Object(key) => Some(Partition {
                top_level_site: key.get("topLevelSite")?.as_str()?.to_owned(),
                cross_site_ancestor: key
                    .get("hasCrossSiteAncestor")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            }),
            _ => None,
        };
        let session = said["session"].as_bool().unwrap_or(false);
        Some(Cookie {
            name: text("name")?,
            value: text("value").unwrap_or_default(),
            domain: text("domain")?,
            path: text("path").unwrap_or_else(|| "/".to_owned()),
            expires: if session {
                None
            } else {
                said["expires"].as_f64()
            },
            http_only: said["httpOnly"].as_bool().unwrap_or(false),
            secure: said["secure"].as_bool().unwrap_or(false),
            same_site: match said["sameSite"].as_str() {
                Some("Strict") => Some(SameSite::Strict),
                Some("Lax") => Some(SameSite::Lax),
                Some("None") => Some(SameSite::None),
                _ => None,
            },
            priority: match said["priority"].as_str() {
                Some("Low") => Some(Priority::Low),
                Some("Medium") => Some(Priority::Medium),
                Some("High") => Some(Priority::High),
                _ => None,
            },
            partition,
            source_scheme: text("sourceScheme"),
            source_port: said["sourcePort"].as_i64(),
        })
    }

    /// One cookie in the protocol's shape for `setCookies`. A cookie only its own host
    /// is sent (no leading dot) is set by address, which is the one way the protocol has
    /// of making a host-only cookie; a domain cookie is set by its domain.
    pub(crate) fn to_devtools(cookie: &Cookie, now: f64) -> Value {
        let mut out = Map::new();
        out.insert("name".into(), json!(cookie.name));
        out.insert("value".into(), json!(cookie.value));
        if cookie.domain.starts_with('.') {
            out.insert("domain".into(), json!(cookie.domain));
        } else {
            let scheme = if cookie.secure { "https" } else { "http" };
            out.insert(
                "url".into(),
                json!(format!("{scheme}://{}{}", cookie.domain, cookie.path)),
            );
        }
        out.insert("path".into(), json!(cookie.path));
        out.insert("secure".into(), json!(cookie.secure));
        out.insert("httpOnly".into(), json!(cookie.http_only));
        out.insert("expires".into(), json!(until(cookie, now)));
        if let Some(same_site) = cookie.same_site {
            out.insert("sameSite".into(), json!(same_site));
        }
        if let Some(priority) = cookie.priority {
            out.insert("priority".into(), json!(priority));
        }
        if let Some(partition) = &cookie.partition {
            out.insert("partitionKey".into(), partition_key(partition));
        }
        if let Some(scheme) = &cookie.source_scheme {
            out.insert("sourceScheme".into(), json!(scheme));
        }
        if let Some(port) = cookie.source_port {
            out.insert("sourcePort".into(), json!(port));
        }
        Value::Object(out)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod engine {
    use tauri::webview::cookie;
    use tauri::Webview;

    use super::{until, Cookie, SameSite};

    /// Tauri's cookie calls wait on the window's thread, so they are made from a thread
    /// that may block rather than from the runtime's own.
    async fn blocking<T: Send + 'static>(
        view: &Webview,
        work: impl FnOnce(Webview) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let view = view.clone();
        tauri::async_runtime::spawn_blocking(move || work(view))
            .await
            .map_err(|error| error.to_string())?
    }

    pub(super) async fn all(view: &Webview) -> Result<Vec<Cookie>, String> {
        blocking(view, |view| {
            Ok(view
                .cookies()
                .map_err(|error| error.to_string())?
                .iter()
                .map(from_engine)
                .collect())
        })
        .await
    }

    pub(super) async fn set(view: &Webview, cookies: &[&Cookie], now: f64) -> Result<(), String> {
        let made: Vec<cookie::Cookie<'static>> =
            cookies.iter().map(|one| to_engine(one, now)).collect();
        blocking(view, move |view| {
            for one in made {
                view.set_cookie(one).map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .await
    }

    /// A moment as seconds since 1970.
    #[allow(
        clippy::cast_precision_loss,
        reason = "seconds since 1970 fit a double's 53 bits for millions of years"
    )]
    fn seconds(at: cookie::time::OffsetDateTime) -> f64 {
        at.unix_timestamp() as f64
    }

    fn from_engine(said: &cookie::Cookie<'static>) -> Cookie {
        Cookie {
            name: said.name().to_owned(),
            value: said.value().to_owned(),
            domain: said.domain_raw().unwrap_or_default().to_owned(),
            path: said.path().unwrap_or("/").to_owned(),
            expires: said.expires_datetime().map(seconds),
            http_only: said.http_only().unwrap_or(false),
            secure: said.secure().unwrap_or(false),
            same_site: said.same_site().map(|one| match one {
                cookie::SameSite::Strict => SameSite::Strict,
                cookie::SameSite::Lax => SameSite::Lax,
                cookie::SameSite::None => SameSite::None,
            }),
            priority: None,
            partition: None,
            source_scheme: None,
            source_port: None,
        }
    }

    #[allow(
        clippy::cast_possible_truncation,
        reason = "an expiry is whole seconds; the fraction a cookie store keeps is noise"
    )]
    fn to_engine(one: &Cookie, now: f64) -> cookie::Cookie<'static> {
        let expires = cookie::time::OffsetDateTime::from_unix_timestamp(until(one, now) as i64)
            .map_or(cookie::Expiration::Session, cookie::Expiration::DateTime);
        let mut made = cookie::Cookie::build((one.name.clone(), one.value.clone()))
            .domain(one.domain.clone())
            .path(one.path.clone())
            .secure(one.secure)
            .http_only(one.http_only)
            .expires(expires);
        if let Some(same_site) = one.same_site {
            made = made.same_site(match same_site {
                SameSite::Strict => cookie::SameSite::Strict,
                SameSite::Lax => cookie::SameSite::Lax,
                SameSite::None => cookie::SameSite::None,
            });
        }
        made.build()
    }
}

#[cfg(all(test, windows))]
mod tests {
    use serde_json::json;

    use super::engine::{from_devtools, to_devtools};
    use super::KEPT_FOR;

    /// A cookie out of the protocol and back in keeps everything that makes it the same
    /// cookie: partition, priority, the source binding, and whether it is only its host's.
    #[test]
    fn a_cookie_round_trips_through_the_protocol() {
        let said = json!({
            "name": "__Host-sid", "value": "v", "domain": "moodle.ethz.ch", "path": "/",
            "expires": 1_900_000_000.25, "size": 10, "httpOnly": true, "secure": true,
            "session": false, "sameSite": "Strict", "priority": "High",
            "sourceScheme": "Secure", "sourcePort": 443,
            "partitionKey": { "topLevelSite": "https://ethz.ch", "hasCrossSiteAncestor": true },
        });
        let cookie = from_devtools(&said).expect("a cookie");
        assert_eq!(cookie.expires, Some(1_900_000_000.25));
        let back = to_devtools(&cookie, 0.0);
        assert_eq!(back["url"], "https://moodle.ethz.ch/");
        assert!(
            back.get("domain").is_none(),
            "a host-only cookie is set by address"
        );
        assert_eq!(back["expires"], 1_900_000_000.25);
        assert_eq!(back["sameSite"], "Strict");
        assert_eq!(back["priority"], "High");
        assert_eq!(back["partitionKey"]["topLevelSite"], "https://ethz.ch");
        assert_eq!(back["partitionKey"]["hasCrossSiteAncestor"], true);
        assert_eq!(back["sourcePort"], 443);
    }

    /// A session cookie is written with four hundred days, a domain cookie by its domain,
    /// and an old engine's partition key (a string) is still read.
    #[test]
    fn a_session_cookie_is_written_to_last() {
        let said = json!({
            "name": "sid", "value": "1", "domain": ".ethz.ch", "path": "/",
            "expires": -1, "session": true, "partitionKey": "https://ethz.ch",
        });
        let cookie = from_devtools(&said).expect("a cookie");
        assert_eq!(cookie.expires, None);
        assert_eq!(
            cookie
                .partition
                .as_ref()
                .map(|one| one.top_level_site.as_str()),
            Some("https://ethz.ch")
        );
        let back = to_devtools(&cookie, 1000.0);
        assert_eq!(back["domain"], ".ethz.ch");
        assert!(back.get("url").is_none());
        assert_eq!(back["expires"], 1000.0 + KEPT_FOR);
    }
}
