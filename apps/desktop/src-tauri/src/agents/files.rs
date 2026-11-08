use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use tauri::{AppHandle, Manager as _};

use super::approvals::{self, Asking};
use super::grants::{Grant, Mode, Scope};
use super::verbs::{Answer, Category, Code, FileEntry, FileKind, Files, FilesDone, FilesOp};
use super::Caller;

const MOST_READ: usize = 1_000_000;

const MOST_LISTED: usize = 500;

const MOST_WALKED: usize = 20_000;

const MOST_SEARCHED: u64 = 2_000_000;

const SKIPPED: [&str; 2] = [".git", "node_modules"];

pub(super) fn answer(app: &AppHandle, caller: &Caller, asked: &Files) -> Answer {
    if !caller.holds(Scope::Files) {
        return Answer::error(
            Code::NotGranted,
            "files outside the spaces need the files scope, which the reader grants in Settings > Agents",
        );
    }
    let path = match resolved(app, &asked.path) {
        Ok(path) => path,
        Err(why) => return Answer::error(Code::BadArguments, why),
    };
    let to = match asked
        .to
        .as_deref()
        .map(|one| resolved(app, one))
        .transpose()
    {
        Ok(to) => to,
        Err(why) => return Answer::error(Code::BadArguments, why),
    };
    let mut fenced = Vec::new();
    if let Caller::Agent(grant) = caller {
        fenced = fences(app);
        if let Some(refused) = refused(&fenced, asked.op, &path, to.as_deref()) {
            return refused;
        }
        if let Some(question) = question(app, grant, asked, &path, to.as_deref()) {
            return question;
        }
    }
    let path = match super::working::on_disk(app, &path) {
        Ok(path) => path,
        Err(why) => return Answer::error(Code::BadArguments, why),
    };
    let to = match to.map(|one| super::working::on_disk(app, &one)).transpose() {
        Ok(to) => to,
        Err(why) => return Answer::error(Code::BadArguments, why),
    };
    match done(asked, &path, to.as_deref(), &fenced) {
        Ok(result) => Answer::Ok {
            untrusted: reads(asked.op).then(|| path.display().to_string()),
            result: serde_json::to_value(result).unwrap_or_default(),
            dialog: None,
        },
        Err(why) => Answer::error(Code::Failed, why),
    }
}

pub(super) fn writable(app: &AppHandle, caller: &Caller, asked: &str) -> Result<PathBuf, Answer> {
    reachable(app, caller, asked, FilesOp::Write)
}

pub(super) fn reachable(
    app: &AppHandle,
    caller: &Caller,
    asked: &str,
    op: FilesOp,
) -> Result<PathBuf, Answer> {
    let write = Files {
        op,
        path: asked.to_owned(),
        to: None,
        content: None,
        base64: false,
        glob: None,
        text: None,
        since: None,
    };
    if !caller.holds(Scope::Files) {
        return Err(Answer::error(
            Code::NotGranted,
            "saving to a file needs the files scope, which the reader grants in Settings > Agents",
        ));
    }
    let path = resolved(app, asked).map_err(|why| Answer::error(Code::BadArguments, why))?;
    if let Caller::Agent(grant) = caller {
        if let Some(refused) = refused(&fences(app), op, &path, None) {
            return Err(refused);
        }
        if let Some(question) = question(app, grant, &write, &path, None) {
            return Err(question);
        }
    }
    super::working::on_disk(app, &path).map_err(|why| Answer::error(Code::BadArguments, why))
}

pub(super) fn pick_reach(app: &AppHandle, path: &Path) -> PathBuf {
    reach_of(&own_folders(app), path)
}

fn reach_of(fenced: &[PathBuf], path: &Path) -> PathBuf {
    if path.is_dir() {
        return path.to_path_buf();
    }
    match path.parent() {
        Some(folder)
            if folder
                .parent()
                .is_some_and(|above| !above.as_os_str().is_empty())
                && refused(fenced, FilesOp::Copy, folder, None).is_none() =>
        {
            folder.to_path_buf()
        }
        _ => path.to_path_buf(),
    }
}

pub(super) fn absolute(app: &AppHandle, asked: &str) -> Result<PathBuf, String> {
    resolved(app, asked)
}

pub(super) fn fenced_out(app: &AppHandle, path: &Path) -> Option<Answer> {
    behind(&own_folders(app), path)
}

fn behind(fenced: &[PathBuf], path: &Path) -> Option<Answer> {
    let real_path = real(path);
    fenced
        .iter()
        .any(|fence| {
            let real_fence = real(fence);
            crate::paths::inside(fence, path) || crate::paths::inside(&real_fence, &real_path)
        })
        .then(|| {
            Answer::error(
                Code::NotGranted,
                format!(
                    "{} is in Orden's own folder, with the agents' grants and the sites' cookies: no agent reaches it",
                    path.display()
                ),
            )
        })
}

fn reads(op: FilesOp) -> bool {
    matches!(
        op,
        FilesOp::Read | FilesOp::List | FilesOp::Search | FilesOp::Changes
    )
}

fn changes(op: FilesOp) -> bool {
    matches!(
        op,
        FilesOp::Write
            | FilesOp::Append
            | FilesOp::Mkdir
            | FilesOp::Move
            | FilesOp::Copy
            | FilesOp::Delete
    )
}

fn resolved(app: &AppHandle, asked: &str) -> Result<PathBuf, String> {
    let asked = asked.trim();
    let given = if let Some(rest) = asked
        .strip_prefix("~/")
        .or_else(|| asked.strip_prefix("~\\"))
    {
        app.path()
            .home_dir()
            .map_err(|_| "this account has no home folder".to_owned())?
            .join(rest)
    } else if asked == "~" {
        app.path()
            .home_dir()
            .map_err(|_| "this account has no home folder".to_owned())?
    } else {
        PathBuf::from(asked)
    };
    if !given.is_absolute() {
        return Err(format!(
            "{asked} is not an absolute path: say where it is, or start it with ~/"
        ));
    }
    Ok(crate::paths::folded(&given))
}

fn fences(app: &AppHandle) -> Vec<PathBuf> {
    crate::paths::spaces_dir(app)
        .ok()
        .into_iter()
        .chain(own_folders(app))
        .collect()
}

pub(crate) fn own_folders(app: &AppHandle) -> Vec<PathBuf> {
    [
        crate::paths::config_dir(app).ok(),
        app.path().app_config_dir().ok(),
        app.path().app_data_dir().ok(),
        app.path().app_local_data_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn refused(fenced: &[PathBuf], op: FilesOp, path: &Path, to: Option<&Path>) -> Option<Answer> {
    let whole = matches!(op, FilesOp::Move | FilesOp::Copy | FilesOp::Delete);
    let meets = |fence: &Path, one: &Path| {
        crate::paths::inside(fence, one) || (whole && crate::paths::inside(one, fence))
    };
    let hit = std::iter::once(path).chain(to).find_map(|one| {
        let real_one = real(one);
        fenced.iter().find(|fence| {
            meets(fence.as_path(), one) || meets(real(fence).as_path(), real_one.as_path())
        })
    })?;
    let why = if fenced.first() == Some(hit) {
        "is in your spaces: use read_note, write_note, move_file, trash_file or create_folder, which keep links, undo and sync right"
    } else {
        "holds Orden's own folder, with the agents' grants and the sites' cookies: no agent reaches it"
    };
    Some(Answer::error(
        Code::NotGranted,
        format!("{} {why}", path.display()),
    ))
}

pub(crate) fn real(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut at = path;
    loop {
        if let Ok(found) = fs::canonicalize(at) {
            return rest
                .iter()
                .rev()
                .fold(found, |whole, part: &std::ffi::OsString| whole.join(part));
        }
        match (at.parent(), at.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                at = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

fn fenced_off(fenced: &[PathBuf], real_fenced: &[PathBuf], path: &Path) -> bool {
    fenced.iter().any(|fence| crate::paths::inside(fence, path)) || {
        let real_path = real(path);
        real_fenced
            .iter()
            .any(|fence| crate::paths::inside(fence, &real_path))
    }
}

fn question(
    app: &AppHandle,
    grant: &Grant,
    asked: &Files,
    path: &Path,
    to: Option<&Path>,
) -> Option<Answer> {
    let category = if asked.op == FilesOp::Delete {
        Category::Deleting
    } else if changes(asked.op) && grant.mode == Mode::Confirm && grant.asks(Category::Writing) {
        Category::Writing
    } else {
        Category::Files
    };
    if !grant.asks(category) {
        return None;
    }
    let folder = folder_of(path, asked.op);
    if category == Category::Files
        && ancestors(&folder).any(|one| grant.always(&one.to_string_lossy(), Category::Files))
    {
        return None;
    }
    let key = approvals::key(
        "files",
        None,
        Some(&format!(
            "{}:{}:{}",
            op_word(asked.op),
            path.display(),
            to.map_or_else(String::new, |one| one.display().to_string())
        )),
    );
    if approvals::allowed(&grant.id, &key) {
        return None;
    }
    Some(approvals::ask(
        app,
        Asking {
            agent: &grant.id,
            name: &grant.name,
            category,
            summary: summary(asked.op, path, to),
            site: Some(folder.display().to_string()),
            tab: None,
            key,
        },
    ))
}

fn folder_of(path: &Path, op: FilesOp) -> PathBuf {
    let about_a_folder = matches!(
        op,
        FilesOp::List | FilesOp::Search | FilesOp::Changes | FilesOp::Mkdir
    ) || path.is_dir();
    if about_a_folder {
        path.to_path_buf()
    } else {
        path.parent()
            .map_or_else(|| path.to_path_buf(), Path::to_path_buf)
    }
}

fn ancestors(folder: &Path) -> impl Iterator<Item = &Path> {
    folder.ancestors().filter(|one| !one.as_os_str().is_empty())
}

fn op_word(op: FilesOp) -> &'static str {
    match op {
        FilesOp::Read => "read",
        FilesOp::Write => "write",
        FilesOp::Append => "append",
        FilesOp::List => "list",
        FilesOp::Stat => "stat",
        FilesOp::Mkdir => "mkdir",
        FilesOp::Move => "move",
        FilesOp::Copy => "copy",
        FilesOp::Delete => "delete",
        FilesOp::Search => "search",
        FilesOp::Changes => "changes",
    }
}

fn summary(op: FilesOp, path: &Path, to: Option<&Path>) -> String {
    let path = path.display();
    let to = to.map_or_else(String::new, |one| one.display().to_string());
    match op {
        FilesOp::Read => format!("Read {path}"),
        FilesOp::Write => format!("Write {path}"),
        FilesOp::Append => format!("Add to {path}"),
        FilesOp::List | FilesOp::Stat => format!("Look in {path}"),
        FilesOp::Mkdir => format!("Make the folder {path}"),
        FilesOp::Move => format!("Move {path} to {to}"),
        FilesOp::Copy => format!("Copy {path} to {to}"),
        FilesOp::Delete => format!("Delete {path} for good"),
        FilesOp::Search => format!("Search {path}"),
        FilesOp::Changes => format!("Watch {path}"),
    }
}

fn millis(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH).map_or(0, |since| {
        u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
    })
}

fn entry(path: &Path) -> Result<FileEntry, String> {
    let meta = fs::symlink_metadata(path).map_err(|why| format!("{}: {why}", path.display()))?;
    let kind = if meta.file_type().is_symlink() {
        FileKind::Link
    } else if meta.is_dir() {
        FileKind::Folder
    } else {
        FileKind::File
    };
    Ok(FileEntry {
        path: path.display().to_string(),
        kind,
        size: if kind == FileKind::File {
            meta.len()
        } else {
            0
        },
        modified: meta.modified().map_or(0, millis),
    })
}

fn done(
    asked: &Files,
    path: &Path,
    to: Option<&Path>,
    fenced: &[PathBuf],
) -> Result<FilesDone, String> {
    let mut out = FilesDone {
        path: path.display().to_string(),
        ..FilesDone::default()
    };
    match asked.op {
        FilesOp::Read => read(path, asked.base64, &mut out)?,
        FilesOp::Write => {
            let bytes = content(asked)?;
            if let Some(folder) = path.parent() {
                fs::create_dir_all(folder).map_err(|why| why.to_string())?;
            }
            crate::paths::write_atomically(path, &bytes)?;
        }
        FilesOp::Append => {
            let bytes = content(asked)?;
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|why| why.to_string())?;
            file.write_all(&bytes).map_err(|why| why.to_string())?;
        }
        FilesOp::List => list(path, &mut out)?,
        FilesOp::Stat => out.entries.push(entry(path)?),
        FilesOp::Mkdir => fs::create_dir_all(path).map_err(|why| why.to_string())?,
        FilesOp::Move => moved(path, outside_of(path, needed(to)?)?)?,
        FilesOp::Copy => copied(path, outside_of(path, needed(to)?)?)?,
        FilesOp::Delete => deleted(path)?,
        FilesOp::Search => {
            if asked.glob.is_none() && asked.text.is_none() {
                return Err("say what to look for: glob, text or both".to_owned());
            }
            walk(path, fenced, &mut out, |found, file| {
                searched(found, file, asked.glob.as_deref(), asked.text.as_deref())
            })?;
        }
        FilesOp::Changes => {
            let since = asked.since.unwrap_or(0);
            out.now = Some(millis(SystemTime::now()));
            walk(path, fenced, &mut out, |_, file| file.modified > since)?;
        }
    }
    Ok(out)
}

fn needed(to: Option<&Path>) -> Result<&Path, String> {
    to.ok_or_else(|| "say where it goes, as to".to_owned())
}

fn outside_of<'a>(from: &Path, to: &'a Path) -> Result<&'a Path, String> {
    if crate::carry::goes_into_itself(from, to) {
        return Err(format!("{} cannot go inside itself", from.display()));
    }
    Ok(to)
}

fn content(asked: &Files) -> Result<Vec<u8>, String> {
    let words = asked
        .content
        .as_deref()
        .ok_or_else(|| "say what goes in it, as content".to_owned())?;
    if asked.base64 {
        base64::engine::general_purpose::STANDARD
            .decode(words)
            .map_err(|why| format!("content is not base64: {why}"))
    } else {
        Ok(words.as_bytes().to_vec())
    }
}

fn read(path: &Path, base64: bool, out: &mut FilesDone) -> Result<(), String> {
    if path.is_dir() {
        return Err(format!("{} is a folder: list it", path.display()));
    }
    let mut bytes = fs::read(path).map_err(|why| format!("{}: {why}", path.display()))?;
    if bytes.len() > MOST_READ {
        bytes.truncate(MOST_READ);
        out.truncated = true;
    }
    let text = if base64 {
        None
    } else {
        String::from_utf8(bytes.clone()).ok()
    };
    if let Some(text) = text {
        out.content = Some(text);
    } else {
        out.content = Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
        out.base64 = true;
    }
    Ok(())
}

fn list(path: &Path, out: &mut FilesDone) -> Result<(), String> {
    let mut names: Vec<PathBuf> = fs::read_dir(path)
        .map_err(|why| format!("{}: {why}", path.display()))?
        .filter_map(Result::ok)
        .map(|one| one.path())
        .collect();
    names.sort();
    if names.len() > MOST_LISTED {
        names.truncate(MOST_LISTED);
        out.truncated = true;
    }
    out.entries = names.iter().filter_map(|one| entry(one).ok()).collect();
    Ok(())
}

fn moved(from: &Path, to: &Path) -> Result<(), String> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(format!("{} is there already", to.display()));
    }
    if let Some(folder) = to.parent() {
        fs::create_dir_all(folder).map_err(|why| why.to_string())?;
    }
    if crate::carry::rename_new(from, to).is_ok() {
        return Ok(());
    }
    copied(from, to)?;
    deleted(from)
}

fn copied(from: &Path, to: &Path) -> Result<(), String> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(format!("{} is there already", to.display()));
    }
    let meta = fs::symlink_metadata(from).map_err(|why| format!("{}: {why}", from.display()))?;
    if meta.file_type().is_symlink() {
        if let Some(folder) = to.parent() {
            fs::create_dir_all(folder).map_err(|why| why.to_string())?;
        }
        let target = fs::read_link(from).map_err(|why| format!("{}: {why}", from.display()))?;
        return linked(from, &target, to).map_err(|why| format!("{}: {why}", to.display()));
    }
    if !meta.is_dir() {
        if let Some(folder) = to.parent() {
            fs::create_dir_all(folder).map_err(|why| why.to_string())?;
        }
        return fs::copy(from, to)
            .map(|_| ())
            .map_err(|why| why.to_string());
    }
    fs::create_dir_all(to).map_err(|why| why.to_string())?;
    for one in fs::read_dir(from).map_err(|why| why.to_string())?.flatten() {
        copied(&one.path(), &to.join(one.file_name()))?;
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn linked(_from: &Path, target: &Path, to: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, to)
}

#[cfg(windows)]
pub(crate) fn linked(from: &Path, target: &Path, to: &Path) -> std::io::Result<()> {
    if fs::metadata(from).is_ok_and(|meta| meta.is_dir()) {
        std::os::windows::fs::symlink_dir(target, to)
    } else {
        std::os::windows::fs::symlink_file(target, to)
    }
}

fn deleted(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|why| format!("{}: {why}", path.display()))?;
    let gone = if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    gone.map_err(|why| why.to_string())
}

fn walk(
    root: &Path,
    fenced: &[PathBuf],
    out: &mut FilesDone,
    mut keep: impl FnMut(&str, &FileEntry) -> bool,
) -> Result<(), String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    let real_fenced: Vec<PathBuf> = fenced.iter().map(PathBuf::as_path).map(real).collect();
    let mut waiting = vec![root.to_path_buf()];
    let mut walked = 0;
    while let Some(folder) = waiting.pop() {
        let Ok(inside) = fs::read_dir(&folder) else {
            continue;
        };
        for one in inside.flatten() {
            walked += 1;
            if walked > MOST_WALKED || out.entries.len() >= MOST_LISTED {
                out.truncated = true;
                return Ok(());
            }
            let path = one.path();
            let Ok(found) = entry(&path) else {
                continue;
            };
            if found.kind == FileKind::Folder {
                let name = one.file_name();
                if !fenced_off(fenced, &real_fenced, &path)
                    && !SKIPPED.iter().any(|skip| name == *skip)
                {
                    waiting.push(path);
                }
                continue;
            }
            let relative = path.strip_prefix(root).map_or_else(
                |_| String::new(),
                |one| one.to_string_lossy().replace('\\', "/"),
            );
            if keep(&relative, &found) {
                out.entries.push(found);
            }
        }
    }
    Ok(())
}

fn searched(relative: &str, file: &FileEntry, glob: Option<&str>, text: Option<&str>) -> bool {
    if let Some(glob) = glob {
        let name = relative.rsplit('/').next().unwrap_or(relative);
        let against = if glob.contains('/') { relative } else { name };
        if !globbed(glob, against) {
            return false;
        }
    }
    let Some(text) = text else {
        return true;
    };
    if file.kind != FileKind::File || file.size > MOST_SEARCHED {
        return false;
    }
    fs::read_to_string(&file.path)
        .is_ok_and(|words| words.to_lowercase().contains(&text.to_lowercase()))
}

fn globbed(glob: &str, name: &str) -> bool {
    let glob: Vec<char> = glob.chars().collect();
    let name: Vec<char> = name.chars().collect();
    matched(&glob, &name, (0, 0), &mut std::collections::HashSet::new())
}

fn same_letter(one: char, other: char) -> bool {
    one == other || one.to_lowercase().eq(other.to_lowercase())
}

fn matched(
    glob: &[char],
    name: &[char],
    (g, n): (usize, usize),
    failed: &mut std::collections::HashSet<(usize, usize)>,
) -> bool {
    if failed.contains(&(g, n)) {
        return false;
    }
    let found = match (glob.get(g), name.get(n)) {
        (None, None) => true,
        (Some('*'), _) if glob.get(g + 1) == Some(&'*') => {
            let rest = if glob.get(g + 2) == Some(&'/') {
                g + 3
            } else {
                g + 2
            };
            (n..=name.len()).any(|at| matched(glob, name, (rest, at), failed))
        }
        (Some('*'), _) => {
            let run = name[n..]
                .iter()
                .position(|one| *one == '/')
                .map_or(name.len(), |at| n + at);
            (n..=run).any(|at| matched(glob, name, (g + 1, at), failed))
        }
        (Some('?'), Some(one)) if *one != '/' => matched(glob, name, (g + 1, n + 1), failed),
        (Some(want), Some(one)) if same_letter(*want, *one) => {
            matched(glob, name, (g + 1, n + 1), failed)
        }
        _ => false,
    };
    if !found {
        failed.insert((g, n));
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_glob_reads_as_a_shell_reads_one() {
        assert!(globbed("*.rs", "main.rs"));
        assert!(!globbed("*.rs", "main.ts"));
        assert!(globbed("note?.md", "note1.md"));
        assert!(!globbed("*.md", "a/b.md"));
        assert!(globbed("**/*.md", "a/b/c.md"));
        assert!(globbed("**/*.md", "c.md"));
        assert!(globbed("src/**/mod.rs", "src/agents/mod.rs"));
        assert!(!globbed("src/*/mod.rs", "src/a/b/mod.rs"));
        assert!(globbed("README*", "readme.md"));
        let many = "a".repeat(200);
        assert!(!globbed("*a*a*a*a*a*a*a*a*a*a*a*a*b", &many));
        assert!(!globbed("**a**a**a**a**a**a**a**a**b", &many));
        assert!(globbed("?.md", "ü.md"));
        assert!(globbed("note-?.md", "note-日.md"));
        assert!(!globbed("?.md", "üb.md"));
        assert!(globbed("Ärger*", "ärger.txt"));
        assert!(globbed("*.MD", "Übersicht.md"));
    }

    fn temp() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let at = std::env::temp_dir().join(format!(
            "orden-files-{}-{}-{}",
            std::process::id(),
            millis(SystemTime::now()),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&at).expect("a folder");
        at
    }

    fn files(op: FilesOp, path: &Path) -> Files {
        Files {
            op,
            path: path.display().to_string(),
            to: None,
            content: None,
            base64: false,
            glob: None,
            text: None,
            since: None,
        }
    }

    #[test]
    fn a_file_is_written_read_moved_copied_and_deleted() {
        let root = temp();
        let file = root.join("deep/down/plan.txt");

        let mut write = files(FilesOp::Write, &file);
        write.content = Some("first".into());
        done(&write, &file, None, &[]).expect("written");
        let mut append = files(FilesOp::Append, &file);
        append.content = Some(" and more".into());
        done(&append, &file, None, &[]).expect("added");
        let read = done(&files(FilesOp::Read, &file), &file, None, &[]).expect("read");
        assert_eq!(read.content.as_deref(), Some("first and more"));
        assert!(!read.base64);

        let moved_to = root.join("elsewhere/plan.txt");
        done(&files(FilesOp::Move, &file), &file, Some(&moved_to), &[]).expect("moved");
        assert!(!file.exists() && moved_to.exists());

        let copy = root.join("copy");
        let elsewhere = root.join("elsewhere");
        done(
            &files(FilesOp::Copy, &elsewhere),
            &elsewhere,
            Some(&copy),
            &[],
        )
        .expect("copied");
        assert!(copy.join("plan.txt").exists());
        let over = copy.join("plan.txt");
        assert!(done(
            &files(FilesOp::Copy, &moved_to),
            &moved_to,
            Some(&over),
            &[]
        )
        .is_err());

        done(&files(FilesOp::Delete, &copy), &copy, None, &[]).expect("deleted");
        assert!(!copy.exists());

        let elsewhere = root.join("elsewhere");
        let inside = elsewhere.join("deeper");
        for op in [FilesOp::Copy, FilesOp::Move] {
            let refused = done(&files(op, &elsewhere), &elsewhere, Some(&inside), &[]);
            assert!(refused.is_err_and(|why| why.contains("inside itself")));
            assert!(!inside.exists() && moved_to.exists());
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn what_is_not_text_comes_back_as_base64() {
        let root = temp();
        let file = root.join("bytes.bin");
        let mut write = files(FilesOp::Write, &file);
        write.content = Some("/wD+".into());
        write.base64 = true;
        done(&write, &file, None, &[]).expect("written");
        assert_eq!(fs::read(&file).expect("there"), [0xff, 0x00, 0xfe]);
        let read = done(&files(FilesOp::Read, &file), &file, None, &[]).expect("read");
        assert!(read.base64);
        assert_eq!(read.content.as_deref(), Some("/wD+"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_search_finds_by_name_and_by_words_and_a_watch_what_changed() {
        let root = temp();
        fs::create_dir_all(root.join("a/.git")).expect("folders");
        fs::write(root.join("a/one.md"), "the Plan is here").expect("one");
        fs::write(root.join("a/two.txt"), "nothing").expect("two");
        fs::write(root.join("a/.git/three.md"), "plan").expect("three");

        let mut by_name = files(FilesOp::Search, &root);
        by_name.glob = Some("*.md".into());
        let found = done(&by_name, &root, None, &[]).expect("searched");
        assert_eq!(found.entries.len(), 1, "{found:?}");

        let mut by_words = files(FilesOp::Search, &root);
        by_words.text = Some("plan".into());
        let found = done(&by_words, &root, None, &[]).expect("searched");
        assert_eq!(found.entries.len(), 1);
        assert!(found.entries[0].path.ends_with("one.md"));

        let watched = done(&files(FilesOp::Changes, &root), &root, None, &[]).expect("watched");
        let since = watched.now;
        assert_eq!(watched.entries.len(), 2);
        let mut after = files(FilesOp::Changes, &root);
        after.since = since;
        assert!(done(&after, &root, None, &[])
            .expect("watched")
            .entries
            .is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_list_and_a_stat_say_what_is_there() {
        let root = temp();
        fs::create_dir_all(root.join("folder")).expect("folder");
        fs::write(root.join("file"), "12345").expect("file");
        let listed = done(&files(FilesOp::List, &root), &root, None, &[]).expect("listed");
        let kinds: Vec<(FileKind, u64)> = listed
            .entries
            .iter()
            .map(|one| (one.kind, one.size))
            .collect();
        assert_eq!(kinds, [(FileKind::File, 5), (FileKind::Folder, 0)]);
        assert!(done(&files(FilesOp::Read, &root), &root, None, &[]).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_fence_is_never_reached_and_a_walk_goes_round_it() {
        let root = temp();
        let fence = root.join("Orden");
        fs::create_dir_all(&fence).expect("fence");
        fs::write(fence.join("agents.json"), "secret plan").expect("grants");
        fs::write(root.join("mine.txt"), "my plan").expect("mine");
        let fenced = [root.join("spaces"), fence.clone()];

        let inside = fence.join("agents.json");
        assert!(refused(&fenced, FilesOp::Read, &inside, None).is_some());
        assert!(refused(&fenced, FilesOp::Delete, &root, None).is_some());
        assert!(refused(
            &fenced,
            FilesOp::Copy,
            &root.join("mine.txt"),
            Some(&inside)
        )
        .is_some());
        assert!(refused(&fenced, FilesOp::List, &root, None).is_none());

        let mut search = files(FilesOp::Search, &root);
        search.text = Some("plan".into());
        let found = done(&search, &root, None, &fenced).expect("searched");
        assert_eq!(found.entries.len(), 1);
        assert!(found.entries[0].path.ends_with("mine.txt"));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_never_carries_a_call_behind_a_fence() {
        let root = temp();
        let fence = root.join("Orden");
        fs::create_dir_all(&fence).expect("fence");
        fs::write(fence.join("agents.json"), "secret plan").expect("grants");
        let mine = root.join("mine");
        fs::create_dir_all(&mine).expect("mine");
        std::os::unix::fs::symlink(&fence, mine.join("door")).expect("link");
        std::os::unix::fs::symlink(&root, root.join("alias")).expect("alias");
        let fenced = [root.join("spaces"), fence.clone()];

        let through = mine.join("door/agents.json");
        assert!(refused(&fenced, FilesOp::Read, &through, None).is_some());
        assert!(refused(&fenced, FilesOp::Write, &mine.join("door/new.json"), None).is_some());
        assert!(refused(&fenced, FilesOp::Read, &mine.join("door"), None).is_some());
        assert!(refused(&fenced, FilesOp::List, &mine, None).is_none());

        let mut search = files(FilesOp::Search, &root.join("alias"));
        search.text = Some("plan".into());
        let found = done(&search, &root.join("alias"), None, &fenced).expect("searched");
        assert!(found.entries.is_empty(), "{:?}", found.entries);

        let copy = root.join("copy");
        copied(&mine, &copy).expect("copied");
        assert!(fs::symlink_metadata(copy.join("door"))
            .expect("the link")
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_link(copy.join("door")).expect("where"), fence);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_path_handed_to_the_system_is_never_behind_orden_s_fence() {
        let root = temp();
        let fence = root.join("Orden");
        fs::create_dir_all(&fence).expect("fence");
        fs::write(fence.join("agents.json"), "secret plan").expect("grants");
        let mine = root.join("mine");
        fs::create_dir_all(&mine).expect("mine");
        std::os::unix::fs::symlink(&fence, mine.join("door")).expect("link");
        std::os::unix::fs::symlink(fence.join("agents.json"), mine.join("grants")).expect("link");
        let fenced = [fence.clone()];

        assert!(behind(&fenced, &fence).is_some());
        assert!(behind(&fenced, &fence.join("agents.json")).is_some());
        assert!(behind(&fenced, &mine.join("door")).is_some());
        assert!(behind(&fenced, &mine.join("door/agents.json")).is_some());
        assert!(behind(&fenced, &mine.join("grants")).is_some());
        assert!(behind(&fenced, &root).is_none());
        assert!(behind(&fenced, &mine).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_path_an_agent_answers_a_dialog_with_reaches_no_further_than_a_pick() {
        let root = temp();
        let config = root.join("config");
        let fence = config.join("Orden");
        fs::create_dir_all(&fence).expect("fence");
        let desk = root.join("Desktop");
        fs::create_dir_all(&desk).expect("desk");
        std::os::unix::fs::symlink(&config, root.join("alias")).expect("alias");
        let fenced = [fence.clone()];

        assert_eq!(reach_of(&fenced, &desk.join("Plan.pdf")), desk);
        assert_eq!(reach_of(&fenced, &desk), desk);
        let beside = config.join("Plan.pdf");
        assert_eq!(reach_of(&fenced, &beside), beside);
        let through = root.join("alias").join("Plan.pdf");
        assert_eq!(reach_of(&fenced, &through), through);
        assert_eq!(
            reach_of(&fenced, Path::new("/Plan.pdf")),
            Path::new("/Plan.pdf")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_changed_call_and_a_reading_one_are_told_apart() {
        assert!(changes(FilesOp::Delete) && changes(FilesOp::Write));
        assert!(!changes(FilesOp::Read) && !changes(FilesOp::Search));
        assert!(reads(FilesOp::Read) && !reads(FilesOp::Write));
    }
}
