use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager, Url};

use crate::paths::{a_space, cannot, files_in, folded, inside, is_pdf, write_atomically};

const LONGEST: usize = 32 * 1024;

#[derive(Default)]
pub struct Handed(Mutex<Vec<PathBuf>>, Mutex<bool>);

static WRITING: Mutex<()> = Mutex::new(());

const KEPT: &str = "handed-pdfs.json";

const MOST_KEPT: usize = 256;

impl Handed {
    fn admit(&self, pdfs: Vec<PathBuf>) -> Vec<String> {
        if let Ok(mut held) = self.0.lock() {
            held.retain(|one| !pdfs.iter().any(|new| same_handed(one, new)));
            held.extend(pdfs.iter().cloned());
            let over = held.len().saturating_sub(MOST_KEPT);
            held.drain(..over);
        }
        pdfs.iter()
            .map(|one| one.to_string_lossy().into_owned())
            .collect()
    }

    fn holds(&self, path: &Path) -> bool {
        self.0
            .lock()
            .is_ok_and(|held| held.iter().any(|one| same_handed(one, path)))
    }

    fn listed(&self) -> Vec<PathBuf> {
        self.0.lock().map(|held| held.clone()).unwrap_or_default()
    }

    fn load(&self, kept: impl FnOnce() -> Vec<PathBuf>) {
        let mut loaded = self.1.lock().unwrap_or_else(PoisonError::into_inner);
        if *loaded {
            return;
        }
        let kept = kept();
        if let Ok(mut held) = self.0.lock() {
            let mut all: Vec<PathBuf> = kept
                .into_iter()
                .filter(|old| !held.iter().any(|new| same_handed(old, new)))
                .collect();
            all.append(&mut held);
            let over = all.len().saturating_sub(MOST_KEPT);
            all.drain(..over);
            *held = all;
        }
        *loaded = true;
    }
}

fn same_handed(one: &Path, other: &Path) -> bool {
    inside(one, other) && inside(other, one)
}

fn handed_list_at(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join(KEPT))
}

fn read_handed_list(at: &Path) -> Vec<PathBuf> {
    fs::read_to_string(at)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .filter(|one| one.is_file())
        .collect()
}

fn write_handed_list(at: &Path, pdfs: &[PathBuf]) -> Result<(), String> {
    let said: Vec<&str> = pdfs.iter().filter_map(|one| one.to_str()).collect();
    let text = serde_json::to_string(&said).map_err(|error| error.to_string())?;
    if let Some(folder) = at.parent() {
        fs::create_dir_all(folder).map_err(|error| cannot("make", folder, &error))?;
    }
    write_atomically(at, text.as_bytes())
}

fn handed_set(app: &AppHandle) -> tauri::State<'_, Handed> {
    if app.try_state::<Handed>().is_none() {
        app.manage(Handed::default());
    }
    app.state::<Handed>()
}

fn loaded_set(app: &AppHandle) -> tauri::State<'_, Handed> {
    let handed = handed_set(app);
    handed.load(|| {
        handed_list_at(app)
            .map(|at| read_handed_list(&at))
            .unwrap_or_default()
    });
    handed
}

pub fn admit_handed(app: &AppHandle, pdfs: Vec<PathBuf>) -> Vec<String> {
    if pdfs.is_empty() {
        return Vec::new();
    }
    let said = handed_set(app).admit(pdfs);
    if let Some(at) = handed_list_at(app) {
        let app = app.clone();
        std::thread::spawn(move || {
            let handed = loaded_set(&app);
            let _writing = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
            if let Err(error) = write_handed_list(&at, &handed.listed()) {
                crate::logs::say(&app, "warn", &format!("handed PDFs: {error}"));
            }
        });
    }
    said
}

pub fn handed_pdf(app: &AppHandle, path: &str) -> Option<PathBuf> {
    let path = folded(Path::new(path));
    loaded_set(app).holds(&path).then_some(path)
}

pub fn pdfs_in<A: AsRef<OsStr>>(args: &[A], cwd: &Path) -> Vec<PathBuf> {
    if crate::web_handed::for_a_link(args) {
        return Vec::new();
    }

    let mut found: Vec<PathBuf> = Vec::new();
    for one in args.iter().skip(1) {
        if let Some(pdf) = named(one.as_ref(), cwd).filter(|pdf| !found.contains(pdf)) {
            found.push(pdf);
        }
    }
    found
}

#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only a Mac hands files over as addresses; the rule is tested everywhere"
    )
)]
pub fn pdfs_among(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| folded(&path))
        .filter(|path| is_pdf(path) && path.is_file())
        .collect()
}

fn named(said: &OsStr, cwd: &Path) -> Option<PathBuf> {
    if said.is_empty() || said.as_encoded_bytes().starts_with(b"-") || said.len() > LONGEST {
        return None;
    }

    let path = match said.to_str().map(Url::parse) {
        Some(Ok(url)) if url.scheme() == "file" => url.to_file_path().ok()?,
        _ => PathBuf::from(said),
    };
    let path = folded(&if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    });

    (is_pdf(&path) && path.is_file()).then_some(path)
}

#[tauri::command(async)]
pub fn same_pdf(app: AppHandle, from: String, space: String) -> Result<Option<String>, String> {
    let pdf = handed_pdf(&app, &from).ok_or_else(|| format!("{from} was not handed to nib"))?;
    let root = a_space(&app, &space)?;
    Ok(same_in(&root, &pdf).map(|there| there.to_string_lossy().into_owned()))
}

fn same_in(root: &Path, pdf: &Path) -> Option<PathBuf> {
    let size = pdf.metadata().ok()?.len();
    let (_, others) = files_in(root);
    others.into_iter().find(|one| {
        is_pdf(one)
            && one.metadata().is_ok_and(|meta| meta.len() == size)
            && same_bytes(one, pdf).unwrap_or(false)
    })
}

fn same_bytes(one: &Path, other: &Path) -> Result<bool, String> {
    let open = |path: &Path| {
        File::open(path)
            .map(BufReader::new)
            .map_err(|error| cannot("read", path, &error))
    };
    let (mut one_read, mut other_read) = (open(one)?, open(other)?);
    let (mut ours, mut theirs) = ([0u8; 8 * 1024], [0u8; 8 * 1024]);

    loop {
        let got = one_read
            .read(&mut ours)
            .map_err(|error| cannot("read", one, &error))?;
        if got == 0 {
            let mut rest = [0u8; 1];
            return Ok(other_read.read(&mut rest).is_ok_and(|more| more == 0));
        }
        if other_read.read_exact(&mut theirs[..got]).is_err() || ours[..got] != theirs[..got] {
            return Ok(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        pdfs_among, pdfs_in, read_handed_list, same_in, write_handed_list, Handed, MOST_KEPT,
    };
    use std::fs;
    use std::path::Path;
    use tauri::Url;

    fn line(args: &[&str]) -> Vec<String> {
        std::iter::once("nib.exe")
            .chain(args.iter().copied())
            .map(str::to_owned)
            .collect()
    }

    fn file(at: &Path, bytes: &[u8]) -> String {
        if let Some(folder) = at.parent() {
            fs::create_dir_all(folder).expect("a folder");
        }
        fs::write(at, bytes).expect("a file");
        at.to_string_lossy().into_owned()
    }

    #[test]
    fn a_command_line_hands_over_its_pdfs_once_each() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = file(&dir.path().join("Paper.PDF"), b"%PDF-1.7");
        let note = file(&dir.path().join("Idea.md"), b"# Idea");

        let found = pdfs_in(
            &line(&[
                &paper,
                &note,
                "--verbose",
                &paper,
                "https://example.com/a.pdf",
            ]),
            dir.path(),
        );
        assert_eq!(found, vec![dir.path().join("Paper.PDF")]);
    }

    #[test]
    fn a_relative_path_is_read_from_where_the_launch_was_made() {
        let dir = tempfile::tempdir().expect("a temp folder");
        file(&dir.path().join("papers").join("a.pdf"), b"%PDF");

        let found = pdfs_in(&line(&["papers/./a.pdf"]), dir.path());
        assert_eq!(found, vec![dir.path().join("papers").join("a.pdf")]);
    }

    #[test]
    fn a_file_address_is_the_file_it_names() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("with space.pdf");
        file(&paper, b"%PDF");
        let address = Url::from_file_path(&paper).expect("an address").to_string();

        assert_eq!(pdfs_in(&line(&[&address]), dir.path()), vec![paper.clone()]);
        assert_eq!(
            pdfs_among(&[
                Url::parse(&address).expect("an address"),
                Url::parse("https://example.com/b.pdf").expect("an address"),
            ]),
            vec![paper]
        );
    }

    #[test]
    fn nothing_but_a_pdf_that_is_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        file(&dir.path().join("folder.pdf").join("inside.txt"), b"");

        for refused in [
            "gone.pdf",
            "folder.pdf",
            "-flag.pdf",
            "",
            "javascript:alert(1)",
        ] {
            assert!(
                pdfs_in(&line(&[refused]), dir.path()).is_empty(),
                "{refused} was taken"
            );
        }
    }

    #[test]
    fn a_links_command_line_hands_over_no_pdf() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = file(&dir.path().join("a.pdf"), b"%PDF");

        let args = line(&[crate::web_handed::LINK_FLAG, "https://example.com/", &paper]);
        assert!(pdfs_in(&args, dir.path()).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_pdf_whose_name_is_not_unicode_is_handed_over_as_named() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().expect("a temp folder");
        let name = std::ffi::OsStr::from_bytes(b"x\xff.pdf");
        file(&dir.path().join(name), b"%PDF");

        let args = [std::ffi::OsString::from("nib"), name.to_owned()];
        assert_eq!(pdfs_in(&args, dir.path()), vec![dir.path().join(name)]);
    }

    #[test]
    fn only_what_was_handed_over_is_held() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("a.pdf");
        let handed = Handed::default();
        handed.admit(vec![paper.clone()]);

        assert!(handed.holds(&paper));
        assert!(!handed.holds(&dir.path().join("b.pdf")));
        assert!(!handed.holds(dir.path()));
    }

    #[test]
    fn what_was_handed_over_is_kept_for_the_next_runs_while_it_is_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let one = dir.path().join("one.pdf");
        file(&one, b"%PDF");
        let gone = dir.path().join("gone.pdf");
        let at = dir.path().join("data").join("handed-pdfs.json");

        write_handed_list(&at, &[one.clone(), gone]).expect("written");
        assert_eq!(read_handed_list(&at), vec![one]);
        assert!(read_handed_list(&dir.path().join("none.json")).is_empty());
    }

    #[test]
    fn papers_handed_before_the_list_is_read_are_kept_after_the_ones_it_holds() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = |name: &str| dir.path().join(name);
        let handed = Handed::default();
        handed.admit(vec![paper("new.pdf"), paper("both.pdf")]);
        handed.load(|| vec![paper("old.pdf"), paper("both.pdf")]);
        handed.load(|| vec![paper("never.pdf")]);

        assert_eq!(
            handed.listed(),
            vec![paper("old.pdf"), paper("new.pdf"), paper("both.pdf")]
        );
    }

    #[test]
    fn the_latest_handed_over_are_kept_and_no_more() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let handed = Handed::default();
        let paper = |n: usize| dir.path().join(format!("{n}.pdf"));
        handed.admit((0..MOST_KEPT).map(paper).collect());
        handed.admit(vec![paper(0)]);
        handed.admit(vec![paper(MOST_KEPT)]);

        let listed = handed.listed();
        assert_eq!(listed.len(), MOST_KEPT);
        assert!(!handed.holds(&paper(1)));
        assert!(handed.holds(&paper(0)));
        assert_eq!(listed.last(), Some(&paper(MOST_KEPT)));
    }

    #[test]
    fn the_same_paper_is_the_copy_the_space_has_wherever_it_is() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let space = dir.path().join("Space");
        file(&space.join("Paper.pdf"), b"%PDF another paper");
        file(&space.join("Papers").join("Read.pdf"), b"%PDF the paper");
        let from = dir.path().join("Downloads").join("Paper.pdf");
        file(&from, b"%PDF the paper");

        assert_eq!(
            same_in(&space, &from),
            Some(space.join("Papers").join("Read.pdf"))
        );
        file(&from, b"%PDF changed");
        assert_eq!(same_in(&space, &from), None);
    }

    fn source(relative: &str) -> String {
        fs::read_to_string(crate::app_dir().join(relative)).expect("a file beside the crate")
    }

    #[test]
    fn windows_offers_nib_for_a_pdf_and_claims_nothing() {
        let script = source("installer.nsh");
        let (install, uninstall) = script
            .split_once("!macro NIB_PDF_FORGET")
            .expect("a macro that forgets");
        for line in [
            r#"WriteRegStr SHCTX "Software\Classes\NibPDF\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'"#,
            r#"WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF" """#,
        ] {
            assert!(install.contains(line), "installer.nsh does not say: {line}");
        }
        for line in [
            r#"DeleteRegKey SHCTX "Software\Classes\NibPDF""#,
            r#"DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF""#,
        ] {
            assert!(
                uninstall.contains(line),
                "installer.nsh does not say: {line}"
            );
        }
        let hooks = script
            .split_once("!macro NSIS_HOOK_POSTINSTALL")
            .expect("an install hook")
            .1;
        let (installing, uninstalling) = hooks
            .split_once("!macro NSIS_HOOK_POSTUNINSTALL")
            .expect("an uninstall hook");
        assert!(installing.contains("!insertmacro NIB_PDF_OPEN_WITH"));
        assert!(uninstalling.contains("!insertmacro NIB_PDF_FORGET"));
        assert!(!script.contains(r#"WriteRegStr SHCTX "Software\Classes\.pdf" """#));

        let fragment = source("wix/pdf.wxs");
        for line in [
            r#"Key="Software\Classes\NibPDF\shell\open\command" Type="string" Value="&quot;[!Path]&quot; &quot;%1&quot;""#,
            r#"Key="Software\Classes\.pdf\OpenWithProgids" Name="NibPDF" Type="string" Value="""#,
        ] {
            assert!(fragment.contains(line), "pdf.wxs does not say: {line}");
        }
        assert!(!fragment.contains(r#"Key="Software\Classes\.pdf" Type"#));
        assert!(source("tauri.conf.json").contains(r#""wix/pdf.wxs""#));

        let config: serde_json::Value =
            serde_json::from_str(&source("tauri.conf.json")).expect("the config");
        let product = config["productName"].as_str().expect("a product name");
        for line in [
            format!(r#"Key="Software\Classes\NibPDF" Type="string" Value="{product} PDF""#),
            format!(
                r#"Key="Software\Classes\NibPDF\Application" Name="ApplicationName" Type="string" Value="{product}""#
            ),
        ] {
            assert!(fragment.contains(&line), "pdf.wxs does not say: {line}");
        }
        assert!(install
            .contains(r#"WriteRegStr SHCTX "Software\Classes\NibPDF" "" "${PRODUCTNAME} PDF""#));
    }

    #[test]
    fn two_files_are_the_same_only_byte_for_byte() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let one = dir.path().join("one");
        let long = vec![7u8; 40 * 1024];
        file(&one, &long);
        let same = dir.path().join("same");
        file(&same, &long);
        let longer = dir.path().join("longer");
        file(&longer, &[long.as_slice(), b"!"].concat());
        let other = dir.path().join("other");
        let mut changed = long.clone();
        changed[30 * 1024] = 8;
        file(&other, &changed);

        assert!(super::same_bytes(&one, &same).expect("read"));
        assert!(!super::same_bytes(&one, &longer).expect("read"));
        assert!(!super::same_bytes(&longer, &one).expect("read"));
        assert!(!super::same_bytes(&one, &other).expect("read"));
    }
}
