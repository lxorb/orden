//! Everything that goes through pandoc: reading a Word or ODT file in as
//! markdown, and writing a note out as one of the formats pandoc knows. Typora
//! shells out for the same jobs, and the formats are pandoc's rather than ours.
//!
//! Nothing here assumes pandoc is installed. `has_pandoc` is what the window asks
//! before it offers any of it.

#[cfg(target_os = "macos")]
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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
    use std::time::{Duration, Instant};

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
fn reading(source: &str) -> [&str; 9] {
    [
        "--sandbox",
        "--to",
        READ_AS,
        "--wrap",
        "none",
        "--extract-media",
        ".",
        "--",
        source,
    ]
}

/// Converts a document into markdown with pandoc. The format comes from the
/// file's extension, which is what pandoc infers from anyway.
///
/// Pictures inside the document are written out beside it rather than into
/// whichever folder the app happens to have been started in, which for an app
/// launched from its own shortcut is a folder nobody would think to look in.
#[tauri::command(async)]
pub fn import_document(app: AppHandle, path: String) -> Result<String, String> {
    // A file the reader picked in the dialog, judged as a path before pandoc is
    // handed it; see `chosen`.
    let source = chosen(&app, &path)?;
    let beside = source
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{path} is not in a folder Orden can write to"))?;
    let source = source.to_string_lossy().to_string();

    let result = pandoc()
        .current_dir(&beside)
        .args(reading(&source))
        .output()
        .map_err(|error| format!("pandoc could not start: {error}. Is it installed?"))?;

    if result.status.success() {
        return String::from_utf8(result.stdout)
            .map_err(|error| format!("pandoc returned something that is not text: {error}"));
    }

    Err(read_refusal(&result.stderr))
}

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
/// page, and the deck points there.
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
        complaint, convert, has_pandoc, is_format, not_found, pandoc, read_refusal, reading,
    };
    use std::fs;
    use std::path::Path;

    /// An import, run the way `import_document` runs it, on a document in `beside`:
    /// what pandoc printed, and what it said on the way.
    fn imported(beside: &Path, name: &str) -> (String, String) {
        let source = beside.join(name).to_string_lossy().to_string();
        let result = pandoc()
            .current_dir(beside)
            .args(reading(&source))
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
        let args = reading("paper.tex");
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

    /// The sandbox keeps the pictures inside a Word file, which come out beside it.
    #[test]
    fn a_picture_inside_a_document_still_comes_out_beside_it() {
        if !pandoc_here() {
            return;
        }
        let folder = tempfile::tempdir().expect("a folder");
        let beside = folder.path();
        fs::write(beside.join("dot.png"), DOT).expect("written");
        let made = pandoc()
            .current_dir(beside)
            .args([
                "--from",
                "markdown",
                "--to",
                "docx",
                "--output",
                "with.docx",
            ])
            .arg("--")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write as _;
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

        let (markdown, said) = imported(beside, "with.docx");
        assert!(markdown.contains("media/"), "{markdown}\n{said}");
        let media = fs::read_dir(beside.join("media"))
            .expect("a media folder")
            .count();
        assert_eq!(media, 1, "{said}");
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
    /// in a folder of its own named after it, and it points there.
    #[test]
    fn a_deck_saved_elsewhere_still_shows_its_pictures() {
        if !pandoc_here() {
            return;
        }
        let (note, elsewhere) = note_and_elsewhere();
        let target = elsewhere.path().join("Deck.html");

        let missing =
            convert(WITH_PICTURE, &target, "revealjs", Some(note.path())).expect("converted");

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

    /// A path is the reader's own, and pandoc reads a leading dash as an option.
    #[test]
    fn the_file_is_read_as_a_file_whatever_it_is_called() {
        let args = reading("-lua-filter=evil.lua");

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
