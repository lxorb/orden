use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

const MINUTE: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Counted {
    Calls,
    Navigations,
}

#[derive(Default)]
pub struct Counts {
    seen: HashMap<(String, Counted), VecDeque<Instant>>,
    said: HashMap<String, Instant>,
}

impl Counts {
    pub fn admit(
        &mut self,
        agent: &str,
        what: Counted,
        most: u32,
        now: Instant,
    ) -> Option<Duration> {
        let most = usize::try_from(most.max(1)).unwrap_or(usize::MAX);
        let moments = self.seen.entry((agent.to_string(), what)).or_default();
        while moments
            .front()
            .is_some_and(|at| now.duration_since(*at) >= MINUTE)
        {
            moments.pop_front();
        }
        if moments.len() < most {
            moments.push_back(now);
            return None;
        }
        moments
            .front()
            .map(|oldest| MINUTE.saturating_sub(now.duration_since(*oldest)))
    }

    pub fn first_of_burst(&mut self, agent: &str, now: Instant) -> bool {
        let fresh = self
            .said
            .get(agent)
            .is_none_or(|at| now.duration_since(*at) >= MINUTE);
        if fresh {
            self.said.insert(agent.to_string(), now);
        }
        fresh
    }
}

static COUNTS: Mutex<Option<Counts>> = Mutex::new(None);

pub fn wait_for_room(
    agent: &str,
    what: Counted,
    most: u32,
    stopped: impl Fn() -> bool,
) -> Result<bool, ()> {
    let mut first = false;
    loop {
        let wait = {
            let mut all = COUNTS.lock().unwrap_or_else(PoisonError::into_inner);
            let counts = all.get_or_insert_with(Counts::default);
            let now = Instant::now();
            let wait = counts.admit(agent, what, most, now);
            if wait.is_some() && !first {
                first = counts.first_of_burst(agent, now);
            }
            wait
        };
        let Some(wait) = wait else {
            return Ok(first);
        };
        if stopped() {
            return Err(());
        }
        std::thread::sleep(wait.min(Duration::from_millis(250)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_past_the_limit_wait_for_the_oldest_to_leave_the_minute() {
        let mut counts = Counts::default();
        let start = Instant::now();
        for _ in 0..3 {
            assert_eq!(counts.admit("a", Counted::Calls, 3, start), None);
        }
        let later = start + Duration::from_secs(20);
        assert_eq!(
            counts.admit("a", Counted::Calls, 3, later),
            Some(Duration::from_secs(40))
        );
        assert_eq!(counts.admit("b", Counted::Calls, 3, later), None);
        assert_eq!(counts.admit("a", Counted::Navigations, 3, later), None);
        let minute = start + MINUTE;
        assert_eq!(counts.admit("a", Counted::Calls, 3, minute), None);
    }

    #[test]
    fn a_burst_is_said_once_a_minute() {
        let mut counts = Counts::default();
        let start = Instant::now();
        assert!(counts.first_of_burst("a", start));
        assert!(!counts.first_of_burst("a", start + Duration::from_secs(5)));
        assert!(counts.first_of_burst("b", start));
        assert!(counts.first_of_burst("a", start + MINUTE));
    }

    #[test]
    fn a_limit_of_nothing_still_lets_one_through() {
        let mut counts = Counts::default();
        assert_eq!(counts.admit("a", Counted::Calls, 0, Instant::now()), None);
    }
}
