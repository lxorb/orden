use portable_pty::MasterPty;

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub id: u32,
    pub parent: u32,
    pub name: String,
}

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
const IDLE: [&str; 13] = [
    "conhost.exe",
    "openconsole.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "bash.exe",
    "sh.exe",
    "zsh.exe",
    "fish.exe",
    "wsl.exe",
    "wslhost.exe",
    "wslrelay.exe",
    "git-bash.exe",
];

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
const AGENTS: [&str; 2] = ["claude.exe", "codex.exe"];

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
fn idle(one: &Process) -> bool {
    IDLE.contains(&one.name.to_ascii_lowercase().as_str())
}

type Born<'a> = &'a dyn Fn(u32) -> Option<u64>;

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
fn first_below<'a>(
    root: u32,
    processes: &'a [Process],
    through: impl Fn(&Process) -> bool,
    stop: impl Fn(&Process) -> bool,
    born: Born<'_>,
) -> Option<&'a Process> {
    let mut below = vec![root];
    let mut at = 0;

    while let Some(&parent) = below.get(at) {
        at += 1;
        let parent_born = born(parent);
        for one in processes.iter().filter(|one| {
            one.parent == parent
                && one.id != parent
                && !matches!((parent_born, born(one.id)), (Some(then), Some(now)) if now < then)
        }) {
            if below.contains(&one.id) {
                continue;
            }
            if stop(one) {
                return Some(one);
            }
            if through(one) {
                below.push(one.id);
            }
        }
    }

    None
}

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
pub fn front_below<'a>(root: u32, processes: &'a [Process], born: Born<'_>) -> Option<&'a Process> {
    let front = first_below(root, processes, idle, |one| !idle(one), born)?;
    let agent = |one: &Process| AGENTS.contains(&one.name.to_ascii_lowercase().as_str());
    if agent(front) {
        return Some(front);
    }
    Some(first_below(front.id, processes, |_| true, agent, born).unwrap_or(front))
}

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows lists processes; the kernel answers elsewhere"
    )
)]
pub fn busy_below(root: u32, processes: &[Process], born: Born<'_>) -> bool {
    first_below(root, processes, idle, |one| !idle(one), born).is_some()
}

fn program_name(file: &str) -> String {
    let stem = file
        .len()
        .checked_sub(4)
        .filter(|&at| file.is_char_boundary(at) && file[at..].eq_ignore_ascii_case(".exe"))
        .map_or(file, |at| &file[..at]);
    stem.to_owned()
}

#[cfg(windows)]
pub fn busy(shell: Option<u32>, _master: &dyn MasterPty) -> bool {
    shell.is_some_and(|root| busy_below(root, &processes(), &started()))
}

#[cfg(unix)]
pub fn busy(shell: Option<u32>, master: &dyn MasterPty) -> bool {
    let (Some(shell), Some(front)) = (shell, master.process_group_leader()) else {
        return false;
    };
    i64::from(front) != i64::from(shell)
}

#[cfg(windows)]
pub fn program(shell: Option<u32>, _master: &dyn MasterPty) -> Option<String> {
    let processes = processes();
    front_below(shell?, &processes, &started()).map(|one| program_name(&one.name))
}

#[cfg(unix)]
pub fn program(shell: Option<u32>, master: &dyn MasterPty) -> Option<String> {
    let front = master.process_group_leader()?;
    if i64::from(front) == i64::from(shell?) {
        return None;
    }
    name_of(u32::try_from(front).ok()?).map(|name| program_name(&name))
}

#[cfg(target_os = "linux")]
fn name_of(pid: u32) -> Option<String> {
    let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "proc_pidpath is the kernel's own call and has no safe wrapper"
)]
fn name_of(pid: u32) -> Option<String> {
    let pid = libc::c_int::try_from(pid).ok()?;
    let mut buffer = vec![0_u8; 4096];
    let size = u32::try_from(buffer.len()).ok()?;

    let written = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), size) };
    let written = usize::try_from(written).ok().filter(|&length| length > 0)?;

    let path = String::from_utf8_lossy(&buffer[..written.min(buffer.len())]).into_owned();
    path.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn name_of(_pid: u32) -> Option<String> {
    None
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the toolhelp snapshot is Win32's own call and has no safe wrapper"
)]
pub(crate) fn processes() -> Vec<Process> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut found = Vec::new();
    let size = u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(u32::MAX);

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return found;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size,
            ..Default::default()
        };

        let mut more = Process32FirstW(snapshot, &raw mut entry).is_ok();
        while more {
            let end = entry
                .szExeFile
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(entry.szExeFile.len());
            found.push(Process {
                id: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                name: String::from_utf16_lossy(&entry.szExeFile[..end]),
            });
            more = Process32NextW(snapshot, &raw mut entry).is_ok();
        }

        let _ = CloseHandle(snapshot);
    }

    found
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a process's start time is Win32's own call and has no safe wrapper"
)]
fn started() -> impl Fn(u32) -> Option<u64> {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let known = RefCell::new(HashMap::<u32, Option<u64>>::new());
    move |pid| {
        *known.borrow_mut().entry(pid).or_insert_with(|| {
            let mut created = FILETIME::default();
            let mut exited = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            unsafe {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
                let read = GetProcessTimes(
                    handle,
                    std::ptr::from_mut(&mut created),
                    std::ptr::from_mut(&mut exited),
                    std::ptr::from_mut(&mut kernel),
                    std::ptr::from_mut(&mut user),
                );
                let _ = CloseHandle(handle);
                read.ok()?;
            }
            Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
        })
    }
}

#[cfg(target_os = "linux")]
pub fn folder(shell: Option<u32>) -> Option<String> {
    let link = std::fs::read_link(format!("/proc/{}/cwd", shell?)).ok()?;
    Some(link.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "proc_pidinfo is the kernel's own call and has no safe wrapper"
)]
pub fn folder(shell: Option<u32>) -> Option<String> {
    let pid = libc::c_int::try_from(shell?).ok()?;
    let size = libc::c_int::try_from(std::mem::size_of::<libc::proc_vnodepathinfo>()).ok()?;
    let mut info = std::mem::MaybeUninit::<libc::proc_vnodepathinfo>::zeroed();

    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if written != size {
        return None;
    }

    let info = unsafe { info.assume_init() };
    let path: Vec<u8> = info
        .pvi_cdir
        .vip_path
        .iter()
        .flatten()
        .map(|one| one.to_ne_bytes()[0])
        .take_while(|one| *one != 0)
        .collect();
    (!path.is_empty()).then(|| String::from_utf8_lossy(&path).into_owned())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn folder(_shell: Option<u32>) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNKNOWN: fn(u32) -> Option<u64> = |_| None;

    fn process(id: u32, parent: u32, name: &str) -> Process {
        Process {
            id,
            parent,
            name: name.to_owned(),
        }
    }

    #[test]
    fn a_shell_at_its_prompt_is_not_busy() {
        let listed = [
            process(10, 1, "nib.exe"),
            process(11, 10, "conhost.exe"),
            process(20, 10, "pwsh.exe"),
        ];
        assert!(!busy_below(20, &listed, &UNKNOWN));
    }

    #[test]
    fn shells_inside_shells_are_still_a_prompt() {
        let listed = [
            process(20, 10, "bash.exe"),
            process(21, 20, "bash.exe"),
            process(30, 5, "node.exe"),
        ];
        assert!(!busy_below(20, &listed, &UNKNOWN));

        let nested = [process(20, 10, "pwsh.exe"), process(22, 20, "CMD.EXE")];
        assert!(!busy_below(20, &nested, &UNKNOWN));
    }

    #[test]
    fn anything_else_below_it_is_something_running() {
        let listed = [
            process(20, 10, "pwsh.exe"),
            process(22, 20, "cmd.exe"),
            process(23, 22, "node.exe"),
        ];
        assert!(busy_below(20, &listed, &UNKNOWN));
    }

    #[test]
    fn the_program_in_front_is_the_first_that_is_not_a_shell() {
        let listed = [
            process(20, 10, "pwsh.exe"),
            process(21, 20, "conhost.exe"),
            process(22, 20, "cmd.exe"),
            process(23, 22, "node.exe"),
            process(24, 23, "esbuild.exe"),
        ];
        assert_eq!(
            front_below(20, &listed, &UNKNOWN).map(|one| one.id),
            Some(23)
        );
        assert_eq!(front_below(20, &listed[..3], &UNKNOWN), None);
    }

    #[test]
    fn an_agent_a_launcher_started_is_the_program_in_front() {
        let codex = [
            process(20, 10, "pwsh.exe"),
            process(30, 20, "node.exe"),
            process(31, 30, "codex.exe"),
            process(32, 31, "git.exe"),
        ];
        assert_eq!(
            front_below(20, &codex, &UNKNOWN).map(|one| one.id),
            Some(31)
        );

        let claude = [
            process(20, 10, "pwsh.exe"),
            process(40, 20, "cmd.exe"),
            process(41, 40, "claude.exe"),
            process(42, 41, "node.exe"),
        ];
        assert_eq!(
            front_below(20, &claude, &UNKNOWN).map(|one| one.id),
            Some(41)
        );
    }

    #[test]
    fn a_program_is_named_without_its_ending() {
        assert_eq!(program_name("node.exe"), "node");
        assert_eq!(program_name("Python.EXE"), "Python");
        assert_eq!(program_name("nvim"), "nvim");
        assert_eq!(program_name(".exe"), "");
        assert_eq!(program_name("ä.exe"), "ä");
    }

    #[test]
    fn a_process_that_is_its_own_parent_ends_the_walk() {
        let listed = [
            process(0, 0, "System Idle Process"),
            process(20, 0, "pwsh.exe"),
        ];
        assert!(!busy_below(20, &listed, &UNKNOWN));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn the_kernel_says_where_a_process_is() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .current_dir(dir.path())
            .spawn()
            .unwrap();
        let found = folder(Some(child.id()));
        let _ = child.kill();
        let _ = child.wait();

        let wanted = dir.path().canonicalize().unwrap();
        assert_eq!(found.map(std::path::PathBuf::from), Some(wanted));
        assert_eq!(folder(None), None);
    }

    #[test]
    fn a_process_older_than_the_shell_is_not_running_in_it() {
        let listed = [
            process(20, 10, "cmd.exe"),
            process(31, 20, "svchost.exe"),
            process(32, 20, "node.exe"),
        ];
        let born = |pid: u32| match pid {
            20 => Some(500),
            31 => Some(100),
            32 => Some(900),
            _ => None,
        };
        assert_eq!(
            front_below(20, &listed, &born).map(|one| one.id),
            Some(32),
            "the one started after it"
        );
        assert!(!busy_below(20, &listed[..2], &born), "only the stale one");
        assert!(
            busy_below(20, &listed[..2], &UNKNOWN),
            "believed where nothing is known"
        );
    }
}
