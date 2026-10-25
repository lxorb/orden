//! Everything that goes through pandoc: reading a Word or ODT file in as
//! markdown, and writing a note out as one of the formats pandoc knows. Typora
//! shells out for the same jobs, and the formats are pandoc's rather than ours.
//!
//! Nothing here assumes pandoc is installed. `has_pandoc` is what the window asks
//! before it offers any of it.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::paths::{chosen, in_spaces};

/// What a document is read in as: plain markdown plus the few extensions the
/// editor itself understands, so nothing comes back that cannot be shown.
const READ_AS: &str =
    "markdown_strict+pipe_tables+backtick_code_blocks+strikeout+task_lists+tex_math_dollars";

/// What a note is written out from, which is what the editor writes.
const WRITE_FROM: &str = "markdown+tex_math_dollars+pipe_tables+task_lists+footnotes+strikeout";

#[cfg(any(target_os = "macos", all(test, unix)))]
mod finding;

/// pandoc, started the way every call here starts it: found where this machine
/// keeps it, and without a console window flashing up on Windows.
// `mut` is only used by the Windows branch below; elsewhere it is dead.
#[cfg_attr(not(windows), allow(unused_mut))]
fn pandoc() -> Command {
    let mut command = Command::new(program());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    command
}

/// On Windows and Linux a launched app has the `PATH` its user set, so the name
/// is enough.
#[cfg(not(target_os = "macos"))]
fn program() -> PathBuf {
    PathBuf::from("pandoc")
}

/// On a Mac an app opened from Finder does not; see finding.rs. Looked up on every
/// call rather than once, so a pandoc installed while the app is open is found by
/// the next export. That is a handful of `stat` calls; only the login shell, which
/// is slow, is asked once per launch.
#[cfg(target_os = "macos")]
fn program() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let folders = finding::folders(std::env::var_os("PATH").as_deref(), home.as_deref());

    finding::first_in(&folders, runs)
        .or_else(from_login_shell)
        .unwrap_or_else(|| PathBuf::from("pandoc"))
}

/// Whether a path is a file somebody may run.
#[cfg(target_os = "macos")]
fn runs(program: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    fs::metadata(program)
        .is_ok_and(|found| found.is_file() && found.permissions().mode() & 0o111 != 0)
}

/// Where the reader's own login shell finds pandoc, asked once per launch.
#[cfg(target_os = "macos")]
fn from_login_shell() -> Option<PathBuf> {
    static ASKED: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    ASKED.get_or_init(ask_login_shell).clone()
}

/// Asks `$SHELL -ilc 'command -v pandoc'`, the way VS Code reads the `PATH` of a
/// shell nobody opened: interactive as well as a login, because a `PATH` line in
/// `.zshrc` is only read by an interactive shell. With nothing to read from, so a
/// shell file that asks a question gets no answer instead of waiting for one, and
/// given three seconds, so a slow or broken shell file costs the export list that
/// long once and never hangs it.
#[cfg(target_os = "macos")]
fn ask_login_shell() -> Option<PathBuf> {
    use std::io::Read as _;

    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", "command -v pandoc"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
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

    let mut printed = String::new();
    child.stdout.take()?.read_to_string(&mut printed).ok()?;
    finding::shell_answer(&printed).filter(|program| runs(program))
}

/// Whether pandoc is on this machine, which is what decides the export list.
#[tauri::command(async)]
pub fn has_pandoc() -> bool {
    pandoc()
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// What a try of this machine's pandoc found about `--extract-media`; see
/// `copying`.
#[derive(Debug, PartialEq)]
enum Copying {
    /// Both pictures of the advisories stayed in the folder they were copied to.
    Safe,
    /// One of them was written outside it.
    Unsafe,
    /// The try did not get that far, and why.
    Unknown(String),
}

/// How long pandoc is given to copy the two pictures of the try, which takes it
/// a fraction of a second; a pandoc that hangs costs this once per import or
/// export and never holds either up for good.
const PATIENCE: Duration = Duration::from_secs(10);

/// What this machine's pandoc does with `--extract-media`. Asked on every call,
/// like `program`, so a pandoc updated while the app is open counts at once.
fn extracts_safely() -> Copying {
    copying(pandoc(), PATIENCE)
}

/// Whether `command`, a pandoc, keeps `--extract-media` inside the folder it is
/// given. Before 3.1.6 a picture whose name hides `../` in percent-encoding is
/// written wherever it says (CVE-2023-35936, fixed in 3.1.4, and CVE-2023-38745,
/// its double-encoded twin, fixed in 3.1.6), and `--sandbox` does not stop it: it
/// fences in the readers and writers, not the copying of pictures. A document
/// somebody sent, or a note from a shared space, could then put a `~/.bashrc` of
/// its own on this machine.
///
/// Asked of pandoc itself rather than read off its version, because Debian and
/// Ubuntu mended their 2.17 and 3.1.3 without changing the number. pandoc copies
/// the two pictures the advisories describe, `CLIMBING`, from a folder four levels
/// down in a temporary folder of our own; each climbs three levels, so wherever it
/// lands it is still in that temporary folder, and anything but a folder found
/// outside the media folder is a picture that got out. That tries these two names
/// and nothing else: a pandoc with some other way out, or one that writes to an
/// absolute path, is not caught here.
///
/// The try runs without `--sandbox` and reads markdown, unlike an import. In its
/// sandbox pandoc fetches no `data:` picture, so a sandboxed try copies nothing and
/// learns nothing. The names of the pictures inside a Word file or an ePub go
/// through the same two functions of pandoc that the advisories mended; a docx
/// whose picture is named this way got out of the sandboxed import on 3.1.3 and
/// stayed in on 3.1.6 and on Ubuntu's 3.1.3, as these pictures do.
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
    // Two lines, well inside what a pipe holds, so this does not wait on pandoc. A
    // pandoc that does not read them is caught by how it exits.
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

/// Whether `child` finished, and well, within `patience`. A child still running
/// then is stopped, so nothing is left behind.
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

/// Whether anything but a folder is in `folder` outside `inside`, however deep. A
/// link counts, since it is written as much as a file is; a folder that cannot be
/// read counts too.
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

/// The two pictures of the advisories, each climbing three folders up from where
/// it is copied: once percent-encoded, and once encoded twice.
const CLIMBING: &str = "![](data://image/png;base64,aGVsbG8=;.lua+%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fonce%2elua)\n\n![](data://image/png;base64,aGVsbG8=;.lua+%252f%252e%252e%252f%252e%252e%252f%252e%252e%252ftwice%252elua)\n";

/// What one import is run with: the options, then `--`, then the file.
///
/// The marker is the whole point of the function. `chosen` judges a path, and lets
/// through a file the reader picked in the dialog wherever it is, so what arrives is
/// the reader's own - and a name that opens with a dash is a name pandoc reads as an
/// option instead. `--lua-filter=…` names a script pandoc runs, which is the same
/// road `is_format` below closes for a writer's name. `--` is where pandoc stops
/// reading options, so everything after it is a file however it is spelled.
///
/// And `--sandbox`, because the document is somebody else's words. LaTeX's
/// `\lstinputlisting`, RST's `include` and Org's `#+INCLUDE` name any file on this
/// machine, and pandoc read it into the note, which then synced: `~/.ssh/id_rsa`
/// sent to the account by opening a paper. In its sandbox pandoc reads the file it
/// was given and nothing else; the pictures inside a Word file still come out
/// beside it, since `--extract-media` writes after the reading is done.
///
/// Only when `media` is true, which is a pandoc that keeps those pictures inside
/// the folder; see `copying`. On any other the words still come in and the
/// pictures stay behind, because the alternative lets the document write anywhere
/// on this machine; see `left_out`.
fn reading(source: &str, media: bool) -> Vec<&str> {
    let mut args = vec!["--sandbox", "--to", READ_AS, "--wrap", "none"];
    if media {
        args.extend(["--extract-media", "."]);
    }
    args.extend(["--", source]);
    args
}

/// Converts a document into markdown with pandoc. The format comes from the
/// file's extension, which is what pandoc infers from anyway.
///
/// Pictures inside the document are written out beside it rather than into
/// whichever folder the app happens to have been started in, which for an app
/// launched from its own shortcut is a folder nobody would think to look in.
#[tauri::command(async)]
pub fn import_document(app: AppHandle, path: String) -> Result<Imported, String> {
    // A file the reader picked in the dialog, judged as a path before pandoc is
    // handed it; see `chosen`.
    let source = chosen(&app, &path)?;
    let beside = source
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{path} is not in a folder Orden can write to"))?;
    let source = source.to_string_lossy().to_string();
    let copying = extracts_safely();

    let result = pandoc()
        .current_dir(&beside)
        .args(reading(&source, copying == Copying::Safe))
        .output()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    if result.status.success() {
        let markdown = String::from_utf8(result.stdout)
            .map_err(|error| format!("pandoc returned something that is not text: {error}"))?;
        let left_out = left_out(&copying, &markdown);
        return Ok(Imported { markdown, left_out });
    }

    Err(read_refusal(&result.stderr))
}

/// A document read in: its words, and why its pictures were left out when they
/// were.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    markdown: String,
    left_out: Option<String>,
}

/// Why the pictures of a document read in without `--extract-media` are not
/// there, for a document that has any: pandoc still writes a link to each.
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

/// Why a document came in without its pictures on a pandoc that copies them
/// unsafely.
const PICTURES_LEFT_OUT: &str = "The pictures were left out: this pandoc can be made to write pictures outside their folder, and 3.1.6 or newer brings them in";

/// Why an import did not happen. A pandoc older than 2.15 has no sandbox and says
/// it does not know the option; the import is refused rather than run without it,
/// and the reader is told what would make it work.
fn read_refusal(stderr: &[u8]) -> String {
    let said = complaint(stderr, "pandoc could not read that file");
    if said.contains("--sandbox") {
        return "Importing needs pandoc 2.15 or newer, which reads a document without reaching the rest of this computer".to_string();
    }
    said
}

/// Whether a string is a format pandoc can be asked for by name.
///
/// This matters more than it looks. `--to` also takes the path of a Lua script,
/// which pandoc then runs as a custom writer with its own filesystem and process
/// access - so a format that could name a file would turn "write this note out"
/// into "run this program". A writer's name is lower-case letters, digits and the
/// three joining characters pandoc's own names use, and nothing that could be a
/// path or an extension.
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

/// Converts markdown with pandoc, the same way Typora does. The source is piped
/// in rather than written to a temp file, so nothing is left behind.
///
/// The file it writes is wherever the reader chose to save it, so it is judged the
/// way `write_bytes` judges the same choice; see `chosen`. `note` is the note the
/// words are, judged as a path inside the spaces, whose folder its pictures are
/// found in. Answers the pictures that were not there, which pandoc leaves out and
/// still calls a success.
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
    let folder = match note {
        Some(note) => in_spaces(&app, &note)?.parent().map(Path::to_path_buf),
        None => None,
    };
    convert(&source, &target, &format, folder.as_deref())
}

/// The conversion itself, apart from the app: `source` written to `target` as
/// `format`, for the note in `folder`. Answers the pictures pandoc could not find.
///
/// The words arrive on stdin, so pandoc has no file to find a picture beside and
/// looks in the folder it was started in: an ODT came out with every picture
/// swapped for its alt text, and pandoc said it had done fine. So it is told the
/// note's folder. A folder whose name holds the path separator (`:`, `;` on
/// Windows) is split by pandoc and finds nothing; that is said like any other
/// picture that was not there.
///
/// A deck links its pictures rather than holding them, so pointing at them where
/// the note is breaks the moment it is opened anywhere else. Its pictures are
/// copied beside it, into `Deck_files` for `Deck.html`, the way a browser saves a
/// page, and the deck points there. That copying is `--extract-media`, so a deck
/// is refused on a pandoc that lets a picture's name lead it out of that folder;
/// see `copying`.
fn convert(
    source: &str,
    target: &Path,
    format: &str,
    folder: Option<&Path>,
) -> Result<Vec<String>, String> {
    let mut command = pandoc();
    command.args(["--from", WRITE_FROM, "--to", format, "--standalone"]);
    if let Some(folder) = folder {
        command.arg(joined("--resource-path=", folder.as_os_str()));
    }
    if format == "revealjs" {
        match extracts_safely() {
            Copying::Safe => {}
            Copying::Unsafe => return Err(DECK_REFUSAL.to_string()),
            Copying::Unknown(why) => {
                return Err(format!(
                    "The deck was not written, since it could not be checked that pandoc copies its pictures safely: {why}"
                ))
            }
        }
        let beside = target
            .parent()
            .ok_or_else(|| format!("{} is not in a folder", target.display()))?;
        let stem = target.file_stem().unwrap_or_default();
        command.current_dir(beside);
        command.arg(joined("--extract-media=", &joined_name(stem, "_files")));
    }

    let mut child = command
        .arg("--output")
        .arg(target)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    let mut sink = child.stdin.take().ok_or("could not write to pandoc")?;

    // On its own thread, because pandoc writes as it reads: a long note plus a
    // pandoc with plenty to say would otherwise be two programs each waiting for
    // the other to take what it has written.
    let source = source.to_string();
    let writer = std::thread::spawn(move || sink.write_all(source.as_bytes()));

    let result = child
        .wait_with_output()
        .map_err(|error| format!("pandoc did not finish: {error}"))?;
    let written = writer
        .join()
        .map_err(|_| "the thread feeding pandoc stopped".to_string())?;

    if result.status.success() {
        // Pandoc is happy, so it read what it needed; a write that failed at the
        // very end is still worth saying out loud.
        return written
            .map(|()| not_found(&result.stderr))
            .map_err(|error| format!("could not send the note to pandoc: {error}"));
    }

    Err(complaint(&result.stderr, "pandoc failed"))
}

/// Why a deck was not written on a pandoc that copies pictures unsafely.
const DECK_REFUSAL: &str = "Exporting a deck needs pandoc 3.1.6 or newer: this pandoc can be made to write a deck's pictures outside the deck's folder";

/// An option and its value as one argument, a path's bytes kept as they are.
fn joined(option: &str, value: &std::ffi::OsStr) -> std::ffi::OsString {
    let mut out = std::ffi::OsString::from(option);
    out.push(value);
    out
}

/// A file name with words on its end.
fn joined_name(stem: &std::ffi::OsStr, end: &str) -> std::ffi::OsString {
    let mut out = stem.to_os_string();
    out.push(end);
    out
}

/// The pictures pandoc said it could not fetch, in the order it said them, each
/// once. `[WARNING] Could not fetch resource dot.png: PandocResourceNotFound
/// "dot.png"`, with quotes around the first name before pandoc 3.
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

/// What pandoc said, or a sentence of our own when it said nothing.
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
        complaint, convert, extracts_safely, has_pandoc, is_format, left_out, not_found, pandoc,
        read_refusal, reading, wrote_outside, Copying, DECK_REFUSAL, PICTURES_LEFT_OUT,
    };
    #[cfg(unix)]
    use super::{copying, PATIENCE};
    use std::fs;
    use std::io::{Read as _, Write as _};
    use std::path::Path;

    /// An import, run the way `import_document` runs it, on a document in `beside`:
    /// what pandoc printed, and what it said on the way.
    fn imported(beside: &Path, name: &str) -> (String, String) {
        let source = beside.join(name).to_string_lossy().to_string();
        let result = pandoc()
            .current_dir(beside)
            .args(reading(&source, extracts_safely() == Copying::Safe))
            .output()
            .expect("pandoc runs");
        (
            String::from_utf8_lossy(&result.stdout).to_string(),
            String::from_utf8_lossy(&result.stderr).to_string(),
        )
    }

    /// Whether these tests can run pandoc; the CI's Linux row installs it.
    fn pandoc_here() -> bool {
        let here = has_pandoc();
        if !here {
            eprintln!("pandoc is not installed here, so this test checks nothing");
        }
        here
    }

    /// The reader's own document is somebody else's words: an include in it must
    /// not read a file of this machine into the note, which then syncs.
    #[test]
    fn an_import_runs_pandoc_in_its_sandbox() {
        let args = reading("paper.tex", true);
        let sandbox = args.iter().position(|one| *one == "--sandbox");
        let marker = args.iter().position(|one| *one == "--");
        assert!(sandbox.is_some_and(|at| marker.is_some_and(|end| at < end)));
    }

    /// What a pandoc without a sandbox says, which is a refusal and not a reason to
    /// run it without one.
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
        // Forward slashes, which LaTeX, RST and Org all read as a path.
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
            let (markdown, said) = imported(beside, name);
            assert!(
                !markdown.contains("PRIVATE KEY"),
                "{name}: {markdown}\n{said}"
            );
            assert!(markdown.contains("Hi"), "{name}: {markdown}\n{said}");
        }
    }

    /// A Word file called `name` in `beside`, made by pandoc from a note with one
    /// picture in it.
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

    /// The sandbox keeps the pictures inside a Word file, which come out beside it
    /// on a pandoc that copies them safely. On any other the words come in, no
    /// picture is written at all, and the reader is told why.
    #[test]
    fn a_picture_inside_a_document_still_comes_out_beside_it() {
        if !pandoc_here() {
            return;
        }
        let folder = tempfile::tempdir().expect("a folder");
        let beside = folder.path();
        docx_with_picture(beside, "with.docx");

        let (markdown, said) = imported(beside, "with.docx");
        assert!(markdown.contains("Text"), "{markdown}\n{said}");
        let copying = extracts_safely();
        if copying != Copying::Safe {
            assert!(!beside.join("media").exists(), "{said}");
            assert!(left_out(&copying, &markdown).is_some(), "{markdown}");
            return;
        }
        assert_eq!(left_out(&copying, &markdown), None);
        assert!(markdown.contains("media/"), "{markdown}\n{said}");
        let media = fs::read_dir(beside.join("media"))
            .expect("a media folder")
            .count();
        assert_eq!(media, 1, "{said}");
    }

    /// A Word file somebody sent, whose picture is named to climb three folders
    /// up once pandoc undoes its percent-encoding. On pandoc 3.1.3 this got out of
    /// the sandboxed import; see `copying`.
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

        let (markdown, said) = imported(&inner, "paper.docx");

        assert!(markdown.contains("Text"), "{markdown}\n{said}");
        assert!(
            !wrote_outside(documents.path(), &inner),
            "{markdown}\n{said}"
        );
    }

    /// `from`, a Word file, written to `to` with each picture renamed to climb
    /// three folders up out of the media folder, and every mention of it with it.
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
            // A picture's own bytes are left alone; the words around it name it.
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

    /// A deck made from a note that came from somebody else writes nothing outside
    /// its own folder: on a pandoc that copies safely the deck is written, on any
    /// other it is refused.
    #[test]
    fn a_deck_writes_no_picture_outside_its_folder() {
        if !pandoc_here() {
            return;
        }
        let elsewhere = tempfile::tempdir().expect("a folder");
        let inner = elsewhere.path().join("inner");
        fs::create_dir(&inner).expect("a folder");
        // From `inner/Deck_files/<sha1>.lua+`, three levels up is `elsewhere`.
        let note = "Text\n\n![](data://image/png;base64,aGVsbG8=;.lua+%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fescaped%2elua)\n";

        let made = convert(note, &inner.join("Deck.html"), "revealjs", None);

        match extracts_safely() {
            Copying::Safe => assert!(made.is_ok(), "{made:?}"),
            _ => assert!(made.is_err(), "{made:?}"),
        }
        assert!(!wrote_outside(elsewhere.path(), &inner), "{made:?}");
    }

    /// The try is judged by what it finds on the disk, which a stand-in for pandoc
    /// shows without needing an old one: a program that writes outside the folder
    /// it was started in is not trusted, however deep the write.
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

    /// And one that writes only inside it, or makes only folders, is.
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

    /// A try that could not be made is neither: it says why, so the reader is not
    /// told to update a pandoc that is new enough.
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

    /// A shell running `script` in place of pandoc, given pandoc's arguments.
    #[cfg(unix)]
    fn stand_in(script: &str) -> std::process::Command {
        let mut command = std::process::Command::new("sh");
        command.args(["-c", script, "pandoc"]);
        command
    }

    /// The pandoc the tests run with gives an answer, rather than a try that fell
    /// over; on the CI's Linux row it is Ubuntu's mended 3.1.3.
    #[test]
    fn the_try_runs_on_this_machine() {
        if !pandoc_here() {
            return;
        }
        let copying = extracts_safely();
        assert!(!matches!(copying, Copying::Unknown(_)), "{copying:?}");
    }

    /// A document with pictures, read in without them, says why; one without says
    /// nothing.
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

    /// A note in a folder of its own, with its picture beside it, and a folder
    /// somewhere else to save the export in, as the dialog lets the reader.
    fn note_and_elsewhere() -> (tempfile::TempDir, tempfile::TempDir) {
        let note = tempfile::tempdir().expect("a folder");
        fs::write(note.path().join("dot.png"), DOT).expect("written");
        (note, tempfile::tempdir().expect("a folder"))
    }

    const WITH_PICTURE: &str = "Text\n\n![a dot](dot.png)\n";

    /// The names inside an ODT, which is a zip.
    fn odt_entries(odt: &Path) -> Vec<String> {
        let file = fs::File::open(odt).expect("an odt");
        let archive = zip::ZipArchive::new(file).expect("a zip");
        archive.file_names().map(str::to_string).collect()
    }

    /// The note is piped in, so pandoc has no folder to find `dot.png` in unless it
    /// is told the note's; without it the picture became its alt text.
    #[test]
    fn an_odt_carries_the_pictures_beside_the_note() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Out.odt");

        let missing = convert(WITH_PICTURE, &target, "odt", Some(note.path())).expect("converted");

        assert!(missing.is_empty(), "{missing:?}");
        let names = odt_entries(&target);
        assert!(
            names.iter().any(|one| one.starts_with("Pictures/")),
            "{names:?}"
        );
    }

    /// A deck links its pictures rather than holding them, so they go beside it,
    /// in a folder of its own named after it, and it points there. A pandoc that
    /// cannot copy them safely is refused, and says which one would do.
    #[test]
    fn a_deck_saved_elsewhere_still_shows_its_pictures() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Deck.html");

        let made = convert(WITH_PICTURE, &target, "revealjs", Some(note.path()));
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

    /// A picture that is not there is said, rather than swapped for its alt text
    /// with pandoc reporting success.
    #[test]
    fn a_picture_that_is_not_there_is_said() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Out.odt");

        let missing =
            convert("![gone](gone.png)\n", &target, "odt", Some(note.path())).expect("converted");

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

    /// A one-pixel PNG.
    const DOT: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    /// An import on an older pandoc is run without `--extract-media`, so its words
    /// still come in.
    #[test]
    fn an_import_copies_pictures_only_on_a_pandoc_that_does_it_safely() {
        assert!(reading("paper.docx", true).contains(&"--extract-media"));
        let without = reading("paper.docx", false);
        assert!(!without.contains(&"--extract-media"));
        assert!(without.contains(&"--sandbox"));
        assert_eq!(without[without.len() - 2..], ["--", "paper.docx"]);
    }

    /// A path is the reader's own, and pandoc reads a leading dash as an option.
    #[test]
    fn the_file_is_read_as_a_file_whatever_it_is_called() {
        let args = reading("-lua-filter=evil.lua", true);

        assert_eq!(args.last(), Some(&"-lua-filter=evil.lua"));
        // The marker sits immediately in front of it, so nothing between the
        // options and the file can be read as one.
        assert_eq!(args[args.len() - 2], "--");
        // And it is said once: a second `--` would be a file called `--`.
        assert_eq!(args.iter().filter(|one| **one == "--").count(), 1);
    }

    /// Every format the window offers; see `src/lib/export-formats.ts`.
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
        // And the spellings pandoc writes with extensions on them.
        assert!(is_format("markdown+tex_math_dollars"));
        assert!(is_format("commonmark_x"));
    }

    /// `--to` takes the path of a Lua script as readily as a writer's name, and
    /// pandoc runs that script. Nothing that could be a path is a format.
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
