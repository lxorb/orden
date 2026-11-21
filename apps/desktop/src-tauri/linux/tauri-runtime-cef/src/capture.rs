use std::collections::HashSet;
use std::sync::Mutex;

static CAPTURING: Mutex<Option<HashSet<i32>>> = Mutex::new(None);

pub(crate) fn heard(browser: i32, video: bool, audio: bool) {
  let mut held = CAPTURING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  let all = held.get_or_insert_with(HashSet::new);
  if video || audio {
    all.insert(browser);
  } else {
    all.remove(&browser);
  }
}

pub(crate) fn closing(browser: i32) -> i32 {
  let mut held = CAPTURING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  i32::from(held.as_mut().is_some_and(|all| all.remove(&browser)))
}

#[cfg(test)]
mod tests {
  use super::{closing, heard};

  #[test]
  fn a_page_holding_a_camera_or_microphone_is_closed_at_once_and_only_while_it_holds_one() {
    assert_eq!(closing(9001), 0);
    heard(9001, true, false);
    assert_eq!(closing(9001), 1);
    assert_eq!(closing(9001), 0);
    heard(9002, false, true);
    heard(9002, false, false);
    assert_eq!(closing(9002), 0);
    heard(9003, false, true);
    assert_eq!(closing(9003), 1);
  }
}
