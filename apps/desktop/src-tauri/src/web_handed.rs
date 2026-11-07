use tauri::Url;

pub const LINK_FLAG: &str = "--url";

const LONGEST: usize = 32 * 1024;

pub fn for_a_link<A: AsRef<std::ffi::OsStr>>(args: &[A]) -> bool {
    args.iter().skip(1).any(|one| one.as_ref() == LINK_FLAG)
}

pub fn pages_in(args: &[String]) -> Vec<String> {
    let given = args.get(1..).unwrap_or_default();
    if let Some(at) = given.iter().position(|one| one == LINK_FLAG) {
        return page(&given[at + 1..].join("|")).into_iter().collect();
    }

    given.iter().filter_map(|one| page(one)).collect()
}

#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only a Mac hands addresses over as addresses; the rule is tested everywhere"
    )
)]
pub fn pages_among(urls: &[Url]) -> Vec<String> {
    urls.iter().filter_map(|url| page(url.as_str())).collect()
}

fn page(said: &str) -> Option<String> {
    if said.len() > LONGEST {
        return None;
    }

    let url = Url::parse(said).ok()?;
    let web = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !host.is_empty());

    (web && crate::web_tabs::allowed(&url)).then(|| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::{for_a_link, pages_among, pages_in, LINK_FLAG};
    use tauri::Url;

    fn line(args: &[&str]) -> Vec<String> {
        std::iter::once("nib.exe")
            .chain(args.iter().copied())
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn a_link_windows_hands_over_is_one_page() {
        let args = line(&[LINK_FLAG, "https://example.com/a?b=1#c"]);
        assert_eq!(pages_in(&args), vec!["https://example.com/a?b=1#c"]);
        assert!(for_a_link(&args));
    }

    #[test]
    fn a_terminal_may_name_several_in_order() {
        let args = line(&["https://one.example", "--verbose", "http://two.example/x"]);
        assert_eq!(
            pages_in(&args),
            vec!["https://one.example/", "http://two.example/x"]
        );
        assert!(!for_a_link(&args));
    }

    #[test]
    fn only_a_page_on_the_web_is_taken() {
        for refused in [
            r"C:\Users\me\Notes\Idea.md",
            "/home/me/Notes/Idea.md",
            "file:///C:/Users/me/Notes/Idea.md",
            "FILE:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "orden://open?path=Idea.md",
            "mailto:me@example.com",
            "view-source:https://example.com",
            "ms-settings:defaultapps",
            "smb://server/share",
            "https://tauri.localhost/",
            "http://ipc.localhost/plugin",
            "http://",
            "https:",
            "example.com",
            "",
        ] {
            assert!(
                pages_in(&line(&[refused])).is_empty(),
                "{refused} was taken"
            );
            assert!(
                pages_in(&line(&[LINK_FLAG, refused])).is_empty(),
                "{refused} was taken after the flag"
            );
        }
    }

    #[test]
    fn a_scheme_in_capitals_is_still_the_web() {
        assert_eq!(
            pages_in(&line(&["HTTPS://Example.COM/Path"])),
            vec!["https://example.com/Path"]
        );
    }

    #[test]
    fn a_bar_in_the_address_survives_the_hand_over() {
        let args = line(&[LINK_FLAG, "https://example.com/?q=a", "b"]);
        assert_eq!(pages_in(&args), vec!["https://example.com/?q=a|b"]);
    }

    #[test]
    fn a_smuggled_argument_stays_part_of_the_address() {
        let args = line(&[LINK_FLAG, "https://example.com/", r"C:\secret.md"]);
        let pages = pages_in(&args);

        assert_eq!(pages.len(), 1);
        assert!(pages[0].starts_with("https://example.com/"));
        assert!(for_a_link(&args));
    }

    #[test]
    fn nothing_after_the_flag_is_nothing() {
        assert!(pages_in(&line(&[LINK_FLAG])).is_empty());
        assert!(pages_in(&["nib.exe".to_owned()]).is_empty());
        assert!(pages_in(&[]).is_empty());
    }

    #[test]
    fn an_address_longer_than_a_command_line_is_refused() {
        let long = format!("https://example.com/{}", "a".repeat(40 * 1024));
        assert!(pages_in(&line(&[&long])).is_empty());
    }

    #[test]
    fn a_mac_hands_over_its_pages_and_keeps_its_files() {
        let urls = [
            Url::parse("file:///Users/me/Notes/Idea.md").expect("an address"),
            Url::parse("https://example.com/").expect("an address"),
            Url::parse("orden://search").expect("an address"),
            Url::parse("http://example.org/x").expect("an address"),
        ];
        assert_eq!(
            pages_among(&urls),
            vec!["https://example.com/", "http://example.org/x"]
        );
    }
}
