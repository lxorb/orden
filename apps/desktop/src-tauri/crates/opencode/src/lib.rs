#![cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod commands;
pub mod env;
mod feed;
pub mod host;
mod http;
pub mod proxy;
mod shell;

pub use env::{Dirs, Launch};
pub use host::{stop_all, Status};
