use std::sync::Mutex;
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
    let pages = views
        .values()
        .filter(|one| one.label().starts_with(crate::web_tabs::LABEL));
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
    let _ = view.set_background_color(clear.then_some(Color(0, 0, 0, 0)));
    let _ = view.eval(script);
}
