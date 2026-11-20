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

pub(crate) fn retold_when_shown(was_visible: Option<bool>, visible: bool, asked: bool) -> bool {
  asked && visible && was_visible == Some(false)
}

#[cfg(test)]
mod tests {
  use super::retold_when_shown;

  #[test]
  fn a_page_shown_again_while_a_screen_reader_asks_gets_its_tree_retold() {
    assert!(retold_when_shown(Some(false), true, true));
    assert!(!retold_when_shown(Some(true), true, true));
    assert!(!retold_when_shown(Some(false), true, false));
    assert!(!retold_when_shown(Some(false), false, true));
    assert!(!retold_when_shown(None, true, true));
  }
}
