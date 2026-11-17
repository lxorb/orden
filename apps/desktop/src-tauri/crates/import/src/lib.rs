#![cfg(not(any(target_os = "android", target_os = "ios")))]

pub mod apple_notes;
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only the Mac's own store reader asks for any of this; it is built elsewhere to be checked, not to be called"
    )
)]
mod apple_text;
pub mod obsidian_vaults;
