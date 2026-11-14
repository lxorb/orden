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
