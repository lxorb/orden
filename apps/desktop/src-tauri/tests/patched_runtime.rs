//! The copy of `tauri-runtime-cef` Linux builds from (linux/tauri-runtime-cef), read as
//! text: whatever it asks for an X window, a missing one is never a crash (#1085).
//!
//! A web tab's browser being closed has no X window left - CEF destroys it before the
//! browser is gone - and the crate asserted there was one: a placement, a show or a hide
//! that reached the browser as it closed stopped the app, and made the step of the sway
//! drive that closes web tabs one after another fail now and then. The crate's own
//! `known` is where every X window it asks for is read through, and none of them may be
//! unwrapped, expected or asserted. Read on every platform, since it is a file like any
//! other; built only on Linux.

use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("linux/tauri-runtime-cef")
}

/// A file of the tree as text, with Windows' line ends made `\n` as a checkout there may
/// write them.
fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("{} is not there: {error}", path.display()))
        .replace("\r\n", "\n")
}

/// Each Rust file of the crate's Linux platform code, with the tests at its end left out.
fn linux_sources() -> Vec<(PathBuf, String)> {
    let folder = root().join("src/platform/linux");
    let mut found: Vec<(PathBuf, String)> = fs::read_dir(&folder)
        .expect("the patched crate's Linux code is in the tree")
        .filter_map(Result::ok)
        .map(|one| one.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .map(|path| {
            let text = read(&path);
            let code = text
                .split("#[cfg(test)]")
                .next()
                .unwrap_or_default()
                .to_owned();
            (path, code)
        })
        .collect();
    found.sort();
    found
}

#[test]
fn no_x_window_asked_for_is_asserted_expected_or_unwrapped() {
    let sources = linux_sources();
    assert!(sources.len() >= 5, "the Linux platform code: {sources:?}");
    for (path, code) in &sources {
        for (number, line) in code.lines().enumerate() {
            let at = format!("{}:{}", path.display(), number + 1);
            let asks = line.contains("window_handle()") || line.contains("xid");
            if !asks {
                continue;
            }
            for crash in ["assert", "expect(", "unwrap()", "panic!"] {
                assert!(
                    !line.contains(crash),
                    "{at} crashes on a missing X window: {line}"
                );
            }
            if line.contains("window_handle()") {
                assert!(
                    line.contains("known(") || line.contains(".ok()"),
                    "{at} reads an X window without asking whether there is one: {line}"
                );
            }
        }
    }
}

#[test]
fn the_browsers_window_is_read_through_one_place() {
    let webview = read(&root().join("src/platform/linux/webview.rs"));
    let code = webview.split("#[cfg(test)]").next().unwrap_or_default();
    // Once in `xid`, and nowhere else: every caller asks `xid` and does nothing on `None`.
    assert_eq!(code.matches("self.host.window_handle()").count(), 1);
    assert!(code.contains("fn xid(&self) -> Option<xlib::Window>"));
}

#[test]
fn linux_builds_the_patched_copy_at_the_pinned_version() {
    let app = Path::new(env!("CARGO_MANIFEST_DIR"));
    let linux = read(&app.join("linux/Cargo.toml"));
    assert!(linux.contains("\n[patch.crates-io]\n"));
    assert!(linux.contains("\ntauri-runtime-cef = { path = \"linux/tauri-runtime-cef\" }\n"));

    let pinned = linux
        .lines()
        .find_map(|line| {
            line.strip_prefix("tauri-runtime-cef = { version = \"=")
                .and_then(|rest| rest.split('"').next())
        })
        .expect("Linux's manifest pins tauri-runtime-cef");
    let copy = read(&root().join("Cargo.toml"));
    assert!(
        copy.contains(&format!("\nversion = \"{pinned}\"\n")),
        "the copy is not tauri-runtime-cef {pinned}: move it with the pin"
    );
}

/// #1148: a sign-in's popup, and an extension's tab, were Chromium's whole window, tab
/// strip, address bar and "Sign in to Chromium?" and all, which a desktop showed as
/// Chromium; and every window GTK made carried no `WM_CLASS`, so no desktop could put it
/// under Orden's name and icon.
#[test]
fn every_window_is_orden_s_and_none_chromium_s() {
    let runtime = read(&root().join("src/runtime.rs"));
    assert!(runtime.contains("use_views_default_popup: 1,"));
    let named = runtime
        .find("crate::platform::linux::name_windows();")
        .expect("the runtime names its windows");
    let built = runtime
        .find("event_loop_builder\n      .build()")
        .expect("the runtime builds its event loop");
    assert!(named < built, "the windows are named after GTK starts");

    let class = read(&root().join("src/platform/linux/class.rs"));
    assert!(class.contains("gtk::glib::set_prgname("));
    assert!(class.contains("\"CHROME_DESKTOP\""));
    assert!(class.contains("(xlib.XSetClassHint)("));
    let popup = read(&root().join("src/popup.rs"));
    assert!(popup.contains("crate::platform::linux::name_popup(host.window_handle());"));
    // And a window Chrome's own UI opens - an extension's tab - is closed, never shown.
    let process = read(&root().join("src/cef_impl/client/process.rs"));
    assert!(process.contains("fn default_client(&self) -> Option<Client>"));
    let unhosted = read(&root().join("src/cef_impl/client/unhosted.rs"));
    assert!(unhosted.contains("host.close_browser(1);"));
}
