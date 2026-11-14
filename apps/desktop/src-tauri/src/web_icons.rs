use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const ICON: &str = "orden://web-icon";

const WANT: u32 = 32;

#[derive(Clone, Serialize)]
struct Iconed<'a> {
    tab: &'a str,
    icon: &'a str,
}

pub fn said(app: &AppHandle, window: &str, tab: &str, icon: &str) {
    let _ = app.emit_to(window, ICON, Iconed { tab, icon });
}

#[derive(Debug, Default, Deserialize)]
pub struct Declared {
    #[serde(default)]
    rel: String,
    #[serde(default)]
    href: String,
    #[serde(default)]
    sizes: String,
    #[serde(default)]
    r#type: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct Declaring {
    #[serde(default)]
    page: String,
    #[serde(default)]
    links: Vec<Declared>,
}

pub const ASK: &str = r"(function () {
  try {
    var links = []
    var found = document.querySelectorAll('link[rel][href]')
    for (var index = 0; index < found.length; index++) {
      var one = found[index]
      links.push({
        rel: one.getAttribute('rel') || '',
        href: one.href,
        sizes: one.getAttribute('sizes') || '',
        type: one.getAttribute('type') || '',
      })
    }
    return { page: location.href, links: links }
  } catch (error) {
    return { page: '', links: [] }
  }
})()";

fn score(declared: &Declared) -> u64 {
    let sizes = declared.sizes.to_ascii_lowercase();
    let scales = sizes.split_whitespace().any(|one| one == "any")
        || declared.r#type.eq_ignore_ascii_case("image/svg+xml")
        || declared
            .href
            .split(['?', '#'])
            .next()
            .is_some_and(|path| path.to_ascii_lowercase().ends_with(".svg"));
    if scales {
        return 4_000_000;
    }

    let widths = || {
        sizes
            .split_whitespace()
            .filter_map(|one| one.split_once('x'))
            .filter_map(|(wide, _)| wide.parse::<u32>().ok())
    };

    if let Some(fits) = widths().filter(|&wide| wide >= WANT).min() {
        return 3_000_000 - u64::from(fits.min(1_000_000));
    }

    match widths().max() {
        Some(wide) => 1_000_000 + u64::from(wide),
        None => 2_000_000,
    }
}

fn names(rel: &str, word: &str) -> bool {
    rel.split_ascii_whitespace()
        .any(|one| one.eq_ignore_ascii_case(word))
}

pub fn best(declaring: &Declaring) -> Option<String> {
    let usable = |one: &&Declared| {
        let href = one.href.to_ascii_lowercase();
        href.starts_with("https:") || href.starts_with("http:") || href.starts_with("data:image/")
    };
    let pick = |word: &str| {
        declaring
            .links
            .iter()
            .filter(|one| names(&one.rel, word))
            .filter(usable)
            .enumerate()
            .max_by_key(|(at, one)| (score(one), *at))
            .map(|(_, one)| one.href.clone())
    };

    pick("icon")
        .or_else(|| pick("apple-touch-icon"))
        .or_else(|| pick("apple-touch-icon-precomposed"))
        .or_else(|| {
            let page = tauri::Url::parse(&declaring.page).ok()?;
            matches!(page.scheme(), "http" | "https")
                .then(|| page.join("/favicon.ico").ok())
                .flatten()
                .map(String::from)
        })
}

pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(test)]
mod tests {
    use super::{best, Declared, Declaring};

    fn link(rel: &str, href: &str, sizes: &str, kind: &str) -> Declared {
        Declared {
            rel: rel.into(),
            href: href.into(),
            sizes: sizes.into(),
            r#type: kind.into(),
        }
    }

    fn on(links: Vec<Declared>) -> Option<String> {
        best(&Declaring {
            page: "https://a.example/deep/page?x=1".into(),
            links,
        })
    }

    #[test]
    fn a_page_that_declares_nothing_wears_its_site_s_favicon_ico() {
        assert_eq!(on(vec![]).as_deref(), Some("https://a.example/favicon.ico"));
        let stylesheet = link("stylesheet", "https://a.example/s.css", "", "");
        assert_eq!(
            on(vec![stylesheet]).as_deref(),
            Some("https://a.example/favicon.ico")
        );
    }

    #[test]
    fn a_page_the_app_cannot_name_wears_nothing() {
        let blank = Declaring {
            page: "about:blank".into(),
            links: vec![],
        };
        assert_eq!(best(&blank), None);
    }

    #[test]
    fn the_smallest_picture_that_fills_the_box_wins() {
        let links = vec![
            link("icon", "https://a.example/16.png", "16x16", ""),
            link("icon", "https://a.example/192.png", "192x192", ""),
            link("icon", "https://a.example/48.png", "48x48", ""),
            link("icon", "https://a.example/32.png", "32x32", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/32.png"));
    }

    #[test]
    fn a_drawing_that_scales_beats_every_picture() {
        let links = vec![
            link("icon", "https://a.example/32.png", "32x32", ""),
            link("icon", "https://a.example/mark.svg?v=2", "", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/mark.svg?v=2"));

        let typed = vec![
            link("icon", "https://a.example/mark", "", "image/svg+xml"),
            link("icon", "https://a.example/32.png", "32x32", ""),
        ];
        assert_eq!(on(typed).as_deref(), Some("https://a.example/mark"));
    }

    #[test]
    fn an_unsized_icon_beats_one_too_small_for_the_box() {
        let links = vec![
            link("shortcut icon", "https://a.example/favicon.ico", "", ""),
            link("icon", "https://a.example/16.png", "16x16", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/favicon.ico"));
    }

    #[test]
    fn of_two_as_good_the_one_declared_last_wins() {
        let links = vec![
            link("shortcut icon", "https://static.example/a.webp", "", ""),
            link(
                "apple-touch-icon",
                "https://static.example/192.webp",
                "192x192",
                "",
            ),
            link("icon", "https://a.example/favicon/1x/", "", ""),
        ];
        assert_eq!(on(links).as_deref(), Some("https://a.example/favicon/1x/"));
    }

    #[test]
    fn apple_s_picture_only_where_there_is_nothing_else() {
        let only = vec![link(
            "apple-touch-icon",
            "https://a.example/touch.png",
            "180x180",
            "",
        )];
        assert_eq!(on(only).as_deref(), Some("https://a.example/touch.png"));

        let both = vec![
            link(
                "apple-touch-icon",
                "https://a.example/touch.png",
                "180x180",
                "",
            ),
            link("icon", "https://a.example/16.png", "16x16", ""),
        ];
        assert_eq!(on(both).as_deref(), Some("https://a.example/16.png"));
    }

    #[test]
    fn a_mark_written_into_the_page_counts_and_other_schemes_do_not() {
        let inline = vec![link("icon", "data:image/png;base64,AAAA", "", "")];
        assert_eq!(on(inline).as_deref(), Some("data:image/png;base64,AAAA"));

        let local = vec![link("icon", "blob:https://a.example/1", "", "")];
        assert_eq!(on(local).as_deref(), Some("https://a.example/favicon.ico"));
    }
}
