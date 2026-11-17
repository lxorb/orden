#![cfg(not(any(target_os = "android", target_os = "ios")))]

pub mod bundle_name;
pub mod fonts;
#[cfg(target_os = "linux")]
pub mod front_x;
pub mod gpu;
#[cfg(target_os = "macos")]
pub mod lights;
pub mod link_preview;
pub mod package_manager;
#[cfg(target_os = "linux")]
pub mod packagekit;
pub mod presence;
#[cfg(target_os = "windows")]
pub mod shell_menu;
pub mod time_sense;
pub mod touchpad;
