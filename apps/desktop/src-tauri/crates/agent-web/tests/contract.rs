#![cfg(not(any(target_os = "android", target_os = "ios")))]

use orden_agent_web::engines::{reader_of, twin_of};

#[test]
fn a_twin_store_names_the_reader_s_store_it_stands_for() {
    assert_eq!(reader_of(Some(&twin_of(None))), Some(None));
    assert_eq!(reader_of(Some(&twin_of(Some("work")))), Some(Some("work")));
    assert_eq!(reader_of(Some("work")), None);
}
