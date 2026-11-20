use orden_base::Held as _;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sensed {
    idle_ms: Option<u64>,
    front: Option<bool>,
    app: Option<String>,
    lid: Option<bool>,
    locked: Option<bool>,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Power {
    lid: Option<bool>,
    locked: Option<bool>,
}
static HELD: Mutex<Option<(Instant, Power)>> = Mutex::new(None);
const POWER_EVERY: Duration = Duration::from_secs(30);
const LONGEST_APP: usize = 80;
#[tauri::command]
pub async fn time_sense() -> Sensed {
    orden_base::lane::off_the_runtime(sensed).await
}
fn sensed() -> Sensed {
    let input = crate::presence::input_idle();
    let power = power();
    Sensed {
        idle_ms: input.map(|one| one.idle_ms),
        front: input.map(|one| one.front),
        app: platform::front_app().and_then(|name| app_name(&name)),
        lid: power.lid,
        locked: power.locked,
    }
}
fn power() -> Power {
    let mut held = HELD.held();
    if let Some((at, power)) = *held {
        if at.elapsed() < POWER_EVERY {
            return power;
        }
    }
    *held = Some((Instant::now(), Power::default()));
    drop(held);
    let power = platform::power();
    *HELD.held() = Some((Instant::now(), power));
    power
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
#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;

    use zbus::blocking::Connection;
    use zbus::zvariant::{OwnedObjectPath, OwnedValue};

    use super::Power;

    fn read(path: &Path) -> Option<String> {
        std::fs::read_to_string(path).ok().map(|one| one.trim().to_owned())
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
    const LOGIND: &str = "org.freedesktop.login1";
    fn ask(
        bus: &Connection,
        name: &str,
        path: &str,
        interface: &str,
        method: &str,
        body: &(impl serde::Serialize + zbus::zvariant::DynamicType),
    ) -> Option<zbus::message::Message> {
        bus.call_method(Some(name), path, Some(interface), method, body).ok()
    }
    fn property(bus: &Connection, path: &str, interface: &str, name: &str) -> Option<OwnedValue> {
        ask(bus, LOGIND, path, "org.freedesktop.DBus.Properties", "Get", &(interface, name))?
            .body()
            .deserialize()
            .ok()
    }
    fn own_session(bus: &Connection) -> Option<String> {
        let id = std::env::var("XDG_SESSION_ID").ok()?;
        let path: OwnedObjectPath = ask(
            bus,
            LOGIND,
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            "GetSession",
            &(id.as_str(),),
        )?
        .body()
        .deserialize()
        .ok()?;
        Some(path.as_str().to_owned())
    }
    fn display_session(bus: &Connection) -> Option<String> {
        let shown = property(
            bus,
            "/org/freedesktop/login1/user/self",
            "org.freedesktop.login1.User",
            "Display",
        )?;
        let (_, path): (String, OwnedObjectPath) = shown.try_into().ok()?;
        (path.as_str() != "/").then(|| path.as_str().to_owned())
    }
    fn locked_hint(bus: &Connection, path: &str) -> Option<bool> {
        bool::try_from(property(bus, path, "org.freedesktop.login1.Session", "LockedHint")?).ok()
    }
    fn logind_locked() -> Option<bool> {
        let bus = Connection::system().ok()?;
        [own_session(&bus), display_session(&bus)]
            .into_iter()
            .flatten()
            .chain(std::iter::once("/org/freedesktop/login1/session/auto".to_owned()))
            .find_map(|path| locked_hint(&bus, &path))
    }
    fn screensaver_locked() -> Option<bool> {
        let bus = Connection::session().ok()?;
        [
            ("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver"),
            ("org.gnome.ScreenSaver", "/org/gnome/ScreenSaver"),
            ("org.cinnamon.ScreenSaver", "/org/cinnamon/ScreenSaver"),
            ("org.mate.ScreenSaver", "/org/mate/ScreenSaver"),
        ]
        .into_iter()
        .filter(|(name, _)| {
            ask(
                &bus,
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "NameHasOwner",
                &(*name,),
            )
            .and_then(|reply| reply.body().deserialize::<bool>().ok())
            .unwrap_or(false)
        })
        .find_map(|(name, path)| {
            ask(&bus, name, path, name, "GetActive", &())?.body().deserialize::<bool>().ok()
        })
    }
    fn locked() -> Option<bool> {
        match logind_locked() {
            Some(true) => Some(true),
            hint => screensaver_locked().filter(|active| *active).or(hint),
        }
    }
    pub fn power() -> Power {
        Power { lid: lid(), locked: locked() }
    }
    pub fn front_app() -> Option<String> {
        crate::front_x::front_class()
    }
}
#[cfg(windows)]
mod platform {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    use super::Power;

    pub fn power() -> Power {
        #[allow(unsafe_code)]
        let locked = unsafe {
            match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
                Ok(desk) => {
                    let _ = CloseDesktop(desk);
                    false
                }
                Err(_) => true,
            }
        };
        Power { lid: None, locked: Some(locked) }
    }
    pub fn front_app() -> Option<String> {
        let mut process = 0u32;
        let mut buffer = [0u16; 1024];
        let mut length = u32::try_from(buffer.len()).ok()?;
        #[allow(unsafe_code)]
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
#[allow(deprecated)]
mod platform {
    use std::process::Command;

    use objc2_app_kit::NSWorkspace;

    use super::Power;

    fn said(program: &str, args: &[&str]) -> Option<String> {
        let out = Command::new(program).args(args).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }
    pub fn power() -> Power {
        let lid = said("ioreg", &["-r", "-k", "AppleClamshellState", "-d", "1"]).and_then(|text| {
            let line = text.lines().find(|one| one.contains("\"AppleClamshellState\""))?;
            Some(!line.contains("Yes"))
        });
        let locked = said("ioreg", &["-n", "Root", "-d", "1"])
            .map(|text| text.contains("\"CGSSessionScreenIsLocked\"=Yes"));
        Power { lid, locked }
    }
    pub fn front_app() -> Option<String> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        Some(app.localizedName()?.to_string())
    }
}
#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
mod platform {
    use super::Power;

    pub fn power() -> Power {
        Power::default()
    }
    pub fn front_app() -> Option<String> {
        None
    }
}
#[cfg(test)]
mod tests {
    use super::{app_name, Sensed};

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
    fn only_what_the_tracker_reads_is_sent() {
        let sent = serde_json::to_value(Sensed::default()).expect("json");
        let mut keys: Vec<&str> =
            sent.as_object().expect("an object").keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["app", "front", "idleMs", "lid", "locked"]);
    }
    #[test]
    fn the_system_is_asked_without_trouble() {
        let first = super::sensed();
        let again = super::sensed();
        assert_eq!((first.lid, first.locked), (again.lid, again.locked));
    }
}
