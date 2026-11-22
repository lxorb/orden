use serde::Serialize;
use tauri::{Manager, ResourceId, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

pub struct Lifecycle {
    pub quit: fn(&tauri::AppHandle),
    pub before_installer: fn(&tauri::AppHandle, &str),
}
static LIFECYCLE: std::sync::OnceLock<Lifecycle> = std::sync::OnceLock::new();
pub fn hand_lifecycle(lifecycle: Lifecycle) {
    let _ = LIFECYCLE.set(lifecycle);
}
pub(crate) fn lifecycle() -> Option<&'static Lifecycle> {
    LIFECYCLE.get()
}
const UNSTABLE: &str = "unstable";
const EDGE: &str = "https://github.com/lxorb/orden/releases/download/edge/latest.json";
const RELEASES: [&str; 2] = [
    "https://github.com/lxorb/nibeditor/releases/download/",
    "https://github.com/lxorb/orden/releases/download/",
];
pub(crate) fn offered(channel: &str, version: &str, download: &str) -> Result<(), String> {
    let Some(file) = RELEASES
        .iter()
        .find_map(|releases| download.strip_prefix(releases))
        .and_then(|rest| rest.rsplit('/').next())
    else {
        return Err(format!("that version is not served from {}", RELEASES.join(" or ")));
    };
    if version.is_empty() || !names(file, version) {
        return Err(format!("{file} is not version {version}"));
    }
    if channel != UNSTABLE && version.contains('-') {
        return Err(format!("{version} is a build of main, not a release"));
    }
    Ok(())
}
const PREFIXES: [&str; 3] = ["Nib-", "nibeditor-", "Orden-"];
fn names(file: &str, version: &str) -> bool {
    PREFIXES.iter().any(|prefix| {
        file.strip_prefix(prefix)
            .and_then(|rest| rest.strip_prefix(version))
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(|platform| platform.starts_with(|first: char| first.is_ascii_alphabetic()))
    })
}
fn moved_target(os: &str, built: &str, native: Option<&str>) -> Option<String> {
    let native = native?;
    let moves = matches!(os, "windows" | "darwin") && built == "x86_64" && native == "aarch64";
    moves.then(|| format!("{os}-{native}"))
}
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
fn native_arch() -> Option<&'static str> {
    use windows::Win32::System::SystemInformation::{
        IMAGE_FILE_MACHINE, IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_ARM64,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, IsWow64Process2};
    let (mut process, mut native) = (IMAGE_FILE_MACHINE(0), IMAGE_FILE_MACHINE(0));
    unsafe { IsWow64Process2(GetCurrentProcess(), &raw mut process, Some(&raw mut native)) }
        .ok()?;
    match native {
        IMAGE_FILE_MACHINE_ARM64 => Some("aarch64"),
        IMAGE_FILE_MACHINE_AMD64 => Some("x86_64"),
        _ => None,
    }
}
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn native_arch() -> Option<&'static str> {
    let mut translated: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let read = unsafe {
        libc::sysctlbyname(
            c"sysctl.proc_translated".as_ptr(),
            (&raw mut translated).cast(),
            &raw mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    match (read, translated) {
        (0, 1) => Some("aarch64"),
        (0, _) => Some(std::env::consts::ARCH),
        _ => None,
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn native_arch() -> Option<&'static str> {
    None
}
fn machine_target() -> Option<String> {
    let os = if cfg!(target_os = "macos") { "darwin" } else { std::env::consts::OS };
    moved_target(os, std::env::consts::ARCH, native_arch())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    rid: ResourceId,
    current_version: String,
    version: String,
    raw_json: serde_json::Value,
}
pub(crate) fn endpoints(channel: &str) -> Option<Vec<Url>> {
    if channel != UNSTABLE {
        return None;
    }
    Url::parse(EDGE).ok().map(|url| vec![url])
}
#[tauri::command]
pub async fn check_update(webview: Webview, channel: String) -> Result<Option<Found>, String> {
    let (app, label) = (webview.app_handle().clone(), webview.label().to_owned());
    let mut builder = webview.updater_builder().on_before_exit(move || {
        if let Some(lifecycle) = lifecycle() {
            (lifecycle.before_installer)(&app, &label);
        }
    });
    if let Some(target) = machine_target() {
        builder = builder.target(target);
    }
    if let Some(endpoints) = endpoints(&channel) {
        builder = builder
            .endpoints(endpoints)
            .map_err(|error| format!("could not follow the {channel} channel: {error}"))?;
    }
    let updater =
        builder.build().map_err(|error| format!("could not ask for a new version: {error}"))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("could not look for a new version: {error}"))?
    else {
        return Ok(None);
    };
    offered(&channel, &update.version, update.download_url.as_str())?;
    Ok(Some(Found {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}
#[cfg(test)]
mod tests {
    use super::{endpoints, moved_target, offered, EDGE, PREFIXES, RELEASES, UNSTABLE};
    use tauri::Url;

    fn bundle(version: &str) -> String {
        format!("{}v{version}/Orden-{version}-windows-x64-setup.exe", RELEASES[1])
    }
    #[test]
    fn a_release_that_says_what_it_serves_is_installed() {
        assert_eq!(offered("stable", "0.9.0", &bundle("0.9.0")), Ok(()));
    }
    #[test]
    fn a_build_of_main_is_installed_on_the_channel_that_follows_main() {
        assert_eq!(offered(UNSTABLE, "0.8.1-421", &bundle("0.8.1-421")), Ok(()));
        assert!(offered("stable", "0.8.1-421", &bundle("0.8.1-421")).is_err());
    }
    #[test]
    fn a_version_the_file_is_not_is_no_update() {
        assert!(offered("stable", "99.0.0", &bundle("0.5.0")).is_err());
        assert!(offered(UNSTABLE, "99.0.0", &bundle("0.5.0")).is_err());
    }
    #[test]
    fn a_file_from_anywhere_else_is_no_update() {
        for address in [
            "https://evil.example/Orden-99.0.0-windows-x64-setup.exe",
            "http://github.com/lxorb/nibeditor/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
            "https://github.com/someone/else/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
            "https://github.com.evil.example/lxorb/nibeditor/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
            "http://github.com/lxorb/orden/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
            "https://github.com.evil.example/lxorb/orden/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
            "https://github.com/lxorb/ordenx/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
            "https://github.com/lxorb/orden.evil.example/releases/download/v99.0.0/Orden-99.0.0-windows-x64-setup.exe",
        ] {
            assert!(
                offered("stable", "99.0.0", address).is_err(),
                "{address} should not be an update"
            );
        }
    }
    #[test]
    fn a_version_is_the_whole_version_in_the_name() {
        assert!(offered("stable", "0.1", &bundle("0.10.0")).is_err());
        assert!(offered("stable", "0.1", &bundle("0.1.0")).is_err());
        assert!(offered("stable", "0.10", &bundle("0.10.0")).is_err());
        assert!(offered("stable", "10.0", &bundle("0.10.0")).is_err());
        assert_eq!(offered("stable", "0.10.0", &bundle("0.10.0")), Ok(()));
    }
    #[test]
    fn a_release_is_not_the_build_of_main_before_it() {
        assert!(offered("stable", "0.8.1", &bundle("0.8.1-421")).is_err());
        assert!(offered(UNSTABLE, "0.8.1", &bundle("0.8.1-421")).is_err());
        assert!(offered(UNSTABLE, "0.8.1-42", &bundle("0.8.1-421")).is_err());
        assert_eq!(offered(UNSTABLE, "0.8.1-421", &bundle("0.8.1-421")), Ok(()));
    }
    #[test]
    fn every_platform_the_updater_serves_is_named_the_same_way() {
        for platform in [
            "windows-x64-setup.exe",
            "windows-arm64-setup.exe",
            "linux-x64.AppImage",
            "linux-arm64.AppImage",
            "macos-universal.app.tar.gz",
        ] {
            for releases in RELEASES {
                for prefix in PREFIXES {
                    let address = format!("{releases}v0.9.0/{prefix}0.9.0-{platform}");
                    assert_eq!(offered("stable", "0.9.0", &address), Ok(()), "{address}");
                }
            }
        }
    }
    #[test]
    fn a_bundle_is_named_by_either_name_and_nothing_else() {
        for file in [
            "nib-0.9.0-windows-x64-setup.exe",
            "Nibeditor0.9.0-windows-x64-setup.exe",
            "evil-nibeditor-0.9.0-windows-x64-setup.exe",
            "nibeditor-0.9.0windows-x64-setup.exe",
            "orden-0.9.0-windows-x64-setup.exe",
            "Orden0.9.0-windows-x64-setup.exe",
            "evil-Orden-0.9.0-windows-x64-setup.exe",
        ] {
            let address = format!("{}v0.9.0/{file}", RELEASES[1]);
            assert!(offered("stable", "0.9.0", &address).is_err(), "{file}");
        }
    }
    #[test]
    fn a_manifest_that_names_no_version_is_no_update() {
        assert!(offered("stable", "", &bundle("0.9.0")).is_err());
    }
    #[test]
    fn the_unstable_channel_follows_the_rolling_build_of_main() {
        let looked = endpoints(UNSTABLE).expect("the unstable channel has an endpoint of its own");
        assert_eq!(looked, vec![Url::parse(EDGE).expect("the manifest url parses")]);
    }
    #[test]
    fn the_stable_channel_follows_the_endpoint_the_app_is_configured_with() {
        assert!(endpoints("stable").is_none());
    }
    #[test]
    fn anything_nobody_wrote_is_stable() {
        for channel in ["", "STABLE", "Unstable", "beta", "main"] {
            assert!(endpoints(channel).is_none(), "{channel} should follow the releases");
        }
    }
    #[test]
    fn the_rolling_manifest_is_served_over_https() {
        let url = Url::parse(EDGE).expect("the manifest url parses");
        assert_eq!(url.scheme(), "https");
        assert!(url.path().ends_with("latest.json"));
    }
    #[test]
    fn the_configured_endpoint_is_the_releases_one() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../tauri.conf.json"))
                .expect("the config parses");
        let configured = config["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("the updater is configured with endpoints");
        assert_eq!(configured.len(), 1);
        assert_ne!(configured[0].as_str(), Some(EDGE));
    }
    #[test]
    fn both_manifests_are_asked_for_under_the_new_name() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../tauri.conf.json"))
                .expect("the config parses");
        assert_eq!(
            config["plugins"]["updater"]["endpoints"][0].as_str(),
            Some("https://github.com/lxorb/orden/releases/latest/download/latest.json")
        );
        assert!(EDGE.starts_with(RELEASES[1]));
    }
    #[test]
    fn an_x64_install_on_an_arm_machine_takes_the_arm_build() {
        assert_eq!(
            moved_target("windows", "x86_64", Some("aarch64")).as_deref(),
            Some("windows-aarch64")
        );
        assert_eq!(
            moved_target("darwin", "x86_64", Some("aarch64")).as_deref(),
            Some("darwin-aarch64")
        );
    }
    #[test]
    fn an_install_built_for_its_machine_keeps_the_updater_s_own_choice() {
        for (os, built, native) in [
            ("windows", "x86_64", Some("x86_64")),
            ("windows", "aarch64", Some("aarch64")),
            ("darwin", "aarch64", Some("aarch64")),
            ("darwin", "x86_64", Some("x86_64")),
            ("windows", "x86_64", None),
            ("linux", "x86_64", Some("aarch64")),
            ("windows", "aarch64", Some("x86_64")),
        ] {
            assert_eq!(moved_target(os, built, native), None, "{os} {built} {native:?}");
        }
    }
    #[test]
    fn the_arm_builds_are_in_the_manifest_under_the_names_the_updater_asks_for() {
        let manifest = include_str!("../../../../../../scripts/update-manifest.mjs");
        for key in ["windows-aarch64", "darwin-aarch64"] {
            assert!(manifest.contains(&format!("'{key}'")), "{key}");
        }
    }
}
