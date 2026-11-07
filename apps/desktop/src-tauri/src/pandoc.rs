use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::assets::safe_name;
use crate::paths::{chosen, in_spaces, inside, space_root, spaces_dir};

const READ_AS: &str =
    "markdown_strict+pipe_tables+backtick_code_blocks+strikeout+task_lists+tex_math_dollars";

const CONVERTING: Duration = Duration::from_secs(10 * 60);

const WRITE_FROM: &str = "markdown+tex_math_dollars+pipe_tables+task_lists+footnotes+strikeout";

#[cfg(any(target_os = "macos", all(test, unix)))]
mod finding;

#[cfg_attr(not(windows), allow(unused_mut))]
fn pandoc() -> Command {
    let mut command = Command::new(program());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
}

#[cfg(not(target_os = "macos"))]
fn program() -> PathBuf {
    PathBuf::from("pandoc")
}

#[cfg(target_os = "macos")]
fn program() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let folders = finding::folders(std::env::var_os("PATH").as_deref(), home.as_deref());

    finding::first_in(&folders, runs)
        .or_else(from_login_shell)
        .unwrap_or_else(|| PathBuf::from("pandoc"))
}

#[cfg(target_os = "macos")]
fn runs(program: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    fs::metadata(program)
        .is_ok_and(|found| found.is_file() && found.permissions().mode() & 0o111 != 0)
}

#[cfg(target_os = "macos")]
fn from_login_shell() -> Option<PathBuf> {
    static ASKED: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    ASKED.get_or_init(ask_login_shell).clone()
}

#[cfg(target_os = "macos")]
fn ask_login_shell() -> Option<PathBuf> {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    let said = crate::printed::output(
        Command::new(shell).args(["-ilc", "command -v pandoc"]),
        Duration::from_secs(3),
    )
    .ok()?;
    finding::shell_answer(&String::from_utf8_lossy(&said.stdout)).filter(|program| runs(program))
}

#[tauri::command(async)]
pub fn has_pandoc() -> bool {
    pandoc()
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[derive(Debug, PartialEq)]
enum Copying {
    Safe,
    Unsafe,
    Unknown(String),
}

const PATIENCE: Duration = Duration::from_secs(10);

fn extracts_safely() -> Copying {
    copying(pandoc(), PATIENCE)
}

fn copying(mut command: Command, patience: Duration) -> Copying {
    let probe = match tempfile::tempdir() {
        Ok(probe) => probe,
        Err(error) => {
            return Copying::Unknown(format!("there was no folder to try it in: {error}"))
        }
    };
    let inside = probe.path().join("a").join("b").join("c").join("inside");
    if let Err(error) = fs::create_dir_all(&inside) {
        return Copying::Unknown(format!("there was no folder to try it in: {error}"));
    }
    let child = command
        .current_dir(&inside)
        .args([
            "--from",
            "markdown",
            "--to",
            "markdown",
            "--extract-media",
            ".",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(error) => return Copying::Unknown(format!("pandoc could not start: {error}")),
    };
    if let Some(mut sink) = child.stdin.take() {
        let _ = sink.write_all(CLIMBING.as_bytes());
    }
    match waited(&mut child, patience) {
        None => Copying::Unknown(format!(
            "pandoc gave no answer within {} seconds",
            patience.as_secs()
        )),
        Some(false) => Copying::Unknown("pandoc failed on the pictures it was given".to_string()),
        Some(true) if wrote_outside(probe.path(), &inside) => Copying::Unsafe,
        Some(true) => Copying::Safe,
    }
}

fn waited(child: &mut Child, patience: Duration) -> Option<bool> {
    let deadline = Instant::now() + patience;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.success()),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn wrote_outside(folder: &Path, inside: &Path) -> bool {
    let Ok(found) = fs::read_dir(folder) else {
        return true;
    };
    found.into_iter().any(|entry| {
        let Ok(entry) = entry else { return true };
        let path = entry.path();
        if path == inside {
            return false;
        }
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => wrote_outside(&path, inside),
            _ => true,
        }
    })
}

const CLIMBING: &str = "![](data://image/png;base64,aGVsbG8=;.lua+%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fonce%2elua)\n\n![](data://image/png;base64,aGVsbG8=;.lua+%252f%252e%252e%252f%252e%252e%252f%252e%252e%252ftwice%252elua)\n";

fn reading(source: &str, media: bool) -> Vec<&str> {
    let mut args = vec!["--sandbox", "--to", READ_AS, "--wrap", "none"];
    if media {
        args.extend(["--extract-media", "."]);
    }
    args.extend(["--", source]);
    args
}

#[tauri::command(async)]
pub fn import_document(app: AppHandle, path: String) -> Result<Imported, String> {
    import_from(&chosen(&app, &path)?)
}

fn import_from(source: &Path) -> Result<Imported, String> {
    let copying = extracts_safely();
    let media = tempfile::tempdir()
        .map_err(|error| format!("there was no folder to read the pictures into: {error}"))?;
    let source = source.to_string_lossy().to_string();

    let result = crate::printed::output(
        pandoc()
            .current_dir(media.path())
            .args(reading(&source, copying == Copying::Safe)),
        CONVERTING,
    )
    .map_err(|error| not_run(&error))?;

    if !result.status.success() {
        return Err(read_refusal(&result.stderr));
    }
    let markdown = String::from_utf8(result.stdout)
        .map_err(|error| format!("pandoc returned something that is not text: {error}"))?;
    let mut left_out = left_out(&copying, &markdown);
    let mut pictures = Vec::new();
    if copying == Copying::Safe {
        let mut too_large = false;
        let mut total = 0;
        gathered(
            media.path(),
            media.path(),
            &mut pictures,
            (&mut total, &mut too_large),
        );
        if too_large {
            left_out = Some(PICTURES_TOO_LARGE.to_string());
        }
    }
    Ok(Imported {
        markdown,
        left_out,
        pictures,
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    markdown: String,
    left_out: Option<String>,
    pictures: Vec<Picture>,
}

#[derive(Debug, serde::Serialize)]
pub struct Picture {
    link: String,
    data: String,
}

const MOST_PICTURE_BYTES: u64 = 24 * 1024 * 1024;

const MOST_PICTURES_BYTES: u64 = 96 * 1024 * 1024;

const PICTURES_TOO_LARGE: &str =
    "Some pictures were left out, since they are larger than a note can keep";

fn gathered(
    top: &Path,
    folder: &Path,
    pictures: &mut Vec<Picture>,
    (total, too_large): (&mut u64, &mut bool),
) {
    use base64::Engine as _;

    let Ok(found) = fs::read_dir(folder) else {
        return;
    };
    let mut entries: Vec<_> = found.flatten().collect();
    entries.sort_by_key(fs::DirEntry::path);
    for entry in entries {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            gathered(top, &path, pictures, (&mut *total, &mut *too_large));
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let size = entry.metadata().map_or(u64::MAX, |meta| meta.len());
        if size > MOST_PICTURE_BYTES || *total + size > MOST_PICTURES_BYTES {
            *too_large = true;
            continue;
        }
        *total += size;
        let (Ok(relative), Ok(bytes)) = (path.strip_prefix(top), fs::read(&path)) else {
            continue;
        };
        let link = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        pictures.push(Picture {
            link,
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
}

fn left_out(copying: &Copying, markdown: &str) -> Option<String> {
    if !markdown.contains("![") && !markdown.contains("<img") {
        return None;
    }
    match copying {
        Copying::Safe => None,
        Copying::Unsafe => Some(PICTURES_LEFT_OUT.to_string()),
        Copying::Unknown(why) => Some(format!(
            "The pictures were left out, since it could not be checked that pandoc copies them safely: {why}"
        )),
    }
}

const PICTURES_LEFT_OUT: &str = "The pictures were left out: this pandoc can be made to write pictures outside their folder, and 3.1.6 or newer brings them in";

fn read_refusal(stderr: &[u8]) -> String {
    let said = complaint(stderr, "pandoc could not read that file");
    if said.contains("--sandbox") {
        return "Importing needs pandoc 2.15 or newer, which reads a document without reaching the rest of this computer".to_string();
    }
    said
}

fn is_format(format: &str) -> bool {
    !format.is_empty()
        && format.len() <= 40
        && format.starts_with(|first: char| first.is_ascii_lowercase())
        && format.chars().all(|one| {
            one.is_ascii_lowercase()
                || one.is_ascii_digit()
                || one == '-'
                || one == '_'
                || one == '+'
        })
}

#[tauri::command(async)]
pub fn run_pandoc(
    app: AppHandle,
    source: String,
    output: String,
    format: String,
    note: Option<String>,
) -> Result<Vec<String>, String> {
    if !is_format(&format) {
        return Err(format!("{format} is not a format pandoc writes"));
    }
    let target = chosen(&app, &output)?;
    let place = match note {
        Some(note) => {
            let note = in_spaces(&app, &note)?;
            let space = space_root(&spaces_dir(&app)?, &note)
                .ok_or_else(|| format!("{} is not in a space", note.display()))?;
            let folder = note
                .parent()
                .map_or_else(|| space.clone(), Path::to_path_buf);
            Some((folder, space))
        }
        None => None,
    };
    let place = place
        .as_ref()
        .map(|(folder, space)| Place { folder, space });
    convert(&source, &target, &format, place.as_ref())
}

struct Place<'a> {
    folder: &'a Path,
    space: &'a Path,
}

fn convert(
    source: &str,
    target: &Path,
    format: &str,
    place: Option<&Place>,
) -> Result<Vec<String>, String> {
    let deck = format == "revealjs";
    if deck {
        match extracts_safely() {
            Copying::Safe => {}
            Copying::Unsafe => return Err(DECK_REFUSAL.to_string()),
            Copying::Unknown(why) => {
                return Err(format!(
                    "The deck was not written, since it could not be checked that pandoc copies its pictures safely: {why}"
                ))
            }
        }
    }

    if !carries_pictures(format) {
        let mut command = pandoc();
        command
            .args(["--sandbox", "--from", WRITE_FROM, "--to", format])
            .args(["--standalone", "--output"])
            .arg(target);
        let result = piped(command, source.to_string())?;
        if result.status.success() {
            return Ok(not_found(&result.stderr));
        }
        return Err(complaint(&result.stderr, "pandoc failed"));
    }

    let mut read = pandoc();
    read.args(["--sandbox", "--from", WRITE_FROM, "--to", "json"]);
    let tree = piped(read, source.to_string())?;
    if !tree.status.success() {
        return Err(complaint(&tree.stderr, "pandoc could not read the note"));
    }
    let mut tree: serde_json::Value = serde_json::from_slice(&tree.stdout)
        .map_err(|error| format!("pandoc returned a tree that could not be read: {error}"))?;

    let pictures = tempfile::tempdir()
        .map_err(|error| format!("there was no folder to gather the pictures in: {error}"))?;
    let mut missing = vetted(&mut tree, place, pictures.path(), deck);

    let mut command = pandoc();
    command.args(["--from", "json", "--to", format, "--standalone"]);
    command.arg(joined("--resource-path=", pictures.path().as_os_str()));
    if deck {
        let beside = target
            .parent()
            .ok_or_else(|| format!("{} is not in a folder", target.display()))?;
        let stem = target.file_stem().unwrap_or_default();
        command.current_dir(beside);
        command.arg(joined("--extract-media=", &joined_name(stem, "_files")));
    }
    command.arg("--output").arg(target);

    let result = piped(command, tree.to_string())?;
    if result.status.success() {
        for name in not_found(&result.stderr) {
            if !missing.contains(&name) {
                missing.push(name);
            }
        }
        return Ok(missing);
    }

    Err(complaint(&result.stderr, "pandoc failed"))
}

fn carries_pictures(format: &str) -> bool {
    let name = format.split(['+', '-']).next().unwrap_or(format);
    matches!(
        name,
        "odt"
            | "docx"
            | "pptx"
            | "icml"
            | "html"
            | "html4"
            | "html5"
            | "revealjs"
            | "slidy"
            | "slideous"
            | "dzslides"
            | "s5"
    )
}

fn not_run(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::TimedOut {
        format!(
            "pandoc gave no answer within {} minutes",
            CONVERTING.as_secs() / 60
        )
    } else {
        format!("pandoc could not start: {error}. Is it installed?")
    }
}

fn piped(mut command: Command, input: String) -> Result<std::process::Output, String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    let mut sink = child.stdin.take().ok_or("could not write to pandoc")?;
    let writer = std::thread::spawn(move || sink.write_all(input.as_bytes()));

    let result = crate::printed::wait_output(child, CONVERTING).map_err(|error| not_run(&error))?;
    let written = writer
        .join()
        .map_err(|_| "the thread feeding pandoc stopped".to_string())?;

    match written {
        Err(error) if result.status.success() => {
            Err(format!("could not send the note to pandoc: {error}"))
        }
        _ => Ok(result),
    }
}

fn vetted(
    tree: &mut serde_json::Value,
    place: Option<&Place>,
    into: &Path,
    deck: bool,
) -> Vec<String> {
    let mut refused = Vec::new();
    let mut copied: Vec<(PathBuf, String)> = Vec::new();
    vet(
        tree,
        &mut |link: &str| {
            let real = place.and_then(|place| admitted(link, place))?;
            if let Some((_, name)) = copied.iter().find(|(from, _)| *from == real) {
                return Some(name.clone());
            }
            let name = copied_in(&real, into)?;
            copied.push((real, name.clone()));
            Some(name)
        },
        &mut refused,
        deck,
    );
    refused
}

fn vet(
    node: &mut serde_json::Value,
    judge: &mut dyn FnMut(&str) -> Option<String>,
    refused: &mut Vec<String>,
    deck: bool,
) {
    use serde_json::Value;

    match node {
        Value::Array(items) => {
            for item in items {
                vet(item, judge, refused, deck);
            }
        }
        Value::Object(fields) => {
            let kind = fields
                .get("t")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let content = fields.get_mut("c");
            match (kind.as_str(), content) {
                ("Image", Some(content)) => {
                    let link = content
                        .get(2)
                        .and_then(|target| target.get(0))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    if let Some(name) = judge(&link) {
                        if let Some(target) = content.get_mut(2).and_then(|one| one.get_mut(0)) {
                            *target = Value::String(name);
                        }
                    } else {
                        refused.push(link);
                        let alt = content
                            .get(1)
                            .cloned()
                            .unwrap_or_else(|| Value::Array(Vec::new()));
                        *node = serde_json::json!({ "t": "Span", "c": [["", [], []], alt] });
                    }
                }
                ("RawInline" | "RawBlock", Some(Value::Array(raw))) if deck => {
                    let html = raw
                        .first()
                        .and_then(Value::as_str)
                        .is_some_and(|format| format.starts_with("html") || format == "revealjs");
                    let text = raw.get(1).and_then(Value::as_str).unwrap_or_default();
                    if html && loads(text) {
                        refused.push(text.trim().chars().take(80).collect());
                        raw[1] = Value::String(String::new());
                    }
                }
                _ => {}
            }
            if let Value::Object(fields) = node {
                for value in fields.values_mut() {
                    vet(value, judge, refused, deck);
                }
            }
        }
        _ => {}
    }
}

fn loads(html: &str) -> bool {
    let html = html.to_ascii_lowercase();
    ["src", "poster", "data="]
        .iter()
        .any(|one| html.contains(one))
}

fn admitted(link: &str, place: &Place) -> Option<PathBuf> {
    if link.is_empty() || has_scheme(link) {
        return None;
    }
    let space = fs::canonicalize(place.space).ok()?;
    let bare = link.split(['?', '#']).next().unwrap_or(link);
    [link, bare].into_iter().find_map(|one| {
        let name = decoded(one)?;
        let mut start = name.chars().take(2);
        if start.clone().count() == 2 && start.all(|one| one == '/' || one == '\\') {
            return None;
        }
        let path = place.folder.join(name);
        let real = fs::canonicalize(path).ok()?;
        let below = real.components().skip(space.components().count());
        let hidden = below
            .clone()
            .any(|part| part.as_os_str().to_string_lossy().starts_with('.'));
        (real.is_file() && inside(&space, &real) && !hidden).then_some(real)
    })
}

fn has_scheme(link: &str) -> bool {
    let Some((scheme, _)) = link.split_once(':') else {
        return false;
    };
    scheme.len() > 1
        && scheme.starts_with(|first: char| first.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || one == '+' || one == '-' || one == '.')
}

fn decoded(link: &str) -> Option<String> {
    let bytes = link.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let hex = |one: u8| (one as char).to_digit(16);
        match (bytes[at], bytes.get(at + 1), bytes.get(at + 2)) {
            (b'%', Some(&high), Some(&low)) if hex(high).is_some() && hex(low).is_some() => {
                out.push(u8::try_from(hex(high)? * 16 + hex(low)?).ok()?);
                at += 3;
            }
            (one, _, _) => {
                out.push(one);
                at += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn copied_in(real: &Path, into: &Path) -> Option<String> {
    let name = safe_name(&real.file_name()?.to_string_lossy())?;
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name.as_str(), ""),
    };
    let free = (1..=10_000)
        .map(|count| match count {
            1 => name.clone(),
            _ => format!("{stem}-{count}{extension}"),
        })
        .find(|one| !into.join(one).exists())?;
    fs::copy(real, into.join(&free)).ok()?;
    Some(free)
}

const DECK_REFUSAL: &str = "Exporting a deck needs pandoc 3.1.6 or newer: this pandoc can be made to write a deck's pictures outside the deck's folder";

fn joined(option: &str, value: &std::ffi::OsStr) -> std::ffi::OsString {
    let mut out = std::ffi::OsString::from(option);
    out.push(value);
    out
}

fn joined_name(stem: &std::ffi::OsStr, end: &str) -> std::ffi::OsString {
    let mut out = stem.to_os_string();
    out.push(end);
    out
}

fn not_found(stderr: &[u8]) -> Vec<String> {
    const SAID: &str = "Could not fetch resource ";
    let text = String::from_utf8_lossy(stderr);
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let Some(at) = line.find(SAID) else { continue };
        let rest = &line[at + SAID.len()..];
        let name = match rest.find("PandocResourceNotFound \"") {
            Some(quoted) => {
                let inner = &rest[quoted + "PandocResourceNotFound \"".len()..];
                inner.split('"').next().unwrap_or(inner)
            }
            None => rest.rsplit_once(": ").map_or(rest, |(name, _)| name),
        };
        let name = name.trim().trim_matches('\'').to_string();
        if !name.is_empty() && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

fn complaint(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr);

    if message.trim().is_empty() {
        fallback.to_string()
    } else {
        message.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        admitted, carries_pictures, complaint, convert, extracts_safely, has_pandoc, import_from,
        is_format, left_out, not_found, pandoc, read_refusal, reading, vetted, wrote_outside,
        Copying, Imported, Place, DECK_REFUSAL, PICTURES_LEFT_OUT,
    };
    #[cfg(unix)]
    use super::{copying, PATIENCE};
    use std::fs;
    use std::io::{Read as _, Write as _};
    use std::path::Path;

    fn imported(beside: &Path, name: &str) -> Imported {
        import_from(&beside.join(name)).expect("pandoc reads it")
    }

    fn names_in(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(folder)
            .expect("a folder")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        names.sort();
        names
    }

    fn pandoc_here() -> bool {
        let here = has_pandoc();
        if !here {
            eprintln!("pandoc is not installed here, so this test checks nothing");
        }
        here
    }

    #[test]
    fn an_import_runs_pandoc_in_its_sandbox() {
        let args = reading("paper.tex", true);
        let sandbox = args.iter().position(|one| *one == "--sandbox");
        let marker = args.iter().position(|one| *one == "--");
        assert!(sandbox.is_some_and(|at| marker.is_some_and(|end| at < end)));
    }

    #[test]
    fn an_old_pandoc_is_refused_and_says_why() {
        let said =
            read_refusal(b"Unknown option --sandbox.\nTry pandoc --help for more information.\n");
        assert!(said.contains("2.15"), "{said}");
        assert_eq!(read_refusal(b"no such file\n"), "no such file");
    }

    #[test]
    fn an_include_in_a_document_reads_no_file_of_this_machine() {
        if !pandoc_here() {
            return;
        }
        let secrets = tempfile::tempdir().expect("a folder");
        let key = secrets.path().join("id_rsa");
        fs::write(&key, "PRIVATE KEY 7f3a\n").expect("written");
        let key = key.to_string_lossy().replace('\\', "/");

        let documents = tempfile::tempdir().expect("a folder");
        let beside = documents.path();
        fs::write(
            beside.join("paper.tex"),
            format!(
                "\\documentclass{{article}}\n\\usepackage{{listings}}\n\\begin{{document}}\nHi\n\\lstinputlisting{{{key}}}\n\\end{{document}}\n"
            ),
        )
        .expect("written");
        fs::write(
            beside.join("notes.rst"),
            format!("Hi\n\n.. include:: {key}\n   :literal:\n"),
        )
        .expect("written");
        fs::write(
            beside.join("plan.org"),
            format!("Hi\n\n#+INCLUDE: \"{key}\" src text\n"),
        )
        .expect("written");

        for name in ["paper.tex", "notes.rst", "plan.org"] {
            let read = imported(beside, name);
            assert!(!read.markdown.contains("PRIVATE KEY"), "{name}: {read:?}");
            assert!(read.markdown.contains("Hi"), "{name}: {read:?}");
        }
    }

    fn docx_with_picture(beside: &Path, name: &str) {
        fs::write(beside.join("dot.png"), DOT).expect("written");
        let made = pandoc()
            .current_dir(beside)
            .args(["--from", "markdown", "--to", "docx", "--output", name])
            .arg("--")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                child
                    .stdin
                    .take()
                    .expect("stdin")
                    .write_all(b"Text\n\n![a dot](dot.png)\n")?;
                child.wait()
            })
            .expect("pandoc writes a docx");
        assert!(made.success());
        fs::remove_file(beside.join("dot.png")).expect("removed");
    }

    #[test]
    fn a_picture_inside_a_document_comes_in_with_the_words() {
        use base64::Engine as _;

        if !pandoc_here() {
            return;
        }
        let folder = tempfile::tempdir().expect("a folder");
        let beside = folder.path();
        docx_with_picture(beside, "with.docx");

        let read = imported(beside, "with.docx");
        assert!(read.markdown.contains("Text"), "{read:?}");
        assert_eq!(names_in(beside), ["with.docx"], "{read:?}");
        let copying = extracts_safely();
        if copying != Copying::Safe {
            assert!(read.pictures.is_empty(), "{read:?}");
            assert!(read.left_out.is_some(), "{read:?}");
            return;
        }
        assert_eq!(read.left_out, None);
        assert_eq!(read.pictures.len(), 1, "{read:?}");
        let picture = &read.pictures[0];
        assert!(read.markdown.contains(&picture.link), "{read:?}");
        assert!(!picture.link.contains('\\'), "{}", picture.link);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&picture.data)
            .expect("base64");
        assert!(bytes.starts_with(&DOT[..8]), "not a png");
    }

    #[test]
    fn an_import_writes_no_picture_outside_its_folder() {
        if !pandoc_here() {
            return;
        }
        let documents = tempfile::tempdir().expect("a folder");
        let inner = documents.path().join("inner");
        fs::create_dir(&inner).expect("a folder");
        docx_with_picture(&inner, "plain.docx");
        climb_out(&inner.join("plain.docx"), &inner.join("paper.docx"));
        fs::remove_file(inner.join("plain.docx")).expect("removed");

        let read = imported(&inner, "paper.docx");

        assert!(read.markdown.contains("Text"), "{read:?}");
        assert!(!wrote_outside(documents.path(), &inner), "{read:?}");
        assert_eq!(names_in(&inner), ["paper.docx"], "{read:?}");
    }

    fn climb_out(from: &Path, to: &Path) {
        const CLIMB: &str = "x%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fescaped.lua";
        let mut archive =
            zip::ZipArchive::new(fs::File::open(from).expect("a docx")).expect("a zip");
        let pictures: Vec<String> = archive
            .file_names()
            .filter_map(|name| name.strip_prefix("word/media/"))
            .map(str::to_string)
            .collect();
        assert!(!pictures.is_empty());
        let mut out = zip::ZipWriter::new(fs::File::create(to).expect("a file"));
        for at in 0..archive.len() {
            let mut entry = archive.by_index(at).expect("an entry");
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("read");
            let mut name = entry.name().to_string();
            let words = !name.starts_with("word/media/");
            for picture in &pictures {
                let renamed = format!("media/{CLIMB}{picture}");
                name = name.replace(&format!("media/{picture}"), &renamed);
                if words {
                    bytes = String::from_utf8_lossy(&bytes)
                        .replace(&format!("media/{picture}"), &renamed)
                        .into_bytes();
                }
            }
            out.start_file(name, zip::write::SimpleFileOptions::default())
                .expect("an entry");
            out.write_all(&bytes).expect("written");
        }
        out.finish().expect("a docx");
    }

    #[test]
    fn a_deck_writes_no_picture_outside_its_folder() {
        if !pandoc_here() {
            return;
        }
        let elsewhere = tempfile::tempdir().expect("a folder");
        let inner = elsewhere.path().join("inner");
        fs::create_dir(&inner).expect("a folder");
        let note = "Text\n\n![](data://image/png;base64,aGVsbG8=;.lua+%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fescaped%2elua)\n";

        let made = convert(note, &inner.join("Deck.html"), "revealjs", None);

        match extracts_safely() {
            Copying::Safe => assert!(made.is_ok(), "{made:?}"),
            _ => assert!(made.is_err(), "{made:?}"),
        }
        assert!(!wrote_outside(elsewhere.path(), &inner), "{made:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_pandoc_that_writes_outside_its_folder_is_not_trusted() {
        assert_eq!(
            copying(stand_in("cat >/dev/null; echo x > ../out"), PATIENCE),
            Copying::Unsafe
        );
        assert_eq!(
            copying(stand_in("cat >/dev/null; echo x > ../../../out"), PATIENCE),
            Copying::Unsafe
        );
        assert_eq!(
            copying(
                stand_in("cat >/dev/null; ln -s /etc/passwd ../../link"),
                PATIENCE
            ),
            Copying::Unsafe
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_pandoc_that_writes_only_inside_its_folder_is_trusted() {
        assert_eq!(
            copying(
                stand_in("cat >/dev/null; mkdir m; echo x > m/dot.png"),
                PATIENCE
            ),
            Copying::Safe
        );
        assert_eq!(
            copying(stand_in("cat >/dev/null; mkdir ../folder"), PATIENCE),
            Copying::Safe
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_try_that_could_not_be_made_says_why() {
        let Copying::Unknown(why) = copying(stand_in("exit 3"), PATIENCE) else {
            panic!("a failed try is not an answer");
        };
        assert!(why.contains("failed"), "{why}");

        let Copying::Unknown(why) =
            copying(std::process::Command::new("/no/such/pandoc"), PATIENCE)
        else {
            panic!("a missing pandoc is not an answer");
        };
        assert!(why.contains("could not start"), "{why}");

        let started = std::time::Instant::now();
        let Copying::Unknown(why) = copying(
            stand_in("exec sleep 30"),
            std::time::Duration::from_millis(300),
        ) else {
            panic!("a hung pandoc is not an answer");
        };
        assert!(why.contains("no answer"), "{why}");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
    }

    #[cfg(unix)]
    fn stand_in(script: &str) -> std::process::Command {
        let mut command = std::process::Command::new("sh");
        command.args(["-c", script, "pandoc"]);
        command
    }

    #[test]
    fn the_try_runs_on_this_machine() {
        if !pandoc_here() {
            return;
        }
        let copying = extracts_safely();
        assert!(!matches!(copying, Copying::Unknown(_)), "{copying:?}");
    }

    #[test]
    fn pictures_left_out_are_said() {
        let with = "Text\n\n![a dot](media/rId20.png)\n";
        assert_eq!(left_out(&Copying::Safe, with), None);
        assert_eq!(
            left_out(&Copying::Unsafe, with),
            Some(PICTURES_LEFT_OUT.to_string())
        );
        let unknown = left_out(&Copying::Unknown("pandoc failed".to_string()), with);
        assert!(
            unknown.is_some_and(|said| said.contains("pandoc failed") && !said.contains("3.1.6"))
        );
        assert_eq!(left_out(&Copying::Unsafe, "Text\n"), None);
    }

    fn note_and_elsewhere() -> (tempfile::TempDir, tempfile::TempDir) {
        let note = tempfile::tempdir().expect("a folder");
        fs::write(note.path().join("dot.png"), DOT).expect("written");
        (note, tempfile::tempdir().expect("a folder"))
    }

    fn alone(folder: &Path) -> Place<'_> {
        Place {
            folder,
            space: folder,
        }
    }

    struct Shared {
        top: tempfile::TempDir,
        space: std::path::PathBuf,
        folder: std::path::PathBuf,
        key: std::path::PathBuf,
    }

    const KEY: &[u8] = b"PRIVATE KEY 7f3a";

    fn shared() -> Shared {
        let top = tempfile::tempdir().expect("a folder");
        let space = top.path().join("spaces").join("Mine");
        let folder = space.join("notes");
        fs::create_dir_all(&folder).expect("folders");
        fs::write(folder.join("dot.png"), DOT).expect("written");
        let key = top.path().join("id_rsa.png");
        fs::write(&key, KEY).expect("written");
        Shared {
            top,
            space,
            folder,
            key,
        }
    }

    impl Shared {
        fn place(&self) -> Place<'_> {
            Place {
                folder: &self.folder,
                space: &self.space,
            }
        }

        fn links(&self) -> [String; 2] {
            [
                self.key.to_string_lossy().replace('\\', "/"),
                "../../../id_rsa.png".to_string(),
            ]
        }
    }

    #[test]
    fn only_a_picture_inside_the_space_is_admitted() {
        let shared = shared();
        let place = shared.place();
        let dot = fs::canonicalize(shared.folder.join("dot.png")).expect("there");
        for inside in [
            "dot.png",
            "./dot.png",
            "../notes/dot.png",
            "d%6Ft.png",
            "dot.png?v=2",
        ] {
            assert_eq!(admitted(inside, &place), Some(dot.clone()), "{inside}");
        }
        assert_eq!(
            admitted(&shared.folder.join("dot.png").to_string_lossy(), &place),
            Some(dot.clone()),
            "absolute"
        );
        let [absolute, climbing] = shared.links();
        let encoded = "..%2f..%2f..%2fid_rsa.png".to_string();
        let file = format!("file://{absolute}");
        for outside in [
            absolute.as_str(),
            climbing.as_str(),
            encoded.as_str(),
            file.as_str(),
            "http://127.0.0.1:8080/secret.png",
            "//host/share/x.png",
            "%2F%2Fhost/share/x.png",
            "%5C%5Chost%5Cshare%5Cx.png",
            "data:image/png;base64,aGVsbG8=",
            "gone.png",
            "",
            "../",
        ] {
            assert_eq!(admitted(outside, &place), None, "{outside}");
        }
        fs::create_dir(shared.space.join(".sync")).expect("a folder");
        fs::write(shared.space.join(".sync").join("token.png"), KEY).expect("written");
        assert_eq!(admitted("../.sync/token.png", &place), None);
        assert!(shared.top.path().exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_space_is_not_admitted() {
        let shared = shared();
        std::os::unix::fs::symlink(&shared.key, shared.folder.join("cat.png")).expect("a link");
        assert_eq!(admitted("cat.png", &shared.place()), None);
    }

    fn picture(target: &str) -> serde_json::Value {
        serde_json::json!({
            "t": "Image",
            "c": [["", [], []], [{ "t": "Str", "c": "alt" }], [target, ""]]
        })
    }

    fn tree_of(targets: &[&str], figure: &str) -> serde_json::Value {
        let pictures: Vec<_> = targets.iter().map(|one| picture(one)).collect();
        serde_json::json!({
            "pandoc-api-version": [1, 23],
            "meta": {},
            "blocks": [
                { "t": "Para", "c": pictures },
                { "t": "Figure", "c": [["", [], []], [null, []], [{ "t": "Plain", "c": [picture(figure)] }]] }
            ]
        })
    }

    fn targets(tree: &serde_json::Value) -> Vec<String> {
        fn walk(node: &serde_json::Value, out: &mut Vec<String>) {
            match node {
                serde_json::Value::Array(items) => items.iter().for_each(|one| walk(one, out)),
                serde_json::Value::Object(fields) => {
                    if fields.get("t").and_then(|t| t.as_str()) == Some("Image") {
                        out.push(node["c"][2][0].as_str().unwrap_or_default().to_string());
                    }
                    fields.values().for_each(|one| walk(one, out));
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(tree, &mut out);
        out
    }

    #[test]
    fn the_pictures_of_a_note_are_judged_before_pandoc_sees_them() {
        let shared = shared();
        let [absolute, climbing] = shared.links();
        let into = tempfile::tempdir().expect("a folder");
        let mut tree = tree_of(&["dot.png", absolute.as_str(), "./dot.png"], &climbing);

        let refused = vetted(&mut tree, Some(&shared.place()), into.path(), false);

        assert_eq!(refused, [absolute.clone(), climbing.clone()]);
        assert_eq!(targets(&tree), ["dot.png", "dot.png"]);
        assert_eq!(names_in(into.path()), ["dot.png"]);
        assert_eq!(fs::read(into.path().join("dot.png")).expect("copied"), DOT);
        let text = tree.to_string();
        assert!(!text.contains("id_rsa"), "{text}");
        assert!(text.contains("Span"), "{text}");

        let mut tree = tree_of(&["dot.png"], "dot.png");
        let nowhere = tempfile::tempdir().expect("a folder");
        assert_eq!(vetted(&mut tree, None, nowhere.path(), false).len(), 2);
        assert!(targets(&tree).is_empty());
        assert!(names_in(nowhere.path()).is_empty());
    }

    #[test]
    fn a_picture_in_its_own_link_is_refused() {
        let shared = shared();
        let into = tempfile::tempdir().expect("a folder");
        let links = [
            "data:image/png;base64,aGVsbG8=",
            "DATA:image/png;base64,aGVsbG8=",
            "data:[/../x.png",
            "data:%zz/../x.png",
            "data:[/../../../../../../../../Windows/win.ini",
        ];
        let mut tree = tree_of(&links[..4], links[4]);

        let refused = vetted(&mut tree, Some(&shared.place()), into.path(), false);

        assert_eq!(refused, links);
        assert!(targets(&tree).is_empty());
        assert!(names_in(into.path()).is_empty());
    }

    #[test]
    fn two_pictures_of_one_name_are_both_kept() {
        let shared = shared();
        fs::create_dir(shared.folder.join("other")).expect("a folder");
        fs::write(shared.folder.join("other").join("dot.png"), b"second").expect("written");
        let into = tempfile::tempdir().expect("a folder");
        let mut tree = tree_of(&["dot.png", "other/dot.png"], "dot.png");

        let refused = vetted(&mut tree, Some(&shared.place()), into.path(), false);

        assert!(refused.is_empty(), "{refused:?}");
        assert_eq!(targets(&tree), ["dot.png", "dot-2.png", "dot.png"]);
        assert_eq!(
            fs::read(into.path().join("dot-2.png")).expect("copied"),
            b"second"
        );
    }

    #[test]
    fn raw_html_that_loads_a_file_is_left_out_of_a_deck() {
        let raw = |text: &str| {
            serde_json::json!({
                "pandoc-api-version": [1, 23],
                "meta": {},
                "blocks": [{ "t": "RawBlock", "c": ["html", text] }]
            })
        };
        let into = tempfile::tempdir().expect("a folder");
        let mut deck = raw("<img src=\"/home/me/.ssh/id_rsa\">");
        assert_eq!(vetted(&mut deck, None, into.path(), true).len(), 1);
        assert!(!deck.to_string().contains("id_rsa"));

        let mut words = raw("<b>bold</b>");
        assert!(vetted(&mut words, None, into.path(), true).is_empty());
        assert!(words.to_string().contains("<b>bold</b>"));

        let mut odt = raw("<img src=\"x.png\">");
        assert!(vetted(&mut odt, None, into.path(), false).is_empty());
    }

    #[test]
    fn knows_which_formats_carry_pictures() {
        for format in ["odt", "revealjs", "docx", "html5", "odt+native_numbering"] {
            assert!(carries_pictures(format), "{format}");
        }
        for format in [
            "latex",
            "mediawiki",
            "rst",
            "textile",
            "opml",
            "markdown",
            "epub3",
        ] {
            assert!(!carries_pictures(format), "{format}");
        }
    }

    fn odt_contents(odt: &Path) -> Vec<(String, Vec<u8>)> {
        let file = fs::File::open(odt).expect("an odt");
        let mut archive = zip::ZipArchive::new(file).expect("a zip");
        (0..archive.len())
            .map(|at| {
                let mut entry = archive.by_index(at).expect("an entry");
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).expect("read");
                (entry.name().to_string(), bytes)
            })
            .collect()
    }

    fn holds(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|one| one == needle)
    }

    #[test]
    fn an_odt_carries_no_file_from_outside_the_space() {
        if !pandoc_here() {
            return;
        }
        let shared = shared();
        let [absolute, climbing] = shared.links();
        let elsewhere = tempfile::tempdir().expect("a folder");
        let target = elsewhere.path().join("Out.odt");
        let note = format!("Text\n\n![a dot](dot.png)\n\n![k]({absolute})\n\n![k]({climbing})\n");

        let missing = convert(&note, &target, "odt", Some(&shared.place())).expect("converted");

        assert_eq!(missing.len(), 2, "{missing:?}");
        assert!(
            missing.iter().all(|one| one.contains("id_rsa")),
            "{missing:?}"
        );
        let contents = odt_contents(&target);
        assert!(
            contents.iter().all(|(_, bytes)| !holds(bytes, KEY)),
            "the key is in the ODT"
        );
        let pictures = contents
            .iter()
            .filter(|(name, _)| name.starts_with("Pictures/") && !name.ends_with('/'))
            .count();
        assert_eq!(pictures, 1);
    }

    #[test]
    fn a_deck_copies_no_file_from_outside_the_space() {
        if !pandoc_here() || extracts_safely() != Copying::Safe {
            return;
        }
        let shared = shared();
        let [absolute, climbing] = shared.links();
        let elsewhere = tempfile::tempdir().expect("a folder");
        let target = elsewhere.path().join("Deck.html");
        let note = format!(
            "# One\n\n![a dot](dot.png)\n\n![k]({absolute})\n\n![k]({climbing})\n\n<img src=\"{absolute}\">\n"
        );

        let missing =
            convert(&note, &target, "revealjs", Some(&shared.place())).expect("converted");

        assert_eq!(missing.len(), 3, "{missing:?}");
        assert_eq!(names_in(&elsewhere.path().join("Deck_files")), ["dot.png"]);
        let html = fs::read_to_string(&target).expect("a deck");
        assert!(!html.contains("id_rsa"), "{html}");
        assert!(html.contains("Deck_files/dot.png"), "{html}");
    }

    #[test]
    fn the_formats_without_pictures_are_still_written() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        for format in ["latex", "mediawiki", "rst", "textile", "opml"] {
            let target = elsewhere.path().join(format!("Out.{format}"));
            let made = convert(WITH_PICTURE, &target, format, Some(&alone(note.path())));
            assert!(made.is_ok(), "{format}: {made:?}");
            let written = fs::read_to_string(&target).expect("written");
            let mark = if format == "opml" { "<opml" } else { "Text" };
            assert!(written.contains(mark), "{format}: {written}");
        }
    }

    const WITH_PICTURE: &str = "Text\n\n![a dot](dot.png)\n";

    fn odt_entries(odt: &Path) -> Vec<String> {
        let file = fs::File::open(odt).expect("an odt");
        let archive = zip::ZipArchive::new(file).expect("a zip");
        archive.file_names().map(str::to_string).collect()
    }

    #[test]
    fn an_odt_carries_the_pictures_beside_the_note() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Out.odt");

        let missing =
            convert(WITH_PICTURE, &target, "odt", Some(&alone(note.path()))).expect("converted");

        assert!(missing.is_empty(), "{missing:?}");
        let names = odt_entries(&target);
        assert!(
            names.iter().any(|one| one.starts_with("Pictures/")),
            "{names:?}"
        );
    }

    #[test]
    fn a_deck_saved_elsewhere_still_shows_its_pictures() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Deck.html");

        let made = convert(WITH_PICTURE, &target, "revealjs", Some(&alone(note.path())));
        match extracts_safely() {
            Copying::Safe => {}
            Copying::Unsafe => {
                assert_eq!(made, Err(DECK_REFUSAL.to_string()));
                assert!(DECK_REFUSAL.contains("3.1.6"));
                assert!(!target.exists());
                return;
            }
            Copying::Unknown(why) => {
                assert!(made.is_err_and(|said| said.contains(&why) && !said.contains("3.1.6")));
                return;
            }
        }
        let missing = made.expect("converted");

        assert!(missing.is_empty(), "{missing:?}");
        let html = fs::read_to_string(&target).expect("a deck");
        assert!(html.contains("Deck_files/dot.png"), "{html}");
        assert!(elsewhere.path().join("Deck_files/dot.png").is_file());
    }

    #[test]
    fn a_picture_that_is_not_there_is_said() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Out.odt");

        let missing = convert(
            "![gone](gone.png)\n",
            &target,
            "odt",
            Some(&alone(note.path())),
        )
        .expect("converted");

        assert_eq!(missing, vec!["gone.png".to_string()]);
    }

    #[test]
    fn reads_the_names_pandoc_could_not_fetch() {
        let said =
            b"[WARNING] Could not fetch resource dot.png: PandocResourceNotFound \"dot.png\"\n\
[WARNING] Could not fetch resource 'a b.png': PandocResourceNotFound \"a b.png\"\n\
[WARNING] Could not fetch resource dot.png: PandocResourceNotFound \"dot.png\"\n\
[WARNING] This document format requires a nonempty <title> element.\n";
        assert_eq!(not_found(said), vec!["dot.png", "a b.png"]);
        assert!(not_found(b"").is_empty());
    }

    const DOT: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn an_import_copies_pictures_only_on_a_pandoc_that_does_it_safely() {
        assert!(reading("paper.docx", true).contains(&"--extract-media"));
        let without = reading("paper.docx", false);
        assert!(!without.contains(&"--extract-media"));
        assert!(without.contains(&"--sandbox"));
        assert_eq!(without[without.len() - 2..], ["--", "paper.docx"]);
    }

    #[test]
    fn the_file_is_read_as_a_file_whatever_it_is_called() {
        let args = reading("-lua-filter=evil.lua", true);

        assert_eq!(args.last(), Some(&"-lua-filter=evil.lua"));
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args.iter().filter(|one| **one == "--").count(), 1);
    }

    #[test]
    fn takes_the_formats_the_window_asks_for() {
        for format in [
            "odt",
            "latex",
            "mediawiki",
            "rst",
            "textile",
            "opml",
            "revealjs",
        ] {
            assert!(is_format(format), "{format}");
        }
        assert!(is_format("markdown+tex_math_dollars"));
        assert!(is_format("commonmark_x"));
    }

    #[test]
    fn refuses_anything_that_could_name_a_file() {
        assert!(!is_format("evil.lua"));
        assert!(!is_format("./evil.lua"));
        assert!(!is_format("/tmp/evil.lua"));
        assert!(!is_format(r"C:\Users\me\evil.lua"));
        assert!(!is_format("../evil"));
        assert!(!is_format("evil lua"));
        assert!(!is_format(""));
        assert!(!is_format("--lua-filter=evil.lua"));
        assert!(!is_format(&"a".repeat(41)));
    }

    #[test]
    fn repeats_what_pandoc_said() {
        assert_eq!(
            complaint(b"  no such format\n", "fallback"),
            "no such format"
        );
    }

    #[test]
    fn says_something_when_pandoc_said_nothing() {
        assert_eq!(complaint(b"", "pandoc failed"), "pandoc failed");
        assert_eq!(complaint(b"   \n", "pandoc failed"), "pandoc failed");
    }

    #[test]
    fn survives_output_that_is_not_utf8() {
        assert_eq!(complaint(&[0xff, b'a'], "pandoc failed"), "\u{fffd}a");
    }
}
