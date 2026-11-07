#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SCRIPT: &str = include_str!("web_swipe.js");

pub fn script() -> &'static str {
    SCRIPT.trim().trim_start_matches(';')
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const BINDING: &str = "nibSwiped";

#[cfg(any(not(feature = "cef"), test))]
const NAMED: &str = "orden-swipe:";

#[cfg(any(not(feature = "cef"), test))]
pub fn named(name: &str) -> Option<&str> {
    name.strip_prefix(NAMED)
}

const SWIPED: &str = "orden://web-swipe";

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn binding() -> Value {
    json!({ "name": BINDING, "executionContextName": crate::web_worlds::WORLD })
}

const LONGEST: f64 = 10_000.0;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "k")]
enum Said {
    #[serde(rename = "w")]
    Wheel {
        dx: f64,
        dy: f64,
        t: f64,
        l: bool,
        r: bool,
    },
    #[serde(rename = "t")]
    Touch {
        dx: f64,
        dy: f64,
        t: f64,
        l: bool,
        r: bool,
    },
    #[serde(rename = "e")]
    End { t: f64 },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Swiped {
    tab: String,
    kind: &'static str,
    dx: f64,
    dy: f64,
    at: f64,
    left: bool,
    right: bool,
}

pub fn read(tab: &str, payload: &str) -> Option<Swiped> {
    let said: Said = serde_json::from_str(payload).ok()?;
    let fine = |one: f64| one.is_finite() && one.abs() <= LONGEST;
    let step = |kind, dx: f64, dy: f64, at: f64, left, right| {
        (fine(dx) && fine(dy) && at.is_finite()).then(|| Swiped {
            tab: tab.to_string(),
            kind,
            dx,
            dy,
            at,
            left,
            right,
        })
    };
    match said {
        Said::Wheel { dx, dy, t, l, r } => step("wheel", dx, dy, t, l, r),
        Said::Touch { dx, dy, t, l, r } => step("touch", dx, dy, t, l, r),
        Said::End { t } => step("lift", 0.0, 0.0, t, false, false),
    }
}

pub fn heard(app: &tauri::AppHandle, window: &str, tab: &str, payload: &str) {
    use tauri::Emitter;

    if let Some(swiped) = read(tab, payload) {
        let _ = app.emit_to(window, SWIPED, swiped);
    }
}

#[cfg(test)]
mod tests {
    use super::{binding, named, read, Swiped, BINDING, SCRIPT};

    fn swiped(kind: &'static str, dx: f64, dy: f64, at: f64, left: bool, right: bool) -> Swiped {
        Swiped {
            tab: "t1".into(),
            kind,
            dx,
            dy,
            at,
            left,
            right,
        }
    }

    #[test]
    fn a_frame_of_scroll_is_read_as_numbers_for_the_tab_it_came_from() {
        assert_eq!(
            read(
                "t1",
                r#"{"k":"w","dx":-12.5,"dy":0.5,"t":1234.5,"l":false,"r":true}"#
            ),
            Some(swiped("wheel", -12.5, 0.5, 1234.5, false, true))
        );
        assert_eq!(
            read("t1", r#"{"k":"t","dx":3,"dy":-1,"t":8,"l":true,"r":false}"#),
            Some(swiped("touch", 3.0, -1.0, 8.0, true, false))
        );
        assert_eq!(
            read("t1", r#"{"k":"e","t":99}"#),
            Some(swiped("lift", 0.0, 0.0, 99.0, false, false))
        );
    }

    #[test]
    fn anything_else_a_page_could_say_is_nothing() {
        for said in [
            "",
            "null",
            "[]",
            r#"{"k":"x","t":1}"#,
            r#"{"k":"w","dx":"1","dy":0,"t":1,"l":false,"r":false}"#,
            r#"{"k":"w","dx":1,"dy":0,"t":1}"#,
            r#"{"k":"w","dx":1e9,"dy":0,"t":1,"l":false,"r":false}"#,
            r#"{"k":"t","dx":1,"dy":-1e300,"t":1,"l":false,"r":false}"#,
        ] {
            assert_eq!(read("t1", said), None, "{said}");
        }
    }

    #[test]
    fn the_window_is_told_in_its_own_words() {
        let told = serde_json::to_value(swiped("wheel", -4.0, 0.0, 10.0, false, true))
            .expect("a swipe is said as JSON");
        assert_eq!(
            told,
            serde_json::json!({
                "tab": "t1", "kind": "wheel", "dx": -4.0, "dy": 0.0, "at": 10.0,
                "left": false, "right": true,
            })
        );
    }

    #[test]
    fn a_swipe_said_as_a_window_name_is_read_off_the_name() {
        assert_eq!(
            named(r#"orden-swipe:{"k":"e","t":1}"#),
            Some(r#"{"k":"e","t":1}"#)
        );
        assert_eq!(named("orden-find"), None);
        assert_eq!(named("orden-swipe"), None);
        assert_eq!(named(""), None);
        let said = named(r#"orden-swipe:{"k":"w","dx":-3,"dy":0,"t":2,"l":false,"r":false}"#)
            .and_then(|payload| read("t1", payload));
        assert_eq!(said.map(|one| one.kind), Some("wheel"));
    }

    #[test]
    fn the_binding_is_nib_s_world_s_alone() {
        assert_eq!(binding()["name"], BINDING);
        assert_eq!(binding()["executionContextName"], crate::web_worlds::WORLD);
    }

    #[test]
    fn the_script_asks_through_the_binding_and_only_listens() {
        assert!(SCRIPT.contains(&format!("globalThis.{BINDING}")));
        assert!(SCRIPT.contains(&format!("open('about:blank', '{}' + words)", super::NAMED)));
        let listening = SCRIPT.matches("addEventListener(").count();
        assert_eq!(listening, 6);
        assert_eq!(SCRIPT.matches("passive: true").count(), listening);
        assert!(!SCRIPT.contains("preventDefault()"));
        assert!(!SCRIPT.contains("stopPropagation"));
    }
}
