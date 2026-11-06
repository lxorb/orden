use std::collections::BTreeMap;
use std::time::{Duration, Instant};

pub const QUIET: Duration = Duration::from_secs(10);

#[derive(Debug, Default)]
pub struct Quiet {
    until: BTreeMap<String, Instant>,
}

impl Quiet {
    pub fn added(&mut self, store: &str, now: Instant) {
        self.until.insert(store.to_owned(), now + QUIET);
        self.until.retain(|_, until| *until > now);
    }

    pub fn hushed(&self, store: &str, user: bool, now: Instant) -> bool {
        !user && self.until.get(store).is_some_and(|until| now < *until)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Seen {
    pub handle: isize,
    pub process: u32,
    pub visible: bool,
    pub captioned: bool,
}

pub fn stray(window: Seen, browser: u32, before: &[isize]) -> bool {
    browser != 0
        && window.process == browser
        && window.visible
        && window.captioned
        && !before.contains(&window.handle)
}

#[cfg(windows)]
pub use engine::{adding, listen, taken};

#[cfg(windows)]
mod engine {
    use std::cell::RefCell;
    use std::collections::{BTreeMap, HashSet};
    use std::sync::{Mutex, PoisonError};
    use std::time::{Duration, Instant};

    use tauri::webview::PlatformWebview;
    use webview2_com::NewWindowRequestedEventHandler;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW,
        GWL_STYLE, WM_CLOSE, WS_CAPTION,
    };

    use super::{stray, Quiet, Seen};

    static QUIET: Mutex<Quiet> = Mutex::new(Quiet {
        until: BTreeMap::new(),
    });

    static WATCHING: Mutex<BTreeMap<u32, Instant>> = Mutex::new(BTreeMap::new());

    const EVERY: Duration = Duration::from_millis(200);

    thread_local! {
        static HUSHED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    }

    pub fn adding(store: &str, browser: u32) {
        QUIET
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .added(store, Instant::now());
        watch(browser);
    }

    pub fn taken(tab: &str) -> bool {
        HUSHED.with_borrow_mut(|hushed| hushed.remove(tab))
    }

    #[allow(
        unsafe_code,
        reason = "a page asking for a window is one of WebView2's own events, reached through COM"
    )]
    pub fn listen(webview: &PlatformWebview, store: Option<&str>, tab: &str) {
        if !crate::extensions::in_store(store) {
            return;
        }
        let (store, tab) = (store.unwrap_or_default().to_owned(), tab.to_owned());
        let requested = NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut user = windows_core::BOOL::default();
            let _ = unsafe { args.IsUserInitiated(&raw mut user) };
            let hushed = QUIET.lock().unwrap_or_else(PoisonError::into_inner).hushed(
                &store,
                user.as_bool(),
                Instant::now(),
            );
            HUSHED.with_borrow_mut(|all| {
                if hushed {
                    all.insert(tab.clone());
                } else {
                    all.remove(&tab);
                }
            });
            Ok(())
        }));
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                let mut token = 0i64;
                let _ = core.add_NewWindowRequested(&requested, &raw mut token);
            }
        }
    }

    fn watch(browser: u32) {
        if browser == 0 {
            return;
        }
        let until = Instant::now() + super::QUIET;
        let fresh = WATCHING
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(browser, until)
            .is_none();
        if !fresh {
            return;
        }

        let before: Vec<isize> = windows().into_iter().map(|one| one.handle).collect();
        std::thread::spawn(move || loop {
            std::thread::sleep(EVERY);
            {
                let mut watching = WATCHING.lock().unwrap_or_else(PoisonError::into_inner);
                if watching
                    .get(&browser)
                    .is_none_or(|until| Instant::now() >= *until)
                {
                    watching.remove(&browser);
                    return;
                }
            }
            for one in windows() {
                if stray(one, browser, &before) {
                    crate::trace::mark("extension: a window it opened on its own, closed");
                    #[allow(unsafe_code, reason = "a window is asked to close through Win32")]
                    unsafe {
                        let _ = PostMessageW(
                            HWND(one.handle as *mut core::ffi::c_void),
                            WM_CLOSE,
                            WPARAM(0),
                            LPARAM(0),
                        );
                    }
                }
            }
        });
    }

    #[allow(unsafe_code, reason = "the desktop's windows are walked through Win32")]
    fn windows() -> Vec<Seen> {
        unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
            let found = unsafe { &mut *(found.0 as *mut Vec<Seen>) };
            let mut process = 0u32;
            let (visible, style) = unsafe {
                GetWindowThreadProcessId(window, Some(&raw mut process));
                (
                    IsWindowVisible(window).as_bool(),
                    GetWindowLongW(window, GWL_STYLE),
                )
            };
            #[allow(
                clippy::cast_sign_loss,
                reason = "a window's style is a set of bits, handed over as a signed number"
            )]
            let captioned = (style as u32) & WS_CAPTION.0 == WS_CAPTION.0;
            found.push(Seen {
                handle: window.0 as isize,
                process,
                visible,
                captioned,
            });
            BOOL(1)
        }

        let mut found: Vec<Seen> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(each), LPARAM(&raw mut found as isize));
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{stray, Quiet, Seen, QUIET};

    #[test]
    fn a_store_is_quiet_for_a_moment_after_an_extension_arrives() {
        let now = Instant::now();
        let mut quiet = Quiet::default();
        assert!(!quiet.hushed("note_3f9a0c17e2b4d685", false, now));

        quiet.added("note_3f9a0c17e2b4d685", now);
        assert!(quiet.hushed("note_3f9a0c17e2b4d685", false, now + Duration::from_secs(1)));
        assert!(
            !quiet.hushed("", false, now),
            "the shared store was handed nothing"
        );
        assert!(!quiet.hushed("note_3f9a0c17e2b4d685", false, now + QUIET));
    }

    #[test]
    fn a_window_somebody_pressed_for_is_never_held_back() {
        let now = Instant::now();
        let mut quiet = Quiet::default();
        quiet.added("", now);
        assert!(!quiet.hushed("", true, now));
        assert!(quiet.hushed("", false, now));
    }

    #[test]
    fn the_last_extension_to_arrive_is_what_the_quiet_runs_from() {
        let now = Instant::now();
        let mut quiet = Quiet::default();
        quiet.added("", now);
        quiet.added("", now + Duration::from_secs(8));
        assert!(quiet.hushed("", false, now + Duration::from_secs(12)));

        quiet.added("note_a", now + QUIET * 3);
        assert!(
            !quiet.until.contains_key(""),
            "a store long quiet is not kept"
        );
    }

    #[test]
    fn only_a_new_window_of_the_browser_s_own_is_closed() {
        let window = Seen {
            handle: 7,
            process: 4242,
            visible: true,
            captioned: true,
        };
        assert!(stray(window, 4242, &[]));
        assert!(!stray(window, 4242, &[7]), "there before");
        assert!(!stray(window, 1, &[]), "another program's");
        assert!(!stray(window, 0, &[]), "no browser known");
        assert!(!stray(
            Seen {
                captioned: false,
                ..window
            },
            4242,
            &[]
        ));
        assert!(!stray(
            Seen {
                visible: false,
                ..window
            },
            4242,
            &[]
        ));
    }
}
