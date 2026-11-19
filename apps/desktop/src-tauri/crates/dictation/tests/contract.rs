#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_dictation::dictation::catalog;

#[test]
fn this_machine_has_one_pinned_runtime() {
    let runtime = catalog::this_runtime().expect("a runtime for this desktop");
    assert_eq!(
        Some(runtime.rid),
        catalog::rid_of(std::env::consts::OS, std::env::consts::ARCH)
    );
}
#[test]
fn every_download_is_pinned_by_its_hash() {
    for runtime in catalog::RUNTIMES {
        for pinned in [runtime.package, runtime.onnxruntime, runtime.api] {
            assert_eq!(pinned.sha256.len(), 64, "{}", pinned.name);
            assert!(pinned.size > 0, "{}", pinned.name);
        }
    }
    assert_eq!(catalog::rid_of("plan9", "x86_64"), None);
}
