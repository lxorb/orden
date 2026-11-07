use std::panic::PanicHookInfo;
use std::sync::atomic::{AtomicBool, Ordering};

use super::report::{self, Report};
use super::stacks::{self, Raw};

static PANICKING: AtomicBool = AtomicBool::new(false);

pub fn panicking() -> bool {
    PANICKING.load(Ordering::Acquire)
}

pub fn install() {
    let before = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        PANICKING.store(true, Ordering::Release);
        report::keep_now(&panicked(info), false);
        before(info);
        if cfg!(debug_assertions) {
            PANICKING.store(false, Ordering::Release);
        }
    }));
}

pub fn message_of(info: &PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    payload
        .downcast_ref::<&str>()
        .map(|said| (*said).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic that said nothing".to_owned())
}

pub fn panicked(info: &PanicHookInfo<'_>) -> Report {
    let thread = std::thread::current();
    let raw = Raw {
        name: thread.name().unwrap_or_default().to_owned(),
        main: thread.name() == Some("main"),
        ips: stacks::here(),
    };
    let mut report = report::fresh("panic", &message_of(info));
    report.place = info.location().map(|at| {
        format!(
            "{}:{}:{}",
            at.file().replace('\\', "/"),
            at.line(),
            at.column()
        )
    });
    report.doing = crate::stall::doing_now();
    report.threads = vec![stacks::resolved(&raw, true)];
    report
}

#[cfg(test)]
mod tests {
    use super::{message_of, panicked};
    use std::sync::{Arc, Mutex};

    #[test]
    fn a_forced_panic_is_reported_with_where_it_happened_and_its_stack() {
        let seen = Arc::new(Mutex::new(None));
        let kept = Arc::clone(&seen);
        let before = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if message_of(info).starts_with("forced for the report test") {
                *kept.lock().expect("held") = Some(panicked(info));
            }
        }));
        let line = line!() + 2;
        let caught = std::thread::spawn(|| {
            panic!("forced for the report test in \"C:\\Users\\someone\\Notes\\Diary.md\"");
        })
        .join();
        std::panic::set_hook(before);
        assert!(caught.is_err());

        let report = seen.lock().expect("held").take().expect("a report");
        assert_eq!(report.kind, "panic");
        assert!(report.summary.starts_with("forced for the report test"));
        assert_eq!(
            report.place.as_deref(),
            Some(format!("src/crashes/panics.rs:{line}:13").as_str())
        );
        assert_eq!(report.threads.len(), 1);
        assert_eq!(report.threads[0].crashed, Some(true));
        assert!(report.threads[0].frames.len() > 3);
        assert_eq!(report.id.len(), 32);
    }
}
