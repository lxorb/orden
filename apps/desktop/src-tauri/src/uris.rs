use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt as _;

const OPENED: &str = "nib://open-url";

#[derive(Default)]
pub struct Pending(pub Mutex<Vec<String>>);

pub fn watch(app: &AppHandle) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        let _ = app.deep_link().register_all();
    }

    #[cfg(desktop)]
    let handing: fn(&AppHandle, Vec<String>) = hand_over;

    let opened = app.clone();
    app.deep_link().on_open_url(move |event| {
        let urls = said(event.urls());
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
        #[cfg(not(desktop))]
        let _ = opened.emit_to("main", OPENED, urls);
    });

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

#[tauri::command]
pub fn take_startup_uris(pending: tauri::State<'_, Pending>) -> Vec<String> {
    let Ok(mut urls) = pending.0.lock() else {
        return Vec::new();
    };

    std::mem::take(&mut *urls)
}

const SCHEME: &str = "nib:";

fn said<T: ToString>(urls: Vec<T>) -> Vec<String> {
    urls.iter()
        .map(ToString::to_string)
        .filter(|one| is_ours(one))
        .collect()
}

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
