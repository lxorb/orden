#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nib_lib as orden;

fn main() {
    orden::former_name::carry_env();
    #[cfg(feature = "cef")]
    if orden::cef_helper() {
        return;
    }
    #[cfg(desktop)]
    if std::env::args_os()
        .nth(1)
        .is_some_and(|first| first == "mcp")
    {
        std::process::exit(orden::mcp::serve());
    }
    orden::run();
}
