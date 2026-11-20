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

#[test]
fn extensions_are_installed_through_one_call_that_says_why_it_failed() {
    let call: orden_web::engine::ExtensionsCdp = orden_web::engine::extensions_cdp;
    let said = call(
        "Extensions.loadUnpacked",
        &serde_json::json!({ "path": "/nowhere" }),
        std::time::Duration::from_millis(10),
    );
    assert_eq!(said, Err("the engine has not started".to_owned()));
}
