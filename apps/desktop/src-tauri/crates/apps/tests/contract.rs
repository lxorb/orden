#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_apps::apps_host::View;

#[test]
fn a_view_that_names_no_rate_is_drawn_sixty_times_a_second() {
    let view: View = serde_json::from_str(r#"{"width":800,"height":600,"dpr":2}"#).unwrap();
    assert!((view.hz - 60.0).abs() < f64::EPSILON);
}
