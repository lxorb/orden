use serde::Serialize;
use tauri::Webview;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotUpdated {
    refused: bool,
    command: Option<String>,
    reason: String,
}

#[tauri::command]
pub async fn system_update(
    webview: Webview,
    channel: String,
    version: String,
) -> Result<(), NotUpdated> {
    through_the_system(webview, &channel, &version).await
}

#[cfg(target_os = "linux")]
use linux::update as through_the_system;

#[cfg(not(target_os = "linux"))]
fn through_the_system(_: Webview, _: &str, _: &str) -> std::future::Ready<Result<(), NotUpdated>> {
    std::future::ready(Err(NotUpdated {
        refused: false,
        command: None,
        reason: "only a Linux package is updated through the system".into(),
    }))
}

#[cfg(target_os = "linux")]
mod linux {
    use std::path::{Path, PathBuf};

    use tauri::utils::config::BundleType;
    use tauri::{Manager, Webview};
    use tauri_plugin_updater::UpdaterExt;

    use super::NotUpdated;
    use crate::packagekit::{Failure, Format, PackageKit};

    const PACKAGE: &str = "orden";

    const OURS: [&str; 2] = ["apt.orden.so", "rpm.orden.so"];

    const SOURCES: [&str; 4] = [
        "/etc/apt/sources.list.d",
        "/etc/yum.repos.d",
        "/etc/zypp/repos.d",
        "/etc/apt",
    ];

    pub async fn update(webview: Webview, channel: &str, version: &str) -> Result<(), NotUpdated> {
        let format = match tauri::utils::platform::bundle_type() {
            Some(BundleType::Deb) => Format::Deb,
            Some(BundleType::Rpm) => Format::Rpm,
            _ => {
                return Err(NotUpdated {
                    refused: false,
                    command: None,
                    reason: "this install is not a .deb or an .rpm".into(),
                })
            }
        };
        let zypper = Path::new("/usr/bin/zypper").exists();
        let told = command(
            format,
            zypper,
            SOURCES.iter().any(|folder| names_ours(Path::new(folder))),
            &release_url(version, std::env::consts::ARCH, format),
        );
        let not = |reason: String, refused: bool| NotUpdated {
            refused,
            command: (!refused).then(|| told.clone()),
            reason,
        };
        let failed = |failure: Failure| match failure {
            Failure::Absent => not("no PackageKit on this system".into(), false),
            Failure::Refused => not("the password was not given".into(), true),
            Failure::Failed(reason) => not(reason, false),
        };

        let wanted = version.to_owned();
        let from_repository = blocking(move || {
            PackageKit::system()?.update_from_repository(PACKAGE, &wanted, format)
        })
        .await
        .map_err(failed)?;
        if from_repository {
            return Ok(());
        }
        if format == Format::Rpm && zypper {
            return Err(not(
                "zypper installs no package file through PackageKit that it cannot verify".into(),
                false,
            ));
        }

        let (file, bytes) = fetched(&webview, channel, format)
            .await
            .map_err(|reason| not(reason, false))?;
        let folder = webview
            .app_handle()
            .path()
            .app_cache_dir()
            .map_err(|error| not(error.to_string(), false))?
            .join("update");
        let path = folder.join(file);
        std::fs::create_dir_all(&folder)
            .and_then(|()| std::fs::write(&path, bytes))
            .map_err(|error| not(format!("{}: {error}", path.display()), false))?;
        let installing = path.clone();
        let installed = blocking(move || PackageKit::system()?.install_file(&installing)).await;
        let _ = std::fs::remove_file(&path);
        installed.map_err(failed)
    }

    async fn blocking<T: Send + 'static>(
        work: impl FnOnce() -> Result<T, Failure> + Send + 'static,
    ) -> Result<T, Failure> {
        tauri::async_runtime::spawn_blocking(work)
            .await
            .map_err(|error| Failure::Failed(error.to_string()))?
    }

    async fn fetched(
        webview: &Webview,
        channel: &str,
        format: Format,
    ) -> Result<(PathBuf, Vec<u8>), String> {
        let mut builder = webview
            .updater_builder()
            .target(target(std::env::consts::ARCH, format));
        if let Some(endpoints) = crate::updates::endpoints(channel) {
            builder = builder
                .endpoints(endpoints)
                .map_err(|error| error.to_string())?;
        }
        let update = builder
            .build()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?
            .ok_or("no newer version on the channel")?;
        crate::updates::offered(channel, &update.version, update.download_url.as_str())?;
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        let file = format!("{PACKAGE}-{}.{}", update.version, extension(format));
        Ok((PathBuf::from(file), bytes))
    }

    pub(super) fn target(arch: &str, format: Format) -> String {
        format!("linux-{arch}-{}", extension(format))
    }

    fn extension(format: Format) -> &'static str {
        match format {
            Format::Deb => "deb",
            Format::Rpm => "rpm",
        }
    }

    pub(super) fn release_url(version: &str, arch: &str, format: Format) -> String {
        let tag = if version.contains('-') {
            "edge".to_owned()
        } else {
            format!("v{version}")
        };
        let label = if arch == "aarch64" { "arm64" } else { "x64" };
        format!(
            "https://github.com/lxorb/orden/releases/download/{tag}/Orden-{version}-linux-{label}.{}",
            extension(format)
        )
    }

    pub(super) fn command(format: Format, zypper: bool, repository: bool, url: &str) -> String {
        match (format, zypper, repository) {
            (Format::Rpm, true, true) => "sudo zypper refresh && sudo zypper update orden".into(),
            (Format::Rpm, false, true) => "sudo dnf upgrade --refresh orden".into(),
            (Format::Rpm, true, false) => format!("sudo zypper install {url}"),
            (Format::Rpm, false, false) => format!("sudo dnf install {url}"),
            (Format::Deb, _, true) => {
                "sudo apt update && sudo apt install --only-upgrade orden".into()
            }
            (Format::Deb, _, false) => {
                format!("curl -fLo /tmp/orden.deb {url} && sudo apt install /tmp/orden.deb")
            }
        }
    }

    pub(super) fn names_ours(folder: &Path) -> bool {
        let read = |path: &Path| {
            std::fs::read_to_string(path)
                .is_ok_and(|text| OURS.iter().any(|ours| text.contains(ours)))
        };
        if folder.is_file() {
            return read(folder);
        }
        std::fs::read_dir(folder).is_ok_and(|entries| {
            entries
                .filter_map(Result::ok)
                .any(|entry| entry.path().is_file() && read(&entry.path()))
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::linux::{command, names_ours, release_url, target};
    use crate::packagekit::Format;

    #[test]
    fn the_manifest_entry_is_the_systems_package() {
        assert_eq!(target("x86_64", Format::Rpm), "linux-x86_64-rpm");
        assert_eq!(target("aarch64", Format::Deb), "linux-aarch64-deb");
    }

    #[test]
    fn the_package_is_on_its_release_page_or_edges() {
        assert_eq!(
            release_url("0.20.0", "x86_64", Format::Rpm),
            "https://github.com/lxorb/orden/releases/download/v0.20.0/Orden-0.20.0-linux-x64.rpm"
        );
        assert_eq!(
            release_url("0.20.1-1200", "aarch64", Format::Deb),
            "https://github.com/lxorb/orden/releases/download/edge/Orden-0.20.1-1200-linux-arm64.deb"
        );
    }

    #[test]
    fn a_terminal_is_told_the_repositorys_update_or_the_package() {
        let url = "https://example.invalid/Orden-0.20.0-linux-x64.rpm";
        assert_eq!(
            command(Format::Rpm, false, true, url),
            "sudo dnf upgrade --refresh orden"
        );
        assert_eq!(
            command(Format::Rpm, true, true, url),
            "sudo zypper refresh && sudo zypper update orden"
        );
        assert_eq!(
            command(Format::Rpm, false, false, url),
            format!("sudo dnf install {url}")
        );
        assert_eq!(
            command(Format::Rpm, true, false, url),
            format!("sudo zypper install {url}")
        );
        assert_eq!(
            command(Format::Deb, false, true, url),
            "sudo apt update && sudo apt install --only-upgrade orden"
        );
        assert!(
            command(Format::Deb, false, false, url).ends_with("&& sudo apt install /tmp/orden.deb")
        );
    }

    #[test]
    fn a_repository_is_ours_by_its_address() {
        let folder = tempfile::tempdir().expect("a folder");
        assert!(!names_ours(folder.path()));
        std::fs::write(
            folder.path().join("fedora.repo"),
            "baseurl=https://fedora.example/",
        )
        .expect("a file");
        assert!(!names_ours(folder.path()));
        std::fs::write(
            folder.path().join("orden.repo"),
            "[orden]\nbaseurl=https://rpm.orden.so/stable\n",
        )
        .expect("a file");
        assert!(names_ours(folder.path()));
        assert!(names_ours(&folder.path().join("orden.repo")));
        assert!(!names_ours(&folder.path().join("missing")));
    }
}
