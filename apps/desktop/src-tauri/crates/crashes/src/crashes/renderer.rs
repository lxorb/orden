use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use super::report::{self, Report};

pub const HUNG: Duration = Duration::from_secs(10);

const LATE_TICK: Duration = Duration::from_secs(3);

const REWRITTEN: Duration = Duration::from_secs(5);

struct Page {
    heard: Instant,
    visible: bool,
    whose: String,
    hung: Option<(Instant, Report)>,
    written: Option<Instant>,
}

#[derive(Default)]
pub struct Pages {
    pages: HashMap<String, Page>,
    looked: Option<Instant>,
}

pub enum Seen {
    Hung(Report),
    Still(Report),
    Answered(Report),
}

impl Pages {
    pub fn heard(&mut self, label: &str, whose: &str, visible: bool, at: Instant) -> Option<Seen> {
        let page = self.pages.entry(label.to_owned()).or_insert_with(|| Page {
            heard: at,
            visible,
            whose: whose.to_owned(),
            hung: None,
            written: None,
        });
        page.heard = at;
        page.visible = visible;
        let (since, mut report) = page.hung.take()?;
        report.held = Some(millis(at.saturating_duration_since(since) + HUNG));
        report.summary = summary(&page.whose, report.held.unwrap_or(0));
        Some(Seen::Answered(report))
    }

    pub fn gone(&mut self, label: &str) -> Option<Seen> {
        let page = self.pages.remove(label)?;
        let (since, mut report) = page.hung?;
        report.held = Some(millis(since.elapsed() + HUNG));
        report.reason = Some("closed while unresponsive".to_owned());
        Some(Seen::Answered(report))
    }

    pub fn look(&mut self, at: Instant, window_answers: bool) -> Vec<Seen> {
        let late = self
            .looked
            .is_some_and(|before| at.saturating_duration_since(before) > LATE_TICK);
        self.looked = Some(at);
        let mut seen = Vec::new();
        for page in self.pages.values_mut() {
            if late || !window_answers {
                page.heard = at;
                continue;
            }
            if let Some((since, report)) = &mut page.hung {
                if page
                    .written
                    .is_some_and(|written| at.saturating_duration_since(written) >= REWRITTEN)
                {
                    let held = at.saturating_duration_since(*since) + HUNG;
                    report.held = Some(millis(held));
                    report.summary = summary(&page.whose, millis(held));
                    page.written = Some(at);
                    seen.push(Seen::Still(report.clone()));
                }
                continue;
            }
            if !page.visible || at.saturating_duration_since(page.heard) < HUNG {
                continue;
            }
            let mut report = report::fresh("engine", &summary(&page.whose, millis(HUNG)));
            report.process = Some("renderer".to_owned());
            report.reason = Some("unresponsive".to_owned());
            report.held = Some(millis(HUNG));
            page.hung = Some((at, report.clone()));
            page.written = Some(at);
            seen.push(Seen::Hung(report));
        }
        seen
    }
}

fn summary(whose: &str, held: u64) -> String {
    format!("{whose} page did not answer for {} s", held / 1000)
}

fn millis(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

static PAGES: Mutex<Option<Pages>> = Mutex::new(None);

fn with<T>(work: impl FnOnce(&mut Pages) -> T) -> T {
    let mut held = PAGES.lock().unwrap_or_else(PoisonError::into_inner);
    work(held.get_or_insert_with(Pages::default))
}

fn kept(seen: Seen) {
    match seen {
        Seen::Hung(report) | Seen::Still(report) => report::keep(&report, true),
        Seen::Answered(report) => report::keep(&report, false),
    }
}

pub fn heard(label: &str, whose: &str, visible: bool) {
    if let Some(seen) = with(|pages| pages.heard(label, whose, visible, Instant::now())) {
        kept(seen);
    }
}

pub fn gone(label: &str) {
    if let Some(seen) = with(|pages| pages.gone(label)) {
        kept(seen);
    }
}

pub fn look(window_answers: bool) {
    for seen in with(|pages| pages.look(Instant::now(), window_answers)) {
        kept(seen);
    }
}

#[cfg(test)]
mod tests {
    use super::{Pages, Seen, HUNG};
    use std::time::{Duration, Instant};

    #[test]
    fn a_page_that_stops_answering_while_the_window_answers_is_a_hung_renderer() {
        let mut pages = Pages::default();
        let start = Instant::now();
        assert!(pages.heard("main", "The window’s", true, start).is_none());

        let mut at = start;
        let mut hung = None;
        while at < start + HUNG + Duration::from_secs(4) {
            at += Duration::from_millis(500);
            for seen in pages.look(at, true) {
                if let Seen::Hung(report) = seen {
                    assert!(hung.is_none(), "one hang, one report");
                    hung = Some(report);
                }
            }
        }
        let hung = hung.expect("the hang was seen");
        assert_eq!(hung.kind, "engine");
        assert_eq!(hung.process.as_deref(), Some("renderer"));
        assert_eq!(hung.reason.as_deref(), Some("unresponsive"));

        let Some(Seen::Answered(done)) = pages.heard("main", "The window’s", true, at) else {
            panic!("the page answered again");
        };
        assert_eq!(done.id, hung.id);
        assert!(done.held.is_some_and(|held| held >= 13_000));
    }

    #[test]
    fn a_page_is_not_hung_while_hidden_while_the_window_is_stuck_or_after_a_sleep() {
        let mut pages = Pages::default();
        let start = Instant::now();
        pages.heard("hidden", "A document window’s", false, start);
        pages.heard("stuck", "The window’s", true, start);
        let mut at = start;
        for _ in 0..40 {
            at += Duration::from_millis(500);
            assert!(pages
                .look(at, false)
                .iter()
                .all(|seen| !matches!(seen, Seen::Hung(_))));
        }
        pages.heard("hidden", "A document window’s", false, at);
        at += Duration::from_secs(60);
        assert!(pages.look(at, true).is_empty(), "a sleep is not a hang");
        for _ in 0..10 {
            at += Duration::from_millis(500);
            assert!(pages.look(at, true).is_empty());
        }
    }
}
