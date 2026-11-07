use std::io;
use std::process::{Child, Command};

pub struct Family {
    pid: u32,
    #[cfg(windows)]
    job: Option<std::os::windows::io::OwnedHandle>,
}

pub fn spawn(command: &mut Command) -> io::Result<(Child, Family)> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;

        const NO_WINDOW: u32 = 0x0800_0000;

        crate::mcp::keep_the_pipes();
        command.creation_flags(NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }

    let child = command.spawn()?;
    let family = Family {
        pid: child.id(),
        #[cfg(windows)]
        job: job_for(&child),
    };
    Ok((child, family))
}

impl Family {
    pub fn end(&self) {
        #[cfg(windows)]
        {
            if let Some(job) = &self.job {
                end_job(job);
                return;
            }
            let pid = self.pid.to_string();
            std::thread::spawn(move || {
                let _ = quiet(Command::new("taskkill").args(["/T", "/F", "/PID", &pid])).status();
            });
        }
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        end_group(self.pid);
        #[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
        {
            let group = format!("-{}", self.pid);
            std::thread::spawn(move || {
                let _ = quiet(Command::new("kill").args(["-KILL", "--", &group])).status();
            });
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[allow(
    unsafe_code,
    reason = "killpg is the system's own call and has no safe wrapper in the crates nib uses"
)]
fn end_group(pid: u32) {
    let Ok(group) = libc::pid_t::try_from(pid) else {
        return;
    };
    if group > 0 {
        let _ = unsafe { libc::killpg(group, libc::SIGKILL) };
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn quiet(command: &mut Command) -> &mut Command {
    use std::process::Stdio;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a job object is Win32's own and has no safe wrapper in the crates nib uses"
)]
fn job_for(child: &Child) -> Option<std::os::windows::io::OwnedHandle> {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let size = u32::try_from(std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).ok()?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
        let owned = OwnedHandle::from_raw_handle(job.0);
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            size,
        )
        .ok()?;
        AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())).ok()?;
        Some(owned)
    }
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a job object is Win32's own and has no safe wrapper in the crates nib uses"
)]
fn end_job(job: &std::os::windows::io::OwnedHandle) {
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::TerminateJobObject;

    let _ = unsafe { TerminateJobObject(HANDLE(job.as_raw_handle()), 1) };
}
