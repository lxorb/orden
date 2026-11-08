pub fn forget() {
    platform::forget();
}

mod platform {
    use std::ptr;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteKeyValueW, RegDeleteTreeW, RegGetValueW, RegOpenKeyExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_SZ,
    };
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    const KEY: PCWSTR = w!("Software\\Classes\\.md\\ShellNew");
    const EXTENSION: PCWSTR = w!("Software\\Classes\\.md");
    const TYPE: &str = "Orden.Markdown";
    const TYPE_KEY: PCWSTR = w!("Software\\Classes\\Orden.Markdown");

    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    fn default_of(root: HKEY, key: PCWSTR) -> Option<String> {
        let mut buffer = [0u16; 260];
        let mut size = u32::try_from(std::mem::size_of_val(&buffer)).unwrap_or(0);
        let status = unsafe {
            RegGetValueW(
                root,
                key,
                PCWSTR::null(),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&raw mut size),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(0);
        Some(String::from_utf16_lossy(&buffer[..length])).filter(|text| !text.is_empty())
    }

    #[allow(unsafe_code, reason = "a shell notification, which only Win32 sends")]
    fn told() {
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }

    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    pub fn read() -> bool {
        let mut key = HKEY::default();

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

    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    pub fn forget() {
        if !read() {
            return;
        }
        unsafe {
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, KEY);
            if default_of(HKEY_CURRENT_USER, EXTENSION).as_deref() == Some(TYPE) {
                let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, EXTENSION, PCWSTR::null());
            }
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, TYPE_KEY);
        }
        told();
    }
}

#[cfg(test)]
mod tests {
    use super::platform::{forget, read};
    use std::ptr;
    use windows::core::w;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_SZ,
    };

    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    fn left_by_an_older_build() {
        let mut key = HKEY::default();
        unsafe {
            assert_eq!(
                RegCreateKeyW(
                    HKEY_CURRENT_USER,
                    w!("Software\\Classes\\.md\\ShellNew"),
                    ptr::from_mut(&mut key),
                ),
                ERROR_SUCCESS
            );
            let _ = RegSetValueExW(key, w!("NullFile"), 0, REG_SZ, Some(&[0, 0]));
            let _ = RegCloseKey(key);
        }
    }

    #[test]
    fn an_entry_an_older_build_put_in_explorers_new_menu_goes() {
        if std::env::var_os("CI").is_none() {
            return;
        }
        left_by_an_older_build();
        assert!(read());
        forget();
        assert!(!read());
        forget();
        assert!(!read());
    }
}
