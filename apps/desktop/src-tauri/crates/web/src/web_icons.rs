use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const ICON: &str = "orden://web-icon";
const WANT: u32 = 32;
const MOST: usize = 22 * 1024;
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
    rel.split_ascii_whitespace().any(|one| one.eq_ignore_ascii_case(word))
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
const DRAW: &str = r"(async function (href) {
  try {
    var stop = new AbortController()
    var late = setTimeout(function () { stop.abort() }, 4000)
    var answer = await fetch(href, { credentials: 'same-origin', signal: stop.signal })
    var blob = answer.ok ? await answer.blob() : null
    clearTimeout(late)
    if (!blob) return null
    var picture
    try {
      picture = await createImageBitmap(blob)
    } catch (error) {
      var shown = URL.createObjectURL(blob)
      try {
        picture = await new Promise(function (done, fail) {
          var image = new Image()
          image.onload = function () { done(image) }
          image.onerror = fail
          image.src = shown
        })
      } finally {
        URL.revokeObjectURL(shown)
      }
    }
    var side = SIDE
    var wide = picture.width || side
    var high = picture.height || side
    var scale = Math.min(side / wide, side / high)
    var canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    canvas.getContext('2d').drawImage(picture, (side - wide * scale) / 2, (side - high * scale) / 2, wide * scale, high * scale)
    return canvas.toDataURL('image/png')
  } catch (error) {
    return null
  }
})(HREF)";
pub fn drawing(href: &str) -> Option<String> {
    let lower = href.to_ascii_lowercase();
    if !lower.starts_with("https:") && !lower.starts_with("http:") {
        return None;
    }
    let quoted = serde_json::to_string(href).ok()?;
    Some(DRAW.replace("SIDE", &WANT.to_string()).replace("HREF", &quoted))
}
pub fn drawn(said: Option<&serde_json::Value>, href: String) -> String {
    said.and_then(serde_json::Value::as_str)
        .filter(|one| one.len() <= MOST && one.starts_with("data:image/png;base64,"))
        .map_or(href, str::to_string)
}
#[cfg(test)]
mod tests {
    use super::{best, drawing, drawn, Declared, Declaring};
    use serde_json::json;

    #[test]
    fn only_a_web_address_is_fetched_and_drawn_and_it_goes_in_quoted() {
        assert_eq!(drawing("data:image/png;base64,AAAA"), None);
        assert_eq!(drawing("blob:https://a.example/1"), None);
        let asked = drawing("https://a.example/i\"con.ico").unwrap_or_default();
        assert!(asked.ends_with(r#"})("https://a.example/i\"con.ico")"#), "{asked}");
        assert!(asked.contains("credentials: 'same-origin'"));
        assert!(asked.contains("var side = 32"));
        assert!(!asked.contains("HREF") && !asked.contains("SIDE"));
        assert!(drawing("HTTP://a.example/favicon.ico").is_some());
    }
    #[test]
    fn the_drawn_picture_is_worn_when_small_and_the_address_otherwise() {
        let href = || "https://a.example/favicon.ico".to_string();
        let small = "data:image/png;base64,AAAA";
        assert_eq!(drawn(Some(&json!(small)), href()), small);
        for said in [
            None,
            Some(json!(null)),
            Some(json!(42)),
            Some(json!("data:,")),
            Some(json!("data:image/svg+xml;base64,AAAA")),
            Some(json!(format!("data:image/png;base64,{}", "A".repeat(22 * 1024)))),
        ] {
            assert_eq!(drawn(said.as_ref(), href()), href(), "{said:?}");
        }
    }

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
        best(&Declaring { page: "https://a.example/deep/page?x=1".into(), links })
    }
    #[test]
    fn a_page_the_app_cannot_name_wears_nothing() {
        let blank = Declaring { page: "about:blank".into(), links: vec![] };
        assert_eq!(best(&blank), None);
    }
    #[test]
    fn the_best_picture_scales_or_fills_the_box_smallest_and_last_and_apple_s_only_alone() {
        let ico = "https://a.example/favicon.ico";
        let touch = ("apple-touch-icon", "https://a.example/touch.png", "180x180", "");
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
                    ("apple-touch-icon", "https://static.example/192.webp", "192x192", ""),
                    ("icon", "https://a.example/favicon/1x/", "", ""),
                ],
                "https://a.example/favicon/1x/",
            ),
            (&[touch], "https://a.example/touch.png"),
            (
                &[touch, ("icon", "https://a.example/16.png", "16x16", "")],
                "https://a.example/16.png",
            ),
            (&[("icon", "data:image/png;base64,AAAA", "", "")], "data:image/png;base64,AAAA"),
            (&[("icon", "blob:https://a.example/1", "", "")], ico),
        ] {
            assert_eq!(on(links).as_deref(), Some(wears), "{links:?}");
        }
    }
}
