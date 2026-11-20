use std::sync::OnceLock;

pub type KeyHook = fn(&str, &cef::KeyEvent) -> bool;
pub type FocusHook = fn(&str, bool);

static HOOKS: OnceLock<(KeyHook, FocusHook)> = OnceLock::new();

pub fn hear_keys(keys: KeyHook, focus: FocusHook) {
  let _ = HOOKS.set((keys, focus));
}

pub(crate) fn pressed(label: &str, event: &cef::KeyEvent) -> bool {
  HOOKS.get().is_some_and(|(keys, _)| keys(label, event))
}

pub type TookHook = fn(&str);

static TOOK: OnceLock<TookHook> = OnceLock::new();

pub fn hear_focus_taken(took: TookHook) {
  let _ = TOOK.set(took);
}

pub(crate) fn took(label: &str) {
  if let Some(took) = TOOK.get() {
    took(label);
  }
}

pub(crate) fn left(label: &str, next: bool) {
  if let Some((_, focus)) = HOOKS.get() {
    focus(label, next);
  }
}
