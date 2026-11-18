#![cfg(not(target_os = "android"))]

#[cfg(desktop)]
pub mod chatgpt;
pub mod owner;
pub mod pass_stretch;
#[cfg(desktop)]
pub mod retired_chats;
pub mod secrets;
