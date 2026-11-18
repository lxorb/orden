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
struct Declared {
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

#[cfg(test)]
mod tests {
    use super::{best, Declared, Declaring};

    fn on(links: &[(&str, &str, &str, &str)]) -> Option<String> {
        let links = links
            .iter()
            .map(|&(rel, href, sizes, kind)| Declared {
                rel: rel.into(),
                href: href.into(),
                sizes: sizes.into(),
                r#type: kind.into(),
            })
            .collect();
        best(&Declaring {
            page: "https://a.example/deep/page?x=1".into(),
            links,
        })
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
    fn the_best_picture_scales_or_fills_the_box_smallest_and_last_and_apple_s_only_alone() {
        let ico = "https://a.example/favicon.ico";
        let touch = (
            "apple-touch-icon",
            "https://a.example/touch.png",
            "180x180",
            "",
        );
        for (links, wears) in [
            (&[][..], ico),
            (&[("stylesheet", "https://a.example/s.css", "", "")], ico),
            (
                &[
                    ("icon", "https://a.example/16.png", "16x16", ""),
                    ("icon", "https://a.example/192.png", "192x192", ""),
                    ("icon", "https://a.example/48.png", "48x48", ""),
                    ("icon", "https://a.example/32.png", "32x32", ""),
                ],
                "https://a.example/32.png",
            ),
            (
                &[
                    ("icon", "https://a.example/32.png", "32x32", ""),
                    ("icon", "https://a.example/mark.svg?v=2", "", ""),
                ],
                "https://a.example/mark.svg?v=2",
            ),
            (
                &[
                    ("icon", "https://a.example/mark", "", "image/svg+xml"),
                    ("icon", "https://a.example/32.png", "32x32", ""),
                ],
                "https://a.example/mark",
            ),
            (
                &[
                    ("shortcut icon", ico, "", ""),
                    ("icon", "https://a.example/16.png", "16x16", ""),
                ],
                ico,
            ),
            (
                &[
                    ("shortcut icon", "https://static.example/a.webp", "", ""),
                    (
                        "apple-touch-icon",
                        "https://static.example/192.webp",
                        "192x192",
                        "",
                    ),
                    ("icon", "https://a.example/favicon/1x/", "", ""),
                ],
                "https://a.example/favicon/1x/",
            ),
            (&[touch], "https://a.example/touch.png"),
            (
                &[touch, ("icon", "https://a.example/16.png", "16x16", "")],
                "https://a.example/16.png",
            ),
            (
                &[("icon", "data:image/png;base64,AAAA", "", "")],
                "data:image/png;base64,AAAA",
            ),
            (&[("icon", "blob:https://a.example/1", "", "")], ico),
        ] {
            assert_eq!(on(links).as_deref(), Some(wears), "{links:?}");
        }
    }
}
