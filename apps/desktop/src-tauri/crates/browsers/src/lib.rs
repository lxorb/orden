#![cfg(not(any(target_os = "android", target_os = "ios")))]

pub mod browser_data;
pub mod browser_profiles;
pub mod chromium_profiles;
pub mod firefox_profiles;
pub mod safari;
pub mod zen_profiles;
