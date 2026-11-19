#![cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod apple_notes;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod apple_text;
pub mod obsidian_vaults;
