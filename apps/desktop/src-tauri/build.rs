//! Tauri's own build step: it generates the context the app is compiled with,
//! which is where the config, the icons and the permissions come from.

fn main() {
    tauri_build::build();
}
