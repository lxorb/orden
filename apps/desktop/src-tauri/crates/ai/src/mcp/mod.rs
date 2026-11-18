mod app;
pub mod home;
pub mod host;
mod link;
mod marks;
mod pairing;
pub mod program;
mod results;
mod rpc;
mod server;
mod shared;
mod tools;

#[must_use]
pub fn serve() -> i32 {
    server::run()
}
