use std::time::{Duration, Instant};

use super::load;
use super::report::{self, Report};
use super::stacks;

const REWRITTEN: Duration = Duration::from_secs(5);

const WALK: Duration = Duration::from_secs(5);

pub struct Freeze {
    report: Report,
    doing: String,
    spent: Option<Duration>,
    began: Instant,
    written: Instant,
}

pub fn began(doing: &str, held: Duration) -> Freeze {
    let mut report = report::fresh("freeze", &summary(doing, held, None));
    report.doing = Some(doing.to_owned());
    report.held = Some(millis(held));
    report::keep(&report, true);
    report.threads = stacks::every_thread(WALK)
        .iter()
        .map(|raw| stacks::resolved(raw, raw.main))
        .collect();
    report::keep(&report, true);
    Freeze {
        report,
        doing: doing.to_owned(),
        spent: load::cpu(),
        began: Instant::now(),
        written: Instant::now(),
    }
}

impl Freeze {
    pub fn still(&mut self, held: Duration) {
        if self.written.elapsed() < REWRITTEN {
            return;
        }
        self.written = Instant::now();
        self.held(held);
        report::keep(&self.report, true);
    }

    pub fn ended(mut self, held: Duration) {
        self.held(held);
        self.report.killed = Some(false);
        report::keep(&self.report, false);
    }

    #[cfg(test)]
    pub fn report(&self) -> &Report {
        &self.report
    }

    fn held(&mut self, held: Duration) {
        let busy = busy(self.spent, load::cpu(), self.began.elapsed());
        self.report.held = Some(millis(held));
        self.report.summary = summary(&self.doing, held, busy);
    }
}

fn busy(before: Option<Duration>, after: Option<Duration>, over: Duration) -> Option<u64> {
    let spent = after?.checked_sub(before?)?;
    if over < Duration::from_millis(500) {
        return None;
    }
    Some(u64::try_from(spent.as_millis() * 100 / over.as_millis()).unwrap_or(u64::MAX))
}

pub fn summary(doing: &str, held: Duration, busy: Option<u64>) -> String {
    let seconds = held.as_secs();
    let core = busy.map_or_else(String::new, |busy| format!(", {busy}% of a core busy"));
    format!("The window did not answer for {seconds} s ({doing}){core}")
}

fn millis(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{began, busy, summary};
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn a_forced_freeze_is_reported_with_where_every_thread_was() {
        let (stop, stopping) = mpsc::channel::<()>();
        let (ready, readied) = mpsc::channel::<()>();
        let frozen = std::thread::Builder::new()
            .name("nib test frozen".to_owned())
            .spawn(move || {
                ready.send(()).expect("ready");
                let _ = stopping.recv();
            })
            .expect("a thread");
        readied.recv().expect("readied");
        std::thread::sleep(Duration::from_millis(50));

        let mut freeze = began("web_open", Duration::from_secs(5));
        freeze.still(Duration::from_secs(6));
        let report = freeze.report().clone();
        stop.send(()).expect("stop");
        frozen.join().expect("joined");

        assert_eq!(report.kind, "freeze");
        assert_eq!(report.doing.as_deref(), Some("web_open"));
        assert_eq!(report.held, Some(5000));
        let thread = report
            .threads
            .iter()
            .find(|one| one.name.contains("nib test frozen"))
            .expect("the frozen thread");
        assert!(thread.frames.len() >= 3);
        assert!(thread
            .frames
            .iter()
            .all(|frame| frame.offset.starts_with("0x")));
    }

    #[test]
    fn a_freeze_says_how_long_what_ran_and_how_busy_it_was() {
        assert_eq!(
            summary("web_open", Duration::from_millis(41_300), Some(97)),
            "The window did not answer for 41 s (web_open), 97% of a core busy"
        );
        assert_eq!(
            summary("nothing of nib's own", Duration::from_secs(5), None),
            "The window did not answer for 5 s (nothing of nib's own)"
        );
        assert_eq!(
            busy(
                Some(Duration::from_secs(1)),
                Some(Duration::from_secs(3)),
                Duration::from_secs(4)
            ),
            Some(50)
        );
    }
}
