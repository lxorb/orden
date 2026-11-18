use std::sync::atomic::{AtomicBool, Ordering};

static ASKED: AtomicBool = AtomicBool::new(false);

pub(crate) fn asked() -> bool {
  ASKED.load(Ordering::Relaxed)
}

pub(crate) fn ask(on: bool) {
  ASKED.store(on, Ordering::Relaxed);
}

pub(crate) fn state(on: bool) -> cef::State {
  if on {
    cef::State::ENABLED
  } else {
    cef::State::DISABLED
  }
}
