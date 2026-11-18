#![cfg(not(any(target_os = "android", target_os = "ios")))]

use orden_carry::{kept, old_engine, old_home};

#[test]
fn before_anything_was_carried_the_window_is_told_nothing() {
    assert!(kept::kept_script().contains(r#"{"values":{},"gone":[]}"#));
    assert_eq!(old_engine::script(), "");
    assert!(old_engine::old_engine_databases().is_none());
    assert!(old_home::script().contains("__ORDEN_FORMER__ = former"));
}

#[test]
fn a_build_under_another_name_carries_no_home() {
    old_home::carry_home("so.orden.Orden.probe");
    assert!(old_home::script().contains("= null"));
}
