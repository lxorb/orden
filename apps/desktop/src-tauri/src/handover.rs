#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Found {
    Nothing,
    Handed,
    Silent,
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Asked {
    End,
    Leave,
    Answered,
}

static ENDED: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

#[cfg(windows)]
pub fn handed_over(identifier: &str) -> bool {
    let names = Names::of(identifier);
    let launch = arguments();
    match handed(&names, &launch, ANSWER) {
        Found::Nothing => false,
        Found::Handed => true,
        Found::Silent => match asked(&names, &launch) {
            Asked::Answered | Asked::Leave => true,
            Asked::End => {
                if let Some(pid) = names.owner() {
                    if ended(pid) {
                        let _ = ENDED.set(pid);
                    }
                }
                false
            }
        },
    }
}

#[cfg(target_os = "linux")]
pub fn handed_over(identifier: &str) -> bool {
    let mut launch: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    if let Some(token) = crate::linux::launched_with() {
        launch.push(format!("{}{token}", crate::launch::TOKEN_FLAG));
    }
    on_the_bus(identifier, &launch).unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn on_the_bus(identifier: &str, launch: &[String]) -> zbus::Result<bool> {
    let name = format!("{identifier}.SingleInstance");
    let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
    let bus = zbus::blocking::Connection::session()?;
    let taken: bool = bus
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "NameHasOwner",
            &(name.as_str(),),
        )?
        .body()
        .deserialize()?;
    if !taken {
        return Ok(false);
    }
    let cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    bus.call_method(
        Some(name.as_str()),
        path.as_str(),
        Some("org.SingleInstance.DBus"),
        "ExecuteCallback",
        &(launch, cwd.as_str()),
    )?;
    Ok(true)
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn handed_over(_identifier: &str) -> bool {
    false
}

pub fn said(app: &tauri::AppHandle) {
    if let Some(pid) = ENDED.get() {
        crate::logs::say(
            app,
            "warn",
            &format!(
                "stall: a launch ended the nib before it, which was not responding (pid {pid})"
            ),
        );
    }
}

#[cfg(windows)]
const ANSWER: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(windows)]
const MARK: usize = 1542;

#[cfg(windows)]
struct Names {
    class: Vec<u16>,
    window: Vec<u16>,
}

#[cfg(windows)]
impl Names {
    fn of(identifier: &str) -> Self {
        let wide = |text: String| text.encode_utf16().chain(std::iter::once(0)).collect();
        Self {
            class: wide(format!("{identifier}-sic")),
            window: wide(format!("{identifier}-siw")),
        }
    }

    #[allow(unsafe_code, reason = "a window is found through FindWindowW")]
    fn find(&self) -> Option<windows::Win32::Foundation::HWND> {
        use windows::core::PCWSTR;
        use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
        unsafe { FindWindowW(PCWSTR(self.class.as_ptr()), PCWSTR(self.window.as_ptr())) }
            .ok()
            .filter(|window| !window.is_invalid())
    }

    #[allow(
        unsafe_code,
        reason = "a window's process is asked through GetWindowThreadProcessId"
    )]
    fn owner(&self) -> Option<u32> {
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let window = self.find()?;
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(window, Some(&raw mut pid)) };
        (pid != 0 && pid != std::process::id()).then_some(pid)
    }
}

#[cfg(windows)]
fn arguments() -> Vec<u8> {
    let folder = std::env::current_dir().unwrap_or_default();
    let args = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<String>>()
        .join("|");
    format!("{}|{args}\0", folder.to_str().unwrap_or_default()).into_bytes()
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the hand-over is a WM_COPYDATA message, which only Win32 sends"
)]
fn handed(names: &Names, launch: &[u8], within: std::time::Duration) -> Found {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_COPYDATA,
    };

    let Some(window) = names.find() else {
        return Found::Nothing;
    };
    let data = COPYDATASTRUCT {
        dwData: MARK,
        cbData: u32::try_from(launch.len()).unwrap_or(u32::MAX),
        lpData: launch.as_ptr().cast_mut().cast(),
    };
    let mut result = 0usize;
    let sent = unsafe {
        SendMessageTimeoutW(
            window,
            WM_COPYDATA,
            WPARAM(0),
            LPARAM(std::ptr::from_ref(&data) as isize),
            SMTO_ABORTIFHUNG,
            u32::try_from(within.as_millis()).unwrap_or(u32::MAX),
            Some(&raw mut result),
        )
    };
    if sent.0 != 0 {
        Found::Handed
    } else {
        Found::Silent
    }
}

#[cfg(windows)]
#[allow(unsafe_code, reason = "the question is a Win32 message box")]
fn asked(names: &Names, launch: &[u8]) -> Asked {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;
    use windows::core::w;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, PostThreadMessageW, IDCANCEL, IDOK, MB_ICONWARNING, MB_OKCANCEL,
        MB_SETFOREGROUND, WM_QUIT,
    };

    let asking = Arc::new(AtomicU32::new(unsafe { GetCurrentThreadId() }));
    let answered = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let trying = {
        let (asking, answered, done) = (asking.clone(), answered.clone(), done.clone());
        let launch = launch.to_vec();
        let names = Names {
            class: names.class.clone(),
            window: names.window.clone(),
        };
        std::thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                if handed(&names, &launch, std::time::Duration::from_millis(500)) != Found::Silent {
                    answered.store(true, Ordering::SeqCst);
                    let _ = unsafe {
                        PostThreadMessageW(
                            asking.load(Ordering::SeqCst),
                            WM_QUIT,
                            WPARAM(0),
                            LPARAM(0),
                        )
                    };
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        })
    };

    let chosen = if crate::placement::asked_away() {
        match std::env::var("NIB_PROBE_NOT_RESPONDING").as_deref() {
            Ok("end") => IDOK,
            Ok("wait") => {
                let until = std::time::Instant::now() + std::time::Duration::from_secs(20);
                while !answered.load(Ordering::SeqCst) && std::time::Instant::now() < until {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                IDCANCEL
            }
            _ => IDCANCEL,
        }
    } else {
        unsafe {
            MessageBoxW(
                None,
                w!("Orden is not responding.\n\nEnd it and open Orden again?"),
                w!("Orden"),
                MB_OKCANCEL | MB_ICONWARNING | MB_SETFOREGROUND,
            )
        }
    };
    done.store(true, Ordering::SeqCst);
    let _ = trying.join();

    if answered.load(Ordering::SeqCst) {
        Asked::Answered
    } else if chosen == IDOK {
        Asked::End
    } else {
        Asked::Leave
    }
}

#[cfg(windows)]
#[allow(unsafe_code, reason = "a process is ended through TerminateProcess")]
fn ended(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };

    const GOING: u32 = 10_000;

    unsafe {
        let Ok(process) = OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid) else {
            return false;
        };
        let _ = TerminateProcess(process, 1);
        let gone = WaitForSingleObject(process, GOING) == WAIT_OBJECT_0;
        let _ = CloseHandle(process);
        gone
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{arguments, handed, Found, Names};
    use std::time::Duration;

    #[test]
    fn nothing_running_is_nothing_to_hand_to() {
        let names = Names::of("ch.emilvinu.nib.test.nobody-runs-this");
        assert_eq!(
            handed(&names, &arguments(), Duration::from_millis(50)),
            Found::Nothing
        );
        assert_eq!(names.owner(), None);
    }

    #[test]
    fn the_launch_is_the_folder_then_the_arguments() {
        let launch = String::from_utf8(arguments()).expect("text");
        assert!(launch.ends_with('\0'));
        let mut parts = launch.trim_end_matches('\0').split('|');
        let folder = parts.next().expect("the folder");
        assert_eq!(
            folder,
            std::env::current_dir()
                .expect("a folder")
                .to_str()
                .expect("text")
        );
        assert!(
            parts.next().is_some(),
            "the program itself is the first argument"
        );
    }
}
