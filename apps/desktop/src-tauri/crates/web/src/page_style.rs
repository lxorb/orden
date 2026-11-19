use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use orden_base::Held as _;
use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, Webview};

const LINE: &str = "/*! orden-pages ";
const NOTHING: &str = r#"{"clear":false,"sheets":[]}"#;
const WEAR: &str = r"(function () {
  var pages = __PAGES__;
  function wear() {
    document.querySelectorAll('style.orden-page-style').forEach(function (old) { old.remove(); });
    pages.sheets.forEach(function (one) {
      Promise.resolve().then(function () {
        if (!document.documentElement || !new RegExp(one.match).test(location.href)) return;
        var style = document.createElement('style');
        style.className = 'orden-page-style';
        style.textContent = one.css;
        document.documentElement.appendChild(style);
      });
    });
  }
  wear();
  document.addEventListener('DOMContentLoaded', wear);
})()";
static PAGES: Mutex<String> = Mutex::new(String::new());
#[tauri::command]
pub fn wear_page_styles(app: AppHandle, css: String) {
    let mut lines = css.lines().map(str::trim);
    let said = lines.find_map(|line| line.strip_prefix(LINE)?.strip_suffix("*/"));
    let read = serde_json::from_str::<serde_json::Value>(said.unwrap_or(NOTHING));
    if let Ok(mut kept) = PAGES.lock() {
        *kept = read.map_or_else(|_| NOTHING.to_string(), |pages| pages.to_string());
    }
    let views = app.webviews();
    let pages = views.values().filter(|one| one.label().starts_with(crate::web_tabs::LABEL));
    pages.for_each(worn);
}
pub fn with(scripts: String) -> String {
    let pages = PAGES.lock().map(|kept| kept.clone()).unwrap_or_default();
    let said = if pages.is_empty() { NOTHING } else { &pages };
    format!("{scripts}{};\n", WEAR.replace("__PAGES__", said))
}
pub fn worn(view: &Webview) {
    let script = with(String::new());
    let clear = script.contains(r#""clear":true"#);
    let ground = if clear { Some(Color(0, 0, 0, 0)) } else { grounded(view.window().label()) };
    let _ = view.set_background_color(ground);
    let _ = view.eval(script);
}
static GROUNDS: LazyLock<Mutex<HashMap<String, Color>>> = LazyLock::new(Mutex::default);
#[must_use]
pub fn ground_of(said: &str) -> Option<Color> {
    let hex = said.trim().strip_prefix('#')?;
    let wide = match hex.len() {
        3 => hex.chars().flat_map(|one| [one, one]).collect::<String>(),
        6 => hex.to_owned(),
        _ => return None,
    };
    let at = |from: usize| u8::from_str_radix(wide.get(from..from + 2)?, 16).ok();
    Some(Color(at(0)?, at(2)?, at(4)?, 255))
}
#[must_use]
pub fn grounded(window: &str) -> Option<Color> {
    GROUNDS.held().get(window).copied()
}
pub fn ground_for(window: &str, said: Option<&str>) -> Option<Color> {
    let ground = said.and_then(ground_of)?;
    GROUNDS.held().insert(window.to_owned(), ground);
    Some(ground)
}
#[tauri::command]
pub fn web_ground(webview: Webview, ground: String) -> Result<(), String> {
    let window = webview.window().label().to_owned();
    ground_for(&window, Some(&ground)).ok_or_else(|| format!("{ground} is not a colour"))?;
    let views = webview.app_handle().webviews();
    views
        .values()
        .filter(|one| one.label().starts_with(crate::web_tabs::LABEL))
        .filter(|one| one.window().label() == window)
        .for_each(worn_ground);
    Ok(())
}
fn worn_ground(view: &Webview) {
    let clear = with(String::new()).contains(r#""clear":true"#);
    if !clear {
        let _ = view.set_background_color(grounded(view.window().label()));
    }
}
#[cfg(test)]
mod tests {
    use super::{ground_for, ground_of, grounded};
    use tauri::utils::config::Color;

    #[test]
    fn a_ground_is_a_colour_in_hex_and_is_kept_for_its_window() {
        assert_eq!(ground_of("#0e1013"), Some(Color(14, 16, 19, 255)));
        assert_eq!(ground_of(" #FBFCFD "), Some(Color(251, 252, 253, 255)));
        assert_eq!(ground_of("#fff"), Some(Color(255, 255, 255, 255)));
        for wrong in ["", "0e1013", "#0e10", "#zzzzzz", "rgb(1,2,3)", "#0e1013ff"] {
            assert_eq!(ground_of(wrong), None, "{wrong}");
        }
        assert_eq!(ground_for("orden-ground-test", Some("#102030")), Some(Color(16, 32, 48, 255)));
        assert_eq!(grounded("orden-ground-test"), Some(Color(16, 32, 48, 255)));
        assert_eq!(ground_for("orden-ground-test", Some("nothing")), None);
        assert_eq!(grounded("orden-ground-test"), Some(Color(16, 32, 48, 255)));
    }
}
