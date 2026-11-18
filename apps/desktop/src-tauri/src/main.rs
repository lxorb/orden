#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use orden_lib as orden;

fn main() {
    #[cfg(desktop)]
    if let Some(code) = orden::terminal_hold() {
        std::process::exit(code);
    }
    #[cfg(desktop)]
    if orden::cef_helper() {
        return;
    }
    #[cfg(desktop)]
    orden::old_home::carry_home();
    #[cfg(desktop)]
    orden::old_engine::carry_storage();
    #[cfg(desktop)]
    if std::env::args_os()
        .nth(1)
        .is_some_and(|first| first == "mcp")
    {
        orden_ai::mcp::home::name(orden_ai::mcp::home::Named {
            identifier: env!("ORDEN_IDENTIFIER"),
            version: env!("ORDEN_VERSION"),
        });
        std::process::exit(orden_ai::mcp::serve());
    }
    orden::run();
}
