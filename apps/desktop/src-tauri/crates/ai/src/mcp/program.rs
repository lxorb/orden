use std::path::{Component, Path, PathBuf};

const STORE: &str = "/nix/store";
const NAME: &str = "orden";
const WRAPPED: &str = ".orden-wrapped";
const BUNDLE: &str = "Orden.app";
pub fn program() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("this program cannot find itself: {error}"))?;
    if !cfg!(target_os = "linux") {
        return Ok(exe);
    }
    let path: Vec<PathBuf> = std::env::var_os("PATH")
        .map_or_else(Vec::new, |path| std::env::split_paths(&path).collect());
    Ok(chosen(&exe, std::env::var_os("APPIMAGE").map(PathBuf::from), &path, |candidate| {
        std::fs::canonicalize(candidate).ok()
    }))
}
fn chosen(
    exe: &Path,
    appimage: Option<PathBuf>,
    path: &[PathBuf],
    resolve: impl Fn(&Path) -> Option<PathBuf>,
) -> PathBuf {
    if let Some(image) = appimage.filter(|one| one.has_root()) {
        return image;
    }
    let Some(copy) = store_copy(exe) else {
        return exe.to_owned();
    };
    let lasting = path
        .iter()
        .filter(|folder| folder.has_root() && !folder.starts_with(STORE))
        .map(|folder| folder.join(NAME))
        .find(|candidate| resolve(candidate).is_some_and(|target| target.starts_with(&copy)));
    lasting.unwrap_or_else(|| unwrapped(exe))
}
fn store_copy(exe: &Path) -> Option<PathBuf> {
    let inside = exe.strip_prefix(STORE).ok()?;
    let Some(Component::Normal(package)) = inside.components().next() else {
        return None;
    };
    Some(Path::new(STORE).join(package))
}
fn unwrapped(exe: &Path) -> PathBuf {
    exe.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix('.')?.strip_suffix("-wrapped"))
        .map_or_else(|| exe.to_owned(), |name| exe.with_file_name(name))
}
pub fn older_copy(command: &str, now: &Path) -> bool {
    let command = command.trim().trim_matches(|c| c == '"' || c == '\'');
    let path = Path::new(command);
    if path == now || command.is_empty() {
        return false;
    }
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let ours = name == NAME || name == WRAPPED;
    if let Some(copy) = store_copy(path) {
        let package = copy.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let named = package.split_once('-').is_some_and(|(_, rest)| rest.starts_with("orden-"));
        return named && ours;
    }
    if command.starts_with("/tmp/.mount_") {
        return command.ends_with("/usr/bin/orden");
    }
    let bundle = path
        .parent()
        .filter(|macos| macos.ends_with("Contents/MacOS"))
        .and_then(|macos| macos.parent()?.parent());
    if let Some(bundle) = bundle.filter(|_| ours) {
        let folder = bundle.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let lent = bundle.parent().and_then(Path::parent) == Some(Path::new("/Volumes"))
            || command.contains("/AppTranslocation/");
        return lent && folder == BUNDLE;
    }
    let lower = name.to_ascii_lowercase();
    lower.strip_suffix(".appimage").is_some_and(|stem| {
        stem.strip_prefix(NAME)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(['-', '_', '.']))
    })
}
pub fn command_in(said: &str) -> Option<&str> {
    said.lines().find_map(|line| {
        let line = line.trim();
        let (label, rest) = line.split_once(':')?;
        label.eq_ignore_ascii_case("command").then_some(rest.trim()).filter(|rest| !rest.is_empty())
    })
}
#[tauri::command(async)]
pub fn mcp_program(webview: tauri::Webview) -> Result<String, String> {
    orden_base::labels::from_the_app(&webview)?;
    program().map(|path| path.display().to_string())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_program_is_this_one_as_its_package_names_it() {
        let found = program().expect("a path");
        assert!(found.is_absolute());
        if !cfg!(target_os = "linux") {
            assert_eq!(found, std::env::current_exe().expect("this test"));
        }
        let deb = Path::new("/usr/bin/orden");
        assert_eq!(chosen(deb, None, &[PathBuf::from("/usr/bin")], links), deb);
    }
    const NOW: &str = "/nix/store/aaa-orden-0.15.0/bin/.orden-wrapped";
    fn links(candidate: &Path) -> Option<PathBuf> {
        match candidate.to_str()?.replace('\\', "/").as_str() {
            "/run/current-system/sw/bin/orden" => {
                Some(PathBuf::from("/nix/store/aaa-orden-0.15.0/bin/orden"))
            }
            "/home/e/.nix-profile/bin/orden" => {
                Some(PathBuf::from("/nix/store/zzz-orden-0.14.0/bin/orden"))
            }
            "/usr/bin/orden" => Some(PathBuf::from("/usr/bin/orden")),
            _ => None,
        }
    }
    #[test]
    fn an_appimage_is_named_and_never_its_mount() {
        let mount = Path::new("/tmp/.mount_OrdenX1/usr/bin/orden");
        let image = PathBuf::from("/home/e/Apps/Orden-0.15.0-linux-x64.AppImage");
        assert_eq!(chosen(mount, Some(image.clone()), &[], links), image);
        assert_eq!(chosen(mount, Some(PathBuf::from("Orden.AppImage")), &[], links), mount);
    }
    #[test]
    fn a_nix_copy_is_named_by_the_path_that_leads_to_it() {
        let path = [
            PathBuf::from("/home/e/.nix-profile/bin"),
            PathBuf::from("/nix/store/aaa-orden-0.15.0/bin"),
            PathBuf::from("/run/current-system/sw/bin"),
        ];
        assert_eq!(
            chosen(Path::new(NOW), None, &path, links),
            PathBuf::from("/run/current-system/sw/bin/orden")
        );
        assert_eq!(
            chosen(Path::new(NOW), None, &path[..2], links),
            PathBuf::from("/nix/store/aaa-orden-0.15.0/bin/orden")
        );
    }
    #[test]
    fn an_older_copy_of_this_app_is_known_and_nothing_else_is() {
        let now = Path::new("/run/current-system/sw/bin/orden");
        for older in [
            "/nix/store/zzz-orden-0.16.0/bin/.orden-wrapped",
            "/tmp/.mount_OrdenAb/usr/bin/orden",
            "/home/e/Apps/Orden-0.13.1-linux-x64.AppImage",
            "/opt/orden_0.12.AppImage",
            "\"/home/e/Apps/Orden.AppImage\"",
            "/Volumes/Orden/Orden.app/Contents/MacOS/orden",
            "/private/var/folders/x1/abc/T/AppTranslocation/7E2F-11AA/d/Orden.app/Contents/MacOS/orden",
        ] {
            assert!(older_copy(older, now), "{older}");
        }
        for theirs in [
            "/run/current-system/sw/bin/orden",
            "/nix/store/xxx-nodejs-22/bin/node",
            "/nix/store/xxx-ordenly-1.0/bin/orden",
            "/usr/bin/python3",
            "/home/e/Apps/Ordenly.AppImage",
            "/tmp/.mount_Other/usr/bin/other",
            "/Applications/Orden.app/Contents/MacOS/orden",
            "/Volumes/Orden/Other.app/Contents/MacOS/orden",
            "/Volumes/Disk/Apps/Orden.app/Contents/MacOS/orden",
            "/Volumes/Orden/Orden.app/Contents/MacOS/other",
            "/Applications/Ordenly.app/Contents/MacOS/orden",
            "",
        ] {
            assert!(!older_copy(theirs, now), "{theirs}");
        }
    }
    #[test]
    fn the_command_is_read_off_either_client_s_description() {
        let claude =
            "orden:\n  Scope: User config\n  Type: stdio\n  Command: /usr/bin/orden\n  Args: mcp\n";
        assert_eq!(command_in(claude), Some("/usr/bin/orden"));
        let codex = "orden\n  enabled: true\n  transport: stdio\n  command: /nix/store/a-orden-1/bin/orden\n  args: mcp\n";
        assert_eq!(command_in(codex), Some("/nix/store/a-orden-1/bin/orden"));
        assert_eq!(command_in("nothing here"), None);
    }
}
