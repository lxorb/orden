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
#[cfg(desktop)]
pub mod program;
pub mod sent;
#[cfg(desktop)]
pub mod stat;
pub mod trace;
#[cfg(desktop)]
pub mod usage;

#[cfg(mobile)]
pub type Engine = tauri::Wry;
#[cfg(desktop)]
pub type Engine = tauri::DynRuntime;
pub trait Held<T: ?Sized> {
    fn held(&self) -> std::sync::MutexGuard<'_, T>;
}
impl<T: ?Sized> Held<T> for std::sync::Mutex<T> {
    fn held(&self) -> std::sync::MutexGuard<'_, T> {
        self.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}
