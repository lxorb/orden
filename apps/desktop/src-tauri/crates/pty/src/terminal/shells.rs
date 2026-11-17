use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, PoisonError};

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Cmd,
    PowerShell,
    Bash,
    Wsl,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shell {
    pub id: String,
    pub name: String,
    program: PathBuf,
    args: Vec<String>,
    kind: Kind,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Offered {
    id: String,
    name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub folder: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Studio {
    pub instance: String,
    pub path: PathBuf,
    pub line: String,
    pub edition: String,
}

pub trait Machine {
    fn var(&self, name: &str) -> Option<String>;
    fn exists(&self, path: &Path) -> bool;
    fn is_folder(&self, path: &Path) -> bool;
    fn distributions(&self) -> Vec<String>;
    fn studios(&self) -> Vec<Studio>;
    fn etc_shells(&self) -> String;
}

static WSL_SILENT: AtomicBool = AtomicBool::new(false);

const LOOKS: u8 = 3;

struct Kept<T: 'static> {
    state: Mutex<Looks<T>>,
    looked: Condvar,
}

struct Looks<T: 'static> {
    found: Option<&'static T>,
    left: u8,
    looking: bool,
}

impl<T: 'static> Kept<T> {
    const fn new() -> Self {
        Self {
            state: Mutex::new(Looks {
                found: None,
                left: LOOKS,
                looking: false,
            }),
            looked: Condvar::new(),
        }
    }

    fn get(&self, look: impl FnOnce() -> (T, bool)) -> &'static T {
        let mut state = self.lock();
        if state.looking {
            state = self
                .looked
                .wait_while(state, |state| state.looking)
                .unwrap_or_else(PoisonError::into_inner);
            if let Some(found) = state.found {
                return found;
            }
        }
        if let (Some(found), 0) = (state.found, state.left) {
            return found;
        }
        state.looking = true;
        drop(state);

        let (found, sure) = look();
        let found: &'static T = Box::leak(Box::new(found));

        let mut state = self.lock();
        state.found = Some(found);
        state.left = if sure { 0 } else { state.left - 1 };
        state.looking = false;
        self.looked.notify_all();
        found
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Looks<T>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn detected() -> &'static [Shell] {
    static FOUND: Kept<Vec<Shell>> = Kept::new();
    FOUND.get(|| {
        let machine = ThisMachine;
        let found = if cfg!(windows) {
            windows(&machine)
        } else {
            unix(&machine)
        };
        (found, !WSL_SILENT.swap(false, Ordering::SeqCst))
    })
}

pub fn find(id: &str) -> Option<&'static Shell> {
    detected().iter().find(|one| one.id == id)
}

impl Shell {
    pub fn offered(&self) -> Offered {
        Offered {
            id: self.id.clone(),
            name: self.name.clone(),
        }
    }

    fn new(id: impl Into<String>, name: impl Into<String>, program: PathBuf, kind: Kind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            program,
            args: Vec::new(),
            kind,
        }
    }

    fn with_args(mut self, args: &[&str]) -> Self {
        self.args = args.iter().map(|one| (*one).to_owned()).collect();
        self
    }

    pub fn launch(&self, folder: Option<&str>, machine: &impl Machine) -> Launch {
        let mut args = self.args.clone();
        let mut env = vec![
            ("TERM".to_owned(), "xterm-256color".to_owned()),
            ("COLORTERM".to_owned(), "truecolor".to_owned()),
            ("TERM_PROGRAM".to_owned(), "orden".to_owned()),
        ];

        let home = machine
            .var(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from);
        let mut start = folder
            .map(PathBuf::from)
            .filter(|one| one.is_absolute() && machine.is_folder(one));

        if self.kind == Kind::Wsl {
            if let Some(linux) = folder.filter(|one| one.starts_with('/')) {
                args.extend(["--cd".to_owned(), linux.to_owned()]);
                start = None;
            }
        }

        match self.kind {
            Kind::Cmd => {
                let prompt = match machine.var("PROMPT") {
                    Some(own) => format!("{CMD_MARK}{own}"),
                    None => CMD_PROMPT.to_owned(),
                };
                env.push(("PROMPT".to_owned(), prompt));
            }
            Kind::PowerShell => args.extend(powershell_args(None)),
            Kind::Bash if machine.var("PROMPT_COMMAND").is_none() => {
                env.push(("PROMPT_COMMAND".to_owned(), BASH_PROMPT.to_owned()));
            }
            Kind::Wsl if machine.var("PROMPT_COMMAND").is_none() => {
                env.push(("PROMPT_COMMAND".to_owned(), BASH_PROMPT.to_owned()));
                let carried = match machine.var("WSLENV") {
                    Some(had) if !had.is_empty() => format!("{had}:PROMPT_COMMAND/u"),
                    _ => "PROMPT_COMMAND/u".to_owned(),
                };
                env.push(("WSLENV".to_owned(), carried));
            }
            _ => {}
        }

        if !cfg!(windows) {
            let unset = ["LANG", "LC_ALL", "LC_CTYPE"]
                .iter()
                .all(|one| machine.var(one).is_none());
            if unset {
                env.push(("LANG".to_owned(), "en_US.UTF-8".to_owned()));
            }
        }

        Launch {
            program: self.program.clone(),
            args,
            folder: start.or(home),
            env,
        }
    }
}

const CMD_MARK: &str = "$E]133;A$E\\";

const CMD_PROMPT: &str = "$E]133;A$E\\$E]9;9;$P$E\\$P$G";

const BASH_PROMPT: &str = r#"printf '\e]133;A\e\\\e]7;file://%s\e\\' "$PWD""#;

const POWERSHELL_PROMPT: &str = "$global:__ordenPrompt = $function:prompt; \
function global:prompt { \
[Console]::Write([char]27 + ']133;A' + [char]27 + '\\'); \
$here = $executionContext.SessionState.Path.CurrentLocation; \
if ($here.Provider.Name -eq 'FileSystem') { [Console]::Write([char]27 + ']9;9;' + $here.ProviderPath + [char]27 + '\\') }; \
& $global:__ordenPrompt }";

fn powershell_args(first: Option<&str>) -> Vec<String> {
    let command = match first {
        Some(first) => format!("{first}; {POWERSHELL_PROMPT}"),
        None => POWERSHELL_PROMPT.to_owned(),
    };
    vec!["-NoExit".to_owned(), "-Command".to_owned(), command]
}

pub fn windows(machine: &impl Machine) -> Vec<Shell> {
    let root = machine
        .var("SystemRoot")
        .unwrap_or_else(|| r"C:\Windows".to_owned());
    let system = Path::new(&root).join("System32");
    let mut found = Vec::new();

    if let Some(pwsh) = powershell_seven(machine) {
        found.push(Shell::new("pwsh", "PowerShell", pwsh, Kind::PowerShell));
    }

    let windows_powershell = system.join(r"WindowsPowerShell\v1.0\powershell.exe");
    if machine.exists(&windows_powershell) {
        found.push(Shell::new(
            "powershell",
            "Windows PowerShell",
            windows_powershell.clone(),
            Kind::PowerShell,
        ));
    }

    let cmd = machine
        .var("ComSpec")
        .map(PathBuf::from)
        .filter(|one| machine.exists(one))
        .unwrap_or_else(|| system.join("cmd.exe"));
    found.push(Shell::new("cmd", "Command Prompt", cmd.clone(), Kind::Cmd));

    if let Some(bash) = git_bash(machine) {
        found.push(
            Shell::new("git-bash", "Git Bash", bash, Kind::Bash).with_args(&["--login", "-i"]),
        );
    }

    let wsl = system.join("wsl.exe");
    if machine.exists(&wsl) {
        for name in machine.distributions() {
            found.push(
                Shell::new(format!("wsl:{name}"), name.clone(), wsl.clone(), Kind::Wsl)
                    .with_args(&["-d", &name]),
            );
        }
    }

    found.extend(developer_shells(machine, &cmd, &windows_powershell));
    found
}

fn powershell_seven(machine: &impl Machine) -> Option<PathBuf> {
    let installed = ["ProgramFiles", "ProgramW6432"]
        .iter()
        .filter_map(|one| machine.var(one))
        .map(|folder| Path::new(&folder).join(r"PowerShell\7\pwsh.exe"));

    installed
        .chain(on_path(machine, "pwsh.exe"))
        .find(|one| machine.exists(one))
}

fn git_bash(machine: &impl Machine) -> Option<PathBuf> {
    let installed = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|one| machine.var(one))
        .map(|folder| Path::new(&folder).join(r"Git\bin\bash.exe"))
        .chain(
            machine
                .var("LOCALAPPDATA")
                .map(|folder| Path::new(&folder).join(r"Programs\Git\bin\bash.exe")),
        );
    let beside_git = on_path(machine, "git.exe").into_iter().filter_map(|git| {
        let git_root = git.parent()?.parent()?;
        Some(git_root.join(r"bin\bash.exe"))
    });

    installed.chain(beside_git).find(|one| machine.exists(one))
}

fn on_path(machine: &impl Machine, program: &str) -> Vec<PathBuf> {
    let path = machine.var("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .map(|folder| folder.join(program))
        .collect()
}

fn developer_shells(machine: &impl Machine, cmd: &Path, powershell: &Path) -> Vec<Shell> {
    let studios = machine.studios();
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86" => "x86",
        _ => "amd64",
    };
    let arches = format!("-arch={arch} -host_arch={arch}");
    let mut found = Vec::new();

    for studio in &studios {
        let shared = studios.iter().filter(|one| one.line == studio.line).count() > 1;
        let named = |what: &str| {
            let mut name = format!("{what} for VS {}", studio.line);
            if shared {
                name = format!("{name} ({})", studio.edition);
            }
            name
        };
        let tools = studio.path.join(r"Common7\Tools");

        let batch = tools.join("VsDevCmd.bat");
        if machine.exists(&batch) {
            let batch = batch.to_string_lossy().into_owned();
            let arch_flag = format!("-arch={arch}");
            let host_flag = format!("-host_arch={arch}");
            found.push(
                Shell::new(
                    format!("vs-cmd:{}", studio.instance),
                    named("Developer Command Prompt"),
                    cmd.to_path_buf(),
                    Kind::Cmd,
                )
                .with_args(&[
                    "/k",
                    &batch,
                    "-startdir=none",
                    &arch_flag,
                    &host_flag,
                ]),
            );
        }

        let module = tools.join("Microsoft.VisualStudio.DevShell.dll");
        if machine.exists(&module) && machine.exists(powershell) {
            let enter = format!(
                "&{{Import-Module '{}'; Enter-VsDevShell {} -SkipAutomaticLocation -DevCmdArguments '{arches}'}}",
                module.to_string_lossy().replace('\'', "''"),
                studio.instance,
            );
            let mut shell = Shell::new(
                format!("vs-pwsh:{}", studio.instance),
                named("Developer PowerShell"),
                powershell.to_path_buf(),
                Kind::Other,
            );
            shell.args = powershell_args(Some(&enter));
            found.push(shell);
        }
    }

    found
}

pub fn unix(machine: &impl Machine) -> Vec<Shell> {
    let listed = machine.etc_shells();
    let mut paths: Vec<String> = machine.var("SHELL").into_iter().collect();
    paths.extend(
        listed
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with('/'))
            .map(str::to_owned),
    );

    let mut seen = HashSet::new();
    let mut kept: Vec<PathBuf> = Vec::new();
    for path in paths {
        let path = PathBuf::from(path);
        let program = name_of(&path);
        if matches!(program.as_str(), "nologin" | "false" | "git-shell" | "true") {
            continue;
        }
        if !machine.exists(&path) || !seen.insert(path.clone()) {
            continue;
        }
        kept.push(path);
    }

    let login = cfg!(target_os = "macos");

    kept.iter()
        .map(|path| {
            let program = name_of(path);
            let twice = kept.iter().filter(|one| name_of(one) == program).count() > 1;
            let id = path.to_string_lossy().into_owned();
            let name = if twice { id.clone() } else { program.clone() };
            let kind = if program == "bash" {
                Kind::Bash
            } else {
                Kind::Other
            };
            let shell = Shell::new(id, name, path.clone(), kind);
            if login {
                shell.with_args(&["-l"])
            } else {
                shell
            }
        })
        .collect()
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|one| one.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows has WSL to ask; the parser is tested everywhere"
    )
)]
pub fn distributions(printed: &[u8]) -> Vec<String> {
    let wide = printed.len() >= 2 && printed.chunks(2).any(|pair| pair.get(1) == Some(&0));
    let text = if wide {
        let units: Vec<u16> = printed
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(printed).into_owned()
    };

    text.lines()
        .map(|line| {
            line.trim_matches(|one: char| one.is_whitespace() || one == '\0' || one == '\u{feff}')
        })
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .map(str::to_owned)
        .collect()
}

pub fn studio(instance: &str, json: &str) -> Option<Studio> {
    let value: serde_json::Value =
        serde_json::from_str(json.trim_start_matches('\u{feff}')).ok()?;
    let path = PathBuf::from(value.get("installationPath")?.as_str()?);

    let title = value
        .get("localizedResources")
        .and_then(serde_json::Value::as_array)
        .and_then(|all| {
            all.iter().find(|one| {
                one.get("language").and_then(serde_json::Value::as_str) == Some("en-us")
            })
        })
        .and_then(|one| one.get("title"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let year = title
        .split_whitespace()
        .rev()
        .find(|word| word.len() == 4 && word.bytes().all(|b| b.is_ascii_digit()));
    let line = year.map(str::to_owned).or_else(|| {
        value
            .pointer("/catalogInfo/productLineVersion")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    })?;

    let edition = value
        .pointer("/product/id")
        .and_then(serde_json::Value::as_str)
        .and_then(|id| id.rsplit('.').next())
        .unwrap_or_default()
        .to_owned();

    Some(Studio {
        instance: instance.to_owned(),
        path,
        line,
        edition,
    })
}

pub struct ThisMachine;

impl Machine for ThisMachine {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|one| !one.is_empty())
    }

    fn exists(&self, path: &Path) -> bool {
        std::fs::symlink_metadata(path).is_ok_and(|one| !one.is_dir())
    }

    fn is_folder(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn distributions(&self) -> Vec<String> {
        wsl_list()
    }

    fn studios(&self) -> Vec<Studio> {
        let Some(data) = self.var("ProgramData") else {
            return Vec::new();
        };
        let folder = Path::new(&data).join(r"Microsoft\VisualStudio\Packages\_Instances");
        let Ok(entries) = std::fs::read_dir(folder) else {
            return Vec::new();
        };

        let mut found: Vec<Studio> = entries
            .flatten()
            .filter_map(|entry| {
                let instance = entry.file_name().to_string_lossy().into_owned();
                let json = std::fs::read_to_string(entry.path().join("state.json")).ok()?;
                studio(&instance, &json)
            })
            .collect();
        found.sort_by(|a, b| b.line.cmp(&a.line).then(a.edition.cmp(&b.edition)));
        found
    }

    fn etc_shells(&self) -> String {
        std::fs::read_to_string("/etc/shells").unwrap_or_default()
    }
}

#[cfg(windows)]
fn wsl_list() -> Vec<String> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    const NO_WINDOW: u32 = 0x0800_0000;

    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_owned());
    let Ok(mut child) = Command::new(Path::new(&root).join(r"System32\wsl.exe"))
        .args(["-l", "-q"])
        .env("WSL_UTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .spawn()
    else {
        return Vec::new();
    };

    let Some(mut out) = child.stdout.take() else {
        return Vec::new();
    };
    let (sent, heard) = mpsc::channel();
    std::thread::spawn(move || {
        let mut printed = Vec::new();
        let _ = out.read_to_end(&mut printed);
        let _ = sent.send(printed);
    });

    let printed = heard
        .recv_timeout(Duration::from_secs(3))
        .unwrap_or_else(|_| {
            WSL_SILENT.store(true, Ordering::SeqCst);
            Vec::new()
        });
    let _ = child.kill();
    let _ = child.wait();
    distributions(&printed)
}

#[cfg(not(windows))]
fn wsl_list() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Fake {
        vars: HashMap<String, String>,
        files: HashSet<PathBuf>,
        folders: HashSet<PathBuf>,
        distros: Vec<String>,
        studios: Vec<Studio>,
        shells: String,
    }

    impl Fake {
        fn set(mut self, name: &str, value: &str) -> Self {
            self.vars.insert(name.to_owned(), value.to_owned());
            self
        }

        fn file(mut self, path: &str) -> Self {
            self.files.insert(PathBuf::from(path));
            self
        }

        fn folder(mut self, path: &str) -> Self {
            self.folders.insert(PathBuf::from(path));
            self
        }
    }

    impl Machine for Fake {
        fn var(&self, name: &str) -> Option<String> {
            self.vars.get(name).cloned()
        }
        fn exists(&self, path: &Path) -> bool {
            self.files.contains(path)
        }
        fn is_folder(&self, path: &Path) -> bool {
            self.folders.contains(path)
        }
        fn distributions(&self) -> Vec<String> {
            self.distros.clone()
        }
        fn studios(&self) -> Vec<Studio> {
            self.studios.clone()
        }
        fn etc_shells(&self) -> String {
            self.shells.clone()
        }
    }

    fn ids(shells: &[Shell]) -> Vec<&str> {
        shells.iter().map(|one| one.id.as_str()).collect()
    }

    fn names(shells: &[Shell]) -> Vec<&str> {
        shells.iter().map(|one| one.name.as_str()).collect()
    }

    #[cfg(windows)]
    fn loaded() -> Fake {
        let mut fake = Fake::default()
            .set("SystemRoot", r"C:\Windows")
            .set("ComSpec", r"C:\Windows\System32\cmd.exe")
            .set("ProgramFiles", r"C:\Program Files")
            .set("USERPROFILE", r"C:\Users\me")
            .file(r"C:\Program Files\PowerShell\7\pwsh.exe")
            .file(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
            .file(r"C:\Windows\System32\cmd.exe")
            .file(r"C:\Program Files\Git\bin\bash.exe")
            .file(r"C:\Windows\System32\wsl.exe")
            .file(r"C:\VS\Common7\Tools\VsDevCmd.bat")
            .file(r"C:\VS\Common7\Tools\Microsoft.VisualStudio.DevShell.dll");
        fake.distros = vec!["Ubuntu".to_owned(), "Debian".to_owned()];
        fake.studios = vec![Studio {
            instance: "66e9e031".to_owned(),
            path: PathBuf::from(r"C:\VS"),
            line: "2026".to_owned(),
            edition: "Community".to_owned(),
        }];
        fake
    }

    #[test]
    fn a_look_that_was_not_sure_is_looked_at_again() {
        let kept = Kept::new();
        assert_eq!(*kept.get(|| (vec!["cmd"], false)), vec!["cmd"]);
        assert_eq!(
            *kept.get(|| (vec!["cmd", "wsl:Ubuntu"], true)),
            vec!["cmd", "wsl:Ubuntu"]
        );
        assert_eq!(*kept.get(|| panic!("kept")), vec!["cmd", "wsl:Ubuntu"]);
    }

    #[test]
    fn a_sure_look_is_the_only_one() {
        let kept = Kept::new();
        assert_eq!(*kept.get(|| ("cmd", true)), "cmd");
        assert_eq!(*kept.get(|| panic!("kept")), "cmd");
    }

    #[test]
    fn a_look_is_made_outside_the_lock() {
        let kept = Kept::new();
        kept.get(|| {
            assert!(kept.state.try_lock().is_ok());
            ("cmd", true)
        });
    }

    #[test]
    fn who_asks_during_a_look_shares_its_answer() {
        let kept: &'static Kept<&str> = Box::leak(Box::new(Kept::new()));
        let (started, looking) = std::sync::mpsc::channel();
        let (finish, finished) = std::sync::mpsc::channel::<()>();
        let first = std::thread::spawn(move || {
            kept.get(|| {
                started.send(()).expect("the test");
                finished.recv().expect("the test");
                ("cmd", true)
            })
        });
        looking.recv().expect("the look");

        let second = std::thread::spawn(|| *kept.get(|| panic!("a second look")));
        std::thread::yield_now();
        finish.send(()).expect("the look");

        assert_eq!(*first.join().expect("the first"), "cmd");
        assert_eq!(second.join().expect("the second"), "cmd");
    }

    #[test]
    fn a_wsl_that_never_answers_stops_being_asked() {
        let kept = Kept::new();
        for _ in 0..LOOKS {
            kept.get(|| ("cmd", false));
        }
        assert_eq!(*kept.get(|| panic!("given up")), "cmd");
    }

    #[test]
    #[cfg(windows)]
    fn windows_offers_what_windows_terminal_offers_in_its_order() {
        let found = windows(&loaded());

        assert_eq!(
            ids(&found),
            vec![
                "pwsh",
                "powershell",
                "cmd",
                "git-bash",
                "wsl:Ubuntu",
                "wsl:Debian",
                "vs-cmd:66e9e031",
                "vs-pwsh:66e9e031",
            ]
        );
        assert_eq!(
            names(&found),
            vec![
                "PowerShell",
                "Windows PowerShell",
                "Command Prompt",
                "Git Bash",
                "Ubuntu",
                "Debian",
                "Developer Command Prompt for VS 2026",
                "Developer PowerShell for VS 2026",
            ]
        );
    }

    #[test]
    #[cfg(windows)]
    fn a_fresh_windows_starts_with_windows_powershell() {
        let fresh = Fake::default()
            .set("SystemRoot", r"C:\Windows")
            .file(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
            .file(r"C:\Windows\System32\cmd.exe");

        assert_eq!(ids(&windows(&fresh)), vec!["powershell", "cmd"]);
    }

    #[test]
    #[cfg(windows)]
    fn git_bash_is_found_beside_git_on_the_path() {
        let fake = Fake::default()
            .set("SystemRoot", r"C:\Windows")
            .set("PATH", r"C:\Tools\Git\cmd;C:\Windows")
            .file(r"C:\Tools\Git\bin\bash.exe");

        let found = windows(&fake);
        let bash = found
            .iter()
            .find(|one| one.id == "git-bash")
            .expect("git bash");
        assert_eq!(bash.program, PathBuf::from(r"C:\Tools\Git\bin\bash.exe"));
        assert_eq!(bash.args, vec!["--login", "-i"]);
    }

    #[test]
    #[cfg(windows)]
    fn two_studios_of_one_year_say_which_is_which() {
        let mut fake = loaded();
        fake.studios.push(Studio {
            instance: "e592bff4".to_owned(),
            path: PathBuf::from(r"C:\VS"),
            line: "2026".to_owned(),
            edition: "BuildTools".to_owned(),
        });

        let found = windows(&fake);
        assert!(names(&found).contains(&"Developer PowerShell for VS 2026 (Community)"));
        assert!(names(&found).contains(&"Developer PowerShell for VS 2026 (BuildTools)"));
    }

    #[test]
    fn wsl_prints_utf16_and_its_names_are_read_off_it() {
        let printed: Vec<u8> = "Ubuntu\r\ndocker-desktop\r\nDebian\r\n\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();

        assert_eq!(distributions(&printed), vec!["Ubuntu", "Debian"]);
    }

    #[test]
    fn and_utf8_when_it_was_asked_for_that() {
        assert_eq!(
            distributions(b"Ubuntu-24.04\nkali-linux\n"),
            vec!["Ubuntu-24.04", "kali-linux"]
        );
        assert!(distributions(b"").is_empty());
    }

    #[test]
    fn a_studio_is_read_off_its_installer_state() {
        let json = r#"{
            "installationPath": "C:\\Program Files\\Microsoft Visual Studio\\18\\Community",
            "catalogInfo": { "productLineVersion": "18" },
            "localizedResources": [
                { "language": "zh-cn", "title": "Visual Studio Community 2026" },
                { "language": "en-us", "title": "Visual Studio Community 2026" }
            ],
            "product": { "id": "Microsoft.VisualStudio.Product.Community" }
        }"#;

        let read = studio("66e9e031", json).expect("a studio");
        assert_eq!(read.line, "2026");
        assert_eq!(read.edition, "Community");
        assert_eq!(read.instance, "66e9e031");

        let bare =
            r#"{ "installationPath": "C:\\VS", "catalogInfo": { "productLineVersion": "2022" } }"#;
        assert_eq!(studio("x", bare).expect("a studio").line, "2022");
        assert!(studio("x", "not json").is_none());
    }

    #[test]
    fn unix_offers_the_readers_own_shell_first_and_each_once() {
        let mut fake = Fake::default()
            .set("SHELL", "/bin/zsh")
            .file("/bin/zsh")
            .file("/bin/bash")
            .file("/bin/sh")
            .file("/opt/homebrew/bin/bash")
            .file("/usr/local/bin/fish");
        fake.shells = "# /etc/shells\n/bin/bash\n/bin/csh\n/bin/sh\n/bin/zsh\n/usr/sbin/nologin\n/opt/homebrew/bin/bash\n/usr/local/bin/fish\n"
            .to_owned();

        let found = unix(&fake);
        assert_eq!(
            ids(&found),
            vec![
                "/bin/zsh",
                "/bin/bash",
                "/bin/sh",
                "/opt/homebrew/bin/bash",
                "/usr/local/bin/fish"
            ]
        );
        assert_eq!(
            names(&found),
            vec!["zsh", "/bin/bash", "sh", "/opt/homebrew/bin/bash", "fish"]
        );
    }

    #[test]
    fn command_prompt_says_its_folder_unless_the_reader_set_a_prompt() {
        let cmd = Shell::new("cmd", "Command Prompt", PathBuf::from("cmd.exe"), Kind::Cmd);
        let plain = cmd.launch(None, &Fake::default());
        assert!(plain
            .env
            .contains(&("PROMPT".to_owned(), CMD_PROMPT.to_owned())));
        assert!(CMD_PROMPT.starts_with(CMD_MARK));

        let own = cmd.launch(None, &Fake::default().set("PROMPT", "$G"));
        assert!(own
            .env
            .contains(&("PROMPT".to_owned(), "$E]133;A$E\\$G".to_owned())));
    }

    #[test]
    fn every_prompt_orden_teaches_is_marked() {
        assert!(BASH_PROMPT.starts_with(r"printf '\e]133;A\e\\"));
        assert!(POWERSHELL_PROMPT
            .contains("function global:prompt { [Console]::Write([char]27 + ']133;A'"));
    }

    #[test]
    fn powershell_wraps_the_prompt_it_already_has() {
        let pwsh = Shell::new(
            "pwsh",
            "PowerShell",
            PathBuf::from("pwsh.exe"),
            Kind::PowerShell,
        );
        let launch = pwsh.launch(None, &Fake::default());

        assert_eq!(
            launch.args[..2],
            ["-NoExit".to_owned(), "-Command".to_owned()]
        );
        assert!(launch.args[2].contains("]9;9;"));
        assert!(launch.args[2].contains("& $global:__ordenPrompt"));
        assert!(!launch.args[2].contains('"'));
    }

    #[test]
    fn wsl_is_put_back_in_a_linux_folder_with_cd() {
        let wsl = Shell::new("wsl:Ubuntu", "Ubuntu", PathBuf::from("wsl.exe"), Kind::Wsl)
            .with_args(&["-d", "Ubuntu"]);
        let home = Fake::default()
            .set("USERPROFILE", r"C:\Users\me")
            .set("HOME", "/home/me");

        let launch = wsl.launch(Some("/home/me/code"), &home);
        assert_eq!(launch.args, vec!["-d", "Ubuntu", "--cd", "/home/me/code"]);
        assert!(launch
            .env
            .contains(&("WSLENV".to_owned(), "PROMPT_COMMAND/u".to_owned())));

        let carried = wsl.launch(None, &home.set("WSLENV", "USERPROFILE/p"));
        assert!(carried.env.contains(&(
            "WSLENV".to_owned(),
            "USERPROFILE/p:PROMPT_COMMAND/u".to_owned()
        )));
    }

    #[test]
    fn a_folder_that_is_not_there_is_home() {
        let bash = Shell::new(
            "git-bash",
            "Git Bash",
            PathBuf::from("bash.exe"),
            Kind::Bash,
        );
        let machine = Fake::default()
            .set("USERPROFILE", r"C:\Users\me")
            .set("HOME", "/home/me")
            .folder(if cfg!(windows) { r"C:\notes" } else { "/notes" });
        let there = if cfg!(windows) { r"C:\notes" } else { "/notes" };
        let gone = if cfg!(windows) { r"C:\gone" } else { "/gone" };
        let home = if cfg!(windows) {
            r"C:\Users\me"
        } else {
            "/home/me"
        };

        assert_eq!(
            bash.launch(Some(there), &machine).folder,
            Some(PathBuf::from(there))
        );
        assert_eq!(
            bash.launch(Some(gone), &machine).folder,
            Some(PathBuf::from(home))
        );
        assert_eq!(
            bash.launch(None, &machine).folder,
            Some(PathBuf::from(home))
        );
    }
}
