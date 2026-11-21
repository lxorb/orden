use orden_base::Held as _;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    Wifi,
    Wired,
    Cellular,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    cpu: Option<f32>,
    memory: Option<f32>,
    battery: Option<f32>,
    charging: Option<bool>,
    ac: Option<bool>,
    screen: Option<bool>,
    online: Option<bool>,
    network: Option<Network>,
    boot: Option<u64>,
}
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Slow {
    power: Supply,
    screen: Option<bool>,
    link: Link,
}
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Supply {
    battery: Option<f32>,
    charging: Option<bool>,
    ac: Option<bool>,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Link {
    online: Option<bool>,
    network: Option<Network>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Ticks {
    busy: u64,
    total: u64,
}
static TICKS: Mutex<Option<Ticks>> = Mutex::new(None);
static SLOW: Mutex<Option<(Instant, Slow)>> = Mutex::new(None);
const SLOW_EVERY: Duration = Duration::from_secs(30);
pub fn read() -> Device {
    let now = platform::ticks();
    let was = std::mem::replace(&mut *TICKS.held(), now);
    let slow = slow();
    Device {
        cpu: was.zip(now).and_then(|(was, now)| busy_share(was, now)),
        memory: platform::memory(),
        battery: slow.power.battery,
        charging: slow.power.charging,
        ac: slow.power.ac,
        screen: slow.screen,
        online: slow.link.online,
        network: slow.link.network,
        boot: boot(),
    }
}
fn slow() -> Slow {
    let mut held = SLOW.held();
    if let Some((at, slow)) = *held {
        if at.elapsed() < SLOW_EVERY {
            return slow;
        }
    }
    *held = Some((Instant::now(), held.map(|(_, slow)| slow).unwrap_or_default()));
    drop(held);
    let slow =
        Slow { power: platform::supply(), screen: platform::screen(), link: platform::link() };
    *SLOW.held() = Some((Instant::now(), slow));
    slow
}
fn boot() -> Option<u64> {
    static BOOT: OnceLock<Option<u64>> = OnceLock::new();
    *BOOT.get_or_init(platform::boot)
}
fn busy_share(was: Ticks, now: Ticks) -> Option<f32> {
    let total = now.total.checked_sub(was.total)?;
    if total == 0 {
        return None;
    }
    let busy = now.busy.saturating_sub(was.busy).min(total);
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    let share = (busy as f64 / total as f64) as f32;
    Some(share)
}
#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
fn share(part: f64, whole: f64) -> Option<f32> {
    (whole > 0.0).then(|| (part / whole).clamp(0.0, 1.0) as f32)
}
fn best(up: impl IntoIterator<Item = Network>) -> Link {
    let mut found = None;
    for one in up {
        let rank = |kind: Network| match kind {
            Network::Wired => 0,
            Network::Wifi => 1,
            Network::Cellular => 2,
        };
        if found.is_none_or(|was| rank(one) < rank(was)) {
            found = Some(one);
        }
    }
    Link { online: Some(found.is_some()), network: found }
}
#[cfg(any(target_os = "linux", test))]
mod linux {
    use std::path::Path;

    use super::{best, share, Link, Network, Supply, Ticks};

    fn read(path: &Path) -> Option<String> {
        std::fs::read_to_string(path).ok().map(|one| one.trim().to_owned())
    }
    pub fn ticks(stat: &str) -> Option<Ticks> {
        let line = stat.lines().find(|one| one.starts_with("cpu "))?;
        let numbers: Vec<u64> =
            line.split_whitespace().skip(1).filter_map(|one| one.parse().ok()).collect();
        if numbers.len() < 4 {
            return None;
        }
        let total: u64 = numbers.iter().take(8).sum();
        let idle = numbers[3] + numbers.get(4).copied().unwrap_or(0);
        Some(Ticks { busy: total.saturating_sub(idle), total })
    }
    pub fn boot(stat: &str) -> Option<u64> {
        let seconds: u64 =
            stat.lines().find_map(|one| one.strip_prefix("btime "))?.trim().parse().ok()?;
        seconds.checked_mul(1000)
    }
    pub fn memory(info: &str) -> Option<f32> {
        let read = |key: &str| -> Option<f64> {
            let line = info.lines().find(|one| one.starts_with(key))?;
            line.split_whitespace().nth(1)?.parse().ok()
        };
        let total = read("MemTotal:")?;
        share(total - read("MemAvailable:")?, total)
    }
    pub fn supply(folder: &Path) -> Supply {
        let Ok(listed) = std::fs::read_dir(folder) else {
            return Supply { battery: None, charging: None, ac: Some(true) };
        };
        let mut battery = None;
        let mut status = None;
        let mut mains = Vec::new();
        for one in listed.flatten() {
            let path = one.path();
            match read(&path.join("type")).as_deref() {
                Some("Battery") => {
                    if battery.is_some() || read(&path.join("scope")).as_deref() == Some("Device") {
                        continue;
                    }
                    battery = read(&path.join("capacity"))
                        .and_then(|one| one.parse::<f64>().ok())
                        .and_then(|one| share(one, 100.0));
                    status = read(&path.join("status"));
                }
                Some(_) => mains.extend(read(&path.join("online")).map(|one| one == "1")),
                None => {}
            }
        }
        let charging = status.as_deref().map(|one| one == "Charging");
        let ac = if !mains.is_empty() {
            Some(mains.contains(&true))
        } else if let Some(status) = status.as_deref() {
            Some(status != "Discharging")
        } else {
            Some(battery.is_none())
        };
        Supply { battery, charging, ac }
    }
    pub fn screen(folder: &Path) -> Option<bool> {
        let mut seen = false;
        for one in std::fs::read_dir(folder).ok()?.flatten() {
            let path = one.path();
            if read(&path.join("status")).as_deref() != Some("connected") {
                continue;
            }
            let on = match read(&path.join("dpms")).as_deref() {
                Some(dpms) => dpms == "On",
                None => read(&path.join("enabled")).as_deref() == Some("enabled"),
            };
            if on {
                return Some(true);
            }
            seen = true;
        }
        seen.then_some(false)
    }
    pub fn link(folder: &Path) -> Option<Link> {
        let mut up = Vec::new();
        for one in std::fs::read_dir(folder).ok()?.flatten() {
            let path = one.path();
            let event = read(&path.join("uevent")).unwrap_or_default();
            let kind =
                event.lines().find_map(|line| line.strip_prefix("DEVTYPE=")).unwrap_or_default();
            let cellular = kind == "wwan";
            if !cellular && !path.join("device").exists() {
                continue;
            }
            let state = read(&path.join("operstate")).unwrap_or_default();
            let carrier = read(&path.join("carrier")).as_deref() == Some("1");
            if !(state == "up" || (state == "unknown" && carrier)) {
                continue;
            }
            up.push(if cellular {
                Network::Cellular
            } else if kind == "wlan"
                || path.join("wireless").exists()
                || path.join("phy80211").exists()
            {
                Network::Wifi
            } else {
                Network::Wired
            });
        }
        Some(best(up))
    }
}
#[cfg(any(target_os = "macos", test))]
mod mac {
    use super::{best, share, Link, Network, Supply};

    pub fn supply(said: &str) -> Supply {
        let ac = if said.contains("'AC Power'") {
            Some(true)
        } else if said.contains("'Battery Power'") {
            Some(false)
        } else {
            None
        };
        let Some(line) = said.lines().find(|one| one.contains("InternalBattery")) else {
            return Supply { battery: None, charging: None, ac: ac.or(Some(true)) };
        };
        let cut = line.find('%');
        let battery = cut.and_then(|cut| {
            let digits: String = line[..cut]
                .chars()
                .rev()
                .take_while(char::is_ascii_digit)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            share(digits.parse().ok()?, 100.0)
        });
        let state =
            cut.and_then(|cut| line[cut..].split(';').nth(1)).map(str::trim).unwrap_or_default();
        let charging = (!state.is_empty())
            .then(|| state.starts_with("charging") || state.starts_with("finishing charge"));
        Supply { battery, charging, ac }
    }
    pub fn route(said: &str) -> Option<String> {
        said.lines()
            .find_map(|one| one.trim().strip_prefix("interface:"))
            .map(|one| one.trim().to_owned())
    }
    pub fn ports(said: &str) -> Vec<(String, String)> {
        let mut found = Vec::new();
        let mut port = None;
        for line in said.lines().map(str::trim) {
            if let Some(name) = line.strip_prefix("Hardware Port:") {
                port = Some(name.trim().to_owned());
            } else if let (Some(device), Some(name)) = (line.strip_prefix("Device:"), port.take()) {
                found.push((name, device.trim().to_owned()));
            }
        }
        found
    }
    pub fn kind(port: &str) -> Network {
        if port.contains("Wi-Fi") || port.contains("AirPort") {
            Network::Wifi
        } else if ["iPhone", "Bluetooth", "WWAN", "Cellular"].iter().any(|one| port.contains(one)) {
            Network::Cellular
        } else {
            Network::Wired
        }
    }
    pub fn link(interface: Option<&str>, ports: &[(String, String)]) -> Link {
        let Some(interface) = interface else {
            return best([]);
        };
        let port =
            ports.iter().find(|(_, device)| device == interface).map(|(name, _)| name.as_str());
        Link { online: Some(true), network: Some(port.map_or(Network::Wired, kind)) }
    }
}
#[cfg(any(windows, test))]
mod win {
    use super::{best, share, Link, Network, Supply};

    const UNKNOWN: u8 = 255;
    const CHARGING: u8 = 8;
    const NO_BATTERY: u8 = 128;
    pub fn supply(ac_line: u8, flags: u8, percent: u8) -> Supply {
        let present = flags != UNKNOWN && flags & NO_BATTERY == 0;
        let battery =
            (present && percent != UNKNOWN).then(|| share(f64::from(percent), 100.0)).flatten();
        let ac = match ac_line {
            0 => Some(false),
            1 => Some(true),
            _ => (!present).then_some(true),
        };
        Supply { battery, charging: present.then_some(flags & CHARGING != 0), ac }
    }
    pub fn link(adapters: &[(u32, bool, bool)]) -> Link {
        best(
            adapters
                .iter()
                .filter(|(kind, up, routed)| *up && *routed && !matches!(kind, 24 | 131))
                .map(|(kind, _, _)| match kind {
                    71 => Network::Wifi,
                    243 | 244 => Network::Cellular,
                    _ => Network::Wired,
                }),
        )
    }
}
#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;

    use super::{linux, Link, Supply, Ticks};

    fn stat() -> Option<String> {
        std::fs::read_to_string("/proc/stat").ok()
    }
    pub fn ticks() -> Option<Ticks> {
        linux::ticks(&stat()?)
    }
    pub fn boot() -> Option<u64> {
        linux::boot(&stat()?)
    }
    pub fn memory() -> Option<f32> {
        linux::memory(&std::fs::read_to_string("/proc/meminfo").ok()?)
    }
    pub fn supply() -> Supply {
        linux::supply(Path::new("/sys/class/power_supply"))
    }
    pub fn screen() -> Option<bool> {
        linux::screen(Path::new("/sys/class/drm"))
    }
    pub fn link() -> Link {
        linux::link(Path::new("/sys/class/net")).unwrap_or_default()
    }
}
#[cfg(windows)]
mod platform {
    use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, FILETIME, NO_ERROR};
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST,
        GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::AF_UNSPEC;
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::SystemInformation::{
        GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };
    use windows::Win32::System::Threading::GetSystemTimes;

    use super::{share, win, Link, Supply, Ticks};

    fn ticks_of(time: FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }
    #[allow(unsafe_code)]
    pub fn ticks() -> Option<Ticks> {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        unsafe { GetSystemTimes(Some(&raw mut idle), Some(&raw mut kernel), Some(&raw mut user)) }
            .ok()?;
        let total = ticks_of(kernel) + ticks_of(user);
        Some(Ticks { busy: total.saturating_sub(ticks_of(idle)), total })
    }
    #[allow(unsafe_code)]
    pub fn memory() -> Option<f32> {
        let mut status = MEMORYSTATUSEX {
            dwLength: u32::try_from(std::mem::size_of::<MEMORYSTATUSEX>()).ok()?,
            ..Default::default()
        };
        unsafe { GlobalMemoryStatusEx(&raw mut status) }.ok()?;
        share(f64::from(status.dwMemoryLoad), 100.0)
    }
    #[allow(unsafe_code)]
    pub fn boot() -> Option<u64> {
        let now = u64::try_from(
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_millis(),
        )
        .ok()?;
        let up = unsafe { GetTickCount64() };
        let at = now.checked_sub(up)?;
        Some((at + 5_000) / 10_000 * 10_000)
    }
    #[allow(unsafe_code)]
    pub fn supply() -> Supply {
        let mut status = SYSTEM_POWER_STATUS::default();
        if unsafe { GetSystemPowerStatus(&raw mut status) }.is_err() {
            return Supply::default();
        }
        win::supply(status.ACLineStatus, status.BatteryFlag, status.BatteryLifePercent)
    }
    pub fn screen() -> Option<bool> {
        None
    }
    #[allow(unsafe_code)]
    pub fn link() -> Link {
        let flags = GAA_FLAG_INCLUDE_GATEWAYS
            | GAA_FLAG_SKIP_ANYCAST
            | GAA_FLAG_SKIP_MULTICAST
            | GAA_FLAG_SKIP_DNS_SERVER;
        let mut size = 16 * 1024u32;
        for _ in 0..3 {
            let mut buffer = vec![0u64; usize::try_from(size).unwrap_or(0) / 8 + 1];
            let read = unsafe {
                GetAdaptersAddresses(
                    u32::from(AF_UNSPEC.0),
                    flags,
                    None,
                    Some(buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>()),
                    &raw mut size,
                )
            };
            if read == NO_ERROR.0 {
                let mut adapters = Vec::new();
                let mut at = buffer.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
                while !at.is_null() {
                    let one = unsafe { &*at };
                    adapters.push((
                        one.IfType,
                        one.OperStatus == IfOperStatusUp,
                        !one.FirstGatewayAddress.is_null(),
                    ));
                    at = one.Next;
                }
                return win::link(&adapters);
            }
            if read != ERROR_BUFFER_OVERFLOW.0 {
                break;
            }
        }
        Link::default()
    }
}
#[cfg(target_os = "macos")]
#[allow(deprecated)]
mod platform {
    use std::process::Command;
    use std::sync::OnceLock;

    use super::{mac, share, Link, Supply, Ticks};

    #[allow(unsafe_code)]
    mod graphics {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            pub fn CGMainDisplayID() -> u32;
            pub fn CGDisplayIsAsleep(display: u32) -> u32;
        }
    }
    fn said(program: &str, args: &[&str]) -> Option<String> {
        let out = Command::new(program).args(args).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }
    #[allow(unsafe_code)]
    pub fn ticks() -> Option<Ticks> {
        let mut info = libc::host_cpu_load_info { cpu_ticks: [0; 4] };
        let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
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
        Some(Ticks { busy: total.saturating_sub(idle), total })
    }
    #[allow(unsafe_code)]
    fn sysctl<T>(name: &str, mut value: T) -> Option<T> {
        let name = std::ffi::CString::new(name).ok()?;
        let mut size = std::mem::size_of::<T>();
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
    #[allow(unsafe_code, clippy::cast_precision_loss)]
    pub fn memory() -> Option<f32> {
        let total = sysctl("hw.memsize", 0u64)?;
        let page = sysctl("hw.pagesize", 0u64)?;
        let mut info: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let read = unsafe {
            libc::host_statistics64(
                libc::mach_host_self(),
                libc::HOST_VM_INFO64,
                (&raw mut info).cast(),
                &raw mut count,
            )
        };
        if read != 0 {
            return None;
        }
        let used = (u64::from(info.active_count)
            + u64::from(info.wire_count)
            + u64::from(info.compressor_page_count))
            * page;
        share(used as f64, total as f64)
    }
    pub fn boot() -> Option<u64> {
        let at = sysctl("kern.boottime", libc::timeval { tv_sec: 0, tv_usec: 0 })?;
        let seconds = u64::try_from(at.tv_sec).ok()?;
        (seconds > 0).then(|| seconds * 1000 + u64::try_from(at.tv_usec).unwrap_or(0) / 1000)
    }
    pub fn supply() -> Supply {
        said("pmset", &["-g", "batt"]).map(|one| mac::supply(&one)).unwrap_or_default()
    }
    #[allow(unsafe_code, clippy::unnecessary_wraps)]
    pub fn screen() -> Option<bool> {
        let asleep = unsafe { graphics::CGDisplayIsAsleep(graphics::CGMainDisplayID()) };
        Some(asleep == 0)
    }
    pub fn link() -> Link {
        static PORTS: OnceLock<Vec<(String, String)>> = OnceLock::new();
        let ports = PORTS.get_or_init(|| {
            said("networksetup", &["-listallhardwareports"])
                .map(|one| mac::ports(&one))
                .unwrap_or_default()
        });
        let interface = said("route", &["-n", "get", "default"]).and_then(|one| mac::route(&one));
        mac::link(interface.as_deref(), ports)
    }
}
#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
mod platform {
    use super::{Link, Supply, Ticks};

    pub fn ticks() -> Option<Ticks> {
        None
    }
    pub fn boot() -> Option<u64> {
        None
    }
    pub fn memory() -> Option<f32> {
        None
    }
    pub fn supply() -> Supply {
        Supply::default()
    }
    pub fn screen() -> Option<bool> {
        None
    }
    pub fn link() -> Link {
        Link::default()
    }
}
#[cfg(test)]
mod tests {
    use super::{busy_share, linux, mac, win, Device, Link, Network, Supply, Ticks};
    use std::path::Path;

    fn put(root: &Path, path: &str, text: &str) {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().expect("a folder")).expect("folders");
        std::fs::write(file, text).expect("a file");
    }
    #[test]
    fn the_processor_is_as_busy_as_its_ticks_since_the_last_look() {
        let was = Ticks { busy: 100, total: 1000 };
        assert_eq!(busy_share(was, Ticks { busy: 150, total: 1100 }), Some(0.5));
        assert_eq!(busy_share(was, was), None);
        assert_eq!(busy_share(was, Ticks { busy: 0, total: 10 }), None);
    }
    #[test]
    fn linux_says_its_processor_memory_and_boot_in_its_own_files() {
        let stat = "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\nbtime 1763600000\n";
        assert_eq!(linux::ticks(stat), Some(Ticks { busy: 200, total: 1000 }));
        assert_eq!(linux::ticks("intr 1 2"), None);
        assert_eq!(linux::boot(stat), Some(1_763_600_000_000));
        assert_eq!(linux::boot("cpu 1 2 3 4"), None);
        let info = "MemTotal:       16000 kB\nMemFree: 1 kB\nMemAvailable:    4000 kB\n";
        assert_eq!(linux::memory(info), Some(0.75));
        assert_eq!(linux::memory("MemTotal: 0 kB\nMemAvailable: 0 kB\n"), None);
    }
    #[test]
    fn a_linux_laptop_says_its_battery_charge_and_power_and_a_desktop_its_power() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        put(root, "BAT0/type", "Battery\n");
        put(root, "BAT0/capacity", "81\n");
        put(root, "BAT0/status", "Charging\n");
        put(root, "AC/type", "Mains\n");
        put(root, "AC/online", "1\n");
        put(root, "hid-mouse/type", "Battery\n");
        put(root, "hid-mouse/scope", "Device\n");
        put(root, "hid-mouse/capacity", "5\n");
        assert_eq!(
            linux::supply(root),
            Supply { battery: Some(0.81), charging: Some(true), ac: Some(true) }
        );
        put(root, "BAT0/status", "Not charging\n");
        assert_eq!(
            linux::supply(root),
            Supply { battery: Some(0.81), charging: Some(false), ac: Some(true) }
        );
        put(root, "BAT0/status", "Discharging\n");
        put(root, "AC/online", "0\n");
        assert_eq!(
            linux::supply(root),
            Supply { battery: Some(0.81), charging: Some(false), ac: Some(false) }
        );
        let bare = tempfile::tempdir().expect("a folder");
        assert_eq!(
            linux::supply(bare.path()),
            Supply { battery: None, charging: None, ac: Some(true) }
        );
        put(bare.path(), "BAT1/type", "Battery\n");
        put(bare.path(), "BAT1/capacity", "40\n");
        put(bare.path(), "BAT1/status", "Discharging\n");
        assert_eq!(
            linux::supply(bare.path()),
            Supply { battery: Some(0.4), charging: Some(false), ac: Some(false) }
        );
    }
    #[test]
    fn a_linux_screen_is_on_while_a_connected_output_is() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        assert_eq!(linux::screen(root), None);
        put(root, "card0-HDMI-A-1/status", "disconnected\n");
        put(root, "card0-HDMI-A-1/dpms", "On\n");
        assert_eq!(linux::screen(root), None);
        put(root, "card0-eDP-1/status", "connected\n");
        put(root, "card0-eDP-1/dpms", "Off\n");
        assert_eq!(linux::screen(root), Some(false));
        put(root, "card0-eDP-1/dpms", "On\n");
        assert_eq!(linux::screen(root), Some(true));
    }
    #[test]
    fn a_linux_link_is_wired_before_wifi_before_cellular_and_virtual_ones_do_not_count() {
        let dir = tempfile::tempdir().expect("a folder");
        let root = dir.path();
        put(root, "lo/operstate", "unknown\n");
        put(root, "lo/carrier", "1\n");
        put(root, "docker0/operstate", "up\n");
        assert_eq!(linux::link(root), Some(Link { online: Some(false), network: None }));
        put(root, "wwan0/uevent", "DEVTYPE=wwan\n");
        put(root, "wwan0/operstate", "unknown\n");
        put(root, "wwan0/carrier", "1\n");
        assert_eq!(linux::link(root).and_then(|one| one.network), Some(Network::Cellular));
        put(root, "wlp2s0/uevent", "DEVTYPE=wlan\nINTERFACE=wlp2s0\n");
        put(root, "wlp2s0/device/vendor", "0x8086\n");
        put(root, "wlp2s0/operstate", "up\n");
        assert_eq!(linux::link(root).and_then(|one| one.network), Some(Network::Wifi));
        put(root, "enp0s31f6/device/vendor", "0x8086\n");
        put(root, "enp0s31f6/operstate", "down\n");
        assert_eq!(linux::link(root).and_then(|one| one.network), Some(Network::Wifi));
        put(root, "enp0s31f6/operstate", "up\n");
        assert_eq!(
            linux::link(root),
            Some(Link { online: Some(true), network: Some(Network::Wired) })
        );
    }
    #[test]
    fn pmset_says_the_charge_the_charging_and_the_power() {
        let charging = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t85%; charging; 1:02 remaining present: true\n";
        assert_eq!(
            mac::supply(charging),
            Supply { battery: Some(0.85), charging: Some(true), ac: Some(true) }
        );
        let full = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t100%; charged; 0:00 remaining present: true\n";
        assert_eq!(
            mac::supply(full),
            Supply { battery: Some(1.0), charging: Some(false), ac: Some(true) }
        );
        let held = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; AC attached; not charging present: true\n";
        assert_eq!(
            mac::supply(held),
            Supply { battery: Some(0.8), charging: Some(false), ac: Some(true) }
        );
        let away = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t7%; discharging; 0:20 remaining present: true\n";
        assert_eq!(
            mac::supply(away),
            Supply { battery: Some(0.07), charging: Some(false), ac: Some(false) }
        );
        assert_eq!(
            mac::supply("Now drawing from 'AC Power'\n"),
            Supply { battery: None, charging: None, ac: Some(true) }
        );
    }
    #[test]
    fn a_mac_link_is_the_default_routes_port() {
        let ports = mac::ports(
            "\nHardware Port: Ethernet\nDevice: en0\nEthernet Address: a\n\nHardware Port: Wi-Fi\nDevice: en1\nEthernet Address: b\n\nHardware Port: iPhone USB\nDevice: en5\n",
        );
        assert_eq!(ports.len(), 3);
        let route = "   route to: default\ndestination: default\n  gateway: 192.168.1.1\n  interface: en1\n";
        assert_eq!(mac::route(route).as_deref(), Some("en1"));
        assert_eq!(
            mac::link(Some("en1"), &ports),
            Link { online: Some(true), network: Some(Network::Wifi) }
        );
        assert_eq!(mac::link(Some("en0"), &ports).network, Some(Network::Wired));
        assert_eq!(mac::link(Some("en5"), &ports).network, Some(Network::Cellular));
        assert_eq!(mac::link(None, &ports), Link { online: Some(false), network: None });
    }
    #[test]
    fn windows_says_its_power_and_its_adapters_link() {
        assert_eq!(
            win::supply(1, 8, 81),
            Supply { battery: Some(0.81), charging: Some(true), ac: Some(true) }
        );
        assert_eq!(
            win::supply(0, 0, 40),
            Supply { battery: Some(0.4), charging: Some(false), ac: Some(false) }
        );
        assert_eq!(
            win::supply(1, 128, 255),
            Supply { battery: None, charging: None, ac: Some(true) }
        );
        assert_eq!(
            win::supply(255, 128, 255),
            Supply { battery: None, charging: None, ac: Some(true) }
        );
        assert_eq!(
            win::link(&[(24, true, false), (131, true, true)]),
            Link { online: Some(false), network: None }
        );
        assert_eq!(win::link(&[(71, true, true), (6, false, true)]).network, Some(Network::Wifi));
        assert_eq!(win::link(&[(71, true, true), (6, true, true)]).network, Some(Network::Wired));
        assert_eq!(win::link(&[(243, true, true)]).network, Some(Network::Cellular));
        assert_eq!(win::link(&[(71, true, false)]).online, Some(false));
    }
    #[test]
    fn the_device_is_read_without_trouble_and_in_range() {
        let first = super::read();
        let again = super::read();
        for one in [first, again] {
            for value in [one.cpu, one.memory, one.battery].into_iter().flatten() {
                assert!((0.0..=1.0).contains(&value), "{one:?}");
            }
        }
        assert_eq!(first.boot, again.boot);
        let sent =
            serde_json::to_value(Device { network: Some(Network::Wifi), ..Device::default() })
                .expect("json");
        assert_eq!(sent["network"], "wifi");
    }
}
