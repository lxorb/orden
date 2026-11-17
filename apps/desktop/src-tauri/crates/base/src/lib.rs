pub mod carry;
pub mod clock;
pub mod labels;
pub mod lane;
pub mod logs;
pub mod paths;
#[cfg(desktop)]
pub mod printed;
pub mod sent;
pub mod trace;
#[cfg(desktop)]
pub mod usage;

#[cfg(mobile)]
pub type Engine = tauri::Wry;

#[cfg(desktop)]
pub type Engine = tauri::DynRuntime;
