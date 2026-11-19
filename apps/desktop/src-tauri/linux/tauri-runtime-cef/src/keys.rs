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

pub(crate) fn left(label: &str, next: bool) {
  if let Some((_, focus)) = HOOKS.get() {
    focus(label, next);
  }
}
