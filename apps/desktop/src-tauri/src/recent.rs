//! The system's own list of recently opened documents. Notes the reader opens are
//! handed to the shell, which is what fills the taskbar Jump List's Recent
//! category and the Start menu's recent documents. Windows keeps and orders the
//! list itself; there is nothing to store here.

/// Tells the shell a note was opened. Nothing is remembered on this side, so
/// there is nothing here that can fail.
#[tauri::command]
pub fn remember_recent(path: String) {
    add_to_recent(&path);
}

/// `SHARD_PATHW`: the thing being added is a path, given as a wide string.
/// Spelled out because the crate offers it signed and the call wants it
/// unsigned, and a cast between the two is worth less than a constant with a
/// test on it.
#[cfg(target_os = "windows")]
const PATH_AS_WIDE_STRING: u32 = 3;

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "the shell's recent documents list is a C call with no safe wrapper"
)]
fn add_to_recent(path: &str) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::SHAddToRecentDocs;

    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // Safe: the pointer is a null-terminated buffer that outlives the call, and
    // the shell only reads from it.
    unsafe {
        SHAddToRecentDocs(PATH_AS_WIDE_STRING, Some(wide.as_ptr().cast()));
    }
}

#[cfg(not(target_os = "windows"))]
fn add_to_recent(_path: &str) {
    // Other desktops read recent documents from their own files, which the
    // portal writes; nothing for the app to do.
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::PATH_AS_WIDE_STRING;
    use windows::Win32::UI::Shell::SHARD_PATHW;

    #[test]
    fn the_flag_is_the_one_the_shell_documents() {
        assert_eq!(i32::try_from(PATH_AS_WIDE_STRING), Ok(SHARD_PATHW.0));
    }
}
