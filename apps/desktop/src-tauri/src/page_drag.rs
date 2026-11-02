//! A drag out of the app's own page on Linux, which the page runs itself (#427).
//!
//! Chromium's drag on X11 waits in a nested run of its message loop for the drag to end
//! (`X11WholeScreenMoveLoop`). The runtime drives CEF with an external message pump, and a
//! run of the loop under one comes back as soon as it is out of work: the drag took the
//! pointer, had nothing to do yet, and ended, within a few milliseconds and before the
//! pointer had moved. So on Linux no row, tab or tile could be dragged anywhere; the
//! pointer kept the cursor the drag had set, the page went on hearing it press and hover,
//! and letting go did nothing. X11's own trace of it, and a plain Chromium on the same X
//! server doing the same drag all the way, are what say the loop is the cause. The pump is
//! `external_message_pump: 1` in tauri-runtime-cef and the loop is in libcef, so neither
//! is Orden's to change.
//!
//! So `SCRIPT` takes the drag as it starts, cancels the engine's, and says the same events
//! a drag says with the pointer's own, so every list, strip and pane goes on hearing the
//! drag it was written for. A file dragged in from another app is the engine's, and
//! unchanged: only a drag leaving a window needs the loop. Which is what this does not
//! give: nothing dragged out of Orden reaches another app, and a page in a web tab is the
//! site's own and has the engine's drag still, so it cannot drag either.

/// What the app's own page runs, in every window of the app's own.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SCRIPT: &str = include_str!("page_drag.js");

#[cfg(test)]
mod tests {
    use super::SCRIPT;

    #[test]
    fn the_script_takes_the_engine_s_drag_and_says_each_event_itself() {
        assert!(SCRIPT.contains("addEventListener('dragstart'"));
        for event in ["dragenter", "dragover", "dragleave", "drop", "dragend"] {
            assert!(SCRIPT.contains(&format!("'{event}'")), "{event}");
        }
    }
}
