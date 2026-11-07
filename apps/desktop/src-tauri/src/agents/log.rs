use std::cell::Cell;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager as _};

const KEPT_DAYS: u64 = 30;

const MOST_SAID: usize = 1_000;

#[derive(Serialize)]
pub struct Line<'a> {
    pub at: u64,
    pub agent: &'a str,
    pub verb: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab: Option<&'a str>,
    pub args: Value,
    pub status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Value>,
    pub ms: u64,
}

thread_local! {
    static SENSITIVE: Cell<bool> = const { Cell::new(false) };
}

static SWEPT: Mutex<Option<String>> = Mutex::new(None);

pub fn sensitive() {
    SENSITIVE.set(true);
}

pub fn write(app: &AppHandle, mut line: Line<'_>) {
    if SENSITIVE.replace(false) {
        line.args = redacted(line.args);
    }
    line.args = shortened(line.args);
    let Ok(folder) = folder(app) else {
        return;
    };
    let day = date(line.at);
    let fresh_day = {
        let mut swept = SWEPT.lock().unwrap_or_else(PoisonError::into_inner);
        let fresh = swept.as_deref() != Some(day.as_str());
        *swept = Some(day.clone());
        fresh
    };
    if fresh_day {
        sweep(&folder, line.at);
    }
    let Ok(text) = serde_json::to_string(&line) else {
        return;
    };
    let path = folder.join(format!("{day}.jsonl"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{text}");
    }
}

pub fn read_day(app: &AppHandle, day: &str) -> Vec<Value> {
    let Some(path) = is_day(day)
        .then(|| folder(app).ok())
        .flatten()
        .map(|folder| folder.join(format!("{day}.jsonl")))
    else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .map(shortened)
        .collect()
}

fn shortened(value: Value) -> Value {
    match value {
        Value::String(said) => match said.char_indices().nth(MOST_SAID) {
            Some((cut, _)) => {
                let count = said.chars().count();
                Value::String(format!("{}… ({count} characters)", &said[..cut]))
            }
            None => Value::String(said),
        },
        Value::Array(all) => Value::Array(all.into_iter().map(shortened).collect()),
        Value::Object(all) => Value::Object(
            all.into_iter()
                .map(|(key, one)| (key, shortened(one)))
                .collect(),
        ),
        other => other,
    }
}

pub fn days(app: &AppHandle) -> Vec<String> {
    folder(app)
        .map(|folder| days_in(&folder))
        .unwrap_or_default()
}

fn days_in(folder: &Path) -> Vec<String> {
    let mut days: Vec<String> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.strip_suffix(".jsonl")
                .filter(|day| is_day(day))
                .map(str::to_string)
        })
        .collect();
    days.sort_unstable_by(|one, other| other.cmp(one));
    days
}

pub fn clear(app: &AppHandle, agent: Option<&str>) -> Result<(), String> {
    clear_in(&folder(app)?, agent)
}

fn clear_in(folder: &Path, agent: Option<&str>) -> Result<(), String> {
    for day in days_in(folder) {
        let path = folder.join(format!("{day}.jsonl"));
        let text = if agent.is_some() {
            fs::read_to_string(&path).unwrap_or_default()
        } else {
            String::new()
        };
        let kept: Vec<&str> = agent.map_or_else(Vec::new, |agent| {
            text.lines()
                .filter(|line| !written_by(line, agent))
                .collect()
        });
        let done = if kept.is_empty() {
            fs::remove_file(&path)
        } else {
            fs::write(&path, format!("{}\n", kept.join("\n")))
        };
        done.map_err(|error| format!("could not clear the log: {error}"))?;
    }
    Ok(())
}

fn written_by(line: &str, agent: &str) -> bool {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|value| value.get("agent")?.as_str().map(|one| one == agent))
        .unwrap_or(false)
}

fn is_day(day: &str) -> bool {
    day.len() == 10 && day.bytes().all(|one| one.is_ascii_digit() || one == b'-')
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("agents")
        .join("log");
    crate::paths::made(&dir)?;
    Ok(dir)
}

fn redacted(mut args: Value) -> Value {
    if let Some(text) = args.get_mut("text") {
        let count = text.as_str().map_or(0, |one| one.chars().count());
        *text = Value::String(format!("({count} characters, not kept)"));
    }
    if let Some(fields) = args.get_mut("fields").and_then(Value::as_array_mut) {
        for field in fields {
            if let Some(value) = field.get_mut("value") {
                *value = Value::String("(not kept)".into());
            }
        }
    }
    args
}

fn sweep(folder: &Path, now: u64) {
    let oldest = date(now.saturating_sub(KEPT_DAYS * 24 * 60 * 60 * 1000));
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(day) = name.strip_suffix(".jsonl") {
            if day.len() == 10 && day < oldest.as_str() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

pub fn date(ms: u64) -> String {
    let days = i64::try_from(ms / 86_400_000).unwrap_or(0);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_long_word_is_kept_short_wherever_it_is_said() {
        let long = "ü".repeat(MOST_SAID + 5);
        let kept = shortened(json!({
            "path": "Notes/a.md",
            "text": long,
            "edits": [{ "insert_after": long }],
            "count": 3,
        }));
        let cut = format!("{}… ({} characters)", "ü".repeat(MOST_SAID), MOST_SAID + 5);
        assert_eq!(kept["path"], "Notes/a.md");
        assert_eq!(kept["text"], cut.as_str());
        assert_eq!(kept["edits"][0]["insert_after"], cut.as_str());
        assert_eq!(kept["count"], 3);
        assert_eq!(shortened(json!("short")), json!("short"));
    }

    #[test]
    fn a_day_is_its_utc_date() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(951_782_400_000), "2000-02-29");
        assert_eq!(date(1_790_726_400_000), "2026-09-30");
        assert_eq!(date(1_790_812_799_999), "2026-09-30");
        assert_eq!(date(1_790_812_800_000), "2026-10-01");
    }

    #[test]
    fn typed_words_in_a_sensitive_field_are_counted_not_kept() {
        let args = redacted(json!({ "tab": "a1", "ref": "e4", "text": "4242424242424242" }));
        assert_eq!(args["text"], "(16 characters, not kept)");
        assert_eq!(args["ref"], "e4");
        let form = redacted(json!({ "fields": [{ "ref": "e1", "value": "123" }] }));
        assert_eq!(form["fields"][0]["value"], "(not kept)");
    }

    #[test]
    fn the_days_are_the_files_newest_first() {
        let folder = tempfile::tempdir().expect("folder");
        for name in [
            "2026-09-29.jsonl",
            "2026-09-30.jsonl",
            "notes.txt",
            "x.jsonl",
        ] {
            fs::write(folder.path().join(name), "{}\n").expect("write");
        }
        assert_eq!(days_in(folder.path()), ["2026-09-30", "2026-09-29"]);
        assert!(days_in(&folder.path().join("missing")).is_empty());
    }

    #[test]
    fn clearing_one_agent_keeps_everybody_else() {
        let folder = tempfile::tempdir().expect("folder");
        let day = |name: &str| folder.path().join(format!("{name}.jsonl"));
        fs::write(
            day("2026-09-29"),
            "{\"agent\":\"a\",\"verb\":\"read_note\"}\n{\"agent\":\"b\",\"verb\":\"read_note\"}\nnot json\n",
        )
        .expect("write");
        fs::write(
            day("2026-09-30"),
            "{\"agent\":\"a\",\"verb\":\"browser_open\"}\n",
        )
        .expect("write");

        clear_in(folder.path(), Some("a")).expect("clear");
        assert_eq!(
            fs::read_to_string(day("2026-09-29")).expect("read"),
            "{\"agent\":\"b\",\"verb\":\"read_note\"}\nnot json\n"
        );
        assert!(!day("2026-09-30").exists());

        clear_in(folder.path(), None).expect("clear all");
        assert!(days_in(folder.path()).is_empty());
    }

    #[test]
    fn thirty_days_are_kept_and_nothing_older() {
        let folder = tempfile::tempdir().expect("folder");
        let now = 1_790_726_400_000;
        for day in ["2026-08-30", "2026-08-31", "2026-09-29", "2026-09-30"] {
            fs::write(folder.path().join(format!("{day}.jsonl")), "{}\n").expect("write");
        }
        fs::write(folder.path().join("notes.txt"), "x").expect("write");
        sweep(folder.path(), now);
        let mut left: Vec<String> = fs::read_dir(folder.path())
            .expect("read")
            .flatten()
            .map(|one| one.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                "2026-08-31.jsonl",
                "2026-09-29.jsonl",
                "2026-09-30.jsonl",
                "notes.txt"
            ]
        );
    }
}
