#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_explorer::explorer::kinds;
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
#[test]
fn a_kind_no_file_could_end_in_has_no_icon() {
    assert_eq!(kinds::icon("not/an/ending"), None);
    assert_eq!(kinds::icon("an-ending-far-too-long"), None);
}
#[test]
fn a_kind_is_the_same_kind_in_any_case() {
    assert_eq!(kinds::icon("TXT"), kinds::icon("txt"));
}
