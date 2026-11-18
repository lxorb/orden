#![cfg(not(any(target_os = "android", target_os = "ios")))]

use orden_extensions::extensions::library::firefox_folders;

#[test]
fn a_profile_with_no_library_loads_no_firefox_extension() {
    let root = tempfile::tempdir().expect("a folder");
    assert!(firefox_folders(root.path()).is_empty());
}
