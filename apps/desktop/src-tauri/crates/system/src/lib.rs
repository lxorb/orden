#![cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod app_icon;
pub mod app_place;
pub mod appearance;
pub mod bundle_name;
pub mod default_browser;
mod device;
pub mod document_window;
pub mod fonts;
#[cfg(target_os = "linux")]
pub mod front_x;
pub mod full_screen;
pub mod gpu;
pub mod ground;
#[cfg(target_os = "macos")]
pub mod lights;
pub mod link_preview;
pub mod menu_bar;
pub mod package_manager;
#[cfg(target_os = "linux")]
pub mod packagekit;
pub mod presence;
#[cfg(target_os = "windows")]
pub mod shell_menu;
pub mod system_update;
pub mod time_sense;
pub mod touchpad;
pub mod updates;
#[cfg(any(windows, test))]
mod win_apps;
