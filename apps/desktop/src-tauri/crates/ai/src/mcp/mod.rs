mod app;
pub(crate) mod home;
pub(crate) mod host;
mod link;
mod marks;
mod pairing;
pub(crate) mod program;
mod results;
mod rpc;
mod server;
mod shared;
mod tools;

#[must_use]
pub fn serve() -> i32 {
    server::run()
}
