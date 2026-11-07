use std::path::{Path, PathBuf};

#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let named = |path: &Path, name: &str| path.file_name().is_some_and(|own| own == name);
    let app = bundle
        .extension()
        .is_some_and(|extension| extension == "app");
    (named(macos, "MacOS") && named(contents, "Contents") && app).then(|| bundle.to_path_buf())
}

#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac translocates an app")
)]
fn stuck_at(bundle: &Path, read_only: bool) -> bool {
    read_only || bundle.to_string_lossy().contains("/AppTranslocation/")
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "statfs fills a struct the type system cannot see into"
)]
fn read_only(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;

    let Ok(name) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    let mut said = std::mem::MaybeUninit::<libc::statfs>::zeroed();
    if unsafe { libc::statfs(name.as_ptr(), said.as_mut_ptr()) } != 0 {
        return false;
    }
    let flags = unsafe { said.assume_init() }.f_flags;
    flags & u32::try_from(libc::MNT_RDONLY).unwrap_or_default() != 0
}

#[cfg(target_os = "macos")]
fn stuck_bundle() -> Option<PathBuf> {
    let bundle = bundle_of(&std::env::current_exe().ok()?)?;
    stuck_at(&bundle, read_only(&bundle)).then_some(bundle)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn app_stuck() -> bool {
    stuck_bundle().is_some()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn app_stuck() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn applications() -> Option<PathBuf> {
    let shared = Path::new("/Applications");
    if writable(shared) {
        return Some(shared.to_path_buf());
    }
    let own = dirs::home_dir()?.join("Applications");
    std::fs::create_dir_all(&own).ok()?;
    Some(own)
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code, reason = "access takes a C string")]
fn writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;

    let Ok(name) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    unsafe { libc::access(name.as_ptr(), libc::W_OK) == 0 }
}

#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac moves the app")
)]
const RELAUNCH: &str = r#"while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 0.1; done; /bin/sleep 0.5; exec /usr/bin/open -n "$2""#;

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn move_to_applications(app: tauri::AppHandle) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        use std::os::unix::process::CommandExt as _;
        use std::process::{Command, Stdio};

        let from = stuck_bundle().ok_or("this copy can update where it is")?;
        let name = from.file_name().ok_or("the app has no name")?;
        let to = applications()
            .ok_or("there is no Applications folder to move to")?
            .join(name);

        if !to.exists() {
            let copied = Command::new("/usr/bin/ditto")
                .arg(&from)
                .arg(&to)
                .status()
                .map_err(|error| error.to_string())?;
            if !copied.success() {
                let _ = std::fs::remove_dir_all(&to);
                return Err(format!("could not copy the app to {}", to.display()));
            }
            let _ = Command::new("/usr/bin/xattr")
                .args(["-dr", "com.apple.quarantine"])
                .arg(&to)
                .status();
        }

        Command::new("/bin/sh")
            .args(["-c", RELAUNCH, "sh"])
            .arg(std::process::id().to_string())
            .arg(&to)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|error| error.to_string())?;
        crate::lifecycle::quit(&app);
        Ok(())
    })
    .await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn move_to_applications(app: tauri::AppHandle) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let _ = app;
        Err("only a Mac moves the app".into())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{bundle_of, stuck_at, RELAUNCH};
    use std::path::{Path, PathBuf};

    #[test]
    fn the_program_is_inside_its_app() {
        assert_eq!(
            bundle_of(Path::new("/Applications/nibeditor.app/Contents/MacOS/nib")),
            Some(PathBuf::from("/Applications/nibeditor.app"))
        );
        for exe in [
            "/Users/a/code/nib/target/release/orden",
            "/Applications/nibeditor.app/Contents/Resources/nib",
            "/Applications/nibeditor/Contents/MacOS/nib",
            "nib",
        ] {
            assert_eq!(bundle_of(Path::new(exe)), None, "{exe}");
        }
    }

    #[test]
    fn a_copy_on_the_disk_image_or_translocated_is_stuck() {
        let image = Path::new("/Volumes/nibeditor/nibeditor.app");
        assert!(stuck_at(image, true));
        let moved =
            Path::new("/private/var/folders/x1/abc/T/AppTranslocation/7E2F-11AA/d/nibeditor.app");
        assert!(stuck_at(moved, false));
    }

    #[test]
    fn a_copy_in_applications_is_not() {
        assert!(!stuck_at(Path::new("/Applications/nibeditor.app"), false));
        assert!(!stuck_at(
            Path::new("/Users/a/Applications/nibeditor.app"),
            false
        ));
    }

    #[test]
    fn the_moved_copy_starts_as_a_new_instance_once_this_one_has_gone() {
        let (wait, start) = RELAUNCH.split_once("done;").expect("a wait, then a start");
        assert!(wait.contains(r#"kill -0 "$1""#));
        assert!(start.trim_end().ends_with(r#"exec /usr/bin/open -n "$2""#));
    }
}
