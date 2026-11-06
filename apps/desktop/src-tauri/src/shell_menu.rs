//! Explorer's "New ▸" menu. Windows builds it from a `ShellNew` key under the
//! extension, named by the file type the extension says it is: an extension that names
//! none, as `.md` on a machine with no Markdown program, is left out of the menu (#483).
//! So where `.md` names no type, it is given Orden's, which only names it. Everything
//! here writes to `HKEY_CURRENT_USER`, so it needs no administrator and affects only the
//! person who asked for it.

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
    use windows::Win32::Foundation::{ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegDeleteKeyValueW, RegDeleteTreeW, RegGetValueW,
        RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ,
        REG_SZ, RRF_RT_REG_SZ,
    };
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    const KEY: PCWSTR = w!("Software\\Classes\\.md\\ShellNew");
    const EXTENSION: PCWSTR = w!("Software\\Classes\\.md");
    const TYPE: &str = "Orden.Markdown";
    const TYPE_KEY: PCWSTR = w!("Software\\Classes\\Orden.Markdown");

    /// A key's default value, as text.
    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    fn default_of(root: HKEY, key: PCWSTR) -> Option<String> {
        let mut buffer = [0u16; 260];
        let mut size = u32::try_from(std::mem::size_of_val(&buffer)).unwrap_or(0);
        // Safe: the buffer and its size outlive the call, which writes no more than `size`.
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

    /// Whether `.md` names a file type that is there, which Explorer names the entry by.
    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    pub(super) fn typed() -> bool {
        let Some(name) = default_of(HKEY_CLASSES_ROOT, w!(".md")) else {
            return false;
        };
        let name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut key = HKEY::default();
        // Safe: a name that ends in a nought, and a handle closed if it opened.
        unsafe {
            if RegOpenKeyExW(
                HKEY_CLASSES_ROOT,
                PCWSTR(name.as_ptr()),
                0,
                KEY_READ,
                ptr::from_mut(&mut key),
            ) != ERROR_SUCCESS
            {
                return false;
            }
            let _ = RegCloseKey(key);
        }
        true
    }

    /// Sets a key's default value, making the key where it is not there.
    #[allow(
        unsafe_code,
        reason = "the registry has no safe wrapper in the windows crate"
    )]
    fn set_default(key: PCWSTR, value: &str) -> Result<(), WIN32_ERROR> {
        let bytes: Vec<u8> = value
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        let mut opened = HKEY::default();
        // Safe: valid names and bytes, and the one handle opened is closed below.
        unsafe {
            let status = RegCreateKeyW(HKEY_CURRENT_USER, key, ptr::from_mut(&mut opened));
            if status != ERROR_SUCCESS {
                return Err(status);
            }
            let set = RegSetValueExW(opened, PCWSTR::null(), 0, REG_SZ, Some(&bytes));
            let _ = RegCloseKey(opened);
            if set == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(set)
            }
        }
    }

    /// Tells Explorer the file types changed, so its menu is read again.
    #[allow(unsafe_code, reason = "a shell notification, which only Win32 sends")]
    fn told() {
        // Safe: an event that carries nothing.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }

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
                if default_of(HKEY_CURRENT_USER, EXTENSION).as_deref() == Some(TYPE) {
                    let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, EXTENSION, PCWSTR::null());
                }
                let _ = RegDeleteTreeW(HKEY_CURRENT_USER, TYPE_KEY);
                told();
                // Already gone is the state that was asked for, not a failure.
                return if status == ERROR_SUCCESS || !read() {
                    Ok(())
                } else {
                    Err(format!("could not remove the entry ({})", status.0))
                };
            }

            if !typed() {
                set_default(TYPE_KEY, "Markdown Document")
                    .and_then(|()| set_default(EXTENSION, TYPE))
                    .map_err(|status| format!("could not add the entry ({})", status.0))?;
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
                told();
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

#[cfg(all(test, windows))]
mod tests {
    use super::platform::{read, typed, write};
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IDataObject, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Registry::HKEY;
    use windows::Win32::UI::Shell::{
        CLSID_NewMenu, IContextMenu, IContextMenu2, ILCreateFromPathW, ILFree, IShellExtInit,
        CMF_NORMAL,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreatePopupMenu, DestroyMenu, GetMenuItemCount, GetMenuStringW, GetSubMenu, MF_BYPOSITION,
        WM_INITMENUPOPUP,
    };

    /// What Explorer's New menu lists in `folder`, as a right click there builds it.
    #[allow(
        unsafe_code,
        reason = "Explorer's New menu is a shell object, reached through COM"
    )]
    fn new_menu(folder: &std::path::Path) -> Vec<String> {
        let mut out = Vec::new();
        // Safe: COM objects of this thread, a menu this frame makes and destroys, and an
        // item list freed once the menu is read.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let menu: IContextMenu =
                CoCreateInstance(&CLSID_NewMenu, None, CLSCTX_INPROC_SERVER).expect("the menu");
            let list = ILCreateFromPathW(&HSTRING::from(folder.as_os_str()));
            menu.cast::<IShellExtInit>()
                .expect("a shell extension")
                .Initialize(Some(list), None::<&IDataObject>, HKEY::default())
                .expect("the folder");
            let popup = CreatePopupMenu().expect("a menu");
            menu.QueryContextMenu(popup, 0, 1, 0x7fff, CMF_NORMAL)
                .expect("the items");
            let opened: IContextMenu2 = menu.cast().expect("a menu that opens");
            for at in 0..GetMenuItemCount(popup) {
                let sub = GetSubMenu(popup, at);
                if sub.is_invalid() {
                    continue;
                }
                let _ = opened.HandleMenuMsg(
                    WM_INITMENUPOPUP,
                    WPARAM(sub.0 as usize),
                    LPARAM(at as isize),
                );
                for item in 0..GetMenuItemCount(sub) {
                    let mut text = [0u16; 260];
                    let length = GetMenuStringW(
                        sub,
                        u32::try_from(item).unwrap_or_default(),
                        Some(&mut text),
                        MF_BYPOSITION,
                    );
                    let length = usize::try_from(length).unwrap_or_default();
                    out.push(String::from_utf16_lossy(&text[..length]));
                }
            }
            let _ = DestroyMenu(popup);
            ILFree(Some(list));
        }
        out
    }

    /// The entry is in Explorer's menu once it is turned on, and gone once it is off, on a
    /// machine whose `.md` names no program. Run on CI's runners only: it writes the
    /// registry of whoever runs it.
    #[test]
    fn the_entry_is_in_explorers_new_menu() {
        if std::env::var_os("CI").is_none() || typed() {
            return;
        }
        let folder = tempfile::tempdir().expect("a folder");
        let ours = |list: &[String]| list.iter().any(|one| one == "Markdown Document");
        assert!(!ours(&new_menu(folder.path())));

        write(true).expect("turned on");
        assert!(read());
        let listed = new_menu(folder.path());
        write(false).expect("turned off");
        assert!(ours(&listed), "the New menu lists {listed:?}");

        assert!(!read());
        assert!(!typed(), "the type it was given goes with it");
        assert!(!ours(&new_menu(folder.path())));
    }
}
