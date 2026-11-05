//! What a tab's processes use of this computer (issue 1063, step 10; docs/apps.md): the
//! processor, the memory, and the GPU, for the tab's hover card in developer mode. Asked
//! once a second while the card is up and never otherwise.
//!
//! **Whose**: a terminal's shell and everything under it; an application's process
//! group, which is everything it started (`apps_host.rs`).
//!
//! **Read from the kernel**, on Linux: `/proc/<pid>/stat` for the processor time and the
//! group, `/proc/<pid>/status` for the memory resident (`VmRSS`), and the DRM clients'
//! `/proc/<pid>/fdinfo` for the GPU's engines (`drm-engine-*`, Linux 5.19 on for Intel,
//! AMD and most of the rest; NVIDIA's own driver says nothing there). The processor and the
//! GPU are rates, so each sample is held against the one before it (`Sampler`). Where a
//! number cannot be read - the GPU of most machines, anything on Windows and macOS yet -
//! it is left out, never said as nothing.

// The kernel's files are read on Linux alone; elsewhere their readers wait for theirs.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::HashMap;
use std::time::Instant;

use serde::Serialize;

/// What a set of processes uses: the processor as a share of one core (100 is one core
/// whole), the memory resident in bytes, and the GPU's busiest engine as a share of it,
/// where it can be read.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Usage {
    pub cpu: f64,
    pub memory: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<f64>,
}

/// The running totals one sample reads.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Totals {
    /// Processor time, in the kernel's ticks (a hundredth of a second).
    pub ticks: u64,
    pub memory: u64,
    /// Each GPU engine's busy time, in nanoseconds, by its name; empty where there is
    /// no DRM client to read.
    pub engines: HashMap<String, u64>,
}

/// The kernel's ticks a second, `USER_HZ`: a hundred on every Linux there is.
const TICKS: f64 = 100.0;

/// Samples held against the one before, by whose they are.
#[derive(Default)]
pub struct Sampler {
    last: HashMap<String, (Instant, Totals)>,
}

impl Sampler {
    /// The usage since the last sample under `key`; the first gives the memory, and the
    /// processor and GPU as nothing yet but known.
    pub fn rate(&mut self, key: &str, now: Instant, totals: Totals) -> Usage {
        let before = self.last.insert(key.to_owned(), (now, totals.clone()));
        rate_between(before.as_ref(), now, &totals)
    }
}

/// The usage between two samples.
#[allow(
    clippy::cast_precision_loss,
    reason = "ticks and nanoseconds over a second fit an f64's mantissa"
)]
pub fn rate_between(before: Option<&(Instant, Totals)>, now: Instant, totals: &Totals) -> Usage {
    let Some((at, old)) = before else {
        return Usage {
            cpu: 0.0,
            memory: totals.memory,
            gpu: (!totals.engines.is_empty()).then_some(0.0),
        };
    };
    let seconds = now.saturating_duration_since(*at).as_secs_f64();
    if seconds <= 0.0 {
        return Usage {
            cpu: 0.0,
            memory: totals.memory,
            gpu: None,
        };
    }
    let cpu = totals.ticks.saturating_sub(old.ticks) as f64 / TICKS / seconds * 100.0;
    let gpu = (!totals.engines.is_empty()).then(|| {
        totals
            .engines
            .iter()
            .map(|(engine, &busy)| {
                let was = old.engines.get(engine).copied().unwrap_or(busy);
                busy.saturating_sub(was) as f64 / 1e9 / seconds * 100.0
            })
            .fold(0.0_f64, f64::max)
            .min(100.0)
    });
    Usage {
        cpu,
        memory: totals.memory,
        gpu,
    }
}

/// One process as `/proc/<pid>/stat` has it: its parent, its group, and its processor
/// time. The name is in parentheses and may hold anything, so the fields are read from
/// after its last one.
pub fn stat_of(text: &str) -> Option<(u32, u32, u64)> {
    let rest = &text[text.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // After the name: state, ppid, pgrp, session, tty, tpgid, flags, minflt, cminflt,
    // majflt, cmajflt, utime, stime.
    let parent = fields.get(1)?.parse().ok()?;
    let group = fields.get(2)?.parse().ok()?;
    let user: u64 = fields.get(11)?.parse().ok()?;
    let system: u64 = fields.get(12)?.parse().ok()?;
    Some((parent, group, user + system))
}

/// The memory resident, in bytes, from `/proc/<pid>/status`.
pub fn resident_of(text: &str) -> Option<u64> {
    let line = text.lines().find(|line| line.starts_with("VmRSS:"))?;
    let kilobytes: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kilobytes * 1024)
}

/// One DRM client's engines from an fd's `fdinfo`, and its client id, which more than
/// one fd may share.
pub fn engines_of(text: &str) -> Option<(String, Vec<(String, u64)>)> {
    let mut client = None;
    let mut engines = Vec::new();
    for line in text.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if name == "drm-client-id" {
            client = Some(value.to_owned());
        } else if let Some(engine) = name.strip_prefix("drm-engine-") {
            if engine.starts_with("capacity") {
                continue;
            }
            if let Some(nanoseconds) = value.strip_suffix(" ns").and_then(|one| one.parse().ok()) {
                engines.push((engine.to_owned(), nanoseconds));
            }
        }
    }
    Some((client?, engines))
}

/// Whose processes a sample is of.
#[derive(Clone, Copy, Debug)]
pub enum Whose {
    /// A process and everything under it.
    Tree(u32),
    /// A process group.
    Group(u32),
}

/// The totals of whose processes, now; None where the system cannot be read.
#[cfg(target_os = "linux")]
pub fn totals(whose: Whose) -> Option<Totals> {
    let mut all: Vec<(u32, u32, u32, u64)> = Vec::new();
    for entry in std::fs::read_dir("/proc").ok()?.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|one| one.parse().ok()) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            continue;
        };
        if let Some((parent, group, ticks)) = stat_of(&text) {
            all.push((pid, parent, group, ticks));
        }
    }
    let chosen: Vec<u32> = match whose {
        Whose::Group(group) => all
            .iter()
            .filter(|one| one.2 == group)
            .map(|one| one.0)
            .collect(),
        Whose::Tree(root) => {
            let mut found = vec![root];
            let mut at = 0;
            while at < found.len() {
                let parent = found[at];
                found.extend(all.iter().filter(|one| one.1 == parent).map(|one| one.0));
                at += 1;
            }
            found
        }
    };
    if chosen.is_empty() {
        return None;
    }
    let mut totals = Totals::default();
    let mut clients: HashMap<String, Vec<(String, u64)>> = HashMap::new();
    for pid in &chosen {
        if let Some(one) = all.iter().find(|one| one.0 == *pid) {
            totals.ticks += one.3;
        }
        if let Some(memory) = std::fs::read_to_string(format!("/proc/{pid}/status"))
            .ok()
            .and_then(|text| resident_of(&text))
        {
            totals.memory += memory;
        }
        let Ok(fds) = std::fs::read_dir(format!("/proc/{pid}/fdinfo")) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(text) = std::fs::read_to_string(fd.path()) else {
                continue;
            };
            if !text.contains("drm-client-id") {
                continue;
            }
            if let Some((client, engines)) = engines_of(&text) {
                clients.insert(client, engines);
            }
        }
    }
    for engines in clients.into_values() {
        for (engine, busy) in engines {
            *totals.engines.entry(engine).or_default() += busy;
        }
    }
    Some(totals)
}

/// A sample of whose processes now, held against the last under `key`: the usage since,
/// or None where the system cannot be read.
pub fn sample(key: &str, whose: Whose) -> Option<Usage> {
    static SAMPLES: std::sync::LazyLock<std::sync::Mutex<Sampler>> =
        std::sync::LazyLock::new(std::sync::Mutex::default);
    let totals = totals(whose)?;
    let mut samples = SAMPLES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Some(samples.rate(key, Instant::now(), totals))
}

/// Nothing to read here yet.
#[cfg(not(target_os = "linux"))]
pub fn totals(_whose: Whose) -> Option<Totals> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn reads_a_process_past_a_name_with_spaces_and_parentheses() {
        let text = "4242 (my (odd) prog) S 1 4242 4242 0 -1 4194560 100 0 0 0 250 50 0 0 20 0";
        assert_eq!(stat_of(text), Some((1, 4242, 300)));
        assert_eq!(stat_of("garbage"), None);
    }

    #[test]
    fn reads_the_memory_resident_and_the_gpus_engines() {
        assert_eq!(
            resident_of("Name:\tx\nVmRSS:\t  2048 kB\nVmSwap:\t0 kB\n"),
            Some(2048 * 1024)
        );
        assert_eq!(resident_of("Name:\tkthread\n"), None);
        let fdinfo = "pos:\t0\ndrm-driver:\ti915\ndrm-client-id:\t7\ndrm-engine-render:\t5000000 ns\ndrm-engine-capacity-video:\t2\ndrm-engine-video:\t10 ns\n";
        assert_eq!(
            engines_of(fdinfo),
            Some((
                "7".to_owned(),
                vec![("render".to_owned(), 5_000_000), ("video".to_owned(), 10)]
            ))
        );
        assert_eq!(engines_of("pos:\t0\nflags:\t02\n"), None);
    }

    #[test]
    fn makes_rates_of_two_samples_and_leaves_out_a_gpu_it_cannot_read() {
        let start = Instant::now();
        let mut sampler = Sampler::default();
        let first = Totals {
            ticks: 100,
            memory: 1000,
            engines: HashMap::from([("render".to_owned(), 0)]),
        };
        assert_eq!(
            sampler.rate("a", start, first),
            Usage {
                cpu: 0.0,
                memory: 1000,
                gpu: Some(0.0)
            }
        );
        let second = Totals {
            ticks: 150,
            memory: 2000,
            engines: HashMap::from([("render".to_owned(), 250_000_000)]),
        };
        let usage = sampler.rate("a", start + Duration::from_secs(1), second);
        assert!((usage.cpu - 50.0).abs() < 1e-9);
        assert_eq!(usage.memory, 2000);
        assert!((usage.gpu.unwrap() - 25.0).abs() < 1e-9);
        let no_gpu = Totals {
            ticks: 0,
            memory: 5,
            engines: HashMap::new(),
        };
        assert_eq!(sampler.rate("b", start, no_gpu).gpu, None);
        assert_eq!(
            serde_json::to_string(&Usage {
                cpu: 1.0,
                memory: 2,
                gpu: None
            })
            .unwrap(),
            r#"{"cpu":1.0,"memory":2}"#
        );
    }

    /// On Linux, this test's own process: its memory is read, and its processor time
    /// grows as it works.
    #[cfg(target_os = "linux")]
    #[test]
    fn reads_this_process_from_the_kernel() {
        let me = std::process::id();
        let before = totals(Whose::Tree(me)).unwrap();
        assert!(before.memory > 0);
        let until = Instant::now() + Duration::from_millis(200);
        let mut spin = 0_u64;
        while Instant::now() < until {
            spin = spin.wrapping_add(1);
        }
        assert!(spin > 0);
        let after = totals(Whose::Tree(me)).unwrap();
        assert!(after.ticks >= before.ticks);
    }
}
