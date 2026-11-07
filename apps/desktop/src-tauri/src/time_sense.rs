use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sensed {
    idle_ms: Option<u64>,
    front: Option<bool>,
    app: Option<String>,
    cpu: Option<f32>,
    memory: Option<f32>,
    battery: Option<f32>,
    charging: Option<bool>,
    lid: Option<bool>,
    locked: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Ticks {
    busy: u64,
    total: u64,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Power {
    battery: Option<f32>,
    charging: Option<bool>,
    lid: Option<bool>,
    locked: Option<bool>,
}

struct Held {
    ticks: Option<Ticks>,
    power: Option<(Instant, Power)>,
}

static HELD: Mutex<Held> = Mutex::new(Held {
    ticks: None,
    power: None,
});

const POWER_EVERY: Duration = Duration::from_secs(30);

const LONGEST_APP: usize = 80;

#[tauri::command]
pub async fn time_sense() -> Sensed {
    crate::lane::off_the_runtime(sensed).await
}

fn sensed() -> Sensed {
    let input = crate::presence::input_idle();
    let ticks = platform::cpu_ticks();
    let mut held = HELD.lock().unwrap_or_else(PoisonError::into_inner);
    let cpu = match (held.ticks, ticks) {
        (Some(was), Some(now)) => busy_share(was, now),
        _ => None,
    };
    held.ticks = ticks;
    let power = match &held.power {
        Some((at, power)) if at.elapsed() < POWER_EVERY => power.clone(),
        _ => {
            let power = platform::power();
            held.power = Some((Instant::now(), power.clone()));
            power
        }
    };
    drop(held);

    Sensed {
        idle_ms: input.map(|one| one.idle_ms),
        front: input.map(|one| one.front),
        app: platform::front_app().and_then(|name| app_name(&name)),
        cpu,
        memory: platform::memory(),
        battery: power.battery,
        charging: power.charging,
        lid: power.lid,
        locked: power.locked,
    }
}

fn busy_share(was: Ticks, now: Ticks) -> Option<f32> {
    let total = now.total.checked_sub(was.total)?;
    if total == 0 {
        return None;
    }
    let busy = now.busy.saturating_sub(was.busy).min(total);
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        reason = "a share between nothing and all, where a float's precision is plenty"
    )]
    let share = (busy as f64 / total as f64) as f32;
    Some(share)
}

fn app_name(path: &str) -> Option<String> {
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let bare = file
        .strip_suffix(".exe")
        .or_else(|| file.strip_suffix(".EXE"))
        .or_else(|| file.strip_suffix(".app"))
        .unwrap_or(file);
    let name: String = bare
        .chars()
        .map(|one| if one.is_control() { ' ' } else { one })
        .take(LONGEST_APP)
        .collect();
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

#[cfg(any(target_os = "linux", test))]
fn linux_ticks(stat: &str) -> Option<Ticks> {
    let line = stat.lines().find(|one| one.starts_with("cpu "))?;
    let numbers: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .filter_map(|one| one.parse().ok())
        .collect();
    if numbers.len() < 4 {
        return None;
    }
    let total: u64 = numbers.iter().take(8).sum();
    let idle = numbers[3] + numbers.get(4).copied().unwrap_or(0);
    Some(Ticks {
        busy: total.saturating_sub(idle),
        total,
    })
}

#[cfg(any(target_os = "linux", test))]
fn linux_memory(info: &str) -> Option<f32> {
    let read = |key: &str| -> Option<f64> {
        let line = info.lines().find(|one| one.starts_with(key))?;
        line.split_whitespace().nth(1)?.parse().ok()
    };
    let total = read("MemTotal:")?;
    let free = read("MemAvailable:")?;
    if total <= 0.0 {
        return None;
    }
    #[allow(
        clippy::cast_possible_truncation,
        reason = "a share between nothing and all"
    )]
    let used = (1.0 - free / total).clamp(0.0, 1.0) as f32;
    Some(used)
}

#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;

    use zbus::blocking::Connection;
    use zbus::zvariant::OwnedValue;

    use super::{linux_memory, linux_ticks, Power, Ticks};

    pub fn cpu_ticks() -> Option<Ticks> {
        linux_ticks(&std::fs::read_to_string("/proc/stat").ok()?)
    }

    pub fn memory() -> Option<f32> {
        linux_memory(&std::fs::read_to_string("/proc/meminfo").ok()?)
    }

    fn read(path: &Path) -> Option<String> {
        std::fs::read_to_string(path)
            .ok()
            .map(|one| one.trim().to_owned())
    }

    fn battery() -> (Option<f32>, Option<bool>) {
        let Ok(supplies) = std::fs::read_dir("/sys/class/power_supply") else {
            return (None, None);
        };
        for supply in supplies.flatten() {
            let path = supply.path();
            if read(&path.join("type")).as_deref() != Some("Battery") {
                continue;
            }
            let level = read(&path.join("capacity"))
                .and_then(|one| one.parse::<f32>().ok())
                .map(|one| (one / 100.0).clamp(0.0, 1.0));
            let charging = read(&path.join("status"))
                .map(|one| one == "Charging" || one == "Full" || one == "Not charging");
            return (level, charging);
        }
        (None, None)
    }

    fn lid() -> Option<bool> {
        let lids = std::fs::read_dir("/proc/acpi/button/lid").ok()?;
        for lid in lids.flatten() {
            if let Some(state) = read(&lid.path().join("state")) {
                return Some(!state.contains("closed"));
            }
        }
        None
    }

    fn locked() -> Option<bool> {
        let reply = Connection::system()
            .ok()?
            .call_method(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1/session/auto",
                Some("org.freedesktop.DBus.Properties"),
                "Get",
                &("org.freedesktop.login1.Session", "LockedHint"),
            )
            .ok()?;
        let value: OwnedValue = reply.body().deserialize().ok()?;
        bool::try_from(value).ok()
    }

    pub fn power() -> Power {
        let (battery, charging) = battery();
        Power {
            battery,
            charging,
            lid: lid(),
            locked: locked(),
        }
    }

    pub fn front_app() -> Option<String> {
        crate::front_x::front_class()
    }
}

#[cfg(windows)]
mod platform {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
    };
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::{
        GetSystemTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    use super::{Power, Ticks};

    const NO_BATTERY: u8 = 128;
    const UNKNOWN: u8 = 255;

    fn ticks_of(time: FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }

    pub fn cpu_ticks() -> Option<Ticks> {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask Windows how long its processors were busy"
        )]
        unsafe {
            GetSystemTimes(
                Some(&raw mut idle),
                Some(&raw mut kernel),
                Some(&raw mut user),
            )
            .ok()?;
        }
        let total = ticks_of(kernel) + ticks_of(user);
        Some(Ticks {
            busy: total.saturating_sub(ticks_of(idle)),
            total,
        })
    }

    pub fn memory() -> Option<f32> {
        let mut status = MEMORYSTATUSEX {
            dwLength: u32::try_from(std::mem::size_of::<MEMORYSTATUSEX>()).ok()?,
            ..Default::default()
        };
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask Windows how much memory is in use"
        )]
        unsafe {
            GlobalMemoryStatusEx(&raw mut status).ok()?;
        }
        #[allow(
            clippy::cast_precision_loss,
            reason = "a percentage, which a float holds exactly"
        )]
        let used = (status.dwMemoryLoad as f32 / 100.0).clamp(0.0, 1.0);
        Some(used)
    }

    pub fn power() -> Power {
        let mut status = SYSTEM_POWER_STATUS::default();
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask Windows about the battery or the lock screen"
        )]
        let (read, locked) = unsafe {
            let read = GetSystemPowerStatus(&raw mut status).is_ok();
            let desk = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP);
            let locked = match desk {
                Ok(desk) => {
                    let _ = CloseDesktop(desk);
                    false
                }
                Err(_) => true,
            };
            (read, locked)
        };
        let battery =
            (read && status.BatteryFlag & NO_BATTERY == 0 && status.BatteryLifePercent != UNKNOWN)
                .then(|| (f32::from(status.BatteryLifePercent) / 100.0).clamp(0.0, 1.0));
        Power {
            battery,
            charging: (read && battery.is_some() && status.ACLineStatus != UNKNOWN)
                .then_some(status.ACLineStatus == 1),
            lid: None,
            locked: Some(locked),
        }
    }

    pub fn front_app() -> Option<String> {
        let mut process = 0u32;
        let mut buffer = [0u16; 1024];
        let mut length = u32::try_from(buffer.len()).ok()?;
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask Windows which program owns the window in front"
        )]
        unsafe {
            let front = GetForegroundWindow();
            if front.is_invalid() {
                return None;
            }
            GetWindowThreadProcessId(front, Some(&raw mut process));
            if process == 0 {
                return None;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process).ok()?;
            let named = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &raw mut length,
            );
            let _ = CloseHandle(handle);
            named.ok()?;
        }
        let length = usize::try_from(length).ok()?.min(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..length]))
    }
}

#[cfg(target_os = "macos")]
#[allow(
    deprecated,
    reason = "libc marks its mach calls for the mach2 crate, which two calls do not warrant"
)]
mod platform {
    use std::process::Command;

    use objc2_app_kit::NSWorkspace;

    use super::{Power, Ticks};

    pub fn cpu_ticks() -> Option<Ticks> {
        let mut info = libc::host_cpu_load_info { cpu_ticks: [0; 4] };
        let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask macOS how long its processors were busy"
        )]
        let read = unsafe {
            libc::host_statistics(
                libc::mach_host_self(),
                libc::HOST_CPU_LOAD_INFO,
                (&raw mut info).cast(),
                &raw mut count,
            )
        };
        if read != 0 {
            return None;
        }
        let [user, system, idle, nice] = info.cpu_ticks.map(u64::from);
        let total = user + system + idle + nice;
        Some(Ticks {
            busy: total.saturating_sub(idle),
            total,
        })
    }

    fn sysctl(name: &str) -> Option<u64> {
        let name = std::ffi::CString::new(name).ok()?;
        let mut value = 0u64;
        let mut size = std::mem::size_of::<u64>();
        #[allow(unsafe_code, reason = "there is no safe way to read a sysctl")]
        let read = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                (&raw mut value).cast(),
                &raw mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        (read == 0).then_some(value)
    }

    pub fn memory() -> Option<f32> {
        let total = sysctl("hw.memsize")?;
        let page = sysctl("hw.pagesize")?;
        let mut info: libc::vm_statistics64 = {
            #[allow(unsafe_code, reason = "a plain struct of counters, all zero")]
            unsafe {
                std::mem::zeroed()
            }
        };
        let mut count = libc::HOST_VM_INFO64_COUNT;
        #[allow(
            unsafe_code,
            reason = "there is no safe way to ask macOS how much memory is in use"
        )]
        let read = unsafe {
            libc::host_statistics64(
                libc::mach_host_self(),
                libc::HOST_VM_INFO64,
                (&raw mut info).cast(),
                &raw mut count,
            )
        };
        if read != 0 || total == 0 {
            return None;
        }
        let used = (u64::from(info.active_count)
            + u64::from(info.wire_count)
            + u64::from(info.compressor_page_count))
            * page;
        #[allow(
            clippy::cast_precision_loss,
            clippy::cast_possible_truncation,
            reason = "a share between nothing and all"
        )]
        let share = (used as f64 / total as f64).clamp(0.0, 1.0) as f32;
        Some(share)
    }

    fn said(program: &str, args: &[&str]) -> Option<String> {
        let out = Command::new(program).args(args).output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    pub fn power() -> Power {
        let battery = said("pmset", &["-g", "batt"]);
        let level = battery.as_deref().and_then(|text| {
            let cut = text.find('%')?;
            let digits: String = text[..cut]
                .chars()
                .rev()
                .take_while(char::is_ascii_digit)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            digits
                .parse::<f32>()
                .ok()
                .map(|one| (one / 100.0).clamp(0.0, 1.0))
        });
        let charging = level
            .and(battery.as_deref())
            .map(|text| text.contains("AC Power"));
        let lid = said("ioreg", &["-r", "-k", "AppleClamshellState", "-d", "1"]).and_then(|text| {
            let line = text
                .lines()
                .find(|one| one.contains("\"AppleClamshellState\""))?;
            Some(!line.contains("Yes"))
        });
        let locked = said("ioreg", &["-n", "Root", "-d", "1"])
            .map(|text| text.contains("\"CGSSessionScreenIsLocked\"=Yes"));
        Power {
            battery: level,
            charging,
            lid,
            locked,
        }
    }

    pub fn front_app() -> Option<String> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        Some(app.localizedName()?.to_string())
    }
}

#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
mod platform {
    use super::{Power, Ticks};

    pub fn cpu_ticks() -> Option<Ticks> {
        None
    }

    pub fn memory() -> Option<f32> {
        None
    }

    pub fn power() -> Power {
        Power::default()
    }

    pub fn front_app() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{app_name, busy_share, linux_memory, linux_ticks, Ticks};

    #[test]
    fn an_app_is_named_by_its_file_without_the_ending() {
        assert_eq!(
            app_name(r"C:\Program Files\Mozilla Firefox\firefox.exe").as_deref(),
            Some("firefox")
        );
        assert_eq!(app_name("/Applications/Zed.app").as_deref(), Some("Zed"));
        assert_eq!(app_name("Code").as_deref(), Some("Code"));
        assert_eq!(app_name("  "), None);
        assert_eq!(app_name(&"x".repeat(200)).map(|one| one.len()), Some(80));
    }

    #[test]
    fn the_processor_is_as_busy_as_its_ticks_since_the_last_look() {
        let was = Ticks {
            busy: 100,
            total: 1000,
        };
        assert_eq!(
            busy_share(
                was,
                Ticks {
                    busy: 150,
                    total: 1100
                }
            ),
            Some(0.5)
        );
        assert_eq!(busy_share(was, was), None);
        assert_eq!(busy_share(was, Ticks { busy: 0, total: 10 }), None);
    }

    #[test]
    fn linux_says_its_processor_and_memory_in_its_own_files() {
        let stat = "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\n";
        assert_eq!(
            linux_ticks(stat),
            Some(Ticks {
                busy: 200,
                total: 1000
            })
        );
        assert_eq!(linux_ticks("intr 1 2"), None);
        let info = "MemTotal:       16000 kB\nMemFree: 1 kB\nMemAvailable:    4000 kB\n";
        assert_eq!(linux_memory(info), Some(0.75));
        assert_eq!(linux_memory("MemTotal: 0 kB\nMemAvailable: 0 kB\n"), None);
    }

    #[test]
    fn the_system_is_asked_without_trouble() {
        let first = super::sensed();
        let again = super::sensed();
        assert!(again.cpu.is_none_or(|one| (0.0..=1.0).contains(&one)));
        assert!(first.memory.is_none_or(|one| (0.0..=1.0).contains(&one)));
    }
}
