#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_explorer::explorer::reach::Explored;
use std::path::Path;

#[test]
fn a_folder_is_seen_once_the_explorer_saw_it() {
    let explored = Explored::default();
    let folder = Path::new("/somewhere/else");
    assert!(!explored.seen(folder));
    explored.saw(folder);
    assert!(explored.seen(folder));
}
