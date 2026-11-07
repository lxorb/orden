use std::path::Path;

use tauri::utils::config::BundleType;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Manager {
    Flatpak,
    Snap,
    Nix,
    Aur,
    Apt,
    Dnf,
    Scoop,
    Choco,
    Brew,
}

impl Manager {
    fn name(self) -> &'static str {
        match self {
            Self::Flatpak => "flatpak",
            Self::Snap => "snap",
            Self::Nix => "nix",
            Self::Aur => "aur",
            Self::Apt => "apt",
            Self::Dnf => "dnf",
            Self::Scoop => "scoop",
            Self::Choco => "choco",
            Self::Brew => "brew",
        }
    }
}

const PACKAGES: [&str; 2] = ["nib", "orden"];

const CASKROOMS: [&str; 2] = ["/opt/homebrew/Caskroom", "/usr/local/Caskroom"];

struct Install<'a> {
    os: &'a str,
    exe: &'a str,
    bundle: Option<BundleType>,
    env: &'a dyn Fn(&str) -> Option<String>,
    exists: &'a dyn Fn(&str) -> bool,
}

fn folded(path: &str) -> String {
    let path = path.strip_prefix(r"\\?\").unwrap_or(path);
    path.replace('\\', "/").to_lowercase()
}

fn under(path: &str, root: &str) -> bool {
    path.strip_prefix(root.trim_end_matches('/'))
        .is_some_and(|rest| rest.starts_with('/'))
}

fn kept_by(at: &Install) -> Option<Manager> {
    match at.os {
        "linux" => linux(at),
        "windows" => windows(at),
        "macos" => mac(at),
        _ => None,
    }
}

fn linux(at: &Install) -> Option<Manager> {
    if (at.exists)("/.flatpak-info") {
        return Some(Manager::Flatpak);
    }
    if (at.env)("SNAP").is_some_and(|snap| under(at.exe, &snap)) {
        return Some(Manager::Snap);
    }
    if under(at.exe, "/nix/store") {
        return Some(Manager::Nix);
    }
    match at.bundle {
        Some(BundleType::Deb) if (at.exists)("/var/lib/pacman") => Some(Manager::Aur),
        Some(BundleType::Deb) => Some(Manager::Apt),
        Some(BundleType::Rpm) => Some(Manager::Dnf),
        _ => None,
    }
}

fn windows(at: &Install) -> Option<Manager> {
    let exe = folded(at.exe);
    let scoop = ["SCOOP", "SCOOP_GLOBAL"]
        .iter()
        .filter_map(|name| (at.env)(name))
        .any(|root| {
            under(
                &exe,
                &format!("{}/apps", folded(&root).trim_end_matches('/')),
            )
        });
    if scoop || exe.contains("/scoop/apps/") {
        return Some(Manager::Scoop);
    }

    if at.bundle == Some(BundleType::Msi) {
        let root = (at.env)("ChocolateyInstall")
            .or_else(|| (at.env)("ProgramData").map(|data| format!(r"{data}\chocolatey")))?;
        let root = root.trim_end_matches('\\');
        if PACKAGES
            .iter()
            .any(|id| (at.exists)(&format!(r"{root}\lib\{id}")))
        {
            return Some(Manager::Choco);
        }
    }
    None
}

fn mac(at: &Install) -> Option<Manager> {
    CASKROOMS
        .iter()
        .any(|room| {
            PACKAGES
                .iter()
                .any(|cask| (at.exists)(&format!("{room}/{cask}")))
        })
        .then_some(Manager::Brew)
}

#[tauri::command(async)]
pub fn install_manager() -> Option<&'static str> {
    let exe = std::env::current_exe().ok()?;
    let env = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    let exists = |path: &str| Path::new(path).exists();

    kept_by(&Install {
        os: std::env::consts::OS,
        exe: &exe.to_string_lossy(),
        bundle: tauri::utils::platform::bundle_type(),
        env: &env,
        exists: &exists,
    })
    .map(Manager::name)
}

#[cfg(test)]
mod tests {
    use super::{kept_by, BundleType, Install, Manager};

    fn on(
        os: &str,
        exe: &str,
        bundle: Option<BundleType>,
        vars: &[(&str, &str)],
        paths: &[&str],
    ) -> Option<Manager> {
        let env = |name: &str| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        };
        let exists = |path: &str| paths.contains(&path);
        kept_by(&Install {
            os,
            exe,
            bundle,
            env: &env,
            exists: &exists,
        })
    }

    const DEB_EXE: &str = "/usr/bin/orden";

    #[test]
    fn an_appimage_updates_itself() {
        let exe = "/tmp/.mount_OrdenX/usr/bin/orden";
        let vars = [("APPIMAGE", "/home/a/Orden.AppImage")];
        assert_eq!(
            on("linux", exe, Some(BundleType::AppImage), &vars, &[]),
            None
        );
    }

    #[test]
    fn a_deb_is_apts_and_on_arch_the_aurs() {
        assert_eq!(
            on("linux", DEB_EXE, Some(BundleType::Deb), &[], &[]),
            Some(Manager::Apt)
        );
        assert_eq!(
            on(
                "linux",
                DEB_EXE,
                Some(BundleType::Deb),
                &[],
                &["/var/lib/pacman"]
            ),
            Some(Manager::Aur)
        );
    }

    #[test]
    fn an_rpm_is_dnfs() {
        assert_eq!(
            on("linux", DEB_EXE, Some(BundleType::Rpm), &[], &[]),
            Some(Manager::Dnf)
        );
    }

    #[test]
    fn a_flatpak_is_known_by_its_sandbox_whatever_the_bundle() {
        assert_eq!(
            on("linux", "/app/bin/nib", None, &[], &["/.flatpak-info"]),
            Some(Manager::Flatpak)
        );
    }

    #[test]
    fn a_snap_is_known_by_its_own_folder() {
        let vars = [("SNAP", "/snap/orden/12")];
        assert_eq!(
            on(
                "linux",
                "/snap/orden/12/usr/bin/orden",
                Some(BundleType::Deb),
                &vars,
                &[]
            ),
            Some(Manager::Snap)
        );
        let vars = [("SNAP", "/snap/code/200")];
        assert_eq!(
            on(
                "linux",
                "/tmp/.mount_x/usr/bin/orden",
                Some(BundleType::AppImage),
                &vars,
                &[]
            ),
            None
        );
    }

    #[test]
    fn the_nix_store_is_nixs_even_for_the_appimage_it_wraps() {
        let exe = "/nix/store/abc-orden-0.15.0-extracted/usr/bin/orden";
        let vars = [("APPIMAGE", "/nix/store/abc-orden.AppImage")];
        assert_eq!(
            on("linux", exe, Some(BundleType::AppImage), &vars, &[]),
            Some(Manager::Nix)
        );
        assert_eq!(on("linux", "/nix/storefront/nib", None, &[], &[]), None);
    }

    #[test]
    fn a_build_of_nobodys_updates_itself() {
        assert_eq!(
            on("linux", "/home/a/orden/target/debug/orden", None, &[], &[]),
            None
        );
    }

    #[test]
    fn scoop_is_known_by_where_it_unpacks() {
        let exe = r"C:\Users\A\scoop\apps\nib\current\nib.exe";
        assert_eq!(
            on("windows", exe, Some(BundleType::Nsis), &[], &[]),
            Some(Manager::Scoop)
        );
        let exe = r"\\?\D:\Tools\Apps\nib\0.15.0\nib.exe";
        let vars = [("SCOOP", r"D:\Tools\")];
        assert_eq!(
            on("windows", exe, Some(BundleType::Nsis), &vars, &[]),
            Some(Manager::Scoop)
        );
    }

    #[test]
    fn chocolatey_is_known_by_its_record_of_the_msi() {
        let exe = r"C:\Program Files\Orden\orden.exe";
        let vars = [("ChocolateyInstall", r"C:\ProgramData\chocolatey")];
        let record = [r"C:\ProgramData\chocolatey\lib\nib"];
        assert_eq!(
            on("windows", exe, Some(BundleType::Msi), &vars, &record),
            Some(Manager::Choco)
        );
        let vars = [("ProgramData", r"C:\ProgramData")];
        assert_eq!(
            on("windows", exe, Some(BundleType::Msi), &vars, &record),
            Some(Manager::Choco)
        );
        let exe = r"C:\Users\A\AppData\Local\Orden\orden.exe";
        assert_eq!(
            on("windows", exe, Some(BundleType::Nsis), &vars, &record),
            None
        );
    }

    #[test]
    fn a_downloaded_installer_updates_itself() {
        let vars = [("ChocolateyInstall", r"C:\ProgramData\chocolatey")];
        assert_eq!(
            on(
                "windows",
                r"C:\Program Files\Orden\orden.exe",
                Some(BundleType::Msi),
                &vars,
                &[]
            ),
            None
        );
        assert_eq!(
            on(
                "windows",
                r"C:\Users\A\AppData\Local\Orden\orden.exe",
                Some(BundleType::Nsis),
                &[],
                &[]
            ),
            None
        );
    }

    #[test]
    fn homebrew_is_known_by_its_caskroom() {
        let exe = "/Applications/Orden.app/Contents/MacOS/orden";
        for room in ["/opt/homebrew/Caskroom/orden", "/usr/local/Caskroom/nib"] {
            assert_eq!(
                on("macos", exe, Some(BundleType::App), &[], &[room]),
                Some(Manager::Brew),
                "{room}"
            );
        }
        assert_eq!(on("macos", exe, Some(BundleType::App), &[], &[]), None);
    }

    #[test]
    fn every_name_is_one_the_window_knows() {
        let names = [
            Manager::Flatpak,
            Manager::Snap,
            Manager::Nix,
            Manager::Aur,
            Manager::Apt,
            Manager::Dnf,
            Manager::Scoop,
            Manager::Choco,
            Manager::Brew,
        ]
        .map(Manager::name);
        assert_eq!(
            names,
            ["flatpak", "snap", "nix", "aur", "apt", "dnf", "scoop", "choco", "brew"]
        );
    }
}
