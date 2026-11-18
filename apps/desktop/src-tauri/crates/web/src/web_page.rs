use serde::Serialize;
use tauri::AppHandle;

const SAID: &str = "orden://web-page";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "said", rename_all = "lowercase")]
pub enum Said {
    Zoom { factor: f64 },
    Step { step: Step },
    Crashed,
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
    let heard = Heard {
        tab,
        said: Said::Crashed,
    };
    let _ = view.app_handle().emit_to(window.as_str(), SAID, heard);
}

pub fn stepped(app: &AppHandle, tab: &str, step: Step) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    let heard = Heard {
        tab: tab.to_string(),
        said: Said::Step { step },
    };
    let _ = app.emit_to(view.window().label(), SAID, heard);
}

pub fn actual_size(app: &AppHandle, window: &str, tab: &str) {
    use tauri::Emitter;

    let Ok(view) = crate::web_tabs::found(app, tab) else {
        return;
    };
    if view.set_zoom(crate::page_scale::web(1.0)).is_ok() {
        let heard = Heard {
            tab: tab.to_string(),
            said: Said::Zoom { factor: 1.0 },
        };
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
    use super::{Heard, Said, Step};

    #[test]
    fn a_zoom_asked_in_the_page_reaches_the_window_as_a_step() {
        let said = |step| {
            serde_json::to_value(Heard {
                tab: "t1".into(),
                said: Said::Step { step },
            })
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
