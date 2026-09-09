//! Which stream of releases an install follows, and the look for a new version on
//! it.
//!
//! Two streams come out of the repository; see `.github/workflows/release.yml`. A
//! tag `v*` is a release proper, and every push to main is a build as well, on one
//! rolling pre-release named `edge`. The releases are what an install follows: they
//! are the endpoint in `tauri.conf.json`, which is what the updater is built with
//! when nothing here says otherwise. The rolling build is the other choice, and
//! this module is the only place that knows where it lives.
//!
//! The look is here rather than on the window side because the plugin's `check()`
//! in JavaScript takes no endpoints: it reads the whole list from the
//! configuration and stops at the first manifest it can parse, so a window cannot
//! choose between two. The builder in Rust does take them. Everything after the
//! look is the plugin's again - the window is handed the same resource id the
//! plugin's own `check` would have handed it, and downloads and installs through
//! the plugin's own commands.

use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

/// The channel that follows every push to main, and the name the window asks for
/// it by.
const UNSTABLE: &str = "unstable";

/// The manifest of the rolling build of main, remade by every push.
///
/// The releases' own manifest is in `tauri.conf.json` rather than beside this: it
/// is what the updater falls back to when no endpoint is given, so the stable
/// stream is the app's configuration itself instead of a second copy of it that
/// could drift from it.
const EDGE: &str = "https://github.com/lxorb/nibeditor/releases/download/edge/latest.json";

/// What the window is told about a new version: the fields the updater plugin's
/// own `Update` is built from on that side.
///
/// The date and the release notes are left out because nothing shows them, and
/// formatting a date would cost a dependency for a field nobody reads. The
/// manifest is passed on whole, the way the plugin's own `check` passes it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// The update itself, which stays on this side; the download and the install
    /// name it.
    rid: ResourceId,
    /// The version running now.
    current_version: String,
    /// The version that was found.
    version: String,
    /// The manifest as it was served.
    raw_json: serde_json::Value,
}

/// Where a channel looks, or `None` for the endpoint the app is configured with.
///
/// Anything the app has not heard of is the stable stream: following the releases
/// is the only safe answer to a value nobody wrote, and it is where every install
/// starts. A constant that did not parse would read as stable too, which is why
/// the tests below parse it.
fn endpoints(channel: &str) -> Option<Vec<Url>> {
    if channel != UNSTABLE {
        return None;
    }

    Url::parse(EDGE).ok().map(|url| vec![url])
}

/// Looks for a new version on the channel this machine follows, and answers
/// nothing when there is none.
///
/// Only ever a higher version, whichever channel was asked for: the plugin
/// compares semver and offers nothing at or below what is installed. That is what
/// keeps a machine which has just left the rolling stream from being handed an
/// older release as an update - a build of main is numbered one patch past the
/// newest tag with a pre-release number, so `0.6.1-84` sits above `0.6.0` and
/// below `0.6.1` and stays where it is until a release passes it. See
/// `scripts/build-version.sh`.
#[tauri::command]
pub async fn check_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
) -> Result<Option<Found>, String> {
    let mut builder = webview.updater_builder();

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

    Ok(Some(Found {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        raw_json: update.raw_json.clone(),
        // Last, because it hands the update itself over to the table.
        rid: webview.resources_table().add(update),
    }))
}

#[cfg(test)]
mod tests {
    use super::{endpoints, EDGE, UNSTABLE};
    use tauri::Url;

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

    /// A manifest served over anything but https is refused in a release build,
    /// which would be a channel that silently never finds anything.
    #[test]
    fn the_rolling_manifest_is_served_over_https() {
        let url = Url::parse(EDGE).expect("the manifest url parses");

        assert_eq!(url.scheme(), "https");
        assert!(url.path().ends_with("latest.json"));
    }

    /// The two channels are two endpoints. A configuration that listed the rolling
    /// manifest as well would follow it whatever the window asked for, since the
    /// updater takes the first endpoint that answers.
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
}
