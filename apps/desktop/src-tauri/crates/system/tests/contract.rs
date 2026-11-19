#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_system::{gpu, package_manager};

#[test]
fn the_gpu_is_on_unless_it_was_turned_off() {
    let dir = tempfile::tempdir().expect("a folder");
    std::fs::write(dir.path().join("gpu.txt"), "off\n").expect("the choice");
    assert!(!gpu::accelerated(dir.path()));
    assert!(gpu::OFF.contains(&"--disable-gpu"));
    assert!(gpu::seen().is_none());
}
#[test]
fn a_test_build_was_installed_by_no_package_manager() {
    assert_eq!(package_manager::install_manager(), None);
}
