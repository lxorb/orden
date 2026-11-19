#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_crashes::stall;

#[test]
fn what_is_being_done_is_said_innermost_first_and_ends_with_its_guard() {
    assert_eq!(stall::doing_now(), None);
    let outer = stall::doing("a command");
    let inner = stall::doing("its page");
    assert_eq!(stall::doing_now().as_deref(), Some("its page < a command"));
    drop(inner);
    assert_eq!(stall::doing_now().as_deref(), Some("a command"));
    drop(outer);
    assert_eq!(stall::doing_now(), None);
}
