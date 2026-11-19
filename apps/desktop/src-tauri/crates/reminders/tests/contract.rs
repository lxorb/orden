#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_reminders::reminders::link::{is_reminder, link, parsed, Act};

#[test]
fn a_reminder_s_link_is_read_back_as_what_it_asked() {
    let made = link(Act::Open, "00ff", "a1b2");
    assert!(is_reminder(&made));
    assert_eq!(
        parsed(&made),
        Some((Act::Open, "00ff".into(), "a1b2".into()))
    );
    assert!(!is_reminder("orden://open?path=Plan.md"));
}
