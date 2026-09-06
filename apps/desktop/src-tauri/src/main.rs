//! The desktop app. Everything it does lives in the library beside this file;
//! this is only the entry point, and the attribute that keeps a console window
//! from opening behind the app on Windows.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nib_lib::run()
}
