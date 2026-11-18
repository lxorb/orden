pub mod carry;
pub mod clock;
pub mod handed;
pub mod labels;
pub mod lane;
#[cfg(desktop)]
pub mod letters;
#[cfg(target_os = "linux")]
pub mod linux;
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
