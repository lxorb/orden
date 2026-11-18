#![cfg(not(any(target_os = "android", target_os = "ios")))]

use orden_placement::placement::names_its_place;
use tauri::utils::config::WindowConfig;

#[test]
fn a_window_names_its_place_only_when_its_config_says_where() {
    let mut config = WindowConfig::default();
    assert!(!names_its_place(&config));
    config.x = Some(10.0);
    config.y = Some(20.0);
    assert!(names_its_place(&config));
}
