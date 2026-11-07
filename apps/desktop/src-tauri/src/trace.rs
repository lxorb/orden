use std::fmt::Write as _;
use std::fs;
use std::io::Write as _;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::clock;
use crate::paths::log_dir;

const SWITCH: &str = "NIB_TRACE_STARTUP";

const FILE: &str = "startup-trace.log";

const MAX_BYTES: u64 = 512 * 1024;

const COLUMN: usize = 34;

static ON: LazyLock<bool> = LazyLock::new(|| {
    std::env::var_os(SWITCH).is_some_and(|value| !value.is_empty() && value != "0")
});

static STARTED: LazyLock<(Instant, u64)> = LazyLock::new(|| (Instant::now(), clock::now()));

static BEFORE: LazyLock<Duration> = LazyLock::new(|| before_main().unwrap_or(Duration::ZERO));

static MARKS: Mutex<Vec<Mark>> = Mutex::new(Vec::new());

struct Mark {
    step: String,
    at: Duration,
    cpu: Option<Duration>,
}

#[derive(serde::Deserialize)]
pub struct Said {
    step: String,
    at: f64,
}

pub fn begin() {
    let _ = *STARTED;
    if *BEFORE > Duration::ZERO {
        push("windows, before our first line", *BEFORE);
    }
    mark("app starting");
}

pub fn on() -> bool {
    *ON
}

pub fn mark(step: &str) {
    push(step, along());
}

fn along() -> Duration {
    BEFORE.saturating_add(STARTED.0.elapsed())
}

pub fn write(app: &AppHandle) {
    if !on() {
        return;
    }

    let Ok(path) = file(app) else { return };
    if fs::metadata(&path).map_or(0, |one| one.len()) > MAX_BYTES {
        let _ = fs::remove_file(&path);
    }

    let written = {
        let Ok(marks) = MARKS.lock() else { return };
        format!("{}{}", page(&marks), line(&marks))
    };
    let Ok(mut out) = fs::OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    let _ = out.write_all(written.as_bytes());
}

fn file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(log_dir(app)?.join(FILE))
}

fn page(marks: &[Mark]) -> String {
    let mut out = format!(
        "\n=== nib {} launched {} ===\n",
        env!("CARGO_PKG_VERSION"),
        STARTED.1
    );

    let mut last = Duration::ZERO;
    let mut spent_by = Duration::ZERO;
    for mark in marks {
        let step = mark.step.chars().take(COLUMN).collect::<String>();
        let since = mark.at.saturating_sub(last);
        let spent = match mark.cpu {
            Some(now) => {
                let over = now.saturating_sub(spent_by);
                spent_by = now;
                format!("{:>8.1} cpu", millis(over))
            }
            None => " ".repeat(12),
        };
        let _ = writeln!(
            out,
            "{step:<COLUMN$} {:>9.1} ms  +{:>8.1} ms  {spent}",
            millis(mark.at),
            millis(since)
        );
        last = mark.at;
    }

    out
}

fn line(marks: &[Mark]) -> String {
    let mut out = format!(
        "{{\"nib\":\"{}\",\"launched\":{},\"steps\":[",
        env!("CARGO_PKG_VERSION"),
        STARTED.1
    );

    for (index, mark) in marks.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }

        let step = mark.step.replace(['\\', '"'], " ");
        let _ = write!(out, "{{\"step\":\"{step}\",\"at\":{:.1}", millis(mark.at));
        if let Some(over) = mark.cpu {
            let _ = write!(out, ",\"cpu\":{:.1}", millis(over));
        }
        out.push('}');
    }

    out.push_str("]}\n");
    out
}

fn millis(span: Duration) -> f64 {
    span.as_secs_f64() * 1000.0
}

fn push(step: &str, at: Duration) {
    push_with(step, at, cpu());
}

fn push_said(step: &str, at: Duration) {
    push_with(step, at, None);
}

fn push_with(step: &str, at: Duration, cpu: Option<Duration>) {
    let Ok(mut marks) = MARKS.lock() else { return };

    let mark = Mark {
        step: step.to_owned(),
        at,
        cpu,
    };
    let place = marks.partition_point(|held| held.at <= mark.at);
    marks.insert(place, mark);
}

#[tauri::command(async)]
pub fn trace_startup(app: AppHandle, origin: f64, steps: Vec<Said>, facts: Option<String>) {
    let shift = offset(origin);
    for said in steps {
        let at = span_of(said.at);
        let at = at.saturating_add(shift).saturating_add(*BEFORE);
        push_said(&format!("window: {}", said.step), at);
    }

    let told = MARKS
        .lock()
        .ok()
        .map(|marks| said(&marks, facts.as_deref()));
    if let Some(told) = told {
        crate::logs::say(&app, "info", &told);
    }
    write(&app);
}

const SAID: [(&str, &str); 7] = [
    ("windows, before our first line", "windows"),
    ("window shown", "window"),
    ("window: page requested", "page"),
    ("window: shell painted", "shell"),
    ("window: first frame painted", "first frame"),
    ("window: active tab painted", "tab"),
    ("window: launch order finished", "done"),
];

fn said(marks: &[Mark], facts: Option<&str>) -> String {
    let mut out = String::from("launch:");
    let mut first = true;
    for (step, word) in SAID {
        let Some(mark) = marks.iter().find(|one| one.step == step) else {
            continue;
        };
        let _ = write!(
            out,
            "{} {word} {:.0}",
            if first { "" } else { "," },
            millis(mark.at)
        );
        first = false;
    }
    out.push_str(" ms");
    if let Some(facts) = facts.map(plain).filter(|one| !one.is_empty()) {
        let _ = write!(out, "; {facts}");
    }
    out
}

fn plain(facts: &str) -> String {
    facts
        .chars()
        .filter(|one| one.is_ascii_alphanumeric() || matches!(one, ' ' | ','))
        .take(160)
        .collect()
}

fn offset(origin: f64) -> Duration {
    if !origin.is_finite() || origin <= 0.0 {
        return Duration::ZERO;
    }

    span_of(origin - millis_since_epoch())
}

fn span_of(millis: f64) -> Duration {
    Duration::try_from_secs_f64(millis.max(0.0) / 1000.0).unwrap_or(Duration::ZERO)
}

fn millis_since_epoch() -> f64 {
    #[allow(
        clippy::cast_precision_loss,
        reason = "a millisecond count this size is exact in an f64 for another 280,000 years"
    )]
    {
        STARTED.1 as f64
    }
}

#[cfg(windows)]
pub(crate) fn cpu() -> Option<Duration> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    const PER_TICK: u32 = 100;

    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();

    #[allow(
        unsafe_code,
        reason = "there is no safe way to ask Windows how much processor this process has had"
    )]
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            std::ptr::from_mut(&mut created),
            std::ptr::from_mut(&mut exited),
            std::ptr::from_mut(&mut kernel),
            std::ptr::from_mut(&mut user),
        )
    }
    .ok()?;

    let ticks =
        |one: FILETIME| (u64::from(one.dwHighDateTime) << 32) | u64::from(one.dwLowDateTime);
    let spent = ticks(kernel).checked_add(ticks(user))?;

    Some(Duration::new(spent / 10_000_000, {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "a remainder under ten million times a hundred is under a second of nanoseconds"
        )]
        {
            (spent % 10_000_000) as u32 * PER_TICK
        }
    }))
}

#[cfg(not(windows))]
pub(crate) fn cpu() -> Option<Duration> {
    None
}

#[cfg(windows)]
fn before_main() -> Option<Duration> {
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    const TO_EPOCH: u64 = 116_444_736_000_000_000;

    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();

    #[allow(
        unsafe_code,
        reason = "there is no safe way to ask Windows when this process was created"
    )]
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            std::ptr::from_mut(&mut created),
            std::ptr::from_mut(&mut exited),
            std::ptr::from_mut(&mut kernel),
            std::ptr::from_mut(&mut user),
        )
    }
    .ok()?;

    let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
    let since = ticks.checked_sub(TO_EPOCH)?;
    let at = UNIX_EPOCH.checked_add(Duration::new(since / 10_000_000, {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "a remainder under ten million times a hundred is under a second of nanoseconds"
        )]
        {
            (since % 10_000_000) as u32 * 100
        }
    }))?;

    SystemTime::now().duration_since(at).ok()
}

#[cfg(not(windows))]
fn before_main() -> Option<Duration> {
    None
}

#[cfg(test)]
mod tests {
    use super::{line, millis, offset, page, push, said, span_of, Mark, COLUMN, MARKS};
    use std::time::Duration;

    fn only(marks: Vec<Mark>) -> String {
        with(marks, page)
    }

    fn only_line(marks: Vec<Mark>) -> String {
        with(marks, line)
    }

    fn with(marks: Vec<Mark>, read: fn(&[Mark]) -> String) -> String {
        let mut held = MARKS.lock().expect("the marks");
        let before = std::mem::replace(&mut *held, marks);
        let written = read(&held);
        *held = before;
        written
    }

    #[test]
    fn a_launch_is_one_line_of_the_log() {
        let at = |step: &str, millis: u64| Mark {
            step: step.to_owned(),
            at: Duration::from_millis(millis),
            cpu: None,
        };
        let marks = vec![
            at("windows, before our first line", 41),
            at("plugins", 60),
            at("window shown", 95),
            at("window: page requested", 310),
            at("window: shell painted", 482),
            at("window: first frame painted", 560),
            at("window: launch order finished", 690),
        ];
        assert_eq!(
            said(&marks, Some("12 spaces, 31 tabs; <b>\n")),
            "launch: windows 41, window 95, page 310, shell 482, first frame 560, done 690 ms; 12 spaces, 31 tabs b"
        );
        assert_eq!(said(&[], None), "launch: ms");
    }

    #[test]
    fn a_duration_reads_as_milliseconds() {
        assert!((millis(Duration::from_millis(1500)) - 1500.0).abs() < 0.001);
        assert!((millis(Duration::ZERO)).abs() < 0.001);
    }

    #[test]
    fn every_step_says_how_long_since_the_one_before_it() {
        let written = only(vec![
            Mark {
                step: "first".to_owned(),
                at: Duration::from_millis(10),
                cpu: None,
            },
            Mark {
                step: "second".to_owned(),
                at: Duration::from_millis(45),
                cpu: None,
            },
        ]);

        assert!(written.contains("first"), "{written}");
        assert!(written.contains("10.0 ms  +    10.0 ms"), "{written}");
        assert!(written.contains("45.0 ms  +    35.0 ms"), "{written}");
    }

    #[test]
    fn a_long_step_name_cannot_push_the_numbers_out_of_line() {
        let written = only(vec![Mark {
            step: "x".repeat(COLUMN * 2),
            at: Duration::ZERO,
            cpu: None,
        }]);

        let line = written
            .lines()
            .find(|one| one.starts_with('x'))
            .expect("the step");
        assert_eq!(line.chars().filter(|one| *one == 'x').count(), COLUMN);
    }

    #[test]
    fn a_step_goes_in_where_it_happened_rather_than_at_the_end() {
        let mut held = MARKS.lock().expect("the marks");
        let before = std::mem::take(&mut *held);
        drop(held);

        push("late", Duration::from_millis(100));
        push("early", Duration::from_millis(5));
        push("between", Duration::from_millis(50));

        let mut held = MARKS.lock().expect("the marks");
        let order: Vec<&str> = held.iter().map(|one| one.step.as_str()).collect();
        assert_eq!(order, vec!["early", "between", "late"]);
        *held = before;
    }

    #[test]
    fn the_line_is_json_a_program_can_read() {
        let written = only_line(vec![
            Mark {
                step: "app starting".to_owned(),
                at: Duration::ZERO,
                cpu: Some(Duration::from_millis(2)),
            },
            Mark {
                step: "window: first frame painted".to_owned(),
                at: Duration::from_millis(400),
                cpu: None,
            },
        ]);

        assert!(written.ends_with("]}\n"), "{written}");
        assert!(
            written.contains(r#""step":"app starting","at":0.0,"cpu":2.0"#),
            "{written}"
        );
        assert!(
            written.contains(r#""step":"window: first frame painted","at":400.0}"#),
            "{written}"
        );
    }

    #[test]
    fn a_quote_in_a_step_name_cannot_break_the_line() {
        let written = only_line(vec![Mark {
            step: "a \"quoted\" step".to_owned(),
            at: Duration::ZERO,
            cpu: None,
        }]);

        assert_eq!(written.matches('"').count() % 2, 0, "{written}");
        assert!(!written.contains('\\'), "{written}");
    }

    #[test]
    fn the_processor_column_is_what_each_step_spent() {
        let written = only(vec![
            Mark {
                step: "first".to_owned(),
                at: Duration::from_millis(10),
                cpu: Some(Duration::from_millis(8)),
            },
            Mark {
                step: "second".to_owned(),
                at: Duration::from_millis(45),
                cpu: Some(Duration::from_millis(30)),
            },
        ]);

        let second = written
            .lines()
            .find(|one| one.starts_with("second"))
            .unwrap_or_default();

        assert!(second.contains("22.0 cpu"), "{written}");
    }

    #[test]
    fn a_count_no_span_can_hold_is_nothing() {
        assert_eq!(span_of(1500.0), Duration::from_millis(1500));
        assert_eq!(span_of(-5.0), Duration::ZERO);
        assert_eq!(span_of(f64::NAN), Duration::ZERO);
        assert_eq!(span_of(f64::MAX), Duration::ZERO);
        assert_eq!(offset(f64::MAX), Duration::ZERO);
    }
}
