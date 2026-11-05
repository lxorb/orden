//! The `nib://` scheme: how a link written somewhere else on the machine reaches
//! the app.
//!
//! A shortcut, a launcher, a note in another program: all any of them can do is
//! hand the system an address. This module owns the arriving half of that - the
//! link the app was launched by, which lands before there is a window to give it
//! to, and the link that arrives while the app is already up, which goes to the
//! window as an event. What a link *means* is the window's, which holds the
//! spaces and the command registry; see apps/desktop/src/lib/automation.
//!
//! The same shape `launch` uses for the pages a command line names, and for the
//! same reason: a launch argument reaches the app before anything is listening,
//! so it waits here until the window asks.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt as _;

/// What the window is told when a link arrives while the app is already running.
const OPENED: &str = "nib://open-url";

/// Links the app was launched by, waiting for the window to ask for them.
#[derive(Default)]
pub struct Pending(pub Mutex<Vec<String>>);

/// Starts listening for links, and puts aside the one that started the app.
///
/// On Linux, and in a debug build on Windows, the scheme is registered here
/// rather than by an installer: there is no installer in either case, and a
/// scheme nothing has registered is a link that opens nothing at all. A release
/// on Windows and macOS is registered by the bundle itself.
pub fn watch(app: &AppHandle) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        // Nothing to do about a refusal: the app runs, and a link into it does
        // not. Which is exactly what happens today.
        let _ = app.deep_link().register_all();
    }

    #[cfg(desktop)]
    let handing: fn(&AppHandle, Vec<String>) = hand_over;

    let opened = app.clone();
    app.deep_link().on_open_url(move |event| {
        let urls = said(event.urls());
        // A reminder's press is the reminders' own, and a Done never brings the window
        // forward; see reminders.rs.
        #[cfg(desktop)]
        let urls: Vec<String> = urls
            .into_iter()
            .filter(|url| !crate::reminders::answer_link(&opened, url))
            .collect();
        if urls.is_empty() {
            return;
        }

        #[cfg(desktop)]
        handing(&opened, urls);
        // A phone has one window and the system has already brought it up.
        #[cfg(not(desktop))]
        let _ = opened.emit_to("main", OPENED, urls);
    });

    // The link that started the app, which no handler above can have heard: it
    // was delivered before this function existed.
    let launched = said(
        app.deep_link()
            .get_current()
            .ok()
            .flatten()
            .unwrap_or_default(),
    );
    #[cfg(desktop)]
    let launched: Vec<String> = launched
        .into_iter()
        .filter(|url| !crate::reminders::answer_link(app, url))
        .collect();
    if launched.is_empty() {
        return;
    }

    if let Some(pending) = app.try_state::<Pending>() {
        if let Ok(mut waiting) = pending.0.lock() {
            *waiting = launched;
        }
    }
}

#[cfg(desktop)]
fn hand_over(app: &AppHandle, urls: Vec<String>) {
    let waiting = app.state::<crate::endpoint::Waiting>();
    let windows: Vec<LinkWindow> = crate::launch::document_windows(app)
        .iter()
        .map(|one| LinkWindow {
            label: one.label().to_owned(),
            focused: one.is_focused().unwrap_or(false),
            visible: one.is_visible().unwrap_or(false),
            listening: waiting.hears(one.label()),
        })
        .collect();
    let chosen = link_window(&windows).and_then(|label| app.get_window(&label));
    if let Some(window) = chosen {
        crate::launch::brought_up(&window);
        let _ = app.emit_to(window.label(), OPENED, urls);
        return;
    }
    if let Some(pending) = app.try_state::<Pending>() {
        if let Ok(mut held) = pending.0.lock() {
            held.extend(urls);
        }
    }
    crate::launch::open_for_what_waits(app);
}

#[cfg(desktop)]
struct LinkWindow {
    label: String,
    focused: bool,
    visible: bool,
    listening: bool,
}

#[cfg(desktop)]
fn link_window(windows: &[LinkWindow]) -> Option<String> {
    windows
        .iter()
        .filter(|one| one.listening)
        .min_by_key(|one| {
            (
                !one.focused,
                !one.visible,
                one.label != "main",
                one.label.clone(),
            )
        })
        .map(|one| one.label.clone())
}

/// Whether the app was started by nothing but a reminder's Done, which is answered
/// without the window coming up (see reminders.rs), or by an agent's `nib mcp`, which never
/// brings it up (`launch::BACKGROUND_FLAG`, #1091).
#[cfg(desktop)]
pub fn launched_quietly(app: &AppHandle) -> bool {
    if crate::launch::in_background(&std::env::args_os().collect::<Vec<_>>()) {
        return true;
    }
    let launched = said(
        app.deep_link()
            .get_current()
            .ok()
            .flatten()
            .unwrap_or_default(),
    );
    let quiet = crate::reminders::quiet_launch(&launched);
    if quiet {
        crate::reminders::came_up_quietly();
    }
    quiet
}

/// Handed to the window once it is ready; clearing them stops a reload from
/// following the same link a second time.
#[tauri::command]
pub fn take_startup_uris(pending: tauri::State<'_, Pending>) -> Vec<String> {
    let Ok(mut urls) = pending.0.lock() else {
        return Vec::new();
    };

    std::mem::take(&mut *urls)
}

/// The scheme a link into the app is written in, as the platform hands it over.
const SCHEME: &str = "nib:";

/// The links as the window reads them: strings, and only `nib:` ones.
///
/// Only those, because on a Mac the plugin hears everything the system asks the
/// app to open: a web page once nib is the browser, which is the pages' road (see
/// `hand_over` in launch.rs), and a `file://` address somebody forced on it, which
/// nib opens nothing of. Neither is a link into the app.
///
/// Written against anything that can say itself rather than against the URL type
/// the plugin hands over, so this module has no opinion about which crate parsed
/// the address.
fn said<T: ToString>(urls: Vec<T>) -> Vec<String> {
    urls.iter()
        .map(ToString::to_string)
        .filter(|one| is_ours(one))
        .collect()
}

/// Whether an address is a link into this app, in whichever case the scheme was
/// written.
fn is_ours(url: &str) -> bool {
    url.trim_start()
        .get(..SCHEME.len())
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case(SCHEME))
}

#[cfg(test)]
mod tests {
    use super::said;
    #[cfg(desktop)]
    use super::{link_window, LinkWindow};

    #[cfg(desktop)]
    fn window(label: &str, focused: bool, visible: bool, listening: bool) -> LinkWindow {
        LinkWindow {
            label: label.to_owned(),
            focused,
            visible,
            listening,
        }
    }

    #[cfg(desktop)]
    #[test]
    fn a_link_goes_to_the_window_in_front_and_never_to_one_hidden_while_another_shows() {
        let windows = [
            window("main", false, false, true),
            window("nib-2", false, true, true),
        ];
        assert_eq!(link_window(&windows).as_deref(), Some("nib-2"));

        let windows = [
            window("main", false, true, true),
            window("nib-2", true, true, true),
        ];
        assert_eq!(link_window(&windows).as_deref(), Some("nib-2"));

        let windows = [
            window("nib-3", false, true, true),
            window("main", false, true, true),
        ];
        assert_eq!(link_window(&windows).as_deref(), Some("main"));

        let windows = [
            window("nib-2", false, false, true),
            window("main", false, false, true),
        ];
        assert_eq!(link_window(&windows).as_deref(), Some("main"));
    }

    #[cfg(desktop)]
    #[test]
    fn a_link_waits_when_nothing_listens() {
        assert_eq!(link_window(&[]), None);
        let windows = [window("main", true, true, false)];
        assert_eq!(link_window(&windows), None);
        let windows = [
            window("nib-3", true, true, false),
            window("main", false, true, true),
        ];
        assert_eq!(link_window(&windows).as_deref(), Some("main"));
    }

    #[test]
    fn says_every_link_it_is_given() {
        let urls = vec![
            "nib://open?path=Idea.md".to_string(),
            "nib://search".to_string(),
        ];
        assert_eq!(
            said(urls),
            vec![
                "nib://open?path=Idea.md".to_string(),
                "nib://search".to_string()
            ]
        );
    }

    #[test]
    fn leaves_out_an_address_that_says_nothing() {
        assert!(said(vec![String::new()]).is_empty());
        assert!(said(Vec::<String>::new()).is_empty());
    }

    #[test]
    fn a_file_the_finder_opened_is_no_link() {
        let urls = vec![
            "file:///Users/me/Notes/Idea.md".to_string(),
            "nib://open?path=Idea.md".to_string(),
            "FILE:///Users/me/Other.md".to_string(),
        ];
        assert_eq!(said(urls), vec!["nib://open?path=Idea.md".to_string()]);
    }

    #[test]
    fn reads_the_scheme_in_any_case() {
        assert_eq!(said(vec!["NIB://search".to_string()]).len(), 1);
        assert!(said(vec!["https://orden.so".to_string()]).is_empty());
        assert!(said(vec!["ni".to_string()]).is_empty());
    }
}
