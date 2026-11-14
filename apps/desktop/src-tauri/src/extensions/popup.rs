use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter as _, LogicalSize, Manager as _, PhysicalPosition, PhysicalSize, Url,
    Webview, WebviewBuilder, WebviewUrl,
};

const LABEL: &str = "web-extension-popup-";

static NUMBERED: AtomicU64 = AtomicU64::new(0);

static SHOWN: Mutex<Option<String>> = Mutex::new(None);

static WANTED: Mutex<Option<String>> = Mutex::new(None);

fn want(label: Option<String>) {
    *WANTED.lock().unwrap_or_else(PoisonError::into_inner) = label;
}

fn is_wanted(label: &str) -> bool {
    WANTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_deref()
        == Some(label)
}

fn fresh_label() -> String {
    format!("{LABEL}{}", NUMBERED.fetch_add(1, Ordering::SeqCst))
}

fn taken() -> Option<String> {
    SHOWN.lock().unwrap_or_else(PoisonError::into_inner).take()
}

fn is_shown(label: &str) -> bool {
    SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_deref()
        == Some(label)
}

fn answering(app: &AppHandle) -> Option<Webview> {
    let label = SHOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()?;
    let view = app.get_webview(&label)?;
    let _doing = crate::stall::doing("extension popup: asked");
    if crate::web_answers::answers(&view) {
        Some(view)
    } else {
        crate::web_answers::said(app);
        None
    }
}

const SAID: &str = "orden://extension-popup";

const SMALLEST: f64 = 25.0;
const WIDEST: f64 = 800.0;
const TALLEST: f64 = 600.0;

const FLUID: f64 = 380.0;

const NO_WIDTH: f64 = 100.0;

const ASKED_AT: [u64; 4] = [0, 150, 500, 1200];

const AGAIN_EVERY: u64 = 1000;

static MEASURING: AtomicU64 = AtomicU64::new(0);

fn wait_before(ask: usize) -> u64 {
    match (
        ask.checked_sub(1).and_then(|at| ASKED_AT.get(at)),
        ASKED_AT.get(ask),
    ) {
        (_, None) => AGAIN_EVERY,
        (None, Some(&first)) => first,
        (Some(&before), Some(&at)) => at - before,
    }
}

fn measuring() -> u64 {
    MEASURING.fetch_add(1, Ordering::SeqCst) + 1
}

fn still(which: u64) -> bool {
    MEASURING.load(Ordering::SeqCst) == which
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Said {
    Size { width: u32, height: u32 },
    Closed,
}

#[tauri::command]
pub async fn extension_popup_open(
    webview: Webview,
    id: String,
    tab: String,
    store: Option<String>,
    rect: Rect,
) -> Result<Option<String>, String> {
    let label = fresh_label();
    want(Some(label.clone()));
    let app = webview.app_handle().clone();
    let finding = app.clone();
    let address: Url =
        tauri::async_runtime::spawn_blocking(move || super::page_of(&finding, &id, false))
            .await
            .map_err(|error| error.to_string())??
            .parse()
            .map_err(|_| "that extension's popup has no address".to_string())?;
    let store = crate::web_stores::named(store.as_deref())?.map(str::to_owned);

    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(blank()?))
        .focused(crate::placement::away().is_none())
        .disable_drag_drop_handler()
        .on_navigation(crate::web_tabs::tab_may_open);
    let builder = crate::engine::web_store(builder, &app, store.as_deref())?;
    let measuring = app.clone();
    let builder = builder.on_page_load(move |view, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            && super::ours(payload.url())
        {
            let (app, view) = (measuring.clone(), view.clone());
            std::thread::spawn(move || measure(&app, &view));
        }
    });
    let holder = webview.window().label().to_string();
    let (opening, asking, going) = (app.clone(), tab.clone(), label.clone());
    let builder = builder.on_new_window(move |url: Url, _| {
        if crate::web_tabs::tab_may_open(&url) {
            crate::web_tabs::open_as_tab(&opening, &holder, &asking, &url);
        }
        let (app, label) = (opening.clone(), going.clone());
        let _ = opening.run_on_main_thread(move || went(&app, &label));
        tauri::webview::NewWindowResponse::Deny
    });

    let window = webview.window();
    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<Option<String>, String>>(1);
    let building = app.clone();
    app.run_on_main_thread(move || {
        let _doing = crate::stall::doing("extension_popup_open: building the popup");
        if !is_wanted(&label) {
            let _ = sending.try_send(Ok(None));
            return;
        }
        closed(&building);
        if let Some(page) = building.get_webview(&crate::web_tabs::label_of(&tab)) {
            if !crate::web_answers::answers(&page) {
                crate::web_answers::said(&building);
                let _ = sending.try_send(Err(crate::web_answers::NOT_ANSWERING.to_owned()));
                return;
            }
        }
        let _ = &store;
        let scale = crate::page_scale::of(&window).unwrap_or(1.0);
        let made = crate::engine::add_child(
            &window,
            builder,
            PhysicalPosition::new(rect.x * scale, rect.y * scale),
            LogicalSize::new(SMALLEST, SMALLEST),
        )
        .map_err(|error| format!("that popup could not be opened: {error}"));
        let made = made.map(|view| {
            *SHOWN.lock().unwrap_or_else(PoisonError::into_inner) = Some(label.clone());
            sent(&building, &view, &address);
            Some(label)
        });
        let _ = sending.try_send(made);
    })
    .map_err(|error| error.to_string())?;
    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("that popup was never built".into()))
}

#[tauri::command]
pub fn extension_popup_place(app: AppHandle, rect: Rect) {
    if let Some(view) = answering(&app) {
        let _doing = crate::stall::doing("extension_popup_place");
        let scale = crate::page_scale::of(&view.window()).unwrap_or(1.0);
        let _ = view.set_position(PhysicalPosition::new(rect.x * scale, rect.y * scale));
        let _ = view.set_size(PhysicalSize::new(
            rect.width.max(1.0) * scale,
            rect.height.max(1.0) * scale,
        ));
    }
}

#[tauri::command]
pub async fn extension_popup_close(app: AppHandle, label: Option<String>) {
    if label.is_none() {
        want(None);
    }
    let closing = app.clone();
    let _ = app.run_on_main_thread(move || {
        if label.as_deref().is_none_or(is_shown) {
            closed(&closing);
        }
    });
}

fn closed(app: &AppHandle) {
    let Some(label) = taken() else {
        return;
    };
    let Some(view) = app.get_webview(&label) else {
        return;
    };
    let _doing = crate::stall::doing("extension popup: closing");
    if crate::web_answers::answers(&view) {
        let _ = view.close();
    } else {
        crate::web_answers::said(app);
        crate::web_answers::put_away(&view);
        crate::web_answers::close_when_answering(app, label);
    }
}

fn went(app: &AppHandle, label: &str) {
    if is_shown(label) {
        closed(app);
        let _ = app.emit(SAID, Said::Closed);
    }
}

fn blank() -> Result<Url, String> {
    "about:blank"
        .parse()
        .map_err(|_| "no blank page to start from".to_string())
}

fn sent(app: &AppHandle, view: &Webview, address: &Url) {
    {
        let _ = app;
        let (view, address) = (view.clone(), address.clone());
        std::thread::spawn(move || {
            let _ = crate::web_worlds::sent(&view, &address, "");
        });
    }
}

fn measure(app: &AppHandle, view: &Webview) {
    let mine = measuring();
    let mut shown = (pixels(SMALLEST), pixels(SMALLEST));
    for ask in 0.. {
        std::thread::sleep(Duration::from_millis(wait_before(ask)));
        if !is_shown(view.label()) || !still(mine) {
            return;
        }
        let Some((width, _)) = laid_out(view) else {
            continue;
        };
        let width = if width < NO_WIDTH { FLUID } else { width };
        let width = pixels(width.clamp(SMALLEST, WIDEST)).max(shown.0);
        if width != shown.0 {
            resized(app, view.label(), LogicalSize::new(width, shown.1));
            std::thread::sleep(Duration::from_millis(30));
        }
        let Some((_, height)) = laid_out(view) else {
            continue;
        };
        let wanted = (width, pixels(height.clamp(SMALLEST, TALLEST)).max(shown.1));
        if wanted == shown {
            continue;
        }
        shown = wanted;
        resized(app, view.label(), LogicalSize::new(shown.0, shown.1));
        let _ = app.emit(
            SAID,
            Said::Size {
                width: shown.0,
                height: shown.1,
            },
        );
    }
}

fn resized(app: &AppHandle, label: &str, size: LogicalSize<u32>) {
    let (sizing, label) = (app.clone(), label.to_owned());
    let _ = app.run_on_main_thread(move || {
        if let Some(view) = answering(&sizing).filter(|view| view.label() == label) {
            let _ = view.set_size(size);
        }
    });
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to a popup's bounds first, so always a small positive length"
)]
fn pixels(length: f64) -> u32 {
    length.ceil().max(0.0) as u32
}

const ASK: &str = "(() => { const root = document.documentElement, body = document.body, own = root.getAttribute('style'); root.removeAttribute('style'); const size = [Math.max(root.scrollWidth, body ? body.scrollWidth : 0), Math.max(root.scrollHeight, body ? body.scrollHeight : 0)]; if (own !== null) root.setAttribute('style', own); return JSON.stringify(size) })()";

fn laid_out(view: &Webview) -> Option<(f64, f64)> {
    let said = evaluated(view)?;
    let pair: (f64, f64) = serde_json::from_str(&said).ok()?;
    Some(pair)
}

fn evaluated(view: &Webview) -> Option<String> {
    let said = crate::engine::devtools::call(
        view,
        None,
        "Runtime.evaluate",
        &serde_json::json!({ "expression": ASK, "returnByValue": true }),
        Duration::from_secs(2),
    )
    .ok()?;
    said.get("result")?
        .get("value")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_popup_is_asked_its_size_for_as_long_as_it_is_open() {
        assert_eq!(
            (0..4).map(wait_before).collect::<Vec<_>>(),
            [0, 150, 350, 700]
        );
        assert!((4..1000).all(|ask| wait_before(ask) == AGAIN_EVERY));
    }

    #[test]
    fn every_popup_has_a_name_of_its_own_under_the_web_prefix() {
        let (first, second) = (fresh_label(), fresh_label());
        assert_ne!(first, second);
        assert!(first.starts_with("web-") && second.starts_with("web-"));
    }

    #[test]
    fn the_popup_that_is_open_is_closed_once() {
        *SHOWN.lock().unwrap_or_else(PoisonError::into_inner) =
            Some("web-extension-popup-x".into());
        assert!(is_shown("web-extension-popup-x"));
        assert!(!is_shown("web-extension-popup-y"));
        assert_eq!(taken().as_deref(), Some("web-extension-popup-x"));
        assert_eq!(taken(), None);
        assert!(!is_shown("web-extension-popup-x"));
    }

    #[test]
    fn nothing_reaches_the_popup_without_asking_its_browser_first() {
        let source = include_str!("popup.rs").replace('\r', "");
        let code = source.split("#[cfg(test)]").next().unwrap_or(&source);
        let calls = ["add_child(", ".set_position(", ".set_size(", ".close()"];
        let mut checked = 0;
        let starts = ["\nfn ", "\npub fn ", "\npub async fn "];
        for body in starts.iter().flat_map(|start| code.split(start).skip(1)) {
            let body = body.split("\n}\n").next().unwrap_or(body);
            if calls.iter().any(|call| body.contains(call)) {
                checked += 1;
                assert!(
                    body.contains("answering(") || body.contains("answers("),
                    "a call into the popup's browser that does not ask it first: {}",
                    body.lines().next().unwrap_or_default()
                );
            }
        }
        assert!(
            checked >= 4,
            "the scan found the calls it is about ({checked})"
        );
    }

    #[test]
    fn a_popup_closed_or_opened_again_before_it_was_built_is_never_built() {
        let first = fresh_label();
        want(Some(first.clone()));
        assert!(is_wanted(&first));
        let second = fresh_label();
        want(Some(second.clone()));
        assert!(!is_wanted(&first) && is_wanted(&second));
        want(None);
        assert!(!is_wanted(&second));
    }

    #[test]
    fn a_newer_measuring_ends_the_older() {
        let first = measuring();
        assert!(still(first));
        let second = measuring();
        assert!(!still(first) && still(second));
    }
}
