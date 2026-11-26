use orden_base::Held as _;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager as _};

pub const UNCLAIMED_FOR: Duration = Duration::from_secs(10);
#[derive(Debug, Default)]
struct Kept {
    pages: HashMap<String, (String, Instant)>,
}
impl Kept {
    fn keep(&mut self, window: &str, page: &str, now: Instant) {
        self.pages.insert(page.to_string(), (window.to_string(), now));
    }
    fn claim(&mut self, page: &str) -> bool {
        self.pages.remove(page).is_some()
    }
    fn unclaimed(&mut self, now: Instant) -> Vec<String> {
        let gone: Vec<String> = self
            .pages
            .iter()
            .filter(|(_, (_, since))| now.duration_since(*since) >= UNCLAIMED_FOR)
            .map(|(page, _)| page.clone())
            .collect();
        for one in &gone {
            self.pages.remove(one);
        }
        gone
    }
}
static KEPT: Mutex<Option<Kept>> = Mutex::new(None);
fn kept<T>(look: impl FnOnce(&mut Kept) -> T) -> T {
    look(KEPT.held().get_or_insert_with(Kept::default))
}
#[derive(Debug, PartialEq, Eq)]
enum Left {
    Page,
    Lingering,
    Other,
}
fn left(label: &str, lingering: bool) -> Left {
    if !crate::web_tabs::is_page(label) {
        Left::Other
    } else if lingering {
        Left::Lingering
    } else {
        Left::Page
    }
}
pub fn app_reloaded(app: &AppHandle, window: &str) {
    let now = Instant::now();
    let mut any = false;
    for (label, view) in app.webviews() {
        if label == window || view.window().label() != window {
            continue;
        }
        let tab = crate::web_tabs::tab_of(&label);
        let lingering = tab.as_deref().is_some_and(|tab| crate::downloads::lingers(app, tab));
        match left(&label, lingering) {
            Left::Lingering => continue,
            Left::Page => {
                kept(|all| all.keep(window, &label, now));
                any = true;
            }
            Left::Other => {}
        }
        crate::page_hide::out_of_sight(&view);
        let _ = view.hide();
    }
    if !any {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(UNCLAIMED_FOR);
        let closing = app.clone();
        let _ = app.run_on_main_thread(move || {
            for page in kept(|all| all.unclaimed(Instant::now())) {
                if let Some(tab) = crate::web_tabs::tab_of(&page) {
                    crate::web_tabs::close_page(&closing, &tab);
                }
            }
        });
    });
}
pub fn claim(page: &str) -> bool {
    kept(|all| all.claim(page))
}
#[cfg(test)]
mod tests {
    use super::{left, Kept, Left, UNCLAIMED_FOR};
    use std::time::{Duration, Instant};

    #[test]
    fn a_page_the_reloaded_app_does_not_claim_in_time_is_closed_and_a_claimed_one_is_kept() {
        let start = Instant::now();
        let mut kept = Kept::default();
        kept.keep("orden-1", "web-a", start);
        kept.keep("orden-1", "web-b", start);
        assert!(kept.claim("web-a"));
        assert!(!kept.claim("web-a"));
        assert_eq!(kept.unclaimed(start + Duration::from_secs(1)), Vec::<String>::new());
        assert_eq!(kept.unclaimed(start + UNCLAIMED_FOR), vec!["web-b".to_string()]);
        assert!(!kept.claim("web-b"));
    }
    #[test]
    fn a_reload_hides_every_view_the_app_does_not_own_keeps_tab_pages_and_leaves_downloads_alone() {
        assert_eq!(left("web-a", false), Left::Page);
        assert_eq!(left("web-a", true), Left::Lingering);
        assert_eq!(left("extension-popup-1", false), Left::Other);
        let source = include_str!("web_orphans.rs");
        let reloaded = &source[source.find("pub fn app_reloaded(").expect("app_reloaded")..];
        let reloaded = &reloaded[..reloaded.find("\n}\n").expect("its end")];
        assert!(reloaded.contains("label == window") && reloaded.contains("view.hide()"));
        let tabs = include_str!("web_tabs.rs");
        assert!(tabs.contains("crate::web_orphans::claim(&label)"));
        let lib = include_str!("../../../src/lib.rs");
        assert!(lib.contains("orden_web::web_orphans::app_reloaded("));
    }
}
