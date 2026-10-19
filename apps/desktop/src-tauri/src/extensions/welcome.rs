//! An extension's first-run page, which never opens on its own (#409).
//!
//! Emil (#409): *"ausserdem oeffnen sich jedes mal die ganzen extension windows von
//! wegen 'thanks for installing...'"*. A store is handed every extension on the list the
//! first time a page is built in it (webview2.rs), and a web note turned Separate is a
//! store nothing was ever handed to - so each turn made every extension a fresh install,
//! and each fresh install ran its `onInstalled`, which opens a page: in a window of the
//! engine's own where the page had nowhere to go, or as a tab beside the page.
//!
//! So for a moment after an extension is handed to a store, that store is **quiet**: a
//! window nobody pressed for is not opened, from any page in it (`listen`, and `taken` in
//! `web_open`'s `on_new_window`), and a window the browser process opens of its own
//! accord - the engine's own frame round a page nothing hosts - is closed as it appears
//! (`watch`). A window a person asks for is a window, quiet or not: the engine says
//! whether one did, and it is never the extension's own `onInstalled`.
//!
//! The extension is installed all the same and runs; only the page it opens about
//! itself does not. Its options page is in its row in Settings and in the web bar.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

/// How long a store stays quiet after an extension was handed to it: long enough for
/// the extension's background to start on a busy machine and answer `onInstalled`, short
/// enough that a page asking for a window on its own a moment later is still heard.
pub const QUIET: Duration = Duration::from_secs(10);

/// Which stores are quiet, until when.
#[derive(Debug, Default)]
pub struct Quiet {
    until: BTreeMap<String, Instant>,
}

impl Quiet {
    /// An extension is on its way into `store` at `now`, or has just arrived there.
    pub fn added(&mut self, store: &str, now: Instant) {
        self.until.insert(store.to_owned(), now + QUIET);
        self.until.retain(|_, until| *until > now);
    }

    /// Whether a window `store` asks for at `now` is held back: one nobody pressed for,
    /// while the store is quiet.
    pub fn hushed(&self, store: &str, user: bool, now: Instant) -> bool {
        !user && self.until.get(store).is_some_and(|until| now < *until)
    }
}

/// A top-level window, as much of it as `stray` asks about.
#[derive(Clone, Copy, Debug)]
pub struct Seen {
    pub handle: isize,
    pub process: u32,
    pub visible: bool,
    /// A title bar: a window, rather than a menu, a list or a tooltip of the page's.
    pub captioned: bool,
}

/// Whether `window` is one the browser process `browser` opened on its own while its
/// store was quiet, and is closed: its own, on screen, a frame with a title bar, and not
/// there before the extension was handed over - which is what keeps the developer tools,
/// and anything else somebody had open, open.
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

    /// Every store that is quiet.
    static QUIET: Mutex<Quiet> = Mutex::new(Quiet {
        until: BTreeMap::new(),
    });

    /// The browser processes being watched for windows of their own, until when.
    static WATCHING: Mutex<BTreeMap<u32, Instant>> = Mutex::new(BTreeMap::new());

    /// How often a watched process's windows are looked at: a window of its own is
    /// closed within a fifth of a second of appearing.
    const EVERY: Duration = Duration::from_millis(200);

    thread_local! {
        /// The tabs whose last request for a window was held back, until `on_new_window`
        /// takes it. The engine raises the request to this handler before wry's answer,
        /// which wry posts to the next turn of the loop; see web_opens.rs.
        static HUSHED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    }

    /// An extension is being handed to `store`, whose pages the browser process
    /// `browser` draws: the store is quiet from now, and the process is watched.
    pub fn adding(store: &str, browser: u32) {
        QUIET
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .added(store, Instant::now());
        watch(browser);
    }

    /// Whether the window this tab's page asked for last is held back, taken so it is
    /// read once.
    pub fn taken(tab: &str) -> bool {
        HUSHED.with_borrow_mut(|hushed| hushed.remove(tab))
    }

    /// Listens on one page of `store` for windows asked for while the store is quiet.
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
            // Safe: the request's own arguments, read on the thread it arrived on.
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
        // Safe: the controller is this page's, asked on its own thread, and the engine
        // holds the handler for as long as it can fire.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                let mut token = 0i64;
                let _ = core.add_NewWindowRequested(&requested, &raw mut token);
            }
        }
    }

    /// Closes the windows `browser` opens on its own for the next `QUIET`, from a thread
    /// of its own: what is open now stays open. Watched once, however many extensions
    /// arrive; each one moves the end.
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
                    // Safe: a message with no arguments to a window that may have gone,
                    // which the call says by failing.
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

    /// Every top-level window on the desktop, as `stray` asks about it.
    #[allow(unsafe_code, reason = "the desktop's windows are walked through Win32")]
    fn windows() -> Vec<Seen> {
        unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
            // Safe: `found` is the address of the list below, alive for the walk.
            let found = unsafe { &mut *(found.0 as *mut Vec<Seen>) };
            let mut process = 0u32;
            // Safe: plain questions about the window being enumerated.
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
        // Safe: the callback writes into one list this frame owns.
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

    /// A window nobody pressed for is held back in a store an extension was just handed
    /// to, and only there, and only for a moment.
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

    /// A window a person asked for is opened, quiet or not.
    #[test]
    fn a_window_somebody_pressed_for_is_never_held_back() {
        let now = Instant::now();
        let mut quiet = Quiet::default();
        quiet.added("", now);
        assert!(!quiet.hushed("", true, now));
        assert!(quiet.hushed("", false, now));
    }

    /// Each extension that arrives moves the end, and a store long quiet is forgotten.
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

    /// Only a framed window of the store's own browser, on screen, that was not there
    /// before, is closed: never a menu or list of a page's, never another program's,
    /// never what somebody already had open.
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
