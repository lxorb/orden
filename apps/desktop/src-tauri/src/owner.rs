use tauri::{Runtime, WebviewWindow};

#[tauri::command]
pub async fn owner_can() -> bool {
    tauri::async_runtime::spawn_blocking(platform::can)
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn owner_check<R: Runtime>(
    window: WebviewWindow<R>,
    reason: String,
) -> Result<bool, String> {
    let reason: String = reason
        .chars()
        .filter(|one| !one.is_control())
        .take(200)
        .collect();
    let window = handle_of(&window);
    tauri::async_runtime::spawn_blocking(move || platform::check(&reason, window))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_os = "windows")]
fn handle_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<isize> {
    window.hwnd().ok().map(|hwnd| hwnd.0 as isize)
}

#[cfg(not(target_os = "windows"))]
fn handle_of<R: Runtime>(_window: &WebviewWindow<R>) -> Option<isize> {
    None
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod platform {
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};

    #[allow(
        unsafe_code,
        reason = "LocalAuthentication is reached only through its Objective-C classes"
    )]
    pub fn can() -> bool {
        unsafe {
            LAContext::new()
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
                .is_ok()
        }
    }

    #[allow(
        unsafe_code,
        reason = "LocalAuthentication is reached only through its Objective-C classes"
    )]
    pub fn check(reason: &str, _window: Option<isize>) -> Result<bool, String> {
        let (said, heard) = mpsc::channel();
        let reply = RcBlock::new(move |yes: Bool, _error: *mut NSError| {
            let _ = said.send(yes.as_bool());
        });
        unsafe {
            LAContext::new().evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthentication,
                &NSString::from_str(reason),
                &reply,
            );
        }
        heard.recv().map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::core::{factory, HSTRING};
    use windows::Foundation::IAsyncOperation;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    pub fn can() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|asked| asked.get())
            .is_ok_and(|answer| answer == UserConsentVerifierAvailability::Available)
    }

    #[allow(
        unsafe_code,
        reason = "Windows Hello is asked over a window through its COM interop interface"
    )]
    pub fn check(reason: &str, window: Option<isize>) -> Result<bool, String> {
        let message = HSTRING::from(reason);
        let asked: IAsyncOperation<UserConsentVerificationResult> = match window {
            Some(hwnd) => {
                let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
                    .map_err(|error| error.to_string())?;
                unsafe {
                    interop.RequestVerificationForWindowAsync(
                        HWND(hwnd as *mut core::ffi::c_void),
                        &message,
                    )
                }
                .map_err(|error| error.to_string())?
            }
            None => UserConsentVerifier::RequestVerificationAsync(&message)
                .map_err(|error| error.to_string())?,
        };
        let answer = asked.get().map_err(|error| error.to_string())?;
        Ok(answer == UserConsentVerificationResult::Verified)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::collections::HashMap;

    use zbus::blocking::Connection;
    use zbus::zvariant::Value;

    const ACTIONS: [&str; 2] = ["ch.emilvinu.nib.unlock", "org.freedesktop.policykit.exec"];
    const ALLOW_INTERACTION: u32 = 1;

    pub(super) fn subject() -> Option<(&'static str, HashMap<&'static str, Value<'static>>)> {
        let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
        let (_, after) = stat.rsplit_once(')')?;
        let started: u64 = after.split_whitespace().nth(19)?.parse().ok()?;
        let mut details = HashMap::new();
        details.insert("pid", Value::from(std::process::id()));
        details.insert("start-time", Value::from(started));
        Some(("unix-process", details))
    }

    fn asked(action: &str, flags: u32) -> zbus::Result<(bool, bool)> {
        let subject = subject().ok_or_else(|| zbus::Error::Failure("no process".into()))?;
        let reply = Connection::system()?.call_method(
            Some("org.freedesktop.PolicyKit1"),
            "/org/freedesktop/PolicyKit1/Authority",
            Some("org.freedesktop.PolicyKit1.Authority"),
            "CheckAuthorization",
            &(subject, action, HashMap::<&str, &str>::new(), flags, ""),
        )?;
        let (yes, challenge, _): (bool, bool, HashMap<String, String>) =
            reply.body().deserialize()?;
        Ok((yes, challenge))
    }

    fn action() -> Option<&'static str> {
        ACTIONS
            .into_iter()
            .find(|one| asked(one, 0).is_ok_and(|(yes, challenge)| yes || challenge))
    }

    pub fn can() -> bool {
        action().is_some()
    }

    pub fn check(_reason: &str, _window: Option<isize>) -> Result<bool, String> {
        let action = action().ok_or("polkit cannot ask here")?;
        asked(action, ALLOW_INTERACTION)
            .map(|(yes, _)| yes)
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
)))]
mod platform {

    pub fn can() -> bool {
        false
    }

    pub fn check(_reason: &str, _window: Option<isize>) -> Result<bool, String> {
        Err("this device cannot ask".into())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    #[test]
    fn names_this_process_as_polkit_does() {
        let (kind, details) = super::platform::subject().expect("a subject");
        assert_eq!(kind, "unix-process");
        assert_eq!(
            details.get("pid"),
            Some(&zbus::zvariant::Value::from(std::process::id()))
        );
        assert!(details.contains_key("start-time"));
    }
}
