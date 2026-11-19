#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_web::page_scale::{switches, CHROMIUM_SCALES_ITSELF, SWITCH};

#[test]
fn the_engine_is_told_its_scale_only_where_it_cannot_find_it_itself() {
    let told = switches();
    if CHROMIUM_SCALES_ITSELF {
        assert!(told.is_empty());
    } else {
        assert_eq!(told, [(SWITCH.0.to_owned(), Some(SWITCH.1.to_owned()))]);
    }
}
