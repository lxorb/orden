use std::path::{Path, PathBuf};

const OLD: [&str; 2] = ["Nib.app", "nibeditor.app"];
const NEW: &str = "Orden.app";

#[cfg_attr(
    not(target_os = "macos"),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
const CASKROOMS: [&str; 4] = [
    "/opt/homebrew/Caskroom/nib",
    "/usr/local/Caskroom/nib",
    "/opt/homebrew/Caskroom/orden",
    "/usr/local/Caskroom/orden",
];

#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
fn renamed(exe: &Path) -> Option<(PathBuf, PathBuf)> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let named = |path: &Path, name: &str| path.file_name().is_some_and(|own| own == name);

    (named(macos, "MacOS")
        && named(contents, "Contents")
        && OLD.iter().any(|old| named(bundle, old)))
    .then(|| (bundle.to_path_buf(), bundle.with_file_name(NEW)))
}

#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
const RELAUNCH: &str = r#"while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 0.1; done; /bin/sleep 0.5; exec /usr/bin/open -n "$2""#;

#[cfg_attr(
    not(any(target_os = "macos", test)),
    allow(dead_code, reason = "only a Mac keeps the app in a folder of its own")
)]
fn brewed(rooms: &[&str]) -> bool {
    rooms.iter().any(|room| Path::new(room).exists())
}

#[cfg(target_os = "macos")]
pub fn carry_over() {
    use std::os::unix::process::CommandExt as _;
    use std::process::{Command, Stdio};

    if env!("ORDEN_IDENTIFIER") != "so.orden.Orden" {
        return;
    }
    let Some((from, to)) = std::env::current_exe().ok().and_then(|exe| renamed(&exe)) else {
        return;
    };
    if to.exists() || brewed(&CASKROOMS) || std::fs::rename(&from, &to).is_err() {
        return;
    }

    let started = Command::new("/bin/sh")
        .args(["-c", RELAUNCH, "sh"])
        .arg(std::process::id().to_string())
        .arg(&to)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
    if started.is_ok() {
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::{brewed, renamed, CASKROOMS, NEW, OLD, RELAUNCH};
    use std::path::{Path, PathBuf};

    #[test]
    fn the_program_inside_either_old_folder_is_moved_to_the_new_one() {
        for old in OLD {
            let (from, to) = renamed(
                &Path::new("/Applications")
                    .join(old)
                    .join("Contents/MacOS/nib"),
            )
            .expect("renamed");
            assert_eq!(from, Path::new("/Applications").join(old));
            assert_eq!(to, PathBuf::from("/Applications/Orden.app"));

            let (_, to) = renamed(
                &Path::new("/Users/a/Apps")
                    .join(old)
                    .join("Contents/MacOS/nib"),
            )
            .expect("anywhere a folder is");
            assert_eq!(to, PathBuf::from("/Users/a/Apps/Orden.app"));
        }
    }

    #[test]
    fn anything_else_keeps_its_name() {
        for exe in [
            "/Applications/Orden.app/Contents/MacOS/orden",
            "/Applications/Nib Copy.app/Contents/MacOS/nib",
            "/Applications/nibeditor 2.app/Contents/MacOS/nib",
            "/Applications/Nib.app/Contents/Resources/nib",
            "/Applications/nibeditor.app/Contents/Resources/nib",
            "/Users/a/code/nib/target/release/orden",
            "nib",
        ] {
            assert_eq!(renamed(Path::new(exe)), None, "{exe}");
        }
    }

    #[test]
    fn a_cask_in_either_home_is_homebrews() {
        let dir = std::env::temp_dir().join(format!("nib-caskroom-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a caskroom");
        let here = dir.to_string_lossy().into_owned();

        assert!(brewed(&["/nowhere/Caskroom/nib", &here]));
        assert!(!brewed(&["/nowhere/Caskroom/nib", "/nowhere/either"]));
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn the_app_starts_again_as_a_new_instance_once_this_one_has_gone() {
        let (wait, start) = RELAUNCH.split_once("done;").expect("a wait, then a start");
        assert!(wait.contains(r#"kill -0 "$1""#));
        assert!(start.trim_end().ends_with(r#"exec /usr/bin/open -n "$2""#));
    }

    #[test]
    fn the_cask_is_looked_for_under_both_tokens() {
        for token in ["nib", "orden"] {
            for home in ["/opt/homebrew", "/usr/local"] {
                let room = format!("{home}/Caskroom/{token}");
                assert!(CASKROOMS.contains(&room.as_str()), "{room}");
            }
        }
    }

    #[test]
    fn the_new_folder_is_the_product_s_name() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the config parses");
        let product = config["productName"].as_str().expect("a product name");
        assert_eq!(NEW, format!("{product}.app"));
        assert!(!OLD.contains(&NEW));
    }
}
