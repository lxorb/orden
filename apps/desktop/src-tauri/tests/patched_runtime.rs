use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("linux/tauri-runtime-cef")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("{} is not there: {error}", path.display()))
        .replace("\r\n", "\n")
}

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
    let process = read(&root().join("src/cef_impl/client/process.rs"));
    assert!(process.contains("fn default_client(&self) -> Option<Client>"));
    let unhosted = read(&root().join("src/cef_impl/client/unhosted.rs"));
    assert!(unhosted.contains("host.close_browser(1);"));
}

#[test]
fn a_tab_chrome_s_own_ui_opens_is_handed_over_before_it_is_closed() {
    let process = read(&root().join("src/cef_impl/client/process.rs"));
    assert!(process.contains("super::unhosted::client(self.unhosted_tab_handler.clone())"));
    let unhosted = read(&root().join("src/cef_impl/client/unhosted.rs"));
    let browsing = unhosted
        .find("fn on_before_browse(")
        .expect("its first navigation is heard");
    let handing = unhosted
        .find("handler(url);")
        .expect("the address is handed over");
    let closing = unhosted
        .find("host.close_browser(1);")
        .expect("the browser is closed");
    assert!(browsing < handing && handing < closing);
    assert!(unhosted.contains("crate::platform::linux::put_out_of_sight(host.window_handle());"));
    let runtime = read(&root().join("src/runtime.rs"));
    assert!(runtime.contains("pub fn on_unhosted_tab<F>(mut self, handler: F) -> Self"));
    let engine = read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine.rs"));
    assert!(engine.contains(".on_unhosted_tab(crate::extensions::tabs::opened)"));
}

#[test]
fn the_eval_observer_never_lets_go_of_its_own_registration_from_inside_its_callback() {
    let source = read(&root().join("src/webview.rs"));
    let start = source
        .find("struct EvalScriptWithCallbackDevToolsObserver")
        .expect("the eval observer");
    let body = &source[start..];
    let end = body.find("\n}\n").expect("the observer's end");
    let observer = &body[..end];
    assert!(
        !observer.contains("self.registration.lock().unwrap().take()"),
        "the observer drops the registration that keeps it alive while it is still running"
    );
    assert!(
        observer.contains("LetGoOfRegistrationTask::new(self.registration.clone())")
            && observer.contains("cef::post_task("),
        "the registration is let go of by a task on the UI thread, after the callback returned"
    );
    assert!(source.contains("struct LetGoOfRegistrationTask"));
}
