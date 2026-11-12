use std::path::Path;

pub type Switch = (String, Option<String>);

pub const ENGINE_SWIPE: (&str, &str, &str) = (
    "TouchpadOverscrollHistoryNavigation",
    "overscroll-history-navigation",
    "0",
);

pub const LOAD_EXTENSION_OFF: &str = "DisableLoadExtensionCommandLineSwitch";

pub const LOAD_EXTENSION: &str = "load-extension";

#[must_use]
pub fn overlay_scrollbars() -> Option<&'static str> {
    if cfg!(target_os = "linux") {
        Some("OverlayScrollbar")
    } else if cfg!(windows) {
        Some("FluentOverlayScrollbar")
    } else {
        None
    }
}

#[must_use]
pub fn switches(written: &str) -> Vec<Switch> {
    written
        .split(',')
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(|one| match one.split_once('=') {
            Some((key, value)) => (key.to_owned(), Some(value.to_owned())),
            None => (format!("--{}", one.trim_start_matches('-')), None),
        })
        .collect()
}

pub fn with_extensions(asked: &mut Vec<Switch>, folders: &[impl AsRef<Path>]) -> bool {
    let ours: Vec<String> = folders
        .iter()
        .map(|folder| folder.as_ref().to_string_lossy().into_owned())
        .collect();
    if let Some((_, value)) = asked
        .iter_mut()
        .find(|(key, _)| key.trim_start_matches('-') == LOAD_EXTENSION)
    {
        let mut all: Vec<String> = value.iter().cloned().collect();
        all.extend(ours);
        *value = Some(all.join(","));
        return true;
    }
    if ours.is_empty() {
        return false;
    }
    asked.push((LOAD_EXTENSION.to_owned(), Some(ours.join(","))));
    true
}

#[must_use]
pub fn from_run(drive: bool, name: &str) -> Option<String> {
    drive.then(|| std::env::var(name).ok()).flatten()
}
