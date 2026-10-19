//! What the theme now worn says of the pages in web tabs: the rules of a Firefox
//! `userContent.css`, each with the addresses it is for, which an imported theme
//! carries on a line of its own file (`paged` in `lib/themes/browser.ts`).
//!
//! A page wears them as a style element of its own document, put there by a script it
//! is built with and told again whenever it has loaded or the theme changes. Where the
//! rules clear a page's own ground, the page's webview is clear with it, so a page
//! that paints nothing shows the window the way it shows Firefox's.
//!
//! A theme out of the store cannot say any of this: what `review` lets through has no
//! comment left in it. A file somebody put in the folder can, as `custom.css` can
//! restyle the app.

use std::sync::Mutex;
use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, Webview};

/// What starts the line a theme file says its pages on.
const LINE: &str = "/*! nib-pages ";

/// What nothing said of pages reads as.
const NOTHING: &str = r#"{"clear":false,"sheets":[]}"#;

/// The script a page runs with `__PAGES__` written in: every sheet whose pattern the
/// address answers to, each in a turn of its own so a pattern that will not compile
/// costs that sheet and no other.
const WEAR: &str = r"(function () {
  var pages = __PAGES__;
  function wear() {
    document.querySelectorAll('style.nib-page-style').forEach(function (old) { old.remove(); });
    pages.sheets.forEach(function (one) {
      Promise.resolve().then(function () {
        if (!document.documentElement || !new RegExp(one.match).test(location.href)) return;
        var style = document.createElement('style');
        style.className = 'nib-page-style';
        style.textContent = one.css;
        document.documentElement.appendChild(style);
      });
    });
  }
  wear();
  document.addEventListener('DOMContentLoaded', wear);
})()";

/// What the theme said, as the JSON it said it in.
static PAGES: Mutex<String> = Mutex::new(String::new());

/// The theme now worn, read for what it says of pages, and every open page told.
#[tauri::command]
pub fn wear_page_styles(app: AppHandle, css: String) {
    let mut lines = css.lines().map(str::trim);
    let said = lines.find_map(|line| line.strip_prefix(LINE)?.strip_suffix("*/"));
    // Read and written again, so only what is JSON is ever written into a script.
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

/// The script a page is built with, after `scripts`.
pub fn with(scripts: String) -> String {
    let pages = PAGES.lock().map(|kept| kept.clone()).unwrap_or_default();
    let said = if pages.is_empty() { NOTHING } else { &pages };
    format!("{scripts}{};\n", WEAR.replace("__PAGES__", said))
}

/// One page, wearing what is said now: its rules, and a ground that is clear where the
/// rules clear it and the page's own white where they do not.
pub fn worn(view: &Webview) {
    let script = with(String::new());
    let clear = script.contains(r#""clear":true"#);
    let _ = view.set_background_color(clear.then_some(Color(0, 0, 0, 0)));
    let _ = view.eval(script);
}
