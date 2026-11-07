#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::HashMap;
use std::time::Instant;

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Usage {
    pub cpu: f64,
    pub memory: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Totals {
    pub ticks: u64,
    pub memory: u64,
    pub engines: HashMap<String, u64>,
}

const TICKS: f64 = 100.0;

#[derive(Default)]
pub struct Sampler {
    last: HashMap<String, (Instant, Totals)>,
}

impl Sampler {
    pub fn rate(&mut self, key: &str, now: Instant, totals: Totals) -> Usage {
        let before = self.last.insert(key.to_owned(), (now, totals.clone()));
        rate_between(before.as_ref(), now, &totals)
    }
}

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

pub fn stat_of(text: &str) -> Option<(u32, u32, u64)> {
    let rest = &text[text.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let parent = fields.get(1)?.parse().ok()?;
    let group = fields.get(2)?.parse().ok()?;
    let user: u64 = fields.get(11)?.parse().ok()?;
    let system: u64 = fields.get(12)?.parse().ok()?;
    Some((parent, group, user + system))
}

pub fn resident_of(text: &str) -> Option<u64> {
    let line = text.lines().find(|line| line.starts_with("VmRSS:"))?;
    let kilobytes: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kilobytes * 1024)
}

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

#[derive(Clone, Copy, Debug)]
pub enum Whose {
    Tree(u32),
    Group(u32),
}

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

pub fn sample(key: &str, whose: Whose) -> Option<Usage> {
    static SAMPLES: std::sync::LazyLock<std::sync::Mutex<Sampler>> =
        std::sync::LazyLock::new(std::sync::Mutex::default);
    let totals = totals(whose)?;
    let mut samples = SAMPLES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Some(samples.rate(key, Instant::now(), totals))
}

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

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_a_busy_process_from_the_kernel() {
        let mut busy = std::process::Command::new("sh")
            .args(["-c", "while :; do :; done"])
            .spawn()
            .unwrap();
        let pid = busy.id();
        let before = totals(Whose::Tree(pid)).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let after = totals(Whose::Tree(pid)).unwrap();
        let _ = busy.kill();
        let _ = busy.wait();
        assert!(before.memory > 0);
        assert!(
            after.ticks > before.ticks,
            "{} then {}",
            before.ticks,
            after.ticks
        );
    }
}
