#![cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod commands;
pub mod env;
pub mod host;
mod http;
mod shell;

pub use env::{Dirs, Launch};
pub use host::{stop_all, Status};
