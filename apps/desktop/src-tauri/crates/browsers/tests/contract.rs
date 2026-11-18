#![cfg(not(any(target_os = "android", target_os = "ios")))]

use orden_browsers::browser_profiles::read_browser_file;

#[test]
fn a_browser_nobody_knows_hands_over_no_file() {
    assert!(read_browser_file("Nowhere".into(), "Default".into(), "History".into()).is_err());
}
