//! Explorer's "New ▸" menu. Windows builds it from a `ShellNew` key under the
//! extension, so adding one entry is all it takes. Everything here writes to
//! `HKEY_CURRENT_USER`, so it needs no administrator and affects only the person
//! who asked for it.

/// Whether the "New ▸ Markdown Document" entry is currently registered.
#[tauri::command]
pub fn new_menu_registered() -> bool {
    platform::read()
}

/// Adds or removes the entry. Nothing here runs unless the reader asks for it.
#[tauri::command]
pub fn set_new_menu(enabled: bool) -> Result<(), String> {
    platform::write(enabled)
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ptr;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegDeleteTreeW, RegOpenKeyExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, REG_SZ,
    };

    const KEY: PCWSTR = w!("Software\\Classes\\.md\\ShellNew");

    /// Whether the key is there, which is the whole of the state.
    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    pub fn read() -> bool {
        let mut key = HKEY::default();

        // Safe: both pointers are valid for the call, and the handle is closed on
        // every path that opened one.
        unsafe {
            let opened =
                RegOpenKeyExW(HKEY_CURRENT_USER, KEY, 0, KEY_READ, ptr::from_mut(&mut key));
            if opened != ERROR_SUCCESS {
                return false;
            }
            let _ = RegCloseKey(key);
        }

        true
    }

    /// Adds the key or takes it away, and says so in a sentence rather than in a
    /// status code.
    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    pub fn write(enabled: bool) -> Result<(), String> {
        // Safe: every call is given a valid key handle and a null-terminated
        // constant name, and the one handle opened here is closed below.
        unsafe {
            if !enabled {
                let status = RegDeleteTreeW(HKEY_CURRENT_USER, KEY);
                // Already gone is the state that was asked for, not a failure.
                return if status == ERROR_SUCCESS || !read() {
                    Ok(())
                } else {
                    Err(format!("could not remove the entry ({})", status.0))
                };
            }

            let mut key = HKEY::default();
            let status = RegCreateKeyW(HKEY_CURRENT_USER, KEY, ptr::from_mut(&mut key));

            if status != ERROR_SUCCESS {
                return Err(format!("could not add the entry ({})", status.0));
            }

            // `NullFile` tells Explorer to create an empty file, which is exactly
            // what a new note is.
            let result = RegSetValueExW(key, w!("NullFile"), 0, REG_SZ, Some(&[0, 0]));
            let _ = RegCloseKey(key);

            if result == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(format!("could not add the entry ({})", result.0))
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    /// No other desktop builds a "new file" menu from the registry, so there is
    /// never an entry to report.
    pub fn read() -> bool {
        false
    }

    /// Asked for anyway, this says why it cannot happen rather than pretending it
    /// did.
    pub fn write(_enabled: bool) -> Result<(), String> {
        Err("only Windows has this menu".into())
    }
}
