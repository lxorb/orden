use std::path::Path;
use std::sync::mpsc::channel;

use orden_base::{carry, clock, labels, lane, paths, sent};
use tauri::ipc::InvokeBody;

#[test]
fn a_lane_does_its_work_in_the_order_it_was_handed() {
    let (done, heard) = channel();
    let send = lane::lane(move |one: u8| done.send(one).expect("the test listening"));
    for one in 0..10 {
        send.send(one).expect("the lane");
    }
    assert_eq!(heard.iter().take(10).collect::<Vec<_>>(), (0..10).collect::<Vec<_>>());
}
#[test]
fn work_off_the_runtime_hands_back_what_it_made() {
    let made = tauri::async_runtime::block_on(lane::off_the_runtime(|| 6 * 7));
    assert_eq!(made, 42);
}
#[test]
fn a_folded_path_stays_inside_its_root_and_climbing_out_is_seen() {
    let root = Path::new("/spaces/Work");
    assert!(paths::inside(root, &paths::folded(Path::new("/spaces/Work/a/../b.md"))));
    assert!(!paths::inside(root, &paths::folded(Path::new("/spaces/Work/../Home/b.md"))));
    assert!(paths::is_markdown(Path::new("a/b.md")));
    assert!(!paths::is_markdown(Path::new("a/b.pdf")));
}
#[test]
fn a_rename_never_takes_the_place_of_what_is_there() {
    let dir = tempfile::tempdir().expect("a folder");
    let from = dir.path().join("a.md");
    let to = dir.path().join("b.md");
    std::fs::write(&from, "a").expect("a note");
    std::fs::write(&to, "b").expect("another");
    assert!(carry::rename_new(&from, &to).is_err());
    assert_eq!(std::fs::read_to_string(&to).expect("kept"), "b");
    let free = dir.path().join("c.md");
    carry::rename_new(&from, &free).expect("a free name");
    assert_eq!(std::fs::read_to_string(&free).expect("moved"), "a");
}
#[test]
fn a_whole_write_lands_whole() {
    let dir = tempfile::tempdir().expect("a folder");
    let target = dir.path().join("a.json");
    paths::write_atomically(&target, b"{}").expect("written");
    assert_eq!(paths::at_most(&target, 16).expect("read"), Some(b"{}".to_vec()));
}
#[test]
fn only_the_main_and_numbered_windows_hold_documents() {
    assert!(labels::is_document_window(labels::MAIN));
    assert!(labels::is_document_window("orden-3"));
    assert!(!labels::is_document_window("orden-quick-add"));
}
#[test]
fn bytes_come_raw_or_as_numbers() {
    let raw = InvokeBody::Raw(vec![1, 2]);
    assert_eq!(sent::bytes_sent(&raw).as_deref(), Some(&[1_u8, 2][..]));
    let numbers = InvokeBody::Json(serde_json::json!([3, 255]));
    assert_eq!(sent::bytes_sent(&numbers).as_deref(), Some(&[3_u8, 255][..]));
    assert!(sent::bytes_sent(&InvokeBody::Json(serde_json::json!("x"))).is_none());
}
#[test]
fn a_moment_is_written_the_iso_way() {
    assert_eq!(clock::iso(0), "1970-01-01T00:00:00.000Z");
    assert!(clock::now() > 1_700_000_000_000);
}
