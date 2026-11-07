use std::time::Duration;

use super::report::Resources;

pub fn resources(uptime: u64) -> Resources {
    Resources {
        memory: memory(),
        cpu: cpu().map(|spent| u64::try_from(spent.as_millis()).unwrap_or(u64::MAX)),
        uptime: Some(uptime),
    }
}

pub fn cpu() -> Option<Duration> {
    #[cfg(windows)]
    {
        crate::trace::cpu()
    }
    #[cfg(unix)]
    {
        let used = usage()?;
        let spent = |one: libc::timeval| {
            Duration::from_secs(u64::try_from(one.tv_sec).unwrap_or(0))
                + Duration::from_micros(u64::try_from(one.tv_usec).unwrap_or(0))
        };
        Some(spent(used.ru_utime) + spent(used.ru_stime))
    }
}

#[cfg(unix)]
#[allow(
    unsafe_code,
    reason = "getrusage fills a struct the C library owns the shape of"
)]
fn usage() -> Option<libc::rusage> {
    let mut used: libc::rusage = unsafe { std::mem::zeroed() };
    (unsafe { libc::getrusage(libc::RUSAGE_SELF, &raw mut used) } == 0).then_some(used)
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a process's memory is Win32's to say, through GetProcessMemoryInfo"
)]
fn memory() -> Option<u64> {
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::GetCurrentProcess;

    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: u32::try_from(std::mem::size_of::<PROCESS_MEMORY_COUNTERS>()).ok()?,
        ..Default::default()
    };
    unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &raw mut counters, counters.cb) }.ok()?;
    u64::try_from(counters.WorkingSetSize).ok()
}

#[cfg(target_os = "linux")]
fn memory() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    Some(pages * page_size())
}

#[cfg(target_os = "linux")]
#[allow(unsafe_code, reason = "sysconf only reads a number the system keeps")]
fn page_size() -> u64 {
    u64::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }).unwrap_or(4096)
}

#[cfg(target_os = "macos")]
fn memory() -> Option<u64> {
    u64::try_from(usage()?.ru_maxrss).ok()
}

#[cfg(test)]
mod tests {
    use super::resources;

    #[test]
    fn a_running_process_has_memory_and_has_spent_some_processor() {
        let spin = std::time::Instant::now();
        while spin.elapsed() < std::time::Duration::from_millis(30) {
            std::hint::black_box(spin.elapsed());
        }
        let seen = resources(7);
        assert!(seen.memory.is_some_and(|bytes| bytes > 1024 * 1024));
        assert!(seen.cpu.is_some());
        assert_eq!(seen.uptime, Some(7));
    }
}
