#![cfg(not(any(target_os = "android", target_os = "ios")))]

use orden_import::obsidian_vaults;

#[test]
fn a_folder_obsidian_never_listed_is_not_read_as_a_vault() {
    let dir = tempfile::tempdir().expect("a folder");
    std::fs::write(dir.path().join("a.md"), "a").expect("a note");
    let vault = dir.path().to_string_lossy().into_owned();
    assert!(obsidian_vaults::obsidian_vault_files(vault.clone()).is_err());
    assert!(obsidian_vaults::read_obsidian_file(vault, "a.md".to_owned()).is_err());
}

#[cfg(not(target_os = "macos"))]
#[test]
fn apple_notes_are_read_only_on_a_mac() {
    assert!(orden_import::apple_notes::read_apple_notes().is_err());
}
