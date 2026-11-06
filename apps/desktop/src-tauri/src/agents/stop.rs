use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter as _};

use super::verbs::{Event, EVENT};

static GENERATION: AtomicU64 = AtomicU64::new(0);

static STOPPED: AtomicBool = AtomicBool::new(false);

static HALTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}

pub fn cancelled(since: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) != since
}

pub fn stopped() -> bool {
    STOPPED.load(Ordering::SeqCst)
}

pub fn stopped_for(agent: &str) -> bool {
    stopped()
        || HALTED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .is_some_and(|all| all.contains(agent))
}

pub fn halted() -> Vec<String> {
    HALTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|all| all.iter().cloned().collect())
        .unwrap_or_default()
}

pub fn halt(app: &AppHandle, agent: &str) {
    let fresh = HALTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashSet::new)
        .insert(agent.to_string());
    super::process::end_all(Some(agent));
    if fresh {
        let _ = app.emit(
            EVENT,
            Event::Paused {
                agent: agent.to_string(),
            },
        );
    }
}

pub fn stop(app: &AppHandle) -> bool {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let again = STOPPED.swap(true, Ordering::SeqCst);
    super::process::end_all(None);
    #[cfg(any(windows, feature = "cef"))]
    if again {
        super::tabs::close_all(app, None);
    }
    let _ = app.emit(EVENT, Event::Stopped { closed: again });
    again
}

pub fn resume(app: &AppHandle, agent: Option<&str>) {
    {
        let mut halted = HALTED.lock().unwrap_or_else(PoisonError::into_inner);
        match (agent, halted.as_mut()) {
            (None, _) => {
                STOPPED.store(false, Ordering::SeqCst);
                *halted = None;
            }
            (Some(agent), Some(all)) => {
                all.remove(agent);
            }
            (Some(_), None) => {}
        }
    }
    let _ = app.emit(
        EVENT,
        Event::Resumed {
            agent: agent.unwrap_or_default().to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_is_cancelled_by_the_count_moving_on() {
        let started = generation();
        assert!(!cancelled(started));
        GENERATION.fetch_add(1, Ordering::SeqCst);
        assert!(cancelled(started));
    }

    #[test]
    fn one_agent_stopped_is_that_agent_and_nobody_else() {
        HALTED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(HashSet::new)
            .insert("halting".into());
        assert!(stopped_for("halting"));
        assert!(!stopped_for("someone-else"));
        assert!(halted().contains(&"halting".to_string()));
        if let Some(all) = HALTED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            all.remove("halting");
        }
        assert!(!stopped_for("halting"));
    }
}
