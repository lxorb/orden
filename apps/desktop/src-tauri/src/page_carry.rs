use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

const FOLDER: &str = "carried";

const KEPT: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Carried {
    pub(crate) files: Vec<PathBuf>,
    pub(crate) text: Option<String>,
    pub(crate) addresses: Vec<String>,
    folder: Option<PathBuf>,
    taken: bool,
}

static CARRYING: Mutex<Option<Carried>> = Mutex::new(None);

pub(crate) fn carrying() -> Option<Carried> {
    CARRYING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

pub(crate) fn taken() {
    if let Some(carried) = CARRYING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        carried.taken = true;
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|cache| cache.join(FOLDER))
        .map_err(|error| format!("there is no folder to carry files in: {error}"))
}

pub fn forget_carried(app: &AppHandle) {
    if let Ok(root) = root(app) {
        let _ = std::fs::remove_dir_all(root);
    }
}

fn is_address(said: &str) -> bool {
    tauri::Url::parse(said).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn free_name(taken: &mut HashSet<OsString>, name: &Path) -> OsString {
    let stem = name.file_stem().unwrap_or_default().to_string_lossy();
    let extension = name
        .extension()
        .map(|one| format!(".{}", one.to_string_lossy()))
        .unwrap_or_default();
    let mut tried = name.as_os_str().to_os_string();
    let mut number = 2;
    while !taken.insert(tried.to_ascii_lowercase()) {
        tried = OsString::from(format!("{stem} {number}{extension}"));
        number += 1;
    }
    tried
}

fn prune(root: &Path, now: SystemTime) {
    let Ok(folders) = std::fs::read_dir(root) else {
        return;
    };
    for folder in folders.flatten() {
        let old = folder
            .metadata()
            .and_then(|about| about.modified())
            .is_ok_and(|made| now.duration_since(made).unwrap_or_default() > KEPT);
        if old {
            let _ = std::fs::remove_dir_all(folder.path());
        }
    }
}

fn made_in(
    root: &Path,
    sources: &[PathBuf],
    addresses: Vec<String>,
    now: SystemTime,
) -> Result<Option<Carried>, String> {
    prune(root, now);
    let sources: Vec<&PathBuf> = sources.iter().filter(|one| one.is_file()).collect();
    if sources.is_empty() && addresses.is_empty() {
        return Ok(None);
    }
    let stamp = now
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let folder = root.join(stamp.to_string());
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("there is no folder to carry files in: {error}"))?;
    let mut names = HashSet::new();
    let mut files = Vec::new();
    let mut words = Vec::new();
    for source in sources {
        let Some(name) = source.file_name() else {
            continue;
        };
        let into = folder.join(free_name(&mut names, Path::new(name)));
        std::fs::copy(source, &into)
            .map_err(|error| format!("{} could not be carried: {error}", source.display()))?;
        if is_note(source) {
            if let Ok(text) = std::fs::read_to_string(&into) {
                words.push(text);
            }
        }
        files.push(into);
    }
    words.extend(addresses.iter().cloned());
    Ok(Some(Carried {
        files,
        text: (!words.is_empty()).then(|| words.join("\n\n")),
        addresses,
        folder: Some(folder),
        taken: false,
    }))
}

fn drop_untaken(carried: Option<Carried>) {
    if let Some(Carried {
        folder: Some(folder),
        taken: false,
        ..
    }) = carried
    {
        let _ = std::fs::remove_dir_all(folder);
    }
}

#[tauri::command]
pub async fn page_carry(
    app: AppHandle,
    files: Vec<String>,
    addresses: Vec<String>,
) -> Result<bool, String> {
    let root = root(&app)?;
    let sources = files
        .iter()
        .map(|path| {
            crate::paths::in_spaces(&app, path).or_else(|_| crate::explorer::shown(&app, path))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let addresses: Vec<String> = addresses
        .into_iter()
        .filter(|one| is_address(one))
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let made = made_in(&root, &sources, addresses, SystemTime::now())?;
        drop_untaken(std::mem::replace(
            &mut *CARRYING.lock().unwrap_or_else(PoisonError::into_inner),
            made,
        ));
        Ok(true)
    })
    .await
    .map_err(|error| format!("the files could not be carried: {error}"))?
}

#[tauri::command]
pub async fn page_carry_end() {
    let carried = CARRYING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    crate::lane::off_the_runtime(move || {
        shown::forget();
        drop_untaken(carried);
    })
    .await;
}

mod shown {
    use std::sync::{Mutex, PoisonError};
    use std::time::Duration;

    use serde_json::{json, Value};

    use super::Carried;

    const PATIENCE: Duration = Duration::from_secs(2);

    static OVER: Mutex<Option<String>> = Mutex::new(None);

    pub(super) fn forget() {
        *OVER.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    pub(super) fn data_of(carried: &Carried) -> Value {
        let mut items = Vec::new();
        if let Some(text) = &carried.text {
            items.push(json!({ "mimeType": "text/plain", "data": text }));
        }
        if !carried.addresses.is_empty() {
            items.push(
                json!({ "mimeType": "text/uri-list", "data": carried.addresses.join("\r\n") }),
            );
        }
        let files: Vec<String> = carried
            .files
            .iter()
            .map(|one| one.to_string_lossy().into_owned())
            .collect();
        json!({ "items": items, "files": files, "dragOperationsMask": 1 })
    }

    pub(super) fn steps(was: Option<&str>, tab: &str, phase: &str) -> Vec<&'static str> {
        let entered = was == Some(tab);
        match phase {
            "over" if entered => vec!["dragOver"],
            "over" => vec!["dragEnter", "dragOver"],
            "drop" if entered => vec!["dragOver", "drop"],
            "drop" => vec!["dragEnter", "dragOver", "drop"],
            "leave" if entered => vec!["dragCancel"],
            _ => Vec::new(),
        }
    }

    pub(super) fn tell(
        view: &tauri::Webview,
        tab: &str,
        carried: &Carried,
        phase: &str,
        x: f64,
        y: f64,
    ) -> Result<bool, String> {
        let mut over = OVER.lock().unwrap_or_else(PoisonError::into_inner);
        let steps = steps(over.as_deref(), tab, phase);
        *over = (phase == "over").then(|| tab.to_string());
        let data = data_of(carried);
        for step in &steps {
            crate::engine::devtools::call(
                view,
                None,
                "Input.dispatchDragEvent",
                &json!({ "type": step, "x": x, "y": y, "data": data }),
                PATIENCE,
            )?;
        }
        Ok(steps.contains(&"drop"))
    }
}

#[tauri::command]
pub async fn page_carry_over(
    app: AppHandle,
    tab: String,
    phase: String,
    x: f64,
    y: f64,
) -> Result<bool, String> {
    let Some(carried) = carrying() else {
        return Ok(false);
    };
    let view = crate::web_tabs::found(&app, &tab)?;
    let dropped = tauri::async_runtime::spawn_blocking(move || {
        shown::tell(&view, &tab, &carried, &phase, x, y)
    })
    .await
    .map_err(|error| format!("the page was not told of the drag: {error}"))??;
    if dropped {
        taken();
    }
    Ok(dropped)
}

#[cfg(test)]
mod tests {
    use super::{drop_untaken, free_name, is_address, made_in, prune, KEPT};
    use std::collections::HashSet;
    use std::path::Path;
    use std::time::{Duration, SystemTime};

    fn carry_room(name: &str) -> std::path::PathBuf {
        let at = std::env::temp_dir().join(format!("orden-carry-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&at);
        std::fs::create_dir_all(&at).expect("a folder");
        at
    }

    #[test]
    fn a_note_is_carried_as_a_copy_of_its_file_with_its_words_beside() {
        let space = carry_room("space");
        let root = carry_room("root");
        let note = space.join("Idea.md");
        std::fs::write(&note, "# Idea\n\nwords").expect("the note");
        let paper = space.join("Paper.pdf");
        std::fs::write(&paper, b"%PDF-1.4").expect("the PDF");

        let carried = made_in(&root, &[note.clone(), paper], Vec::new(), SystemTime::now())
            .expect("carried")
            .expect("something");

        let names: Vec<_> = carried
            .files
            .iter()
            .map(|one| one.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["Idea.md", "Paper.pdf"]);
        assert!(carried.files.iter().all(|one| one.starts_with(&root)));
        assert_eq!(
            std::fs::read_to_string(&carried.files[0]).unwrap(),
            "# Idea\n\nwords"
        );
        assert_eq!(carried.text.as_deref(), Some("# Idea\n\nwords"));
        assert!(note.is_file());
    }

    #[test]
    fn two_files_of_one_name_are_both_carried() {
        let space = carry_room("twice");
        let root = carry_room("twice-root");
        std::fs::create_dir_all(space.join("a")).unwrap();
        std::fs::create_dir_all(space.join("b")).unwrap();
        std::fs::write(space.join("a/Idea.md"), "one").unwrap();
        std::fs::write(space.join("b/Idea.md"), "two").unwrap();

        let carried = made_in(
            &root,
            &[space.join("a/Idea.md"), space.join("b/Idea.md")],
            Vec::new(),
            SystemTime::now(),
        )
        .unwrap()
        .unwrap();

        let names: Vec<_> = carried
            .files
            .iter()
            .map(|one| one.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["Idea.md", "Idea 2.md"]);
        assert_eq!(carried.text.as_deref(), Some("one\n\ntwo"));
    }

    #[test]
    fn a_free_name_counts_up_past_every_name_taken() {
        let mut taken = HashSet::new();
        assert_eq!(free_name(&mut taken, Path::new("a.md")), "a.md");
        assert_eq!(free_name(&mut taken, Path::new("A.md")), "A 2.md");
        assert_eq!(free_name(&mut taken, Path::new("a.md")), "a 3.md");
        assert_eq!(free_name(&mut taken, Path::new("Makefile")), "Makefile");
    }

    #[test]
    fn a_web_note_is_carried_as_its_address_and_no_file() {
        let root = carry_room("web");
        let carried = made_in(
            &root,
            &[],
            vec!["https://example.com/".into()],
            SystemTime::now(),
        )
        .unwrap()
        .unwrap();

        assert!(carried.files.is_empty());
        assert_eq!(carried.text.as_deref(), Some("https://example.com/"));
        assert_eq!(carried.addresses, ["https://example.com/"]);
    }

    #[test]
    fn nothing_to_carry_is_no_carrying() {
        let root = carry_room("none");
        let space = carry_room("none-space");
        assert_eq!(
            made_in(
                &root,
                std::slice::from_ref(&space),
                Vec::new(),
                SystemTime::now()
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn only_a_page_s_address_is_an_address() {
        assert!(is_address("https://example.com/a"));
        assert!(is_address("http://localhost:8080/"));
        assert!(!is_address("file:///etc/passwd"));
        assert!(!is_address("javascript:alert(1)"));
        assert!(!is_address("words"));
    }

    #[test]
    fn files_no_page_took_are_gone_at_the_drag_s_end_and_taken_ones_stay() {
        let space = carry_room("end");
        let root = carry_room("end-root");
        std::fs::write(space.join("Idea.md"), "x").unwrap();

        let left = made_in(
            &root,
            &[space.join("Idea.md")],
            Vec::new(),
            SystemTime::now(),
        )
        .unwrap()
        .unwrap();
        let folder_left = left.files[0].parent().unwrap().to_path_buf();
        drop_untaken(Some(left));
        assert!(!folder_left.exists());

        let mut dropped = made_in(
            &root,
            &[space.join("Idea.md")],
            Vec::new(),
            SystemTime::now(),
        )
        .unwrap()
        .unwrap();
        dropped.taken = true;
        let folder_dropped = dropped.files[0].parent().unwrap().to_path_buf();
        drop_untaken(Some(dropped));
        assert!(folder_dropped.is_dir());
    }

    #[test]
    fn carried_files_older_than_a_day_are_cleared() {
        let root = carry_room("prune");
        std::fs::create_dir_all(root.join("old")).unwrap();
        let later = SystemTime::now() + KEPT + Duration::from_secs(60);
        prune(&root, later);
        assert!(!root.join("old").exists());

        std::fs::create_dir_all(root.join("new")).unwrap();
        prune(&root, SystemTime::now());
        assert!(root.join("new").is_dir());
    }

    #[test]
    fn a_page_is_told_the_drag_entered_once_and_its_drop_after_it_moved() {
        use super::shown::steps;
        assert_eq!(steps(None, "a", "over"), ["dragEnter", "dragOver"]);
        assert_eq!(steps(Some("a"), "a", "over"), ["dragOver"]);
        assert_eq!(steps(Some("b"), "a", "over"), ["dragEnter", "dragOver"]);
        assert_eq!(steps(Some("a"), "a", "drop"), ["dragOver", "drop"]);
        assert_eq!(steps(None, "a", "drop"), ["dragEnter", "dragOver", "drop"]);
        assert_eq!(steps(Some("a"), "a", "leave"), ["dragCancel"]);
        assert!(steps(None, "a", "leave").is_empty());
    }

    #[test]
    fn a_page_is_handed_the_file_its_words_and_its_address() {
        use super::shown::data_of;
        use super::Carried;
        let carried = Carried {
            files: vec!["/tmp/c/Idea.md".into()],
            text: Some("words".into()),
            addresses: vec!["https://example.com/".into()],
            ..Carried::default()
        };
        let data = data_of(&carried);
        assert_eq!(data["files"][0], "/tmp/c/Idea.md");
        assert_eq!(data["items"][0]["mimeType"], "text/plain");
        assert_eq!(data["items"][0]["data"], "words");
        assert_eq!(data["items"][1]["mimeType"], "text/uri-list");
        assert_eq!(data["dragOperationsMask"], 1);
    }
}
