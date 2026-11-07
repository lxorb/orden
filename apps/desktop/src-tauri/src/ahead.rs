use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::paths::{config_dir, made, openable, write_atomically};
use crate::spaces::{list_spaces, Space};
use crate::tree::{read_tree, Entry, TreeOptions};

const FILE: &str = "launch.json";

const PATIENCE: Duration = Duration::from_secs(2);

const MOST_NOTES: usize = 24;
const LONGEST_NOTE: u64 = 256 * 1024;
const MOST_BYTES: usize = 1024 * 1024;

const LONGEST_PLAN: u64 = 64 * 1024;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Plan {
    root: Option<String>,
    options: serde_json::Value,
    notes: Vec<String>,
    web: bool,
}

#[derive(Serialize)]
pub struct Answer {
    plan: Plan,
    spaces: Option<Vec<Space>>,
    tree: Option<Entry>,
    notes: BTreeMap<String, String>,
}

enum Reading {
    Idle,
    Busy,
    Ready(Box<Answer>),
    Taken,
}

static READING: Mutex<Reading> = Mutex::new(Reading::Idle);
static READ: Condvar = Condvar::new();

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}

fn planned(app: &AppHandle) -> Option<Plan> {
    let path = file(app).ok()?;
    if std::fs::metadata(&path).ok()?.len() > LONGEST_PLAN {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

pub fn start(app: &AppHandle) -> bool {
    let Some(plan) = planned(app) else {
        return false;
    };
    let web = plan.web;
    if let Ok(mut reading) = READING.lock() {
        *reading = Reading::Busy;
    }

    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("launch ahead".into())
        .spawn(move || {
            let answer = read(&app, plan);
            if let Ok(mut reading) = READING.lock() {
                if matches!(*reading, Reading::Busy) {
                    *reading = Reading::Ready(Box::new(answer));
                }
            }
            READ.notify_all();
        });

    if spawned.is_err() {
        if let Ok(mut reading) = READING.lock() {
            *reading = Reading::Idle;
        }
    }
    web
}

fn read(app: &AppHandle, plan: Plan) -> Answer {
    let spaces = list_spaces(app.clone()).ok();
    crate::trace::mark("read ahead: spaces");

    let tree = plan.root.as_ref().and_then(|root| {
        let options = serde_json::from_value::<TreeOptions>(plan.options.clone()).ok();
        read_tree(app.clone(), root.clone(), options).ok()
    });
    crate::trace::mark("read ahead: tree");

    let notes = notes_of(app, &plan.notes);
    crate::trace::mark(&format!("read ahead: {} notes", notes.len()));

    Answer {
        plan,
        spaces,
        tree,
        notes,
    }
}

fn notes_of(app: &AppHandle, paths: &[String]) -> BTreeMap<String, String> {
    let mut notes = BTreeMap::new();
    let mut bytes = 0;

    for path in paths.iter().take(MOST_NOTES) {
        let Ok(target) = openable(app, path) else {
            continue;
        };
        match std::fs::metadata(&target) {
            Ok(meta) if meta.len() <= LONGEST_NOTE => {}
            _ => continue,
        }
        let Ok(words) = crate::notes::note_words(app, path) else {
            continue;
        };
        if bytes + words.len() > MOST_BYTES {
            break;
        }
        bytes += words.len();
        notes.insert(path.clone(), words);
    }

    notes
}

#[tauri::command]
pub async fn launch_ahead(app: AppHandle) -> Option<Answer> {
    crate::lane::off_the_runtime(move || -> Option<Answer> {
        taken().or_else(|| planned(&app).map(|plan| read(&app, plan)))
    })
    .await
}

fn taken() -> Option<Answer> {
    let reading = READING.lock().ok()?;
    let (mut reading, _) = READ
        .wait_timeout_while(reading, PATIENCE, |now| matches!(now, Reading::Busy))
        .ok()?;

    match std::mem::replace(&mut *reading, Reading::Taken) {
        Reading::Ready(answer) => Some(*answer),
        _ => None,
    }
}

#[tauri::command(async)]
pub fn remember_launch(app: AppHandle, plan: Plan) -> Result<(), String> {
    let bytes = serde_json::to_vec(&plan).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > LONGEST_PLAN {
        return Err("that plan is too long".into());
    }

    let path = file(&app)?;
    if let Some(parent) = path.parent() {
        made(parent)?;
    }
    write_atomically(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::{Plan, LONGEST_PLAN};

    #[test]
    fn a_plan_reads_back_whatever_the_page_left_out() {
        let written = r#"{"root":"C:\\Orden\\Work","options":{"sort":"name","showHidden":false},"notes":["C:\\Orden\\Work\\Plan.md"]}"#;
        let plan: Plan = serde_json::from_str(written).expect("a plan");
        assert_eq!(plan.root.as_deref(), Some("C:\\Orden\\Work"));
        assert_eq!(plan.notes.len(), 1);

        let bare: Plan = serde_json::from_str("{}").expect("an empty plan");
        assert!(bare.root.is_none() && bare.notes.is_empty());

        let more: Plan = serde_json::from_str(r#"{"root":null,"later":1}"#).expect("more");
        assert!(more.root.is_none());
    }

    #[test]
    fn a_plan_of_every_note_a_window_holds_fits_the_bound() {
        let plan = Plan {
            root: Some("C:\\".repeat(100)),
            options: serde_json::json!({ "sort": "modified", "descending": true }),
            notes: vec!["C:\\Users\\somebody\\Documents\\Orden\\Space\\note.md".repeat(4); 24],
            web: true,
        };
        let bytes = serde_json::to_vec(&plan).expect("written");
        assert!((bytes.len() as u64) < LONGEST_PLAN);
    }
}
