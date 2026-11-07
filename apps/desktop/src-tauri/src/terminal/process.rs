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
fn front(shell: Option<u32>, _master: &dyn MasterPty) -> Option<(u32, String)> {
    let processes = processes();
    front_below(shell?, &processes, &started()).map(|one| (one.id, program_name(&one.name)))
}

#[cfg(unix)]
fn front(shell: Option<u32>, master: &dyn MasterPty) -> Option<(u32, String)> {
    let front = master.process_group_leader()?;
    if i64::from(front) == i64::from(shell?) {
        return None;
    }
    let pid = u32::try_from(front).ok()?;
    name_of(pid).map(|name| (pid, program_name(&name)))
}

pub fn program(shell: Option<u32>, master: &dyn MasterPty) -> Option<String> {
    front(shell, master).map(|(_, name)| name)
}

pub fn command(shell: Option<u32>, master: &dyn MasterPty) -> Option<(String, Vec<String>)> {
    let (pid, name) = front(shell, master)?;
    Some((name, arguments_of(pid)?))
}

#[cfg(target_os = "linux")]
fn arguments_of(pid: u32) -> Option<Vec<String>> {
    let line = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    Some(split_arguments(&line, 1))
}

#[cfg_attr(
    not(target_os = "linux"),
    allow(dead_code, reason = "only Linux's kernel answers in this shape")
)]
fn split_arguments(bytes: &[u8], skip: usize) -> Vec<String> {
    bytes
        .strip_suffix(&[0])
        .unwrap_or(bytes)
        .split(|one| *one == 0)
        .skip(skip)
        .map(|one| String::from_utf8_lossy(one).into_owned())
        .collect()
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "sysctl is the kernel's own call and has no safe wrapper"
)]
fn arguments_of(pid: u32) -> Option<Vec<String>> {
    let pid = libc::c_int::try_from(pid).ok()?;
    let mut most: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let mut name = [libc::CTL_KERN, libc::KERN_ARGMAX];
    let read = unsafe {
        libc::sysctl(
            name.as_mut_ptr(),
            2,
            std::ptr::from_mut(&mut most).cast(),
            &raw mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }

    let mut buffer = vec![0_u8; usize::try_from(most).ok()?];
    let mut size = buffer.len();
    let mut name = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let read = unsafe {
        libc::sysctl(
            name.as_mut_ptr(),
            3,
            buffer.as_mut_ptr().cast(),
            &raw mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }
    procargs(&buffer[..size.min(buffer.len())])
}

#[cfg_attr(
    not(target_os = "macos"),
    allow(dead_code, reason = "only a Mac's kernel answers in this shape")
)]
fn procargs(buffer: &[u8]) -> Option<Vec<String>> {
    let count = usize::try_from(i32::from_ne_bytes(buffer.get(..4)?.try_into().ok()?)).ok()?;
    let rest = &buffer[4..];
    let path_end = rest.iter().position(|one| *one == 0)?;
    let start = rest[path_end..].iter().position(|one| *one != 0)? + path_end;
    let mut words = rest[start..]
        .split(|one| *one == 0)
        .take(count)
        .map(|one| String::from_utf8_lossy(one).into_owned())
        .collect::<Vec<_>>();
    if words.len() < count || words.is_empty() {
        return None;
    }
    words.remove(0);
    Some(words)
}

#[cfg(windows)]
const MOST_COMMAND_LINE: usize = 8200;

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a process's command line is the kernel's own call and has no safe wrapper"
)]
fn arguments_of(pid: u32) -> Option<Vec<String>> {
    use windows::Wdk::System::Threading::{
        NtQueryInformationProcess, ProcessCommandLineInformation,
    };
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HLOCAL, UNICODE_STRING};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Shell::CommandLineToArgvW;

    let mut buffer = vec![0_u64; 4096];
    let line: Vec<u16> = unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut asked = 0;
        let status = loop {
            asked += 1;
            let mut written = 0_u32;
            let status = NtQueryInformationProcess(
                handle,
                ProcessCommandLineInformation,
                buffer.as_mut_ptr().cast(),
                u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX),
                &raw mut written,
            );
            let needed = usize::try_from(written).unwrap_or(0).div_ceil(8);
            if status.is_ok() || asked > 1 || needed <= buffer.len() || needed > MOST_COMMAND_LINE {
                break status;
            }
            buffer = vec![0_u64; needed];
        };
        let _ = CloseHandle(handle);
        if status.is_err() {
            return None;
        }
        let text = &*buffer.as_ptr().cast::<UNICODE_STRING>();
        let units = usize::from(text.Length / 2);
        let start = buffer.as_ptr() as usize;
        let end = start + buffer.len() * 8;
        let first = text.Buffer.0 as usize;
        if text.Buffer.is_null() || first < start || first.checked_add(units * 2)? > end {
            return None;
        }
        std::slice::from_raw_parts(text.Buffer.0, units).to_vec()
    };

    let mut line = line;
    line.push(0);
    let mut count = 0_i32;
    unsafe {
        let words = CommandLineToArgvW(windows::core::PCWSTR(line.as_ptr()), &raw mut count);
        if words.is_null() {
            return None;
        }
        let found = (0..usize::try_from(count).unwrap_or(0))
            .skip(1)
            .map(|at| String::from_utf16_lossy((*words.add(at)).as_wide()))
            .collect();
        let _ = LocalFree(HLOCAL(words.cast()));
        Some(found)
    }
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn arguments_of(_pid: u32) -> Option<Vec<String>> {
    None
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
            process(10, 1, "orden.exe"),
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

    #[test]
    fn a_command_line_is_split_at_its_nuls() {
        assert_eq!(
            split_arguments(b"ssh\0-p\x002222\0pi\0", 1),
            ["-p", "2222", "pi"]
        );
        assert_eq!(split_arguments(b"ssh\0\0pi", 1), ["", "pi"]);
        assert!(split_arguments(b"ssh", 1).is_empty());
    }

    #[test]
    fn a_macs_process_arguments_are_after_its_path() {
        let mut buffer = 3_i32.to_ne_bytes().to_vec();
        buffer.extend_from_slice(b"/usr/bin/ssh\0\0\0ssh\0-A\0pi\0TERM=xterm\0");
        assert_eq!(
            procargs(&buffer),
            Some(vec!["-A".to_owned(), "pi".to_owned()])
        );
        assert_eq!(procargs(&buffer[..6]), None);
    }

    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    #[test]
    fn the_kernel_says_what_a_process_was_started_with() {
        let (program, args) = if cfg!(windows) {
            ("ping", vec!["-n", "5", "127.0.0.1"])
        } else {
            ("sleep", vec!["5"])
        };
        let mut child = std::process::Command::new(program)
            .args(&args)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let wanted: Vec<String> = args.iter().map(|one| (*one).to_owned()).collect();
        let mut found = None;
        for _ in 0..50 {
            found = arguments_of(child.id());
            if found.as_ref() == Some(&wanted) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(found, Some(wanted));
    }

    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    #[test]
    fn the_kernel_says_a_command_line_near_the_longest_windows_takes() {
        let long = "x".repeat(30_000);
        #[cfg(windows)]
        let (mut child, wanted) = {
            let args = vec![
                "-NoProfile".to_owned(),
                "-Command".to_owned(),
                format!("Start-Sleep 6 #{long}"),
            ];
            let child = std::process::Command::new("powershell.exe")
                .args(&args)
                .stdout(std::process::Stdio::null())
                .spawn()
                .unwrap();
            (child, args)
        };
        #[cfg(unix)]
        let (mut child, wanted) = {
            let args = vec!["-c".to_owned(), "sleep 6; true".to_owned(), long];
            let child = std::process::Command::new("sh")
                .args(&args)
                .spawn()
                .unwrap();
            (child, args)
        };
        let mut found = None;
        for _ in 0..100 {
            found = arguments_of(child.id());
            if found.as_ref() == Some(&wanted) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(found.as_ref().map(Vec::len), Some(wanted.len()));
        assert!(found == Some(wanted), "the long line came back changed");
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
