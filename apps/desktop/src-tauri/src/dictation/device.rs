use serde::Serialize;

use super::catalog::{rid_of, Model};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Device {
    pub os: &'static str,
    pub arch: &'static str,
    pub cores: usize,
    pub memory: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Fits,
    Platform,
    Cores,
    Memory,
}

const LEAST_CORES: usize = 4;

pub fn fit(device: &Device, model: &Model) -> Fit {
    if rid_of(device.os, device.arch).is_none() {
        return Fit::Platform;
    }
    if device.cores < LEAST_CORES {
        return Fit::Cores;
    }
    if device.memory.is_some_and(|gb| gb < model.memory) {
        return Fit::Memory;
    }
    Fit::Fits
}

pub fn threads(cores: usize) -> i32 {
    i32::try_from((cores / 2).clamp(1, 4)).unwrap_or(1)
}

pub fn this() -> Device {
    Device {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        cores: std::thread::available_parallelism().map_or(1, std::num::NonZero::get),
        memory: memory().map(|bytes| bytes / (1 << 30)),
    }
}

#[cfg(target_os = "linux")]
fn memory() -> Option<u64> {
    let info = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = info.lines().find(|line| line.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(target_os = "macos")]
fn memory() -> Option<u64> {
    let out = crate::printed::output(
        std::process::Command::new("/usr/sbin/sysctl").args(["-n", "hw.memsize"]),
        std::time::Duration::from_secs(3),
    )
    .ok()?;
    String::from_utf8(out.stdout).ok()?.trim().parse().ok()
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the memory status call has no safe wrapper in the windows crate"
)]
fn memory() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: u32::try_from(std::mem::size_of::<MEMORYSTATUSEX>()).ok()?,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&raw mut status) }.ok()?;
    Some(status.ullTotalPhys)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn memory() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dictation::catalog::PARAKEET;

    fn device(os: &'static str, arch: &'static str, cores: usize, memory: Option<u64>) -> Device {
        Device {
            os,
            arch,
            cores,
            memory,
        }
    }

    #[test]
    fn a_laptop_of_today_fits() {
        assert_eq!(
            fit(&device("macos", "aarch64", 8, Some(8)), &PARAKEET),
            Fit::Fits
        );
        assert_eq!(
            fit(&device("windows", "x86_64", 4, Some(16)), &PARAKEET),
            Fit::Fits
        );
        assert_eq!(
            fit(&device("linux", "x86_64", 12, None), &PARAKEET),
            Fit::Fits
        );
    }

    #[test]
    fn what_cannot_keep_up_says_why() {
        assert_eq!(
            fit(&device("linux", "x86_64", 2, Some(16)), &PARAKEET),
            Fit::Cores
        );
        assert_eq!(
            fit(&device("windows", "x86_64", 8, Some(3)), &PARAKEET),
            Fit::Memory
        );
        assert_eq!(
            fit(&device("linux", "riscv64", 8, Some(16)), &PARAKEET),
            Fit::Platform
        );
        assert_eq!(
            fit(&device("freebsd", "x86_64", 8, Some(16)), &PARAKEET),
            Fit::Platform
        );
    }

    #[test]
    fn a_pass_leaves_the_app_half_the_cores() {
        assert_eq!(threads(1), 1);
        assert_eq!(threads(4), 2);
        assert_eq!(threads(8), 4);
        assert_eq!(threads(32), 4);
    }

    #[test]
    fn this_machine_is_read() {
        let here = this();
        assert!(here.cores >= 1);
        #[cfg(any(target_os = "linux", target_os = "macos", windows))]
        assert!(here.memory.is_some_and(|gb| gb >= 1));
    }
}
