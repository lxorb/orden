use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString, NSWorkspace};
use objc2_foundation::NSString;

pub const MOST: usize = 200 * 1024;
const EVERY: Duration = Duration::from_millis(250);

pub type Listener = Arc<dyn Fn(String) + Send + Sync>;

pub struct Clipboard {
    pid: i32,
    listener: Mutex<Option<Listener>>,
    ours: AtomicIsize,
    ended: AtomicBool,
}

impl Clipboard {
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

    pub fn listen(&self, listener: Option<Listener>) {
        *self
            .listener
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = listener;
    }

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

#[allow(unsafe_code, reason = "an AppKit constant, read as the static it is")]
fn unsafe_string_type() -> &'static NSString {
    unsafe { NSPasteboardTypeString }
}

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
