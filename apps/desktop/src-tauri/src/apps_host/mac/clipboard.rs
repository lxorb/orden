//! The clipboard between an application on a Mac and the device holding it (issue 1063,
//! step 8; docs/apps.md): text, both ways, while the holder shares it.
//!
//! A Mac has one clipboard for everyone, so this is the system's own:
//!
//! - **The holder pastes**: its text is put on the clipboard just before the paste's
//!   press reaches the application.
//! - **The application copies**: the clipboard is looked at a few times a second, and a
//!   change made while the application is in front is sent to the holder. A copy in any
//!   other application stays on this Mac.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString, NSWorkspace};
use objc2_foundation::NSString;

/// The most text taken or given, in bytes: what one data channel message carries.
pub const MOST: usize = 200 * 1024;
/// How often the clipboard is looked at.
const EVERY: Duration = Duration::from_millis(250);

/// Who hears what the application copied.
pub type Listener = Arc<dyn Fn(String) + Send + Sync>;

/// The clipboard, as one hosted application shares it.
pub struct Clipboard {
    pid: i32,
    listener: Mutex<Option<Listener>>,
    /// The clipboard's count after the holder's text was put on it, not news.
    ours: AtomicIsize,
    ended: AtomicBool,
}

impl Clipboard {
    /// The clipboard for the application in process `pid`, watched while it is held.
    pub fn open(pid: i32) -> Arc<Clipboard> {
        let clipboard = Arc::new(Clipboard {
            pid,
            listener: Mutex::new(None),
            ours: AtomicIsize::new(-1),
            ended: AtomicBool::new(false),
        });
        let watched = Arc::downgrade(&clipboard);
        let _ = std::thread::Builder::new()
            .name("app clipboard".to_owned())
            .spawn(move || watch(&watched));
        clipboard
    }

    /// Who hears what the application copies from now on, or nobody.
    pub fn listen(&self, listener: Option<Listener>) {
        *self
            .listener
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = listener;
    }

    /// The holder's text, put on the clipboard for the application's paste.
    pub fn give(&self, text: &str) {
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        board.setString_forType(&NSString::from_str(clipped(text)), unsafe_string_type());
        self.ours.store(board.changeCount(), Ordering::SeqCst);
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        self.ended.store(true, Ordering::SeqCst);
    }
}

/// `NSPasteboardTypeString`, the type plain text goes by.
#[allow(unsafe_code, reason = "an AppKit constant, read as the static it is")]
fn unsafe_string_type() -> &'static NSString {
    // SAFETY: a constant AppKit defines and never changes.
    unsafe { NSPasteboardTypeString }
}

/// At most `MOST` bytes of text, cut at a character.
pub fn clipped(text: &str) -> &str {
    if text.len() <= MOST {
        return text;
    }
    let mut end = MOST;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Looks at the clipboard until the clipboard is gone.
fn watch(clipboard: &Weak<Clipboard>) {
    let mut seen = NSPasteboard::generalPasteboard().changeCount();
    loop {
        std::thread::sleep(EVERY);
        let Some(clipboard) = clipboard.upgrade() else {
            return;
        };
        if clipboard.ended.load(Ordering::SeqCst) {
            return;
        }
        let board = NSPasteboard::generalPasteboard();
        let count = board.changeCount();
        if count == seen {
            continue;
        }
        seen = count;
        if count == clipboard.ours.load(Ordering::SeqCst) || !in_front(clipboard.pid) {
            continue;
        }
        let listener = clipboard
            .listener
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let (Some(listener), Some(text)) = (listener, board.stringForType(unsafe_string_type()))
        else {
            continue;
        };
        listener(clipped(&text.to_string()).to_owned());
    }
}

/// Whether the application in process `pid` is the one in front.
fn in_front(pid: i32) -> bool {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .is_some_and(|one| one.processIdentifier() == pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_text_at_a_character_within_the_most() {
        assert_eq!(clipped("hi"), "hi");
        let long = "é".repeat(MOST);
        let cut = clipped(&long);
        assert!(cut.len() <= MOST);
        assert!(cut.chars().all(|one| one == 'é'));
    }
}
