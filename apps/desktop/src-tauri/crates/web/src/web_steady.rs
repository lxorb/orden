use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

pub const STEADY: Duration = Duration::from_millis(100);

struct Kept<T> {
    last: Instant,
    loading: bool,
    held: Option<T>,
    waiting: bool,
}

pub struct Steady<T> {
    tabs: HashMap<String, Kept<T>>,
}

impl<T> Default for Steady<T> {
    fn default() -> Self {
        Self {
            tabs: HashMap::new(),
        }
    }
}

impl<T> Steady<T> {
    #[cfg(test)]
    pub fn told(
        &mut self,
        tab: &str,
        loading: bool,
        one: T,
        now: Instant,
    ) -> (Vec<T>, Option<Duration>) {
        self.told_over(tab, loading, one, now, |_, newer| newer)
    }

    pub fn told_over(
        &mut self,
        tab: &str,
        loading: bool,
        one: T,
        now: Instant,
        over: impl FnOnce(T, T) -> T,
    ) -> (Vec<T>, Option<Duration>) {
        let Some(kept) = self.tabs.get_mut(tab) else {
            self.tabs.insert(
                tab.to_string(),
                Kept {
                    last: now,
                    loading,
                    held: None,
                    waiting: false,
                },
            );
            return (vec![one], None);
        };
        if kept.loading != loading {
            let mut out: Vec<T> = kept.held.take().into_iter().collect();
            out.push(one);
            kept.last = now;
            kept.loading = loading;
            return (out, None);
        }
        let since = now.saturating_duration_since(kept.last);
        if !kept.waiting && since >= STEADY {
            kept.last = now;
            return (vec![one], None);
        }
        kept.held = Some(match kept.held.take() {
            Some(older) => over(older, one),
            None => one,
        });
        if kept.waiting {
            return (Vec::new(), None);
        }
        kept.waiting = true;
        (Vec::new(), Some(STEADY.saturating_sub(since)))
    }

    pub fn due(&mut self, tab: &str, now: Instant) -> Option<T> {
        let kept = self.tabs.get_mut(tab)?;
        kept.waiting = false;
        let one = kept.held.take()?;
        kept.last = now;
        Some(one)
    }

    pub fn forget(&mut self, tab: &str) {
        self.tabs.remove(tab);
    }
}

type Said = (String, serde_json::Value);

fn said_over(older: Said, newer: Said) -> Said {
    let (window, mut payload) = newer;
    if let (serde_json::Value::Object(kept), serde_json::Value::Object(now)) =
        (older.1, &mut payload)
    {
        for (key, was) in kept {
            let blank = now.get(&key).is_none_or(|one| one.as_str() == Some(""));
            if blank && was.as_str().is_some_and(|one| !one.is_empty()) {
                now.insert(key, was);
            }
        }
    }
    (window, payload)
}

static TOLD: LazyLock<Mutex<Steady<Said>>> = LazyLock::new(Mutex::default);

fn told<R>(look: impl FnOnce(&mut Steady<Said>) -> R) -> R {
    look(&mut TOLD.lock().unwrap_or_else(PoisonError::into_inner))
}

pub fn say(
    app: &tauri::AppHandle,
    window: &str,
    event: &'static str,
    tab: &str,
    loading: bool,
    payload: serde_json::Value,
) {
    use tauri::Emitter;

    let (now, later) = told(|all| {
        all.told_over(
            tab,
            loading,
            (window.to_string(), payload),
            Instant::now(),
            said_over,
        )
    });
    for (window, one) in now {
        let _ = app.emit_to(window.as_str(), event, one);
    }
    let Some(wait) = later else {
        return;
    };
    let (app, tab) = (app.clone(), tab.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        if let Some((window, one)) = told(|all| all.due(&tab, Instant::now())) {
            let _ = app.emit_to(window.as_str(), event, one);
        }
    });
}

pub fn forget(tab: &str) {
    told(|all| all.forget(tab));
}

#[cfg(test)]
mod tests {
    use super::{said_over, Steady, STEADY};
    use std::time::{Duration, Instant};

    #[test]
    fn a_page_s_first_word_and_each_after_a_quiet_spell_go_at_once() {
        let mut steady = Steady::default();
        let at = Instant::now();
        assert_eq!(steady.told("t", false, 1, at), (vec![1], None));
        assert_eq!(steady.told("t", false, 2, at + STEADY), (vec![2], None));
    }

    #[test]
    fn a_storm_of_titles_reaches_the_window_as_its_last_one_each_tenth_of_a_second() {
        let mut steady = Steady::default();
        let at = Instant::now();
        let mut sent = vec![];
        let mut waits = 0;
        sent.extend(steady.told("t", false, 0, at).0);
        for one in 1..=1000 {
            let now = at + Duration::from_micros(50 * one);
            let (out, wait) = steady.told("t", false, one, now);
            sent.extend(out);
            if let Some(wait) = wait {
                waits += 1;
                assert!(wait <= STEADY);
            }
        }
        assert_eq!(sent, vec![0]);
        assert_eq!(waits, 1);
        assert_eq!(steady.due("t", at + STEADY), Some(1000));
        assert_eq!(steady.due("t", at + STEADY), None);
    }

    #[test]
    fn a_load_starting_or_ending_is_never_held_back_nor_merged_away() {
        let mut steady = Steady::default();
        let at = Instant::now();
        steady.told("t", false, "titled", at);
        assert_eq!(
            steady.told("t", false, "retitled", at).0,
            Vec::<&str>::new()
        );
        assert_eq!(
            steady.told("t", true, "loading", at),
            (vec!["retitled", "loading"], None)
        );
        assert_eq!(
            steady.told("t", false, "loaded", at),
            (vec!["loaded"], None)
        );
        assert_eq!(steady.due("t", at + STEADY), None);
    }

    #[test]
    fn a_title_held_back_is_not_lost_to_a_later_word_that_carries_none() {
        let mut steady = Steady::default();
        let at = Instant::now();
        let word = |url: &str, title: &str| {
            (
                "main".to_string(),
                serde_json::json!({ "tab": "t", "url": url, "title": title, "back": false }),
            )
        };
        steady.told_over("t", false, word("http://a/", "carry"), at, said_over);
        let held = steady.told_over("t", false, word("http://a/", "carried {}"), at, said_over);
        assert!(held.0.is_empty());
        let after = steady.told_over("t", false, word("http://a/b", ""), at, said_over);
        assert!(after.0.is_empty());
        let (_, sent) = steady.due("t", at + STEADY).unwrap();
        assert_eq!(sent["title"], "carried {}");
        assert_eq!(sent["url"], "http://a/b");
    }

    #[test]
    fn each_tab_keeps_its_own_pace_and_a_closed_one_is_forgotten() {
        let mut steady = Steady::default();
        let at = Instant::now();
        steady.told("a", false, 1, at);
        assert_eq!(steady.told("b", false, 2, at), (vec![2], None));
        steady.forget("a");
        assert_eq!(steady.told("a", false, 3, at), (vec![3], None));
    }
}
