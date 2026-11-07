use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf, MAIN_SEPARATOR_STR};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::AppHandle;

use crate::carry::move_whole;
use crate::clock;
use crate::paths::{
    folded, free_spot, in_spaces, inside, is_reserved, made, move_held, move_paper,
    rejoins_highlights, restore_held, spaces_dir, write_atomically, HIGHLIGHTS, TRASH,
};

const MANIFEST: &str = "manifest.json";

const KINDS: [&str; 3] = ["note", "folder", "space"];

static COUNTER: AtomicU64 = AtomicU64::new(0);

static MANIFEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub from: String,
    pub trashed_at: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub apart: bool,
}

#[tauri::command(async)]
pub fn trash_item(
    app: AppHandle,
    path: String,
    kind: String,
    alone: Option<bool>,
) -> Result<TrashEntry, String> {
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("{kind} is not something Orden can delete"));
    }

    let (source, from, name) = placed(&app, &path)?;
    if !source.exists() {
        return Err("nothing is there".into());
    }

    let _guard = locked();
    let dir = trash_dir(&app)?;
    trashed(&dir, &source, from, name, kind, alone == Some(true))
}

fn trashed(
    dir: &Path,
    source: &Path,
    from: String,
    name: String,
    kind: String,
    alone: bool,
) -> Result<TrashEntry, String> {
    let id = new_id();
    let slot = dir.join(&id);
    made(&slot)?;

    let held = slot.join(&name);
    if let Err(error) = move_whole(source, &held, "delete") {
        let _ = fs::remove_dir(&slot);
        return Err(error);
    }

    if alone {
        move_paper(source, &held);
    } else {
        move_held(source, &held);
    }

    let entry = TrashEntry {
        id,
        kind,
        name,
        from,
        trashed_at: clock::now(),
        apart: alone,
    };

    recorded(dir, entry, || {
        if move_whole(&held, source, "restore").is_ok() {
            restore_held(&held, source);
            let _ = fs::remove_dir(&slot);
        }
    })
}

#[tauri::command(async)]
pub fn trash_words(app: AppHandle, path: String, content: String) -> Result<TrashEntry, String> {
    let (_, from, name) = placed(&app, &path)?;
    if !is_name(&name) {
        return Err(format!("{name} is not a name Orden can keep"));
    }

    let _guard = locked();
    let dir = trash_dir(&app)?;
    let id = new_id();
    let slot = dir.join(&id);
    made(&slot)?;

    if let Err(error) = write_atomically(&slot.join(&name), content.as_bytes()) {
        let _ = fs::remove_dir_all(&slot);
        return Err(error);
    }

    let entry = TrashEntry {
        id,
        kind: "note".into(),
        name,
        from,
        trashed_at: clock::now(),
        apart: false,
    };
    recorded(&dir, entry, || {
        let _ = fs::remove_dir_all(&slot);
    })
}

fn placed(app: &AppHandle, path: &str) -> Result<(PathBuf, String, String), String> {
    let base = spaces_dir(app)?;
    let source = in_spaces(app, path)?;
    let (from, name) = manifest_place(&base, &source)?;
    Ok((source, from, name))
}

fn manifest_place(base: &Path, source: &Path) -> Result<(String, String), String> {
    let relative = source
        .strip_prefix(base)
        .map_err(|_| format!("{} is not in the notes folder", source.display()))?;
    if relative.as_os_str().is_empty() {
        return Err("that cannot be deleted".into());
    }
    let from = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");

    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or("that has no name")?;

    Ok((from, name))
}

fn recorded(dir: &Path, entry: TrashEntry, undo: impl FnOnce()) -> Result<TrashEntry, String> {
    let mut entries = read_manifest(dir);
    entries.push(entry.clone());

    if let Err(error) = write_manifest(dir, &entries) {
        undo();
        return Err(error);
    }

    Ok(entry)
}

pub fn space_renamed(app: &AppHandle, from: &Path, to: &Path) {
    let (Some(from), Some(to)) = (from.file_name(), to.file_name()) else {
        return;
    };
    let _guard = locked();
    let moved = trash_dir(app)
        .and_then(|dir| follows(&dir, &from.to_string_lossy(), &to.to_string_lossy()));
    if let Err(error) = moved {
        eprintln!("orden: the trash did not follow a space's new name: {error}");
    }
}

fn follows(dir: &Path, from: &str, to: &str) -> Result<(), String> {
    let inside = format!("{from}/");
    let mut entries = read_manifest(dir);
    let mut moved = false;
    let gone = entries
        .iter()
        .filter(|entry| entry.kind == "space" && entry.from == from)
        .map(|entry| entry.trashed_at)
        .max();
    for entry in &mut entries {
        if gone.is_some_and(|gone| entry.trashed_at <= gone) {
            continue;
        }
        if let Some(rest) = entry.from.strip_prefix(&inside) {
            entry.from = format!("{to}/{rest}");
            moved = true;
        }
    }
    if moved {
        write_manifest(dir, &entries)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn list_trash(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.trashed_at));
    Ok(entries)
}

#[tauri::command(async)]
pub fn restore_trash(app: AppHandle, id: String) -> Result<String, String> {
    let base = spaces_dir(&app)?;

    let _guard = locked();
    let dir = trash_dir(&app)?;
    restored(&base, &dir, &id)
}

fn restored(base: &Path, dir: &Path, id: &str) -> Result<String, String> {
    let mut entries = read_manifest(dir);

    let position = entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or("nothing to restore")?;
    let entry = entries[position].clone();

    if !is_slot(&entry.id) {
        return Err("that is not something in the trash".into());
    }
    let slot = dir.join(&entry.id);
    let held = slot.join(&entry.name);
    let target = restore_target(base, &entry)?;
    if !held.exists() {
        entries.remove(position);
        write_manifest(dir, &entries)?;
        return Err("it is already gone".into());
    }

    if let Some(parent) = target.parent() {
        made(parent)?;
    }

    move_whole(&held, &target, "restore")?;
    restore_held(&held, &target);

    match left_in(&slot) {
        None => {
            let _ = fs::remove_dir(&slot);
            entries.remove(position);
        }
        Some(left) => {
            let folder = entry.from.rsplit_once('/').map_or("", |(folder, _)| folder);
            entries[position].from = if folder.is_empty() {
                left.clone()
            } else {
                format!("{folder}/{left}")
            };
            entries[position].name = left;
            entries[position].kind = "note".into();
        }
    }
    write_manifest(dir, &entries)?;
    Ok(target.to_string_lossy().to_string())
}

fn left_in(slot: &Path) -> Option<String> {
    let mut left: Vec<String> = fs::read_dir(slot)
        .ok()?
        .flatten()
        .map(|one| one.file_name().to_string_lossy().into_owned())
        .collect();
    left.sort_by_key(|name| name.ends_with(HIGHLIGHTS));
    left.into_iter().next()
}

#[tauri::command(async)]
pub fn purge_trash(app: AppHandle, id: String) -> Result<(), String> {
    if !is_slot(&id) {
        return Err(format!("{id} is not something in the trash"));
    }

    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    purge(&dir, &mut entries, &id);
    write_manifest(&dir, &entries)
}

#[tauri::command(async)]
pub fn purge_trash_older_than(app: AppHandle, age: u64) -> Result<u32, String> {
    let _guard = locked();
    let dir = trash_dir(&app)?;

    let mut entries = read_manifest(&dir);
    let cutoff = clock::now().saturating_sub(age);

    let old: Vec<String> = entries
        .iter()
        .filter(|entry| entry.trashed_at < cutoff)
        .map(|entry| entry.id.clone())
        .collect();
    for id in &old {
        purge(&dir, &mut entries, id);
    }

    write_manifest(&dir, &entries)?;
    Ok(u32::try_from(old.len()).unwrap_or(u32::MAX))
}

fn trash_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = spaces_dir(app)?.join(TRASH);
    made(&dir)?;
    Ok(dir)
}

fn locked() -> MutexGuard<'static, ()> {
    MANIFEST_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

fn new_id() -> String {
    format!(
        "{}-{}",
        clock::now(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn is_slot(id: &str) -> bool {
    let Some((moment, counter)) = id.split_once('-') else {
        return false;
    };

    !moment.is_empty()
        && !counter.is_empty()
        && moment.len() <= 20
        && counter.len() <= 20
        && moment.bytes().all(|byte| byte.is_ascii_digit())
        && counter.bytes().all(|byte| byte.is_ascii_digit())
}

fn read_manifest(dir: &Path) -> Vec<TrashEntry> {
    let path = dir.join(MANIFEST);
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };

    serde_json::from_str(&text).unwrap_or_else(|_| {
        let _ = fs::rename(&path, dir.join(format!("{MANIFEST}.unreadable")));
        Vec::new()
    })
}

fn write_manifest(dir: &Path, entries: &[TrashEntry]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("could not write down what is in the trash: {error}"))?;
    write_atomically(&dir.join(MANIFEST), text.as_bytes())
}

fn purge(dir: &Path, entries: &mut Vec<TrashEntry>, id: &str) {
    if is_slot(id) {
        let _ = fs::remove_dir_all(dir.join(id));
    }
    entries.retain(|entry| entry.id != id);
}

fn restore_target(base: &Path, entry: &TrashEntry) -> Result<PathBuf, String> {
    if !names_one_entry(&entry.name) {
        return Err("that is not a name Orden stored".into());
    }

    let wanted = folded(&base.join(entry.from.replace('/', MAIN_SEPARATOR_STR)));
    if !inside(base, &wanted) || inside(&base.join(TRASH), &wanted) || wanted == folded(base) {
        return Err("that did not come from the notes folder".into());
    }

    if entry.apart && entry.kind == "note" && rejoins_highlights(&wanted) {
        return Ok(wanted);
    }
    Ok(free_spot(&wanted, entry.kind == "note"))
}

fn names_one_entry(name: &str) -> bool {
    if name.contains('\0') || (cfg!(windows) && name.contains(':')) {
        return false;
    }
    let mut parts = Path::new(name).components();
    matches!(parts.next(), Some(Component::Normal(one)) if one.to_str() == Some(name))
        && parts.next().is_none()
}

fn is_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name.starts_with(' ')
        && !is_reserved(name)
}

#[cfg(test)]
mod tests {
    use super::{
        follows, is_name, is_slot, manifest_place, purge, read_manifest, recorded, restore_target,
        write_manifest, TrashEntry, MANIFEST,
    };
    use std::path::{Path, PathBuf};

    fn entry(id: &str, name: &str, from: &str) -> TrashEntry {
        TrashEntry {
            id: id.into(),
            kind: "note".into(),
            name: name.into(),
            from: from.into(),
            trashed_at: 1_700_000_000_000,
            apart: false,
        }
    }

    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn what_was_deleted_out_of_a_space_follows_its_new_name() {
        let dir = tempfile::tempdir().expect("a folder");
        write_manifest(
            dir.path(),
            &[
                entry("a", "a.md", "Work/a.md"),
                entry("b", "b.md", "Work/deep/b.md"),
                entry("c", "c.md", "Workshop/c.md"),
            ],
        )
        .expect("written");

        follows(dir.path(), "Work", "Job").expect("followed");

        let from: Vec<String> = read_manifest(dir.path())
            .into_iter()
            .map(|one| one.from)
            .collect();
        assert_eq!(from, ["Job/a.md", "Job/deep/b.md", "Workshop/c.md"]);
    }

    #[test]
    fn what_was_deleted_before_its_space_stays_with_that_space() {
        let dir = tempfile::tempdir().expect("a folder");
        let at = |one: TrashEntry, when: u64, kind: &str| TrashEntry {
            trashed_at: when,
            kind: kind.into(),
            ..one
        };
        write_manifest(
            dir.path(),
            &[
                at(entry("a", "old.md", "Work/old.md"), 1, "note"),
                at(entry("b", "Work", "Work"), 2, "space"),
                at(entry("c", "new.md", "Work/new.md"), 3, "note"),
            ],
        )
        .expect("written");

        follows(dir.path(), "Work", "Job").expect("followed");

        let from: Vec<String> = read_manifest(dir.path())
            .into_iter()
            .map(|one| one.from)
            .collect();
        assert_eq!(from, ["Work/old.md", "Work", "Job/new.md"]);
    }

    #[test]
    fn only_a_folder_the_trash_named_itself_is_one() {
        assert!(is_slot("1700000000000-0"));
        assert!(is_slot("1-42"));
        assert!(!is_slot(".."));
        assert!(!is_slot("../.."));
        assert!(!is_slot("1700000000000"));
        assert!(!is_slot("a-0"));
        assert!(!is_slot("1--0"));
        assert!(!is_slot(""));
        assert!(!is_slot("-0"));
        assert!(!is_slot("1-"));
    }

    #[test]
    fn purging_cannot_reach_outside_the_trash() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let trash = dir.path().join("Orden").join(".trash");
        let elsewhere = dir.path().join("Orden").join("Notes");
        std::fs::create_dir_all(&trash).expect("the trash");
        std::fs::create_dir_all(&elsewhere).expect("a space beside it");
        std::fs::write(elsewhere.join("Idea.md"), "mine").expect("a note in it");

        let mut entries = Vec::new();
        for id in ["../Notes", "..", r"..\Notes"] {
            purge(&trash, &mut entries, id);
        }

        assert!(
            elsewhere.join("Idea.md").exists(),
            "the note is still there"
        );
        assert!(elsewhere.exists(), "and so is the space");
    }

    #[test]
    fn a_stored_name_is_a_name_and_not_a_path() {
        assert!(is_name("Idea.md"));
        assert!(is_name("Notizen über Bücher.md"));
        assert!(!is_name(""));
        assert!(!is_name("."));
        assert!(!is_name(".."));
        assert!(!is_name("Work/Idea.md"));
        assert!(!is_name(r"..\Idea.md"));
        assert!(!is_name("/Idea.md"));
        assert!(!is_name("C:"));
        assert!(!is_name(r"C:\Notes\Idea.md"));
        assert!(!is_name("Idea.md:stream"));
        assert!(!is_name("Idea.md "));
        assert!(!is_name("Idea.md."));
        assert!(!is_name(" Idea.md"));
        assert!(!is_name("NUL"));
        assert!(!is_name("nul.md"));
        assert!(!is_name("COM1.md"));
        assert!(is_name("Console.md"));
        assert!(is_name("nullable.md"));
        assert!(!is_name("Idea\0.md"));
    }

    #[test]
    fn a_hidden_note_is_still_a_name() {
        assert!(is_name(".secret.md"));
        assert!(is_name(".gitignore"));

        let base = path(&["Documents", "Orden"]);
        assert_eq!(
            restore_target(&base, &entry("1-0", ".secret.md", "Work/.secret.md")),
            Ok(base.join("Work").join(".secret.md"))
        );
    }

    #[test]
    fn restoring_lands_back_inside_the_notes_folder() {
        let base = path(&["Documents", "Orden"]);

        assert_eq!(
            restore_target(&base, &entry("1-0", "Idea.md", "Work/Idea.md")),
            Ok(base.join("Work").join("Idea.md"))
        );
        assert!(restore_target(&base, &entry("1-0", "Idea.md", "../Idea.md")).is_err());
        assert!(restore_target(&base, &entry("1-0", "Idea.md", "../../../../etc/passwd")).is_err());
        assert!(restore_target(&base, &entry("1-0", "Idea.md", ".trash/1-0/Idea.md")).is_err());
        assert!(restore_target(&base, &entry("1-0", "Idea.md", "")).is_err());
        assert!(restore_target(&base, &entry("1-0", "../../Idea.md", "Idea.md")).is_err());
    }

    #[test]
    fn a_restore_takes_back_any_name_the_trash_took() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();

        let mut names = vec![" Lead.md"];
        if cfg!(unix) {
            names.extend([
                "aux.md",
                "con.md",
                "Q3:Q4 plan.md",
                r"back\slash.md",
                "Trail.",
                "Trail ",
            ]);
        }
        for name in names {
            assert_eq!(
                restore_target(base, &entry("1-0", name, name)),
                Ok(base.join(name)),
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_name_with_a_backslash_comes_back_under_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        let source = base.join(r"Q\4").join(r"back\slash.md");

        let (from, name) = manifest_place(base, &source).expect("placed");
        assert_eq!(from, r"Q\4/back\slash.md");
        assert_eq!(name, r"back\slash.md");
        assert_eq!(
            restore_target(base, &entry("1-0", &name, &from)),
            Ok(base.join(r"Q\4").join(r"back\slash.md"))
        );
    }

    #[test]
    fn a_place_is_written_with_slashes() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        let (from, name) =
            manifest_place(base, &base.join("Work").join("Idea.md")).expect("placed");
        assert_eq!((from.as_str(), name.as_str()), ("Work/Idea.md", "Idea.md"));
        assert!(manifest_place(base, base).is_err());
    }

    #[test]
    fn a_folder_of_a_page_notes_name_restores_beside_a_pdf_of_its_papers_name() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        std::fs::write(base.join("Report.pages.pdf"), b"%PDF mine").expect("a PDF");
        let mut folder = entry("1-0", "Report.pages", "Report.pages");
        folder.kind = "folder".into();

        assert_eq!(restore_target(base, &folder), Ok(base.join("Report.pages")));
    }

    #[test]
    fn a_restore_numbers_a_name_whose_place_is_taken() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        std::fs::write(base.join("Idea.md"), "the one that stayed").expect("a note");

        let target = restore_target(base, &entry("1-0", "Idea.md", "Idea.md")).expect("a place");
        assert_eq!(target, base.join("Idea 2.md"));
        assert!(Path::new(&target).parent().is_some());
    }

    #[test]
    fn a_page_note_restores_beside_a_pdf_of_its_papers_name() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        std::fs::write(base.join("Report.pages.pdf"), b"%PDF mine").expect("somebody's PDF");

        let target =
            restore_target(base, &entry("1-0", "Report.pages", "Report.pages")).expect("a place");
        assert_eq!(target, base.join("Report 2.pages"));
    }

    #[test]
    fn a_pdf_restores_beside_a_page_note_of_its_name() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let base = dir.path();
        std::fs::write(base.join("Report.pages"), "{}").expect("a page note");

        let target = restore_target(base, &entry("1-0", "Report.pages.pdf", "Report.pages.pdf"))
            .expect("a place");
        assert_eq!(target, base.join("Report.pages 2.pdf"));
    }

    #[test]
    fn a_recorded_entry_joins_the_manifest() {
        let dir = tempfile::tempdir().expect("a temp folder");
        write_manifest(dir.path(), &[entry("1-0", "Idea.md", "Work/Idea.md")]).expect("one");

        let mut undone = false;
        let kept = recorded(dir.path(), entry("1-1", "Plan.md", "Work/Plan.md"), || {
            undone = true;
        })
        .expect("recorded");

        assert_eq!(kept.name, "Plan.md");
        assert!(!undone);
        let read = read_manifest(dir.path());
        assert_eq!(read.len(), 2);
        assert_eq!(read[1].from, "Work/Plan.md");
    }

    #[test]
    fn a_manifest_survives_the_round_trip() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let written = vec![
            entry("1-0", "Idea.md", "Work/Idea.md"),
            entry(
                "1-1",
                "Notizen über Bücher.md",
                "Privat/Notizen über Bücher.md",
            ),
        ];

        write_manifest(dir.path(), &written).expect("the manifest");
        let read = read_manifest(dir.path());

        assert_eq!(read.len(), 2);
        assert_eq!(read[1].name, "Notizen über Bücher.md");
        assert_eq!(read[1].from, "Privat/Notizen über Bücher.md");
        assert_eq!(read[0].trashed_at, 1_700_000_000_000);
    }

    #[test]
    fn the_manifest_is_the_camel_case_the_window_reads() {
        let dir = tempfile::tempdir().expect("a temp folder");
        write_manifest(dir.path(), &[entry("1-0", "Idea.md", "Idea.md")]).expect("the manifest");

        let text = std::fs::read_to_string(dir.path().join(MANIFEST)).expect("the file");
        assert!(text.contains("\"trashedAt\""));
        assert!(!text.contains("trashed_at"));
    }

    #[test]
    fn nothing_written_yet_reads_as_an_empty_trash() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert!(read_manifest(dir.path()).is_empty());
    }

    #[test]
    fn a_manifest_that_cannot_be_read_is_kept_rather_than_lost() {
        let dir = tempfile::tempdir().expect("a temp folder");
        std::fs::write(dir.path().join(MANIFEST), "{ not json").expect("a broken manifest");

        assert!(read_manifest(dir.path()).is_empty());
        assert!(dir.path().join("manifest.json.unreadable").exists());
    }

    fn a_space() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temp folder");
        for (name, words) in [
            ("X.pdf", "%PDF"),
            ("X.pdf.highlights.json", "{}"),
            ("L.pages", "{}"),
            ("L.pages.pdf", "%PDF"),
            ("L.pages.pdf.highlights.json", "{}"),
        ] {
            std::fs::write(dir.path().join(name), words).expect("a file");
        }
        std::fs::create_dir(dir.path().join(".trash")).expect("the trash");
        dir
    }

    fn trash(dir: &Path, name: &str, alone: bool) -> String {
        super::trashed(
            &dir.join(".trash"),
            &dir.join(name),
            name.into(),
            name.into(),
            "note".into(),
            alone,
        )
        .expect("deleted")
        .id
    }

    fn restore(dir: &Path, id: &str) -> String {
        super::restored(dir, &dir.join(".trash"), id).expect("restored")
    }

    #[test]
    fn a_pdf_deleted_alone_leaves_its_highlights() {
        let dir = a_space();
        trash(dir.path(), "X.pdf", true);

        assert!(!dir.path().join("X.pdf").exists());
        assert!(dir.path().join("X.pdf.highlights.json").exists());
    }

    #[test]
    fn a_page_note_deleted_alone_takes_its_paper() {
        let dir = a_space();
        trash(dir.path(), "L.pages", true);

        assert!(!dir.path().join("L.pages").exists());
        assert!(!dir.path().join("L.pages.pdf").exists());
        assert!(dir.path().join("L.pages.pdf.highlights.json").exists());
    }

    #[test]
    fn a_file_deleted_by_hand_takes_what_it_holds() {
        let dir = a_space();
        trash(dir.path(), "X.pdf", false);
        trash(dir.path(), "L.pages", false);

        for name in [
            "X.pdf.highlights.json",
            "L.pages.pdf",
            "L.pages.pdf.highlights.json",
        ] {
            assert!(!dir.path().join(name).exists(), "{name}");
        }
    }

    #[test]
    fn a_page_note_restored_after_its_papers_highlights_keeps_them() {
        let dir = a_space();
        let note = trash(dir.path(), "L.pages", true);
        let highlights = trash(dir.path(), "L.pages.pdf.highlights.json", true);

        restore(dir.path(), &highlights);
        restore(dir.path(), &note);

        for name in ["L.pages", "L.pages.pdf", "L.pages.pdf.highlights.json"] {
            assert!(dir.path().join(name).exists(), "{name}");
        }
    }

    #[test]
    fn a_pdf_restored_after_its_highlights_rejoins_them() {
        let dir = a_space();
        let pdf = trash(dir.path(), "X.pdf", true);
        let highlights = trash(dir.path(), "X.pdf.highlights.json", true);

        restore(dir.path(), &highlights);
        let back = restore(dir.path(), &pdf);

        assert_eq!(Path::new(&back), dir.path().join("X.pdf"));
        assert!(dir.path().join("X.pdf.highlights.json").exists());
    }

    #[test]
    fn a_pdf_restored_before_its_highlights_is_joined_by_them() {
        let dir = a_space();
        let pdf = trash(dir.path(), "X.pdf", true);
        let highlights = trash(dir.path(), "X.pdf.highlights.json", true);

        restore(dir.path(), &pdf);
        restore(dir.path(), &highlights);

        assert!(dir.path().join("X.pdf").exists());
        assert!(dir.path().join("X.pdf.highlights.json").exists());
    }
}
