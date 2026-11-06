const MB: u64 = 1024 * 1024;

pub fn too_much(ceiling: u32) -> Option<String> {
    if ceiling == 0 {
        return None;
    }
    past(engine_bytes(), ceiling)
}

fn past(used: u64, ceiling: u32) -> Option<String> {
    let most = u64::from(ceiling) * MB;
    (ceiling > 0 && used > most).then(|| {
        format!(
            "the browser is using {} MB of memory, past the {} MB this agent's limits allow: close or finish some tabs first, or raise the limit in Settings",
            used / MB,
            ceiling
        )
    })
}

#[cfg(windows)]
pub fn engine_bytes() -> u64 {
    let own = std::process::id();
    let all = crate::terminal::process::processes();
    let mut below = vec![own];
    let mut at = 0;
    while at < below.len() {
        let parent = below[at];
        for one in &all {
            if one.parent == parent && one.id != parent && !below.contains(&one.id) {
                below.push(one.id);
            }
        }
        at += 1;
    }
    below.iter().skip(1).map(|pid| working_set(*pid)).sum()
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a process's memory is Win32's own question and has no safe wrapper"
)]
fn working_set(pid: u32) -> u64 {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    let size = u32::try_from(std::mem::size_of::<PROCESS_MEMORY_COUNTERS>()).unwrap_or(u32::MAX);
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return 0;
        };
        let mut counters = PROCESS_MEMORY_COUNTERS {
            cb: size,
            ..Default::default()
        };
        let read = K32GetProcessMemoryInfo(handle, &raw mut counters, size).as_bool();
        let _ = CloseHandle(handle);
        if read {
            u64::try_from(counters.WorkingSetSize).unwrap_or(0)
        } else {
            0
        }
    }
}

#[cfg(not(windows))]
pub fn engine_bytes() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::{past, too_much, MB};

    #[test]
    fn no_ceiling_is_the_default_and_refuses_nothing() {
        assert_eq!(crate::agents::grants::Limits::default().memory, 0);
        assert!(too_much(0).is_none());
        assert!(past(u64::MAX, 0).is_none());
        assert!(past(64 * 1024 * MB, 0).is_none());
    }

    #[test]
    fn a_ceiling_somebody_set_still_holds() {
        assert!(past(3 * 1024 * MB, 4096).is_none());
        assert!(past(4096 * MB, 4096).is_none());
        let why = past(5 * 1024 * MB, 4096).expect("past");
        assert!(why.contains("5120 MB"), "{why}");
        assert!(why.contains("4096 MB"), "{why}");
    }

    #[test]
    fn the_test_runner_itself_holds_no_engine() {
        assert!(super::engine_bytes() < 1024 * MB);
        assert!(too_much(1024).is_none());
    }
}
