use std::sync::{Mutex, PoisonError};

static FULL: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn noted(label: &str, on: bool, away: bool) -> bool {
    let mut full = FULL.lock().unwrap_or_else(PoisonError::into_inner);
    full.retain(|one| one != label);
    if on {
        full.push(label.to_owned());
    }
    !away
}

pub fn is_on(label: &str) -> bool {
    FULL.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .any(|one| one == label)
}

#[tauri::command(async)]
pub fn window_fullscreen(window: tauri::Window, on: bool) -> Result<(), String> {
    if !noted(window.label(), on, away()) {
        return Ok(());
    }
    window
        .set_fullscreen(on)
        .map_err(|error| format!("could not change full screen: {error}"))
}

#[tauri::command(async)]
pub fn window_is_fullscreen(window: tauri::Window) -> bool {
    if away() {
        return is_on(window.label());
    }
    window.is_fullscreen().unwrap_or(false)
}

fn away() -> bool {
    crate::placement::asked_away()
}

#[cfg(test)]
mod tests {
    use super::{is_on, noted, FULL};

    #[test]
    fn a_window_off_the_screen_is_never_asked_and_still_says_what_it_was_asked() {
        assert!(!noted("probe-1", true, true));
        assert!(is_on("probe-1"));
        assert!(!noted("probe-1", false, true));
        assert!(!is_on("probe-1"));
    }

    #[test]
    fn a_window_on_the_screen_is_asked_and_remembered_once() {
        assert!(noted("main-test", true, false));
        assert!(noted("main-test", true, false));
        let held = FULL
            .lock()
            .map(|full| full.iter().filter(|one| *one == "main-test").count());
        assert_eq!(held.ok(), Some(1));

        assert!(noted("other-test", true, false));
        assert!(noted("main-test", false, false));
        assert!(!is_on("main-test"));
        assert!(is_on("other-test"));
        noted("other-test", false, false);
    }
}
