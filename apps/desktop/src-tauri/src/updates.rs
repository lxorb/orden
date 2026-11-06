use serde::Serialize;
use tauri::{Manager, ResourceId, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

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
        return Err(format!(
            "that version is not served from {}",
            RELEASES.join(" or ")
        ));
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
    let mut builder = webview
        .updater_builder()
        .on_before_exit(move || crate::lifecycle::before_installer(&app, &label));

    if let Some(endpoints) = endpoints(&channel) {
        builder = builder
            .endpoints(endpoints)
            .map_err(|error| format!("could not follow the {channel} channel: {error}"))?;
    }

    let updater = builder
        .build()
        .map_err(|error| format!("could not ask for a new version: {error}"))?;

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
    use super::{endpoints, offered, EDGE, PREFIXES, RELEASES, UNSTABLE};
    use tauri::Url;

    fn bundle(version: &str) -> String {
        format!(
            "{}v{version}/Nib-{version}-windows-x64-setup.exe",
            RELEASES[0]
        )
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
            "https://evil.example/Nib-99.0.0-windows-x64-setup.exe",
            "http://github.com/lxorb/nibeditor/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com/someone/else/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com.evil.example/lxorb/nibeditor/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "http://github.com/lxorb/orden/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com.evil.example/lxorb/orden/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com/lxorb/ordenx/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
            "https://github.com/lxorb/orden.evil.example/releases/download/v99.0.0/Nib-99.0.0-windows-x64-setup.exe",
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

        assert_eq!(
            looked,
            vec![Url::parse(EDGE).expect("the manifest url parses")]
        );
    }

    #[test]
    fn the_stable_channel_follows_the_endpoint_the_app_is_configured_with() {
        assert!(endpoints("stable").is_none());
    }

    #[test]
    fn anything_nobody_wrote_is_stable() {
        for channel in ["", "STABLE", "Unstable", "beta", "main"] {
            assert!(
                endpoints(channel).is_none(),
                "{channel} should follow the releases"
            );
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
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the config parses");
        let configured = config["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("the updater is configured with endpoints");

        assert_eq!(configured.len(), 1);
        assert_ne!(configured[0].as_str(), Some(EDGE));
    }

    #[test]
    fn both_manifests_are_asked_for_under_the_new_name() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the config parses");
        assert_eq!(
            config["plugins"]["updater"]["endpoints"][0].as_str(),
            Some("https://github.com/lxorb/orden/releases/latest/download/latest.json")
        );
        assert!(EDGE.starts_with(RELEASES[1]));
    }
}
