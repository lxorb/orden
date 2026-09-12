//! A website in a tab: one child webview per web tab, placed over the pane that
//! shows it.
//!
//! Tauri can put a second webview inside a window and give it bounds of its own,
//! so a page sits exactly where the pane is and nothing else about the window
//! changes. That is the only embedding on a desktop that renders a site the way a
//! browser does: a frame cannot, because a great deal of the web refuses to be
//! framed. The engine is the system's - WebView2 on Windows, which is Chromium,
//! and WKWebView on macOS, which is WebKit and not Chromium however the tab is
//! asked for. See docs/web-tabs.md.
//!
//! What the window may do with one of these is deliberately small: make it, move
//! it, show it, hide it, send it to an address, step its history, read the page
//! for a clip, and close it. The window says where the pane is; nothing here
//! knows what a pane is.
//!
//! The site gets nothing of the app. It is granted no command, because the
//! capabilities name the app's own webviews rather than the windows they sit in
//! and because a remote origin matches no capability here (see
//! capabilities/default.json); and the globals that reach the app are taken away
//! before the page's first script runs, along with the devices nobody asked to
//! hand over. See `GUARD`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewBuilder,
    WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

/// What a web tab's webview is labelled: this in front of the tab's own id, so a
/// label says which tab it belongs to and nothing else in the window can be
/// mistaken for one.
const LABEL: &str = "web-";

/// The event the window hears whenever a page moves: which tab, where it is, what
/// it calls itself, and whether there is anywhere to step.
const MOVED: &str = "nib://web-tab";

/// The largest page a clip reads, in characters. A note the account would refuse
/// is worse than a clip that stops early, and 4 MB is what the API takes; see
/// `MAX_NOTE_BYTES` in the clipper.
const LONGEST_PAGE: usize = 4_000_000;

/// What a site in a web tab does not get, taken away before its own first script
/// runs.
///
/// Two kinds of thing. The app's own globals, so nothing in the page can speak to
/// the crate even by accident: the capabilities already refuse it, and this is the
/// lock that does not depend on a list of labels being right. And the devices a
/// page can ask a browser for, which a note-taking app has no business granting
/// silently: the camera and the microphone, the clipboard, where you are, and the
/// buses a page can reach hardware over. Taking the API away rather than answering
/// a prompt with no is what keeps the engine from putting a prompt on screen at
/// all.
///
/// `__HIDDEN__` is filled in by `guard` with whatever this origin has not been
/// granted, which is everything until somebody says otherwise.
const GUARD: &str = r"(function () {
  try {
    delete window.__TAURI_INTERNALS__
    delete window.__TAURI__
    delete window.__TAURI_EVENT_PLUGIN_INTERNALS__
    if (window.chrome) delete window.chrome.webview
  } catch (error) {
    // A page that has frozen its own globals keeps them. The capabilities are
    // what actually refuse the call; this is the second lock, not the first.
  }

  function hide(on, name) {
    try {
      Object.defineProperty(on, name, { configurable: true, get: () => undefined })
    } catch (error) {
      // A property that will not be redefined is one the engine still prompts
      // for, and the prompt is answered by nobody pressing allow.
    }
  }

  for (const name of __HIDDEN__) hide(Navigator.prototype, name)
  hide(window, 'Notification')
})()";

/// The page, read for a clip, in the site's own document.
///
/// It reads what is on screen rather than what the server sent: a page that writes
/// itself with a script has already written itself. Every address comes back
/// resolved, because the note this becomes is read from a folder and not from the
/// site.
///
/// `__SELECTION__` takes what somebody has selected. Without one it takes the
/// article: the element a page says holds its writing, or the longest candidate,
/// and otherwise the body with the furniture cut out of it. Turning the HTML into
/// markdown is the window's, through the same converter the clipper uses; see
/// `lib/web-tab/clip.ts`.
const READER: &str = r"(function () {
  const OUT =
    'nav,header,footer,aside,form,dialog,button,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true]'
  const PICKS = ['article', 'main', '[role=main]', '#content', '.post', '.entry-content']
  const ENOUGH = 200

  function absolute(root) {
    for (const one of root.querySelectorAll('[href]')) {
      try {
        one.setAttribute('href', one.href)
      } catch (error) {
        one.removeAttribute('href')
      }
    }
    for (const one of root.querySelectorAll('[src]')) {
      try {
        one.setAttribute('src', one.src)
      } catch (error) {
        one.removeAttribute('src')
      }
    }
    return root
  }

  function selected() {
    const range = window.getSelection()
    if (!range || range.isCollapsed || range.rangeCount === 0) return null

    const held = document.createElement('div')
    for (let index = 0; index < range.rangeCount; index += 1) {
      held.append(range.getRangeAt(index).cloneContents())
    }
    return (held.textContent || '').trim() ? held : null
  }

  function article() {
    let best = null
    for (const pick of PICKS) {
      for (const found of document.querySelectorAll(pick)) {
        const length = (found.textContent || '').trim().length
        if (!best || length > best.length) best = { node: found, length: length }
      }
    }

    if (best && best.length > ENOUGH) return best.node.cloneNode(true)

    const whole = document.body.cloneNode(true)
    for (const furniture of whole.querySelectorAll(OUT)) furniture.remove()
    return whole
  }

  const title = (document.title || '').trim()

  try {
    const part = (__SELECTION__ ? selected() : null) || article()
    const page = absolute(part)

    return { url: location.href, title: title, html: (page.innerHTML || '').slice(0, __LONGEST__) }
  } catch (error) {
    return { url: location.href, title: title, html: '' }
  }
})()";

/// Where a page has been in one tab, and where along it the tab is.
///
/// Kept here rather than asked of the engine, because neither WebView2 nor
/// WKWebView tells Tauri whether a page can go back, and a back arrow that is
/// always lit is an arrow that lies half the time.
#[derive(Default)]
struct Trail {
    urls: Vec<String>,
    at: usize,
}

impl Trail {
    /// A page that has arrived. A step back or forward lands on the address next
    /// to where the trail is, and anything else is somewhere new, which forgets
    /// whatever was ahead.
    fn visited(&mut self, url: &str) {
        if self.urls.get(self.at).is_some_and(|here| here == url) {
            return;
        }

        if self.at > 0 && self.urls.get(self.at - 1).is_some_and(|back| back == url) {
            self.at -= 1;
            return;
        }

        if self.urls.get(self.at + 1).is_some_and(|on| on == url) {
            self.at += 1;
            return;
        }

        if !self.urls.is_empty() {
            self.urls.truncate(self.at + 1);
            self.at = self.urls.len();
        }

        self.urls.push(url.to_string());
    }

    fn back(&self) -> bool {
        self.at > 0
    }

    fn forward(&self) -> bool {
        self.at + 1 < self.urls.len()
    }
}

/// Every web tab this app has open, by tab id.
#[derive(Default)]
pub struct WebTabs(Mutex<HashMap<String, Trail>>);

/// Where the pane is, in the window's own coordinates, as the window measured it.
#[derive(Deserialize)]
pub struct Pane {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// What the window is told when a page moves.
#[derive(Clone, Serialize)]
struct Moved {
    tab: String,
    url: String,
    title: String,
    back: bool,
    forward: bool,
    loading: bool,
}

/// A page as a clip reads it: where it is, what it calls itself, and the HTML of
/// the part worth keeping.
#[derive(Clone, Serialize, Deserialize)]
pub struct Clipped {
    url: String,
    title: String,
    html: String,
}

/// Which way a step goes.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Back,
    Forward,
    Reload,
}

/// Whether an address is one a web tab may go to.
///
/// Only the web, and never the app: `file:` would read this machine, a scheme the
/// system knows would hand the page to another application, and the app's own
/// origins would put nib inside the tab with the site's script beside it. What
/// somebody typed is turned into an address by the window (see
/// `lib/web-tab/address.ts`); this is the rule that cannot be talked round,
/// because it is also what every link inside the page is judged by.
fn allowed(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }

    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    !matches!(
        host.as_str(),
        "tauri.localhost" | "ipc.localhost" | "asset.localhost" | "nib.localhost"
    )
}

/// The address, read and judged, or a reason it is not one.
fn address(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|error| format!("that is not an address: {error}"))?;
    if allowed(&parsed) {
        Ok(parsed)
    } else {
        Err("a web tab only opens http and https pages".into())
    }
}

/// The guard script for one origin: `GUARD` with the list of what it may not have.
///
/// A grant is spent by leaving that one alone. The hardware buses are never in the
/// list of grants, so they are never left alone; a note-taking app has no reason to
/// let a page talk to a USB device.
fn guard(granted: &[String]) -> String {
    let asked = ["camera", "clipboard", "location"];
    let named = ["mediaDevices", "clipboard", "geolocation"];

    let mut hidden: Vec<&str> = Vec::new();
    for (want, api) in asked.iter().zip(named) {
        if !granted.iter().any(|one| one == want) {
            hidden.push(api);
        }
    }
    hidden.extend(["bluetooth", "usb", "serial", "hid", "credentials"]);

    let list = hidden
        .iter()
        .map(|one| format!("'{one}'"))
        .collect::<Vec<_>>()
        .join(", ");

    GUARD.replace("__HIDDEN__", &format!("[{list}]"))
}

/// The reader script, told whether it is after a selection.
fn reader(selection: bool) -> String {
    READER
        .replace("__SELECTION__", if selection { "true" } else { "false" })
        .replace("__LONGEST__", &LONGEST_PAGE.to_string())
}

/// Where the site's own storage lives: the app's folder, in a directory of its own.
///
/// Not the app's webview data, which is the point. A page in a tab keeps its
/// cookies and its logins in a profile the app's own session is not in, so signing
/// into a site is not signing into anything of nib's, and clearing one never
/// touches the other. Cross-origin reading is the engine's own rule either way;
/// this is about what sits in the same store on disk.
#[cfg(any(windows, target_os = "linux"))]
fn store(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = crate::paths::config_dir(app)?.join("web");
    crate::paths::made(&dir)?;
    Ok(dir)
}

/// The same sixteen bytes every time, so WKWebView hands back the store it handed
/// out last time. macOS 14 and later; older macOS has no such API and falls back
/// to the default store, which is the one case where a web tab and the app share a
/// profile on disk. Said out loud in docs/web-tabs.md rather than hidden here.
#[cfg(target_os = "macos")]
const STORE_ID: [u8; 16] = *b"nib-web-tabs\0\0\0\0";

/// The webview for one tab, built and attached to the window that asked.
#[tauri::command]
pub fn web_open(
    webview: Webview,
    tabs: tauri::State<'_, WebTabs>,
    tab: String,
    url: String,
    pane: Pane,
    granted: Vec<String>,
) -> Result<(), String> {
    let at = address(&url)?;
    let label = format!("{LABEL}{tab}");
    let app = webview.app_handle().clone();

    if app.get_webview(&label).is_some() {
        return Err("that tab already has a page".into());
    }

    #[allow(
        unused_mut,
        reason = "the storage builders below are per platform, and one platform sets neither"
    )]
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(at))
        .initialization_script(guard(&granted))
        .on_navigation(allowed)
        // The page takes its own drops. A file dropped on a site is the site's
        // business, and the app is not in the middle of it.
        .disable_drag_drop_handler();

    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.data_directory(store(&app)?);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(STORE_ID);
    }

    let opening = app.clone();
    let builder = builder.on_new_window(move |url: Url, _features: NewWindowFeatures| {
        // A window the page asks for leaves the app the way every other link
        // does: the system browser. A second webview over the pane would be a
        // window with no way to close it.
        let _ = opening.opener().open_url(url.to_string(), None::<&str>);
        NewWindowResponse::Deny
    });

    let moved = tab.clone();
    let sending = app.clone();
    let builder = builder.on_page_load(move |view, payload| {
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        say(
            &sending,
            &view,
            &moved,
            &payload.url().to_string(),
            None,
            loading,
        );
    });

    let titled = tab.clone();
    let naming = app.clone();
    let builder = builder.on_document_title_changed(move |view, title| {
        let url = view.url().map(|one| one.to_string()).unwrap_or_default();
        say(&naming, &view, &titled, &url, Some(title), false);
    });

    webview
        .window()
        .add_child(
            builder,
            LogicalPosition::new(pane.x, pane.y),
            LogicalSize::new(pane.width, pane.height),
        )
        .map_err(|error| format!("that page could not be opened: {error}"))?;

    if let Ok(mut open) = tabs.0.lock() {
        open.entry(tab).or_default().visited(&url);
    }

    Ok(())
}

/// Says where a page is, to the window that holds it and to nothing else.
fn say(
    app: &AppHandle,
    view: &Webview,
    tab: &str,
    url: &str,
    title: Option<String>,
    loading: bool,
) {
    let stepping = app.try_state::<WebTabs>().and_then(|tabs| {
        tabs.0.lock().ok().map(|mut open| {
            let trail = open.entry(tab.to_string()).or_default();
            if !loading && !url.is_empty() {
                trail.visited(url);
            }
            (trail.back(), trail.forward())
        })
    });
    let (back, forward) = stepping.unwrap_or((false, false));

    let payload = Moved {
        tab: tab.to_string(),
        url: url.to_string(),
        title: title.unwrap_or_default(),
        back,
        forward,
        loading,
    };

    // To the window's own webview, by label, rather than to everything: the page
    // in the tab is one of the webviews a plain emit would reach.
    let _ = app.emit_to(view.window().label(), MOVED, payload);
}

/// Puts the page where the pane is, and shows or hides it.
///
/// One command for both, because the pane says both in the same breath: a tab that
/// is not the one on top has no bounds worth setting, and a tab that has just come
/// forward has to be placed before it is shown, or it appears for a frame where the
/// last one was.
#[tauri::command]
pub fn web_place(app: AppHandle, tab: String, pane: Pane, visible: bool) -> Result<(), String> {
    let view = found(&app, &tab)?;

    view.set_bounds(Rect {
        position: LogicalPosition::new(pane.x, pane.y).into(),
        size: LogicalSize::new(pane.width, pane.height).into(),
    })
    .map_err(|error| format!("that page could not be placed: {error}"))?;

    if visible { view.show() } else { view.hide() }
        .map_err(|error| format!("that page could not be shown: {error}"))
}

/// Sends a tab to an address.
#[tauri::command]
pub fn web_navigate(app: AppHandle, tab: String, url: String) -> Result<(), String> {
    let at = address(&url)?;
    found(&app, &tab)?
        .navigate(at)
        .map_err(|error| format!("that address could not be opened: {error}"))
}

/// Back, forward, or the same page again.
///
/// The history is the page's own, so it is stepped in the page: neither WebView2
/// nor WKWebView hands Tauri a Go Back, and `history.back()` is what a browser's
/// own button calls. Reload goes through the engine, which is the one of the three
/// it does offer.
#[tauri::command]
pub fn web_step(app: AppHandle, tab: String, step: Step) -> Result<(), String> {
    let view = found(&app, &tab)?;

    match step {
        Step::Reload => view.reload(),
        Step::Back => view.eval("history.back()"),
        Step::Forward => view.eval("history.forward()"),
    }
    .map_err(|error| format!("that page could not be stepped: {error}"))
}

/// The page, read for a clip.
///
/// The script runs in the site's document and the answer comes back through the
/// engine's own callback rather than through the app's IPC, which is what lets a
/// page be read without the page being given anything to call.
#[tauri::command]
pub async fn web_clip(app: AppHandle, tab: String, selection: bool) -> Result<Clipped, String> {
    let view = found(&app, &tab)?;
    let (sending, mut waiting) = tauri::async_runtime::channel::<String>(1);

    view.eval_with_callback(reader(selection), move |answer| {
        // One page, one answer: a full channel is an answer already sent.
        let _ = sending.try_send(answer);
    })
    .map_err(|error| format!("that page could not be read: {error}"))?;

    let answer = waiting
        .recv()
        .await
        .ok_or_else(|| "that page said nothing".to_string())?;

    serde_json::from_str::<Clipped>(&answer)
        .map_err(|error| format!("that page could not be read: {error}"))
}

/// Takes the page away. A closed tab keeps nothing: the webview goes and so does
/// its trail.
#[tauri::command]
pub fn web_close(app: AppHandle, tabs: tauri::State<'_, WebTabs>, tab: String) {
    if let Some(view) = app.get_webview(&format!("{LABEL}{tab}")) {
        let _ = view.close();
    }

    if let Ok(mut open) = tabs.0.lock() {
        open.remove(&tab);
    }
}

/// The webview for a tab, or a reason there is none. A tab whose page has been
/// unloaded to give the memory back is the ordinary case rather than a failure, and
/// the window opens it again instead of reporting anything.
fn found(app: &AppHandle, tab: &str) -> Result<Webview, String> {
    app.get_webview(&format!("{LABEL}{tab}"))
        .ok_or_else(|| "that tab has no page open".to_string())
}

#[cfg(test)]
mod tests {
    use super::{allowed, guard, reader, Trail};
    use tauri::Url;

    fn at(url: &str) -> Url {
        Url::parse(url).expect("an address")
    }

    #[test]
    fn only_the_web_is_allowed() {
        assert!(allowed(&at("https://example.com/a")));
        assert!(allowed(&at("http://example.com/a")));
        assert!(!allowed(&at("file:///C:/notes/Idea.md")));
        assert!(!allowed(&at("mailto:someone@example.com")));
        assert!(!allowed(&at("data:text/html,<p>hi")));
    }

    #[test]
    fn the_app_is_not_a_page() {
        assert!(!allowed(&at("http://tauri.localhost/index.html")));
        assert!(!allowed(&at("https://TAURI.localhost/")));
        assert!(!allowed(&at("http://ipc.localhost/notes")));
        assert!(!allowed(&at("http://asset.localhost/a.png")));
    }

    #[test]
    fn a_trail_remembers_where_it_has_been() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        assert!(!trail.back());
        assert!(!trail.forward());

        trail.visited("https://b.example/");
        assert!(trail.back());
        assert!(!trail.forward());
    }

    #[test]
    fn the_same_page_again_is_not_a_step() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://a.example/");
        assert!(!trail.back());
        assert_eq!(trail.urls.len(), 1);
    }

    #[test]
    fn a_step_back_moves_along_the_trail_rather_than_adding_to_it() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://b.example/");
        trail.visited("https://a.example/");

        assert_eq!(trail.at, 0);
        assert_eq!(trail.urls.len(), 2);
        assert!(!trail.back());
        assert!(trail.forward());
    }

    #[test]
    fn somewhere_new_forgets_what_was_ahead() {
        let mut trail = Trail::default();
        trail.visited("https://a.example/");
        trail.visited("https://b.example/");
        trail.visited("https://a.example/");
        trail.visited("https://c.example/");

        assert_eq!(trail.urls, ["https://a.example/", "https://c.example/"]);
        assert!(trail.back());
        assert!(!trail.forward());
    }

    #[test]
    fn nothing_granted_takes_every_device_away() {
        let script = guard(&[]);
        assert!(script.contains("'mediaDevices'"));
        assert!(script.contains("'clipboard'"));
        assert!(script.contains("'geolocation'"));
        assert!(script.contains("delete window.__TAURI_INTERNALS__"));
        assert!(!script.contains("__HIDDEN__"));
    }

    #[test]
    fn a_grant_is_spent_by_leaving_one_alone() {
        let script = guard(&["camera".to_string()]);
        assert!(!script.contains("'mediaDevices'"));
        assert!(script.contains("'clipboard'"));
    }

    #[test]
    fn the_hardware_buses_are_never_granted() {
        let script = guard(&["usb".to_string(), "bluetooth".to_string()]);
        assert!(script.contains("'usb'"));
        assert!(script.contains("'bluetooth'"));
    }

    #[test]
    fn the_reader_says_whether_it_wants_the_selection() {
        assert!(reader(true).contains("(true ? selected()"));
        assert!(reader(false).contains("(false ? selected()"));
        assert!(!reader(false).contains("__LONGEST__"));
    }
}
