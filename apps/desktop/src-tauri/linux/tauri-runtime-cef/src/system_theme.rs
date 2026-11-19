use std::sync::{Mutex, OnceLock};

use tauri_utils::Theme;

type Tell = Box<dyn Fn() + Send + Sync>;

static THEME: Mutex<Option<Theme>> = Mutex::new(None);
static TELL: OnceLock<Tell> = OnceLock::new();

pub fn set_system_theme(theme: Theme) {
  let Ok(mut held) = THEME.lock() else {
    return;
  };
  if held.replace(theme) == Some(theme) {
    return;
  }
  drop(held);
  if let Some(tell) = TELL.get() {
    tell();
  }
}

pub(crate) fn system_theme() -> Option<Theme> {
  THEME.lock().ok().and_then(|held| *held)
}

pub(crate) fn tell_through(tell: impl Fn() + Send + Sync + 'static) {
  let _ = TELL.set(Box::new(tell));
}
