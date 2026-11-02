//! placeholder until the fix: every context
const DEV_ORIGIN: &str = "http://localhost:1420";
pub(crate) fn own_origin(_url: &str) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::own_origin;

    /// The app's own page, in the shapes it is served in, and nothing that only looks like it.
    #[test]
    fn only_the_app_s_own_origin_is_given_the_channel() {
        assert!(own_origin("http://tauri.localhost/"));
        assert!(own_origin("http://tauri.localhost/quick-add.html"));
        assert!(own_origin("http://tauri.localhost/presenter.html?x=1#y"));
        assert!(own_origin("tauri://localhost/"));
        for other in [
            "https://docs.google.com/spreadsheets/d/x/edit",
            "http://tauri.localhost.evil.example/",
            "http://evil.example/?u=http://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "https://tauri.localhost/",
            "http://user@evil.example/",
            "http://ipc.localhost/",
            "http://asset.localhost/",
            "tauri://evil.example/",
            "about:blank",
            "about:srcdoc",
            "data:text/html,<p>x",
            "chrome://extensions/",
            "chrome-extension://abcdefghijklmnop/popup.html",
            "file:///tmp/a.html",
            "",
            "not a url",
        ] {
            assert!(!own_origin(other), "{other}");
        }
    }

    /// A build served by the dev server is the one place the dev server is the app.
    #[test]
    fn the_dev_server_is_the_app_only_in_a_build_that_uses_it() {
        assert_eq!(own_origin("http://localhost:1420/"), tauri::is_dev());
        assert!(!own_origin("http://localhost:1421/"));
        assert!(!own_origin("http://127.0.0.1:1420/"));
    }

    /// The address above is the one the config serves the app from.
    #[test]
    fn the_dev_server_named_is_the_config_s() {
        let config = std::fs::read_to_string(crate::app_dir().join("tauri.conf.json"))
            .expect("the config");
        assert!(config.contains(&format!("\"devUrl\": \"{}\"", super::DEV_ORIGIN)));
    }
}
