//! How much of the machine's memory the engine is holding, for an agent whose grant sets
//! a ceiling on it (docs/agent-native.md 6.4).
//!
//! Every engine process is a child of the app's own: the browser process, the renderers,
//! the GPU and the utilities. Their working sets together are the engine's cost to the
//! reader. There is **no ceiling unless the reader sets one** on an agent (Settings,
//! Agents, Limits): the 3 GB that stood here for every agent refused tabs on a machine
//! with memory to spare, and what that machine can hold is its owner's to say (#333).
//! Past a ceiling that is set, the agent's `browser_open` is refused with the reason
//! rather than adding another page. Asked only when an agent opens a tab.

/// A megabyte, as the grant's ceiling is counted.
const MB: u64 = 1024 * 1024;

/// Why an agent may not open another tab now, or `None` when it may: the browser is past
/// `ceiling` MB. A `ceiling` of 0 is none, and the engine is then not even asked.
pub fn too_much(ceiling: u32) -> Option<String> {
    if ceiling == 0 {
        return None;
    }
    past(engine_bytes(), ceiling)
}

/// The sentence for `used` bytes against `ceiling` MB, when they are past it.
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

/// The working sets of every process below the app's own, together.
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

/// One process's working set, in bytes; nothing for a process that cannot be asked.
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
    // SAFETY: the handle is this function's own and closed before it returns; the
    // counters are written by Windows into a structure whose size it is told.
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

/// Elsewhere the ceiling is not asked: the engine counts as nothing, so no tab is
/// refused for memory there.
#[cfg(not(windows))]
pub fn engine_bytes() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::{past, too_much, MB};

    #[test]
    fn no_ceiling_is_the_default_and_refuses_nothing() {
        // #333: the browser's memory was capped for every agent at 3 GB. A grant's
        // ceiling of 0, which is every grant's own, refuses nothing however much the
        // browser holds.
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
        // The test binary starts no webview, so nothing below it is an engine; what is
        // asserted is that asking does not fail or take the machine's whole process list.
        assert!(super::engine_bytes() < 1024 * MB);
        assert!(too_much(1024).is_none());
    }
}
