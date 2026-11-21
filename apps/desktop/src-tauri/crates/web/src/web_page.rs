use serde::Serialize;
use tauri::AppHandle;

const SAID: &str = "orden://web-page";
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "said", rename_all = "lowercase")]
pub enum Said {
    Zoom { factor: f64 },
    Step { step: Step },
    Arrived { url: String, failure: Failure, bare: bool },
    Crashed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Failure {
    Offline,
    Unknown,
    Unreachable,
    Slow,
    Certificate,
    Blocked,
    Other,
}
impl Failure {
    pub fn of(code: i32) -> Option<Self> {
        Some(match code {
            0 | -1 | -3 | -301 | -302 => return None,
            -106 | -21 => Self::Offline,
            -105 | -137 | -6 => Self::Unknown,
            -7 | -118 => Self::Slow,
            -102..=-100 | -104 | -109 | -15 | -324 => Self::Unreachable,
            -107 | -113 | -501 | -299..=-200 => Self::Certificate,
            -10 | -20 | -22 | -27 => Self::Blocked,
            _ => Self::Other,
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    In,
    Out,
    Reset,
}
#[derive(Clone, Serialize)]
struct Heard {
    tab: String,
    #[serde(flatten)]
    said: Said,
}
pub fn ended(view: &tauri::Webview) {
    use tauri::{Emitter, Manager};

    let Some(tab) = crate::web_tabs::tab_of(view.label()) else {
        return;
    };
    let window = view.window().label().to_string();
    let heard = Heard { tab, said: Said::Crashed };
    let _ = view.app_handle().emit_to(window.as_str(), SAID, heard);
}
pub fn failed(app: &AppHandle, tab: &str, url: &str, code: i32) {
    use tauri::Emitter;

    let Some(failure) = Failure::of(code) else {
        return;
    };
    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    let said = Said::Arrived { url: url.to_string(), failure, bare: true };
    let _ = app.emit_to(view.window().label(), SAID, Heard { tab: tab.to_string(), said });
}
pub fn stepped(app: &AppHandle, tab: &str, step: Step) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    let heard = Heard { tab: tab.to_string(), said: Said::Step { step } };
    let _ = app.emit_to(view.window().label(), SAID, heard);
}
pub fn actual_size(app: &AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    if view.set_zoom(crate::page_scale::web(1.0)).is_ok() {
        let heard = Heard { tab: tab.to_string(), said: Said::Zoom { factor: 1.0 } };
        let _ = app.emit_to(window, SAID, heard);
    }
}
#[tauri::command]
pub fn web_mute(app: AppHandle, tab: String, muted: bool) -> Result<(), String> {
    mute(&crate::web_tabs::found(&app, &tab)?, muted)
}
#[tauri::command]
pub fn web_unfill(app: AppHandle, tab: String) -> Result<(), String> {
    crate::web_tabs::found(&app, &tab)?
        .eval("if (document.fullscreenElement) document.exitFullscreen()")
        .map_err(|error| format!("that page could not be reached: {error}"))
}
pub fn mute(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    (crate::engine::engine()?.mute)(view, muted)
}
#[cfg(test)]
mod tests {
    use super::{Failure, Heard, Said, Step};

    #[test]
    fn a_page_that_does_not_arrive_says_why_in_the_window_s_words() {
        let said = Heard {
            tab: "t2".into(),
            said: Said::Arrived {
                url: "https://a.test/".into(),
                failure: Failure::Offline,
                bare: true,
            },
        };
        assert_eq!(
            serde_json::to_value(said).expect("a failure"),
            serde_json::json!({
                "tab": "t2",
                "said": "arrived",
                "url": "https://a.test/",
                "failure": "offline",
                "bare": true,
            })
        );
    }
    #[test]
    fn chromium_s_net_errors_are_read_as_what_they_mean() {
        assert_eq!(Failure::of(-3), None);
        assert_eq!(Failure::of(-302), None);
        assert_eq!(Failure::of(-106), Some(Failure::Offline));
        assert_eq!(Failure::of(-105), Some(Failure::Unknown));
        assert_eq!(Failure::of(-118), Some(Failure::Slow));
        assert_eq!(Failure::of(-102), Some(Failure::Unreachable));
        assert_eq!(Failure::of(-202), Some(Failure::Certificate));
        assert_eq!(Failure::of(-20), Some(Failure::Blocked));
        assert_eq!(Failure::of(-310), Some(Failure::Other));
    }

    #[test]
    fn a_zoom_asked_in_the_page_reaches_the_window_as_a_step() {
        let said = |step| {
            serde_json::to_value(Heard { tab: "t1".into(), said: Said::Step { step } })
                .expect("a step")
        };
        assert_eq!(
            said(Step::In),
            serde_json::json!({ "tab": "t1", "said": "step", "step": "in" })
        );
        assert_eq!(said(Step::Out)["step"], "out");
        assert_eq!(said(Step::Reset)["step"], "reset");
    }
}
