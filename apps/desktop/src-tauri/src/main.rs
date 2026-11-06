#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "cef")]
    if nib_lib::cef_helper() {
        return;
    }
    #[cfg(desktop)]
    if std::env::args_os()
        .nth(1)
        .is_some_and(|first| first == "mcp")
    {
        std::process::exit(nib_lib::mcp::serve());
    }
    nib_lib::run();
}
