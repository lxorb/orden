use std::collections::HashSet;
use std::ffi::OsStr;
use std::fmt::Display;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
#[cfg(desktop)]
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

pub const MARKDOWN: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

pub const TRASH: &str = ".trash";

pub const MAX_DEPTH: usize = 32;

static WRITES: AtomicU64 = AtomicU64::new(0);

pub const HIGHLIGHTS: &str = ".highlights.json";

pub const RESERVED: [&str; 32] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "COM0", "COM1", "COM2", "COM3", "COM4",
    "COM5", "COM6", "COM7", "COM8", "COM9", "COM¹", "COM²", "COM³", "LPT0", "LPT1", "LPT2", "LPT3",
    "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³",
];

pub fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    RESERVED.contains(&stem.to_ascii_uppercase().as_str())
}

pub fn named_for_every_machine(target: &Path) -> Result<(), String> {
    match target.file_name().and_then(OsStr::to_str) {
        Some(name) if is_reserved(name) => Err(format!(
            "{name} is a name Windows keeps for a device, so a note or folder cannot be called it"
        )),
        _ => Ok(()),
    }
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| MARKDOWN.contains(&extension.to_lowercase().as_str()))
}

pub fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

pub fn is_canvas(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("canvas"))
}

pub fn is_pages(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pages"))
}

pub fn is_base(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("base"))
}

pub fn is_chat(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("chat"))
}

pub fn is_term(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("term"))
}

pub fn is_application(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("application"))
}

pub fn is_shortcut(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("url") || extension.eq_ignore_ascii_case("webloc")
        })
}

pub fn highlights_of(pdf: &Path) -> PathBuf {
    let mut name = pdf.file_name().unwrap_or_default().to_os_string();
    name.push(HIGHLIGHTS);
    pdf.with_file_name(name)
}

pub fn paper_of(pages: &Path) -> PathBuf {
    let mut name = pages.file_name().unwrap_or_default().to_os_string();
    name.push(".pdf");
    pages.with_file_name(name)
}

pub fn held_paper(pdf: &Path) -> bool {
    if !is_pdf(pdf) {
        return false;
    }

    paper_holder(pdf).is_some_and(|holder| {
        let paper = paper_of(&holder);
        paper == pdf || crate::notes::same_entry(&paper, pdf)
    })
}

fn paper_holder(pdf: &Path) -> Option<PathBuf> {
    if !is_pdf(pdf) {
        return None;
    }
    let holder = pdf.with_extension("");
    holds_paper(&holder).then_some(holder)
}

fn holds_paper(path: &Path) -> bool {
    is_pages(path) && path.is_file()
}

pub fn taken(path: &Path, is_file: bool) -> bool {
    path.exists()
        || (is_file
            && ((is_pages(path) && paper_of(path).exists())
                || paper_holder(path).is_some()
                || (is_pdf(path) && highlights_of(path).exists())))
}

pub fn paper_in_the_way(
    from: &Path,
    to: &Path,
    same: impl Fn(&Path, &Path) -> bool,
) -> Option<PathBuf> {
    if !is_pages(to) {
        return paper_holder(to);
    }
    if from.is_dir() {
        return None;
    }
    let there = paper_of(to);
    if !there.exists() {
        return None;
    }
    let own = is_pages(from) && {
        let paper = paper_of(from);
        paper == there || (paper.parent() == there.parent() && same(&paper, &there))
    };
    (!own).then_some(there)
}

pub fn move_held(from: &Path, to: &Path) {
    held_moved(from, to, true);
}

pub fn restore_held(from: &Path, to: &Path) {
    held_moved(from, to, false);
}

fn held_moved(from: &Path, to: &Path, clear: bool) {
    if is_pages(from) {
        if move_paper(from, to) {
            held_moved(&paper_of(from), &paper_of(to), clear);
        }
        return;
    }
    if !is_pdf(from) {
        return;
    }

    let source = highlights_of(from);
    if clear {
        let _ = fs::remove_file(highlights_of(to));
    }
    if source.exists() {
        let _ = crate::carry::move_whole(&source, &highlights_of(to), "move");
    }
}

pub fn rejoins_highlights(pdf: &Path) -> bool {
    is_pdf(pdf) && !pdf.exists() && paper_holder(pdf).is_none() && highlights_of(pdf).exists()
}

pub fn move_paper(from: &Path, to: &Path) -> bool {
    if !is_pages(from) || !holds_paper(to) {
        return false;
    }
    let paper = paper_of(from);
    paper.exists()
        && paper_in_the_way(from, to, crate::notes::same_entry).is_none()
        && crate::carry::move_whole(&paper, &paper_of(to), "move").is_ok()
}

pub fn copy_held(from: &Path, to: &Path) {
    if is_pages(from) {
        if !holds_paper(from) {
            return;
        }
        let paper = paper_of(from);
        let copied = paper_of(to);
        if paper.exists() && crate::carry::copy_whole(&paper, &copied).is_ok() {
            copy_held(&paper, &copied);
        }
        return;
    }
    if !is_pdf(from) {
        return;
    }

    let source = highlights_of(from);
    if source.exists() {
        let _ = fs::copy(&source, highlights_of(to));
    } else {
        let _ = fs::remove_file(highlights_of(to));
    }
}

pub fn drop_held(file: &Path) {
    if is_pages(file) {
        let paper = paper_of(file);
        if fs::remove_file(&paper).is_ok() {
            drop_held(&paper);
        }
    } else if is_pdf(file) {
        let _ = fs::remove_file(highlights_of(file));
    }
}

pub fn cannot(verb: &str, path: &Path, error: &impl Display) -> String {
    format!("could not {verb} {}: {error}", path.display())
}

pub fn made(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| cannot("create", dir, &error))
}

pub(crate) const SPACES_DIR: &str = "ORDEN_SPACES_DIR";

pub(crate) fn folder_named(said: Option<&OsStr>) -> Option<PathBuf> {
    let path = PathBuf::from(said?);
    path.is_absolute().then_some(path)
}

#[cfg(desktop)]
pub(crate) const SPACES: &str = "Spaces";

#[cfg(desktop)]
pub(crate) const SPACES_KEPT: &str = "spaces-folder";

#[cfg(desktop)]
pub(crate) static SPACES_OUTSIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

#[cfg(desktop)]
static SPACES_CHOSEN: OnceLock<PathBuf> = OnceLock::new();

pub fn spaces_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(named) = folder_named(std::env::var_os(SPACES_DIR).as_deref()) {
        return Ok(named);
    }

    default_spaces(app)
}

#[cfg(desktop)]
fn default_spaces(_app: &AppHandle) -> Result<PathBuf, String> {
    SPACES_CHOSEN
        .get()
        .cloned()
        .ok_or_else(|| "the spaces folder is not decided yet".to_string())
}

#[cfg(desktop)]
pub fn decide_spaces(app: &AppHandle) {
    if folder_named(std::env::var_os(SPACES_DIR).as_deref()).is_some() {
        return;
    }

    match chosen_spaces(app) {
        Ok(chosen) => {
            let _ = SPACES_CHOSEN.set(chosen);
        }
        Err(error) => crate::logs::say(app, "error", &format!("the spaces folder: {error}")),
    }
}

#[cfg(desktop)]
fn chosen_spaces(app: &AppHandle) -> Result<PathBuf, String> {
    let kept = config_dir(app)?.join(SPACES_KEPT);
    let said = fs::read_to_string(&kept).ok();
    let fresh = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?
        .join(SPACES);
    let nib = documents_nib(app).ok();
    let outside = outside_folder(said.as_deref(), &[Some(fresh.as_path()), nib.as_deref()]);
    let old = nib.filter(|dir| dir.is_dir());
    if let Some(outside) = outside {
        if let Ok(mut pending) = SPACES_OUTSIDE.lock() {
            *pending = Some(outside);
        }
        return Ok(spaces_folder(None, old, fresh));
    }
    let chosen = spaces_folder(said.as_deref(), old, fresh);
    if folder_named(said.as_deref().map(str::trim).map(OsStr::new)).is_none() {
        if let Some(dir) = kept.parent() {
            let _ = made(dir);
        }
        let _ = fs::write(&kept, chosen.to_string_lossy().as_bytes());
    }
    Ok(chosen)
}

#[cfg(mobile)]
fn default_spaces(app: &AppHandle) -> Result<PathBuf, String> {
    documents_nib(app)
}

fn documents_nib(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("could not find the documents folder: {error}"))?;

    Ok(base.join("Nib"))
}

#[cfg(desktop)]
pub(crate) fn spaces_folder(said: Option<&str>, old: Option<PathBuf>, fresh: PathBuf) -> PathBuf {
    if let Some(kept) = folder_named(said.map(str::trim).map(OsStr::new)) {
        return kept;
    }
    old.unwrap_or(fresh)
}

#[cfg(desktop)]
pub(crate) fn outside_folder(said: Option<&str>, own: &[Option<&Path>]) -> Option<PathBuf> {
    let named = folder_named(said.map(str::trim).map(OsStr::new))?;
    let ours = own.iter().flatten().any(|one| same_path(one, &named));
    (!ours).then_some(named)
}

pub fn spaces_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = spaces_dir(app)?;
    made(&dir)?;

    Ok(dir)
}

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("could not find the settings folder: {error}"))
}

pub fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("could not find the log folder: {error}"))?;

    made(&dir)?;
    Ok(dir)
}

pub fn folded(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();

    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }

    out
}

pub fn inside(root: &Path, path: &Path) -> bool {
    inside_as(NAMING, root, path)
}

fn inside_as(naming: Naming, root: &Path, path: &Path) -> bool {
    let root = folded(root);
    let path = folded(path);
    if root.as_os_str().is_empty() {
        return false;
    }

    let last = path.components().count();
    let mut theirs = path.components().enumerate();
    for ours in root.components() {
        match theirs.next() {
            Some((at, mine)) if same_part(naming, ours, mine, at + 1 == last) => {}
            _ => return false,
        }
    }

    !theirs.any(|(_, part)| unspoken(naming, part))
}

pub fn space_root(spaces: &Path, path: &Path) -> Option<PathBuf> {
    let spaces = folded(spaces);
    let path = folded(path);
    if !inside(&spaces, &path) {
        return None;
    }

    let mut parts = path.components().skip(spaces.components().count());
    let first = spaces.join(parts.next()?);
    let working = first.join(".work");
    match (parts.next(), parts.next()) {
        (Some(second), Some(third)) if first.ends_with(".orden") && working.ends_with(second) => {
            Some(working.join(third))
        }
        _ => Some(first),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Naming {
    Exact,
    Cased,
    Win32,
}

const NAMING: Naming = if cfg!(windows) {
    Naming::Win32
} else if cfg!(target_os = "macos") {
    Naming::Cased
} else {
    Naming::Exact
};

fn name_key(naming: Naming, name: &str, last: bool) -> String {
    match naming {
        Naming::Exact => name.to_owned(),
        Naming::Cased => upcased(name),
        Naming::Win32 => upcased(win32_name(name, last)),
    }
}

fn win32_name(name: &str, last: bool) -> &str {
    if name.chars().all(|one| one == '.') {
        name
    } else if last {
        name.trim_end_matches(['.', ' '])
    } else {
        name.strip_suffix('.').unwrap_or(name)
    }
}

fn upcased(name: &str) -> String {
    name.chars()
        .map(|one| {
            let mut upper = one.to_uppercase();
            match (upper.next(), upper.next()) {
                (Some(only), None) => only,
                _ => one,
            }
        })
        .collect()
}

fn same_part(naming: Naming, one: Component, other: Component, last: bool) -> bool {
    if naming == Naming::Exact {
        return one == other;
    }
    let key = |part: Component| name_key(naming, &part.as_os_str().to_string_lossy(), last);
    key(one) == key(other)
}

fn unspoken(naming: Naming, part: Component) -> bool {
    match part {
        Component::Normal(name) if naming == Naming::Win32 => {
            let name = name.to_string_lossy();
            name.contains(':') || short_alias(&name)
        }
        _ => false,
    }
}

fn short_alias(name: &str) -> bool {
    let (stem, extension) = name.rsplit_once('.').unwrap_or((name, ""));
    let Some((_, number)) = stem.rsplit_once('~') else {
        return false;
    };
    stem.chars().count() <= 8
        && extension.chars().count() <= 3
        && !number.is_empty()
        && number.chars().all(|one| one.is_ascii_digit())
}

#[cfg(desktop)]
pub fn spoken(path: &Path) -> bool {
    !path.components().any(|part| unspoken(NAMING, part))
}

#[cfg(desktop)]
pub fn path_key(path: &Path) -> String {
    path_key_as(NAMING, path)
}

#[cfg(any(desktop, test))]
fn path_key_as(naming: Naming, path: &Path) -> String {
    let path = folded(path);
    let last = path.components().count();
    path.components()
        .enumerate()
        .map(|(at, part)| name_key(naming, &part.as_os_str().to_string_lossy(), at + 1 == last))
        .collect::<Vec<_>>()
        .join("\u{0}")
}

pub fn in_spaces(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    judged(&spaces_dir(app)?, path)
}

fn judged(root: &Path, path: &str) -> Result<PathBuf, String> {
    judged_as(NAMING, root, path)
}

fn judged_as(naming: Naming, root: &Path, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    if !inside_as(naming, root, &target) || inside_as(naming, &root.join(TRASH), &target) {
        return Err(format!("{path} is outside the notes folder"));
    }
    if naming == Naming::Win32
        && target.components().any(
            |part| matches!(part, Component::Normal(name) if name.to_string_lossy().contains(':')),
        )
    {
        return Err(format!("{path} is not a file name"));
    }

    Ok(target)
}

pub fn a_space(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    judged_space(&spaces_dir(app)?, path)
}

fn judged_space(root: &Path, path: &str) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));

    let directly_inside = target
        .parent()
        .is_some_and(|parent| inside(root, parent) && inside(parent, root));
    let hidden = target
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with('.'));

    if !directly_inside || hidden {
        return Err(format!("{path} is not a space"));
    }

    Ok(target)
}

pub fn openable(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    past_spaces(app, path, |target| is_own_file(app, target))
}

pub fn chosen(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    past_spaces(app, path, |target| {
        is_own_file(app, target)
            || app
                .try_state::<Picked>()
                .is_some_and(|picked| picked.reach(target))
    })
}

fn past_spaces(
    app: &AppHandle,
    path: &str,
    beyond: impl FnOnce(&Path) -> bool,
) -> Result<PathBuf, String> {
    judged_beyond(&spaces_dir(app)?, path, beyond)
}

fn judged_beyond(
    root: &Path,
    path: &str,
    beyond: impl FnOnce(&Path) -> bool,
) -> Result<PathBuf, String> {
    let target = folded(Path::new(path));
    if inside(root, &target) || !beyond(&target) {
        return judged(root, path);
    }

    Ok(target)
}

fn is_own_file(app: &AppHandle, target: &Path) -> bool {
    crate::themes::own_files(app)
        .iter()
        .any(|own| same_path(own, target))
}

fn same_path(one: &Path, other: &Path) -> bool {
    inside(one, other) && inside(other, one)
}

#[derive(Default)]
pub struct Picked(Mutex<HashSet<PathBuf>>);

impl Picked {
    fn add(&self, path: &Path) {
        let path = folded(path);
        let reach = if path.is_dir() {
            path
        } else {
            match path.parent().map(folded) {
                Some(folder) if a_shareable_folder(&folder) => folder,
                _ => path,
            }
        };

        if let Ok(mut picked) = self.0.lock() {
            picked.insert(reach);
        }
    }

    fn reach(&self, target: &Path) -> bool {
        self.0
            .lock()
            .is_ok_and(|picked| picked.iter().any(|one| inside(one, target)))
    }
}

#[cfg(desktop)]
pub fn picked_for_an_agent(app: &AppHandle, reach: &Path) {
    if let Some(picked) = app.try_state::<Picked>() {
        if let Ok(mut all) = picked.0.lock() {
            all.insert(folded(reach));
        }
    }
}

pub fn hear_picks(app: &AppHandle) {
    let heard = app.clone();
    app.asset_protocol_scope().listen(move |event| {
        if let tauri::scope::fs::Event::PathAllowed(path) = event {
            if let Some(picked) = heard.try_state::<Picked>() {
                picked.add(path);
            }
        }
    });
}

fn a_shareable_folder(folder: &Path) -> bool {
    folder
        .parent()
        .is_some_and(|above| !above.as_os_str().is_empty())
}

#[derive(Default)]
pub struct Seen(HashSet<PathBuf>);

impl Seen {
    pub fn first_time(&mut self, dir: &Path) -> bool {
        self.0
            .insert(fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf()))
    }
}

pub fn files_in(dir: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut notes = Vec::new();
    let mut others = Vec::new();
    gather(dir, 0, &mut Seen::default(), &mut notes, &mut others);
    notes.sort();
    others.sort();
    (notes, others)
}

fn gather(
    dir: &Path,
    depth: usize,
    seen: &mut Seen,
    notes: &mut Vec<PathBuf>,
    others: &mut Vec<PathBuf>,
) {
    if depth >= MAX_DEPTH || !seen.first_time(dir) {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }

        if path.is_dir() {
            gather(&path, depth + 1, seen, notes, others);
        } else if is_markdown(&path) {
            notes.push(path);
        } else if !entry.file_name().to_string_lossy().ends_with(HIGHLIGHTS) {
            others.push(path);
        }
    }
}

#[must_use]
pub fn folder_key(path: &str) -> String {
    folder_key_as(NAMING, path)
}

fn folder_key_as(naming: Naming, path: &str) -> String {
    let spelled = if naming == Naming::Exact {
        path.to_owned()
    } else {
        path.to_lowercase()
    };
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in spelled.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

pub fn kept_folder(root: &Path, path: &str) -> PathBuf {
    kept_folder_named(root, &folder_key(path), path)
}

fn kept_folder_named(root: &Path, name: &str, path: &str) -> PathBuf {
    let dir = root.join(name);
    let was = root.join(folder_key_as(Naming::Cased, path));
    if !dir.exists() && fs::read_to_string(was.join(ORIGIN)).is_ok_and(|origin| origin == path) {
        let _ = crate::carry::rename_new(&was, &dir);
    }
    dir
}

pub const ORIGIN: &str = "origin.txt";

pub fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn at_most(target: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    Ok(at_most_stamped(target, limit)?.map(|(bytes, _)| bytes))
}

pub fn at_most_stamped(
    target: &Path,
    limit: u64,
) -> Result<Option<(Vec<u8>, fs::Metadata)>, String> {
    let file = fs::File::open(target).map_err(|error| cannot("read", target, &error))?;
    let meta = file
        .metadata()
        .map_err(|error| cannot("read", target, &error))?;
    let size = meta.len();
    if size > limit {
        return Ok(None);
    }

    let mut bytes = Vec::with_capacity(usize::try_from(size).unwrap_or_default());
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| cannot("read", target, &error))?;

    let within = u64::try_from(bytes.len()).is_ok_and(|read| read <= limit);
    Ok(within.then_some((bytes, meta)))
}

pub fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    written(target, bytes, false)
}

#[cfg_attr(mobile, allow(dead_code))]
pub fn write_privately(target: &Path, bytes: &[u8]) -> Result<(), String> {
    written(target, bytes, true)
}

pub fn write_in_place(target: &Path, bytes: &[u8]) -> Result<(), String> {
    into_place(target, bytes, |file| poured(file, bytes, cfg!(windows)))
}

fn into_place(
    target: &Path,
    bytes: &[u8],
    pour: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    let linked = fs::symlink_metadata(target).is_ok_and(|meta| meta.file_type().is_symlink());
    let opened = (!linked)
        .then(|| fs::OpenOptions::new().write(true).open(target).ok())
        .flatten();
    let Some(mut file) = opened else {
        return write_atomically(target, bytes);
    };

    let copy = staged(target, bytes, false)?;
    let into = pour(&mut file);
    drop(file);

    match into {
        Ok(()) => {
            let _ = fs::remove_file(&copy);
            Ok(())
        }
        Err(_) => fs::rename(&copy, target).map_err(|error| cannot("save", target, &error)),
    }
}

trait Pourable: Write {
    fn size(&self) -> std::io::Result<u64>;
    fn shrink(&mut self, to: u64) -> std::io::Result<()>;
    fn sync(&mut self) -> std::io::Result<()>;
}

impl Pourable for fs::File {
    fn size(&self) -> std::io::Result<u64> {
        self.metadata().map(|meta| meta.len())
    }
    fn shrink(&mut self, to: u64) -> std::io::Result<()> {
        self.set_len(to)
    }
    fn sync(&mut self) -> std::io::Result<()> {
        self.sync_all()
    }
}

fn poured(file: &mut impl Pourable, bytes: &[u8], shrink_first: bool) -> std::io::Result<()> {
    let length = bytes.len() as u64;
    if shrink_first && file.size()? > length {
        file.shrink(length)?;
    }
    file.write_all(bytes)?;
    if !shrink_first && file.size()? > length {
        file.shrink(length)?;
    }
    file.sync()
}

fn written(target: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    let temp = staged(target, bytes, private)?;
    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        cannot("save", target, &error)
    })
}

fn staged(target: &Path, bytes: &[u8], private: bool) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{} has no folder to write into", target.display()))?;
    let temp = parent.join(format!(
        ".{}.{}-{}.orden.tmp",
        temp_stem(target),
        std::process::id(),
        WRITES.fetch_add(1, Ordering::Relaxed)
    ));

    match spill(&temp, bytes, private) {
        Ok(()) => Ok(temp),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

const TEMP_STEM: usize = 64;

fn temp_stem(target: &Path) -> &str {
    let name = target.file_name().and_then(OsStr::to_str).unwrap_or("file");
    let mut end = name.len().min(TEMP_STEM);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

#[cfg_attr(not(unix), allow(unused_variables))]
fn spill(temp: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    if private {
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    }

    let mut file = options
        .open(temp)
        .map_err(|error| cannot("write", temp, &error))?;
    file.write_all(bytes)
        .map_err(|error| cannot("write", temp, &error))?;
    file.sync_all()
        .map_err(|error| cannot("finish writing", temp, &error))
}

pub fn free_spot(path: &Path, is_file: bool) -> PathBuf {
    first_spot(path, is_file, |one| !taken(one, is_file))
}

pub fn first_spot(path: &Path, is_file: bool, fits: impl Fn(&Path) -> bool) -> PathBuf {
    if fits(path) {
        return path.to_path_buf();
    }

    let parent = path.parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let file_name = path
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().to_string());

    let (stem, extension) = match file_name.rfind('.') {
        Some(dot) if is_file && dot > 0 => {
            (file_name[..dot].to_string(), file_name[dot..].to_string())
        }
        _ => (file_name.clone(), String::new()),
    };

    let mut counter = 2;
    loop {
        let candidate = parent.join(format!("{stem} {counter}{extension}"));
        if fits(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

#[cfg(all(test, unix))]
pub(crate) fn link_to(target: &Path, link: &Path) -> bool {
    std::os::unix::fs::symlink(target, link).is_ok()
}

#[cfg(all(test, windows))]
pub(crate) fn link_to(target: &Path, link: &Path) -> bool {
    if std::os::windows::fs::symlink_dir(target, link).is_ok() {
        return true;
    }

    std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .is_ok_and(|made| made.status.success())
}

#[cfg(test)]
mod tests {
    use super::{
        a_shareable_folder, at_most, copy_held, drop_held, files_in, folded, folder_key,
        folder_key_as, folder_named, free_spot, held_paper, highlights_of, inside, inside_as,
        is_base, is_canvas, is_markdown, is_pages, is_pdf, is_shortcut, judged, judged_as,
        judged_beyond, judged_space, kept_folder_named, link_to, move_held, paper_of, path_key_as,
        same_path, space_root, unspoken, upcased, write_atomically, Naming, Picked, ORIGIN,
    };
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    #[test]
    fn a_path_key_is_one_folder_however_it_is_spelled() {
        let key = |naming, path: &str| path_key_as(naming, Path::new(path));
        assert_eq!(
            key(Naming::Cased, "/Users/a/Photos"),
            key(Naming::Cased, "/users/A/photos")
        );
        assert_eq!(
            key(Naming::Win32, "/Users/a/Photos."),
            key(Naming::Win32, "/users/a/photos")
        );
        assert_eq!(
            key(Naming::Exact, "/a/./b/../c"),
            key(Naming::Exact, "/a/c")
        );
        assert_ne!(
            key(Naming::Exact, "/a/Photos"),
            key(Naming::Exact, "/a/photos")
        );
        assert_ne!(key(Naming::Cased, "/a/b"), key(Naming::Cased, "/a/bc"));
        assert_ne!(key(Naming::Cased, "/a/b/c"), key(Naming::Cased, "/a/b"));
    }

    #[test]
    fn a_stream_or_an_alias_is_not_spoken_on_windows() {
        let unsaid = |naming, path: &str| {
            Path::new(path)
                .components()
                .any(|part| unspoken(naming, part))
        };
        assert!(unsaid(Naming::Win32, "/a/b.txt:hidden"));
        assert!(unsaid(Naming::Win32, "/a/PROGRA~1/b"));
        assert!(!unsaid(Naming::Win32, "/a/Program Files/b"));
        assert!(!unsaid(Naming::Exact, "/a/b.txt:hidden"));
    }

    #[test]
    fn a_device_name_is_reserved_however_it_is_written() {
        for name in ["COM¹", "LPT².md", "CONIN$", "conout$.md", "CON .md", "COM0"] {
            assert!(super::is_reserved(name), "{name}");
        }
        for name in ["CONSOLE.md", "COM10", "Con Law.md"] {
            assert!(!super::is_reserved(name), "{name}");
        }
    }

    #[test]
    fn reads_a_file_whole_and_stops_at_the_ceiling() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("shot.png");
        std::fs::write(&target, b"a picture").expect("the file");

        assert_eq!(at_most(&target, 64), Ok(Some(b"a picture".to_vec())));
        assert_eq!(at_most(&target, 9), Ok(Some(b"a picture".to_vec())));
        assert_eq!(at_most(&target, 8), Ok(None));
        assert!(at_most(&dir.path().join("gone.png"), 64).is_err());
    }

    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn a_variable_says_where_the_spaces_are_and_wins() {
        let absolute = if cfg!(windows) {
            path(&[r"C:\", "probe", "notes"])
        } else {
            path(&["/", "probe", "notes"])
        };

        let said = folder_named(Some(absolute.as_os_str())).expect("an absolute path");
        assert_eq!(said, absolute);
        assert!(!said.ends_with("Nib"));
    }

    #[cfg(desktop)]
    #[test]
    fn a_new_install_keeps_its_spaces_in_app_data_and_nobody_s_move() {
        let root = |parts: &[&str]| {
            let mut all = vec![if cfg!(windows) { r"C:\" } else { "/" }];
            all.extend_from_slice(parts);
            path(&all)
        };
        let fresh = root(&["data", "so.orden.Orden", "Spaces"]);
        let old = root(&["home", "Documents", "Nib"]);

        assert_eq!(super::spaces_folder(None, None, fresh.clone()), fresh);
        assert_eq!(
            super::spaces_folder(None, Some(old.clone()), fresh.clone()),
            old
        );
        let kept = fresh.to_string_lossy().to_string();
        assert_eq!(
            super::spaces_folder(Some(&kept), Some(old.clone()), root(&["elsewhere"])),
            fresh
        );
        let edited = format!("{}\n", old.to_string_lossy());
        assert_eq!(
            super::spaces_folder(Some(&edited), None, fresh.clone()),
            old
        );
        assert_eq!(
            super::spaces_folder(Some("Spaces"), None, fresh.clone()),
            fresh
        );
        assert_eq!(
            super::spaces_folder(Some(""), Some(old.clone()), fresh),
            old
        );
    }

    #[cfg(desktop)]
    #[test]
    fn a_kept_answer_naming_somebody_else_s_folder_is_outside() {
        let root = |parts: &[&str]| {
            let mut all = vec![if cfg!(windows) { r"C:\" } else { "/" }];
            all.extend_from_slice(parts);
            path(&all)
        };
        let fresh = root(&["data", "so.orden.Orden", "Spaces"]);
        let nib = root(&["home", "Documents", "Nib"]);
        let own = [Some(fresh.as_path()), Some(nib.as_path())];
        let said = |at: &Path| format!("{}\n", at.to_string_lossy());

        assert_eq!(super::outside_folder(Some(&said(&fresh)), &own), None);
        assert_eq!(super::outside_folder(Some(&said(&nib)), &own), None);
        assert_eq!(super::outside_folder(Some("Spaces"), &own), None);
        assert_eq!(super::outside_folder(None, &own), None);

        let vault = root(&["home", "Obsidian", "Vault"]);
        assert_eq!(
            super::outside_folder(Some(&said(&vault)), &own),
            Some(vault.clone())
        );
        let within = root(&["home", "Documents", "Nib", "Work"]);
        assert_eq!(
            super::outside_folder(Some(&said(&within)), &own),
            Some(within)
        );
        assert_eq!(
            super::outside_folder(Some(&said(&nib)), &[Some(fresh.as_path()), None]),
            Some(nib.clone())
        );
        assert_eq!(super::spaces_folder(None, None, fresh.clone()), fresh);
    }

    #[test]
    fn a_variable_that_names_no_absolute_folder_is_ignored() {
        assert!(folder_named(None).is_none());
        assert!(folder_named(Some(OsStr::new(""))).is_none());
        assert!(folder_named(Some(OsStr::new("notes"))).is_none());
        assert!(folder_named(Some(OsStr::new("./notes"))).is_none());
        assert!(folder_named(Some(OsStr::new("../notes"))).is_none());
        assert!(folder_named(Some(OsStr::new("Documents/Nib"))).is_none());
    }

    #[test]
    fn folds_a_path_down_to_where_it_points() {
        assert_eq!(folded(&path(&["a", ".", "b"])), path(&["a", "b"]));
        assert_eq!(folded(&path(&["a", "b", "..", "c"])), path(&["a", "c"]));
        assert_eq!(folded(&path(&["a", "..", "..", "b"])), path(&["b"]));
    }

    #[test]
    fn a_path_is_inside_the_folder_it_starts_with() {
        let root = path(&["notes", "Nib"]);
        assert!(inside(&root, &root));
        assert!(inside(&root, &path(&["notes", "Nib", "Work", "a.md"])));
        assert!(!inside(&root, &path(&["notes", "Nibble", "a.md"])));
        assert!(!inside(&root, &path(&["notes"])));
    }

    #[test]
    fn climbing_out_of_the_folder_does_not_count_as_inside() {
        let root = path(&["notes", "Nib"]);
        assert!(!inside(&root, &path(&["notes", "Nib", "..", "secret.md"])));
        assert!(!inside(
            &root,
            &path(&["notes", "Nib", "Work", "..", "..", "secret.md"])
        ));
        assert!(inside(
            &root,
            &path(&["notes", "Nib", "Work", "..", "Home", "a.md"])
        ));
    }

    #[test]
    fn nothing_is_inside_a_folder_with_no_name() {
        assert!(!inside(Path::new(""), &path(&["a"])));
    }

    #[test]
    fn the_gate_takes_a_path_inside_the_spaces_folder_and_nothing_else() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged(&root, &path(one).to_string_lossy());

        let note = ["Documents", "Nib", "Work", "a.md"];
        assert_eq!(said(&note), Ok(path(&note)));
        assert!(said(&["Documents", "Nib"]).is_ok());
        assert!(said(&["Documents", "Secrets", "a.md"]).is_err());
        assert!(said(&["Documents", "Nibble", "a.md"]).is_err());
        assert!(said(&["Documents"]).is_err());
        assert!(judged(&root, "").is_err());
    }

    #[test]
    fn the_gate_refuses_a_path_that_climbs_out_of_the_spaces_folder() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged(&root, &path(one).to_string_lossy());

        assert!(said(&["Documents", "Nib", "..", "secret.md"]).is_err());
        assert!(said(&["Documents", "Nib", "Work", "..", "..", "..", "secret.md"]).is_err());
        assert!(said(&["Documents", "Nib", "Work", "..", "Home", "a.md"]).is_ok());
    }

    #[test]
    fn the_gate_refuses_the_trash_it_stands_beside() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged(&root, &path(one).to_string_lossy());

        assert!(said(&[".trash"]).is_err());
        assert!(said(&["Documents", "Nib", ".trash"]).is_err());
        assert!(said(&["Documents", "Nib", ".trash", "1-0", "a.md"]).is_err());
        assert!(said(&["Documents", "Nib", ".trashy.md"]).is_ok());
    }

    #[test]
    fn the_gate_refuses_a_stream_only_where_a_colon_is_one() {
        let root = path(&["Documents", "Nib"]);
        let said = |naming| {
            judged_as(
                naming,
                &root,
                &path(&["Documents", "Nib", "Work", "a.md:x.md"]).to_string_lossy(),
            )
        };
        assert!(said(Naming::Win32).is_err());
        assert!(said(Naming::Cased).is_ok());
        assert!(said(Naming::Exact).is_ok());
    }

    #[test]
    fn the_gate_refuses_the_trash_however_the_file_system_spells_it() {
        let root = path(&["Documents", "Nib"]);
        let said = |naming, one: &[&str]| {
            let mut parts = vec!["Documents", "Nib"];
            parts.extend_from_slice(one);
            judged_as(naming, &root, &path(&parts).to_string_lossy())
        };

        for naming in [Naming::Cased, Naming::Win32] {
            for trash in [
                &[".TRASH", "1-0", "a.md"][..],
                &[".Trash"],
                &[".tra\u{17f}h"],
            ] {
                assert!(said(naming, trash).is_err(), "{naming:?} {trash:?}");
            }
            assert!(said(naming, &["Work", "Plan.md"]).is_ok(), "{naming:?}");
            assert!(said(naming, &[".trashy.md"]).is_ok(), "{naming:?}");
        }

        for trash in [
            &[".trash."][..],
            &[".trash "],
            &[".trash. ."],
            &[".trash.", "x.md"],
            &[".trash::$INDEX_ALLOCATION"],
            &[".trash:x"],
            &["TRASH~1", "1-0", "a.md"],
            &["Work", "Plan.md:hidden"],
        ] {
            assert!(said(Naming::Win32, trash).is_err(), "{trash:?}");
        }
        assert!(said(Naming::Win32, &["...", "a.md"]).is_ok());

        assert!(said(Naming::Exact, &[".TRASH", "a.md"]).is_ok());
        assert!(said(Naming::Exact, &[".trash.", "a.md"]).is_ok());
    }

    #[test]
    fn a_short_name_in_the_folder_guarded_is_no_bar() {
        let root = path(&["Users", "RUNNER~1", "Temp", "Nib"]);
        let under = path(&["Users", "RUNNER~1", "Temp", "Nib", "Work", "Plan.md"]);
        let alias = path(&["Users", "RUNNER~1", "Temp", "Nib", "WORK~1", "Plan.md"]);
        let stream = path(&["Users", "RUNNER~1", "Temp", "Nib", "Plan.md:hidden"]);

        assert!(inside_as(Naming::Win32, &root, &under));
        assert!(inside_as(Naming::Win32, &root, &root));
        assert!(!inside_as(Naming::Win32, &root, &alias));
        assert!(!inside_as(Naming::Win32, &root, &stream));
    }

    #[test]
    fn containment_folds_case_no_wider_than_the_file_system() {
        let root = path(&["Users", "kim", "Nib"]);
        let kelvin = path(&["Users", "\u{212a}im", "Nib", "x.md"]);
        let upper = path(&["Users", "KIM", "Nib", "x.md"]);

        assert!(!inside_as(Naming::Win32, &root, &kelvin));
        assert!(inside_as(Naming::Win32, &root, &upper));
        assert!(!inside_as(Naming::Exact, &root, &upper));
        assert_eq!(upcased("stra\u{df}e"), "STRA\u{df}E");
    }

    #[test]
    fn a_space_is_a_folder_directly_inside_the_spaces_folder() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str]| judged_space(&root, &path(one).to_string_lossy());

        assert!(said(&["Documents", "Nib", "Work"]).is_ok());
        assert!(said(&["Documents", "Nib", "Work", "2026"]).is_err());
        assert!(said(&["Documents", "Nib"]).is_err());
        assert!(said(&["Documents"]).is_err());
        assert!(said(&["Documents", "Nib", ".trash"]).is_err());
    }

    #[test]
    fn a_space_outside_ascii_is_a_space_like_any_other() {
        let root = path(&["Documents", "Nib"]);

        assert!(judged(
            &root,
            &path(&["Documents", "Nib", "メモ", "考え.md"]).to_string_lossy()
        )
        .is_ok());
        assert!(judged_space(
            &root,
            &path(&["Documents", "Nib", "Ideen über alles"]).to_string_lossy()
        )
        .is_ok());
        assert!(judged(
            &root,
            &path(&["Documents", "メモ", "考え.md"]).to_string_lossy()
        )
        .is_err());
    }

    #[test]
    fn the_top_of_a_disk_is_not_a_folder_a_pick_shares() {
        assert!(a_shareable_folder(&path(&["Users", "me", "Notes"])));

        if cfg!(windows) {
            assert!(!a_shareable_folder(Path::new(r"C:\")));
            assert!(!a_shareable_folder(Path::new(r"\\server\share")));
            assert!(a_shareable_folder(Path::new(r"C:\Notes")));
        } else {
            assert!(!a_shareable_folder(Path::new("/")));
            assert!(a_shareable_folder(Path::new("/Notes")));
        }

        assert!(!a_shareable_folder(Path::new("")));
        assert!(!a_shareable_folder(Path::new("Idea.md")));
    }

    #[test]
    fn nothing_outside_the_spaces_is_let_in_unless_the_way_in_says_so() {
        let root = path(&["Documents", "Nib"]);
        let said = |one: &[&str], beyond: bool| {
            judged_beyond(&root, &path(one).to_string_lossy(), |_| beyond)
        };

        let outside = ["Downloads", "Idea.md"];
        assert!(said(&outside, false).is_err());
        assert_eq!(said(&outside, true), Ok(path(&outside)));

        let note = ["Documents", "Nib", "Work", "a.md"];
        assert_eq!(said(&note, false), Ok(path(&note)));
        assert!(said(&["Documents", "Nib", ".trash", "1-0", "a.md"], true).is_err());
        assert!(said(&["Documents", "Nib", "..", "Downloads", "Idea.md"], false).is_err());
    }

    #[test]
    fn a_path_is_the_same_place_however_it_was_spelled() {
        let file = path(&["config", "custom.css"]);
        assert!(same_path(&file, &path(&["config", ".", "custom.css"])));
        assert!(!same_path(&file, &path(&["config", "custom.css", "x"])));
        assert!(!same_path(&file, &path(&["config"])));
    }

    #[test]
    fn a_pick_reaches_its_own_folder_and_no_further() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let desk = dir.path().join("Desktop");
        std::fs::create_dir_all(&desk).expect("a folder");
        let picked = Picked::default();

        assert!(!picked.reach(&desk.join("Idea.md")));

        picked.add(&desk.join("Idea.md"));
        assert!(picked.reach(&desk.join("Idea.md")));
        assert!(picked.reach(&desk.join("assets").join("one.png")));
        assert!(!picked.reach(&dir.path().join("Elsewhere.md")));
        assert!(!picked.reach(&desk.join("..").join("Elsewhere.md")));

        let bundle = dir.path().join("Idea.textbundle");
        std::fs::create_dir_all(&bundle).expect("a picked folder");
        picked.add(&bundle);
        assert!(picked.reach(&bundle.join("text.md")));
        assert!(!picked.reach(&dir.path().join("Other.md")));
    }

    #[test]
    fn names_the_space_a_folder_belongs_to() {
        let spaces = path(&["Documents", "Nib"]);
        let space = path(&["Documents", "Nib", "Notes"]);

        assert_eq!(space_root(&spaces, &space), Some(space.clone()));
        assert_eq!(
            space_root(&spaces, &space.join("Work")),
            Some(space.clone())
        );
        assert_eq!(
            space_root(&spaces, &space.join("Work").join("2026")),
            Some(space.clone())
        );
        assert_eq!(
            space_root(&spaces, &space.join("Work").join("..")),
            Some(space)
        );
    }

    #[test]
    fn a_working_folder_of_a_kept_space_is_a_space_of_its_own() {
        let spaces = path(&["Documents", "Nib"]);
        let working = path(&["Documents", "Nib", ".orden", ".work", "Notes"]);

        assert_eq!(space_root(&spaces, &working), Some(working.clone()));
        assert_eq!(
            space_root(&spaces, &working.join("Work").join("Plan.md")),
            Some(working)
        );
        assert_eq!(
            space_root(&spaces, &path(&["Documents", "Nib", ".orden", "Notes"])),
            Some(path(&["Documents", "Nib", ".orden"]))
        );
    }

    #[test]
    fn nothing_outside_the_spaces_folder_belongs_to_a_space() {
        let spaces = path(&["Documents", "Nib"]);

        assert_eq!(space_root(&spaces, &path(&["elsewhere", "notes"])), None);
        assert_eq!(space_root(&spaces, &spaces), None);
    }

    #[test]
    #[cfg(windows)]
    fn windows_paths_differ_in_case_without_differing_in_meaning() {
        assert!(inside(
            Path::new(r"C:\Users\me\Documents\Nib"),
            Path::new(r"c:\users\me\documents\nib\Work\a.md")
        ));
    }

    #[test]
    fn names_a_note_by_its_extension() {
        assert!(is_markdown(Path::new("a/b.md")));
        assert!(is_markdown(Path::new("a/b.MARKDOWN")));
        assert!(!is_markdown(Path::new("a/b.txt")));
        assert!(!is_markdown(Path::new("a/b")));
    }

    #[test]
    fn an_atomic_write_leaves_the_file_and_nothing_else() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");

        write_atomically(&target, b"first").expect("the first write");
        write_atomically(&target, b"second").expect("the second write");

        assert_eq!(
            std::fs::read_to_string(&target).expect("the note"),
            "second"
        );

        let left: Vec<_> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, vec!["Note.md".to_string()]);
    }

    struct Mapped(Vec<u8>);

    impl std::io::Write for Mapped {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let end = bytes.len().min(self.0.len());
            self.0[..end].copy_from_slice(&bytes[..end]);
            self.0.extend_from_slice(&bytes[end..]);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl super::Pourable for Mapped {
        fn size(&self) -> std::io::Result<u64> {
            Ok(self.0.len() as u64)
        }
        fn shrink(&mut self, _to: u64) -> std::io::Result<()> {
            Err(std::io::Error::other("the file is mapped"))
        }
        fn sync(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_file_that_may_not_shrink_keeps_its_old_text() {
        let mut file = Mapped(b"a first, longer version".to_vec());
        assert!(super::poured(&mut file, b"second", true).is_err());
        assert_eq!(file.0, b"a first, longer version");
    }

    #[test]
    fn a_file_that_may_not_shrink_still_takes_a_longer_text() {
        let mut file = Mapped(b"short".to_vec());
        super::poured(&mut file, b"a longer one", true).expect("the write");
        assert_eq!(file.0, b"a longer one");
    }

    #[test]
    fn off_windows_the_write_comes_before_the_shrink() {
        let mut file = Mapped(b"a first, longer version".to_vec());
        assert!(super::poured(&mut file, b"second", false).is_err());
        assert_eq!(file.0, b"secondt, longer version");
    }

    #[test]
    fn either_order_leaves_exactly_the_new_text() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");
        for shrink_first in [true, false] {
            std::fs::write(&target, "a first, longer version").expect("the old text");
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .open(&target)
                .expect("the note");
            super::poured(&mut file, b"second", shrink_first).expect("the write");
            drop(file);
            assert_eq!(
                std::fs::read_to_string(&target).expect("the note"),
                "second"
            );
        }
    }

    #[test]
    fn a_write_that_fails_puts_the_copy_over_the_note() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");
        std::fs::write(&target, "a first, longer version").expect("the old text");

        super::into_place(&target, b"second", |file| {
            file.write_all(b"sec")?;
            Err(std::io::Error::other("the file is mapped"))
        })
        .expect("the copy put over the note");

        assert_eq!(
            std::fs::read_to_string(&target).expect("the note"),
            "second"
        );
        assert_eq!(
            std::fs::read_dir(dir.path()).expect("the folder").count(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_copy_that_cannot_be_put_over_the_note_stays_beside_it() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");
        std::fs::write(&target, "old").expect("the old text");
        let folder = |mode| {
            std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(mode))
                .expect("the folder's mode");
        };

        let saved = super::into_place(&target, b"second", |_| {
            folder(0o555);
            Err(std::io::Error::other("the file is mapped"))
        });
        folder(0o755);

        assert!(saved.is_err());
        assert_eq!(std::fs::read_to_string(&target).expect("the note"), "old");
        let copies: Vec<_> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .map(|one| one.expect("an entry").path())
            .filter(|one| *one != target)
            .collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(std::fs::read(&copies[0]).expect("the copy"), b"second");
    }

    #[test]
    fn an_in_place_write_keeps_the_file() {
        use std::io::{Read as _, Seek as _};

        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join("Note.md");
        super::write_in_place(&target, b"a first, longer version").expect("the first write");

        let mut held = std::fs::File::open(&target).expect("a reader holding the note");
        super::write_in_place(&target, b"second").expect("the second write");

        let mut through = String::new();
        held.rewind().expect("back to the start");
        held.read_to_string(&mut through).expect("the held file");
        assert_eq!(through, "second");

        let left: Vec<_> = std::fs::read_dir(dir.path())
            .expect("the folder")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, vec!["Note.md".to_string()]);
    }

    #[test]
    #[cfg(unix)]
    fn an_in_place_write_never_writes_through_a_link() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let outside = dir.path().join("outside.md");
        let link = dir.path().join("Note.md");
        std::fs::write(&outside, "untouched").expect("a file the link points at");
        std::os::unix::fs::symlink(&outside, &link).expect("a link");

        super::write_in_place(&link, b"words").expect("the write");

        assert_eq!(
            std::fs::read_to_string(&outside).expect("the far file"),
            "untouched"
        );
        assert_eq!(std::fs::read_to_string(&link).expect("the note"), "words");
        assert!(!std::fs::symlink_metadata(&link)
            .expect("the note")
            .file_type()
            .is_symlink());
    }

    #[test]
    #[cfg(unix)]
    fn a_private_file_is_the_owners_alone() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().expect("a temp folder");
        let secret = dir.path().join("automation.json");

        super::write_privately(&secret, b"{}").expect("the private write");

        let mode = std::fs::metadata(&secret)
            .expect("the file")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_note_with_the_longest_name_a_disk_allows_can_be_saved() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let target = dir.path().join(format!("{}.md", "a".repeat(240)));

        write_atomically(&target, b"words").expect("the write to land");
        assert_eq!(std::fs::read(&target).expect("the note"), b"words");
    }

    #[test]
    fn a_temp_file_is_named_after_the_front_of_the_note() {
        assert_eq!(super::temp_stem(Path::new("dir/Idea.md")), "Idea.md");

        let long = "\u{1F600}".repeat(40);
        let stem = super::temp_stem(Path::new(&long));
        assert!(stem.len() <= 64, "{} bytes", stem.len());
        assert_eq!(stem, "\u{1F600}".repeat(16));
    }

    #[test]
    fn numbering_goes_before_the_extension_for_files() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("Idea.md"), "").expect("a note");
        std::fs::write(here.join("Idea 2.md"), "").expect("a second note");
        std::fs::create_dir_all(here.join("Notes")).expect("a folder");

        assert_eq!(
            free_spot(&here.join("Idea.md"), true),
            here.join("Idea 3.md")
        );
        assert_eq!(free_spot(&here.join("Notes"), false), here.join("Notes 2"));
        assert_eq!(free_spot(&here.join("New.md"), true), here.join("New.md"));
    }

    fn names(paths: &[PathBuf]) -> Vec<String> {
        let mut found: Vec<String> = paths
            .iter()
            .filter_map(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .collect();
        found.sort();
        found
    }

    #[test]
    fn names_a_pdf_by_its_extension() {
        assert!(is_pdf(Path::new("a/paper.pdf")));
        assert!(is_pdf(Path::new("a/paper.PDF")));
        assert!(!is_pdf(Path::new("a/paper.pdf.md")));
        assert!(!is_pdf(Path::new("a/paper")));
    }

    #[test]
    fn names_a_canvas_by_its_extension() {
        assert!(is_canvas(Path::new("a/Board.canvas")));
        assert!(is_canvas(Path::new("a/Board.CANVAS")));
        assert!(!is_canvas(Path::new("a/Board.canvas.md")));
        assert!(!is_canvas(Path::new("a/Board")));
        assert!(!is_markdown(Path::new("a/Board.canvas")));
    }

    #[test]
    fn names_a_page_note_by_its_extension() {
        assert!(is_pages(Path::new("a/Journal.pages")));
        assert!(is_pages(Path::new("a/Journal.PAGES")));
        assert!(!is_pages(Path::new("a/Journal.pages.md")));
        assert!(!is_pages(Path::new("a/Journal")));
        assert!(is_base(Path::new("a/Bugs.base")));
        assert!(is_base(Path::new("a/Bugs.BASE")));
        assert!(!is_base(Path::new("a/Bugs.base.md")));
        assert!(!is_canvas(Path::new("a/Journal.pages")));
        assert!(!is_markdown(Path::new("a/Journal.pages")));
    }

    #[test]
    fn names_a_website_by_its_extension() {
        assert!(is_shortcut(Path::new("a/Svelte docs.url")));
        assert!(is_shortcut(Path::new("a/Svelte docs.URL")));
        assert!(is_shortcut(Path::new("a/Safari page.webloc")));
        assert!(!is_shortcut(Path::new("a/Svelte docs.url.md")));
        assert!(!is_shortcut(Path::new("a/Svelte docs")));
        assert!(!is_markdown(Path::new("a/Svelte docs.url")));
        assert!(!is_canvas(Path::new("a/Svelte docs.url")));
        assert!(!is_pages(Path::new("a/Svelte docs.url")));
    }

    #[test]
    fn highlights_sit_beside_the_pdf_under_its_whole_name() {
        assert_eq!(
            highlights_of(&path(&["Nib", "Notes", "paper.pdf"])),
            path(&["Nib", "Notes", "paper.pdf.highlights.json"])
        );
        assert_ne!(
            highlights_of(Path::new("paper.pdf")),
            highlights_of(Path::new("paper.PDF"))
        );
    }

    #[test]
    fn a_sidecar_never_leaves_the_folder_its_pdf_is_in() {
        let root = path(&["Documents", "Nib"]);
        let pdf = root.join("Notes").join("paper.pdf");

        assert_eq!(highlights_of(&pdf).parent(), pdf.parent());
        assert!(inside(&root, &highlights_of(&pdf)));
        assert!(!inside(&root, &folded(&root.join("..").join("secret.pdf"))));
    }

    #[test]
    fn the_sidecar_follows_the_pdf_and_goes_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let was = here.join("paper.pdf");
        let now = here.join("Reading").join("renamed.pdf");
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(&was, b"%PDF-1.4").expect("a pdf");
        std::fs::write(highlights_of(&was), "{}").expect("its highlights");

        std::fs::rename(&was, &now).expect("the move");
        move_held(&was, &now);

        assert!(!highlights_of(&was).exists());
        assert!(highlights_of(&now).exists());

        drop_held(&now);
        assert!(!highlights_of(&now).exists());
    }

    #[test]
    fn a_pdf_moved_where_old_highlights_lie_brings_its_own() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let was = here.join("paper.pdf");
        let now = here.join("renamed.pdf");
        std::fs::write(&was, b"%PDF-1.4").expect("a pdf");
        std::fs::write(highlights_of(&was), "mine").expect("its highlights");
        std::fs::write(highlights_of(&now), "left over").expect("highlights of a PDF gone");

        std::fs::rename(&was, &now).expect("the move");
        move_held(&was, &now);

        assert!(!highlights_of(&was).exists());
        assert_eq!(
            std::fs::read_to_string(highlights_of(&now)).expect("its own"),
            "mine"
        );
    }

    #[test]
    fn a_page_notes_paper_never_goes_over_a_pdf_already_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let lecture = here.join("Lecture.pages");
        let report = here.join("Report.pages");
        std::fs::write(&lecture, "{}").expect("a page note");
        std::fs::write(paper_of(&lecture), b"%PDF lecture").expect("its paper");
        std::fs::write(paper_of(&report), b"%PDF mine").expect("somebody's own PDF");
        let never = |_: &Path, _: &Path| false;

        assert_eq!(
            super::paper_in_the_way(&lecture, &report, never),
            Some(paper_of(&report))
        );
        std::fs::rename(&lecture, &report).expect("the note's own move");
        move_held(&lecture, &report);
        assert_eq!(
            std::fs::read(paper_of(&report)).expect("still there"),
            b"%PDF mine"
        );
        assert_eq!(
            std::fs::read(paper_of(&lecture)).expect("left where it was"),
            b"%PDF lecture"
        );

        assert_eq!(
            free_spot(&here.join("Report.pages"), true),
            here.join("Report 2.pages")
        );
    }

    #[test]
    fn a_page_note_respelled_is_not_in_its_own_way() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let lecture = here.join("Lecture.pages");
        std::fs::write(paper_of(&lecture), b"%PDF").expect("its paper");
        let same = |_: &Path, _: &Path| true;

        assert_eq!(
            super::paper_in_the_way(&lecture, &here.join("lecture.pages"), same),
            None
        );
        assert_eq!(
            super::paper_in_the_way(&lecture, &here.join("Elsewhere.pages"), same),
            None
        );
        assert_eq!(
            super::paper_in_the_way(&here.join("Idea.md"), &here.join("Note.md"), same),
            None
        );
    }

    #[test]
    fn a_pdf_arriving_never_shows_highlights_left_behind() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let plain = here.join("A.pdf");
        std::fs::write(&plain, b"%PDF a").expect("a PDF with no highlights");
        let gone = here.join("B.pdf");
        std::fs::write(highlights_of(&gone), "[\"old\"]").expect("leftovers");
        let copy = here.join("C.pdf");
        std::fs::write(highlights_of(&copy), "[\"old\"]").expect("leftovers");

        copy_held(&plain, &copy);
        assert!(!highlights_of(&copy).exists());

        std::fs::rename(&plain, &gone).expect("the PDF's own move");
        move_held(&plain, &gone);
        assert!(!highlights_of(&gone).exists());
    }

    #[test]
    fn a_pdf_never_lands_where_a_page_note_would_take_it_for_its_paper() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let mine = dir.path().join("A");
        let here = dir.path().join("B");
        std::fs::create_dir_all(&mine).expect("A");
        std::fs::create_dir_all(&here).expect("B");
        let note = here.join("Report.pages");
        std::fs::write(&note, "{}").expect("a page note of blank sheets");
        let pdf = mine.join("Report.pages.pdf");
        std::fs::write(&pdf, b"%PDF mine").expect("somebody's own PDF");
        let never = |_: &Path, _: &Path| false;

        assert_eq!(
            super::paper_in_the_way(&pdf, &here.join("Report.pages.pdf"), never),
            Some(note.clone())
        );
        assert_eq!(
            free_spot(&here.join("Report.pages.pdf"), true),
            here.join("Report.pages 2.pdf")
        );

        let lecture = here.join("Lecture.pages");
        std::fs::write(&lecture, "{}").expect("a page note of blank sheets");
        let slides = here.join("slides.pdf");
        std::fs::write(&slides, b"%PDF slides").expect("a PDF");
        assert_eq!(
            super::paper_in_the_way(&slides, &here.join("Lecture.pages.pdf"), never),
            Some(lecture)
        );
    }

    #[test]
    fn a_folder_of_a_page_notes_name_holds_no_paper() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let package = here.join("Report.pages");
        std::fs::create_dir_all(&package).expect("a Pages document");
        std::fs::write(paper_of(&package), b"%PDF mine").expect("a PDF beside it");
        let never = |_: &Path, _: &Path| false;

        let copy = here.join("Copy.pages");
        std::fs::create_dir_all(&copy).expect("the copy");
        copy_held(&package, &copy);
        assert!(!paper_of(&copy).exists());

        let moved = here.join("Final.pages");
        std::fs::rename(&package, &moved).expect("the folder's own move");
        move_held(&package, &moved);
        assert_eq!(
            std::fs::read(paper_of(&package)).expect("still there"),
            b"%PDF mine"
        );
        assert!(!paper_of(&moved).exists());

        std::fs::write(here.join("Other.pages.pdf"), b"%PDF other").expect("another PDF");
        assert_eq!(
            super::paper_in_the_way(&moved, &here.join("Other.pages"), never),
            None
        );
    }

    #[test]
    fn a_pdfs_name_is_taken_by_highlights_left_behind() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(highlights_of(&here.join("Paper.pdf")), "[]").expect("leftovers");

        assert_eq!(
            free_spot(&here.join("Paper.pdf"), true),
            here.join("Paper 2.pdf")
        );
    }

    #[test]
    fn a_note_has_no_sidecar_to_move() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let note = here.join("Idea.md");
        std::fs::write(highlights_of(&note), "{}").expect("a decoy");

        move_held(&note, &here.join("Other.md"));
        drop_held(&note);
        assert!(highlights_of(&note).exists());
    }

    #[test]
    fn a_page_note_holds_the_paper_named_after_it() {
        assert_eq!(
            paper_of(&path(&["Nib", "Lecture 4.pages"])),
            path(&["Nib", "Lecture 4.pages.pdf"])
        );

        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let paper = here.join("Lecture.pages.pdf");
        std::fs::write(&paper, "%PDF").expect("a paper");
        assert!(!held_paper(&paper));

        std::fs::write(here.join("Lecture.pages"), "{}").expect("its page note");
        assert!(held_paper(&paper));
        std::fs::write(here.join("Lecture.pdf"), "%PDF").expect("a pdf");
        assert!(!held_paper(&here.join("Lecture.pdf")));
        assert!(!held_paper(&here.join("Lecture.pages")));
        let capital = here.join("Lecture.pages.PDF");
        std::fs::remove_file(&paper).expect("the paper, gone");
        std::fs::write(&capital, "%PDF").expect("a capital PDF");
        let lecture = here.join("Lecture.pages");
        assert_eq!(held_paper(&capital), paper_of(&lecture).exists());
    }

    #[test]
    fn a_page_note_takes_its_paper_and_the_papers_highlights_with_it() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let was = here.join("Lecture.pages");
        let now = here.join("Reading").join("Week 1.pages");
        std::fs::create_dir_all(here.join("Reading")).expect("a folder");
        std::fs::write(&was, "{}").expect("a page note");
        std::fs::write(paper_of(&was), "%PDF").expect("its paper");
        std::fs::write(highlights_of(&paper_of(&was)), "{}").expect("the paper's highlights");

        std::fs::rename(&was, &now).expect("the move");
        move_held(&was, &now);

        assert!(!paper_of(&was).exists());
        assert!(paper_of(&now).exists());
        assert!(highlights_of(&paper_of(&now)).exists());

        let copy = here.join("Reading").join("Week 1 copy.pages");
        std::fs::copy(&now, &copy).expect("the copy");
        copy_held(&now, &copy);
        assert!(paper_of(&now).exists());
        assert!(paper_of(&copy).exists());
        assert!(highlights_of(&paper_of(&copy)).exists());

        drop_held(&copy);
        assert!(!paper_of(&copy).exists());
        assert!(!highlights_of(&paper_of(&copy)).exists());
        assert!(paper_of(&now).exists());
    }

    #[test]
    fn a_sidecar_is_not_one_of_the_files_of_a_space() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::write(here.join("paper.pdf"), "").expect("a pdf");
        std::fs::write(here.join("paper.pdf.highlights.json"), "{}").expect("its highlights");
        std::fs::write(here.join("notes.json"), "{}").expect("a plain json file");

        let (_notes, others) = files_in(here);
        assert_eq!(names(&others), ["notes.json", "paper.pdf"]);
    }

    #[test]
    fn tells_the_notes_of_a_space_from_the_files_beside_them() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Deep/Deeper")).expect("two folders");
        std::fs::create_dir_all(here.join(".hidden")).expect("a hidden folder");
        std::fs::write(here.join("One.md"), "").expect("a note");
        std::fs::write(here.join("Deep/Deeper/Two.markdown"), "").expect("a nested note");
        std::fs::write(here.join("Deep/notes.txt"), "").expect("a text file");
        std::fs::write(here.join("Deep/pic.png"), "").expect("a picture");
        std::fs::write(here.join(".hidden/Three.md"), "").expect("a hidden note");

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md", "Two.markdown"]);
        assert_eq!(names(&others), ["notes.txt", "pic.png"]);
    }

    #[test]
    fn stops_before_it_runs_out_of_stack() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let mut deep = dir.path().to_path_buf();
        for level in 0..34 {
            deep.push(format!("d{level}"));
        }
        std::fs::create_dir_all(&deep).expect("a very deep folder");
        std::fs::write(deep.join("Buried.md"), "").expect("a buried note");

        let (notes, others) = files_in(dir.path());
        assert!(notes.is_empty());
        assert!(others.is_empty());
    }

    #[test]
    fn a_cycle_of_symlinks_is_walked_once() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        std::fs::create_dir_all(here.join("Work")).expect("a folder");
        std::fs::create_dir_all(here.join("Home")).expect("another folder");
        std::fs::write(here.join("Work").join("One.md"), "").expect("a note");
        std::fs::write(here.join("Home").join("Two.md"), "").expect("another note");

        assert!(
            link_to(&here.join("Home"), &here.join("Work").join("to-home")),
            "a link from Work into Home"
        );
        assert!(
            link_to(&here.join("Work"), &here.join("Home").join("to-work")),
            "a link from Home into Work"
        );

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md", "Two.md"]);
        assert!(others.is_empty());
    }

    #[test]
    fn two_links_back_up_do_not_double_the_walk() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let here = dir.path();
        let inner = here.join("Notes");
        std::fs::create_dir_all(&inner).expect("a folder");
        std::fs::write(inner.join("One.md"), "").expect("a note");

        assert!(link_to(here, &inner.join("up")), "one link back up");
        assert!(link_to(here, &inner.join("over")), "a second link back up");

        let (notes, others) = files_in(here);
        assert_eq!(names(&notes), ["One.md"]);
        assert!(others.is_empty());
    }

    #[test]
    fn the_same_path_always_gets_the_same_folder() {
        assert_eq!(folder_key("/notes/a.md"), folder_key("/notes/a.md"));
    }

    #[test]
    fn different_paths_get_different_folders() {
        assert_ne!(folder_key("/notes/a.md"), folder_key("/notes/b.md"));
    }

    #[test]
    fn the_same_file_in_another_case_is_the_same_file() {
        let key = |path| folder_key_as(Naming::Win32, path);
        assert_eq!(key(r"C:\Notes\A.md"), key(r"c:\notes\a.md"));
    }

    #[test]
    fn two_names_apart_only_in_case_are_two_files_on_linux() {
        let key = |path| folder_key_as(Naming::Exact, path);
        assert_ne!(key("/Notes/Plan.md"), key("/Notes/plan.md"));
    }

    #[test]
    fn a_folder_linux_kept_by_the_lowercased_path_goes_with_that_spelling_only() {
        let root = tempfile::tempdir().expect("a temp folder");
        let was = root
            .path()
            .join(folder_key_as(Naming::Cased, "/Notes/Plan.md"));
        std::fs::create_dir(&was).expect("an old folder");
        std::fs::write(was.join(ORIGIN), "/Notes/Plan.md").expect("its origin");

        let kept = |path| kept_folder_named(root.path(), &folder_key_as(Naming::Exact, path), path);
        assert!(!kept("/Notes/plan.md").exists());
        assert!(was.exists());
        assert!(kept("/Notes/Plan.md").join(ORIGIN).exists());
        assert!(!was.exists());
    }

    #[test]
    fn the_folder_name_is_filesystem_safe() {
        let name = folder_key(r"C:\notes\a b.md");
        assert_eq!(name.len(), 16);
        assert!(name.chars().all(|letter| letter.is_ascii_hexdigit()));
    }
}
