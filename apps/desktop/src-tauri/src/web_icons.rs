use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const ICON: &str = "nib://web-icon";

#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
const WANT: u32 = 32;

const LARGEST: usize = 16 * 1024;

#[derive(Clone, Serialize)]
struct Iconed<'a> {
    tab: &'a str,
    icon: &'a str,
}

pub fn said(app: &AppHandle, window: &str, tab: &str, icon: &str) {
    let _ = app.emit_to(window, ICON, Iconed { tab, icon });
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
pub fn data_url(png: &[u8]) -> Option<String> {
    use base64::Engine as _;

    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if !png.starts_with(&SIGNATURE) || png.len() > LARGEST {
        return None;
    }

    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[derive(Debug, Default, Deserialize)]
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
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
#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
pub struct Declaring {
    #[serde(default)]
    page: String,
    #[serde(default)]
    links: Vec<Declared>,
}

#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
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

#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
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

#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
fn names(rel: &str, word: &str) -> bool {
    rel.split_ascii_whitespace()
        .any(|one| one.eq_ignore_ascii_case(word))
}

#[cfg_attr(all(windows, not(feature = "cef")), allow(dead_code))]
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

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's favicon is WebView2's own, reached through its COM interfaces"
)]
pub fn listen(
    webview: &tauri::webview::PlatformWebview,
    app: AppHandle,
    tab: String,
    window: String,
) {
    use webview2_com::FaviconChangedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15;
    use windows_core::Interface as _;

    unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(core) = core.cast::<ICoreWebView2_15>() else {
            return;
        };

        let telling = Telling {
            app,
            tab,
            window,
            asked: std::rc::Rc::default(),
            turn: 0,
        };

        let changed = telling.clone();
        let handler = FaviconChangedEventHandler::create(Box::new(move |sender, _args| {
            if let Some(core) = sender.and_then(|one| one.cast::<ICoreWebView2_15>().ok()) {
                fetch(&core, changed.again());
            }
            Ok(())
        }));

        let mut token = 0i64;
        let _ = core.add_FaviconChanged(&handler, &raw mut token);
        fetch(&core, telling.again());
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[derive(Clone)]
struct Telling {
    app: AppHandle,
    tab: String,
    window: String,
    asked: std::rc::Rc<std::cell::Cell<u64>>,
    turn: u64,
}

#[cfg(all(windows, not(feature = "cef")))]
impl Telling {
    fn again(&self) -> Self {
        let turn = self.asked.get() + 1;
        self.asked.set(turn);
        Self {
            turn,
            ..self.clone()
        }
    }

    fn tell(&self, icon: &str) {
        if self.asked.get() == self.turn {
            said(&self.app, &self.window, &self.tab, icon);
        }
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's favicon is WebView2's own, reached through its COM interfaces"
)]
fn fetch(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15, told: Telling) {
    let uri = unsafe {
        let mut uri = windows_core::PWSTR::null();
        match core.FaviconUri(&raw mut uri) {
            Ok(()) => webview2_com::take_pwstr(uri),
            Err(_) => String::new(),
        }
    };

    if uri.is_empty() {
        told.tell("");
        return;
    }

    if let Some(icon) = picture(&uri) {
        told.tell(&icon);
        return;
    }

    if !(uri.starts_with("https:") || uri.starts_with("http:")) {
        decoded(core, told);
        return;
    }

    let fallback = core.clone();
    crate::web_worlds::evaluate(core, fetching(&uri), move |answer| {
        match answer.as_deref().and_then(read_back) {
            Some(icon) => told.tell(&icon),
            None => decoded(&fallback, told),
        }
    });
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a page's favicon is WebView2's own, reached through its COM interfaces"
)]
fn decoded(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_15, told: Telling) {
    use webview2_com::GetFaviconCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG;

    let handler = GetFaviconCompletedHandler::create(Box::new(move |result, stream| {
        let icon = result
            .ok()
            .and(stream)
            .and_then(|stream| crate::web_tabs::read_stream(&stream))
            .and_then(|png| data_url(&png))
            .unwrap_or_default();
        told.tell(&icon);
        Ok(())
    }));

    unsafe {
        let _ = core.GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG, &handler);
    }
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
const FETCH: &str = r"(async () => {
  try {
    const answer = await fetch(__URI__, { cache: 'force-cache' })
    if (!answer.ok) return ''
    const body = await answer.blob()
    if (!/^image\//.test(body.type) || body.size > __LARGEST__) return ''
    return await new Promise((done) => {
      const reader = new FileReader()
      reader.onload = () => done(String(reader.result))
      reader.onerror = () => done('')
      reader.readAsDataURL(body)
    })
  } catch (error) {
    return ''
  }
})()";

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
fn fetching(uri: &str) -> String {
    let address = serde_json::to_string(uri).unwrap_or_else(|_| "''".into());
    FETCH
        .replace("__URI__", &address)
        .replace("__LARGEST__", &LARGEST.to_string())
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
fn read_back(answer: &str) -> Option<String> {
    let said: serde_json::Value = serde_json::from_str(answer).ok()?;
    picture(said.pointer("/result/value")?.as_str()?)
}

#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
fn picture(address: &str) -> Option<String> {
    const KINDS: [&str; 9] = [
        "png",
        "jpeg",
        "gif",
        "webp",
        "avif",
        "bmp",
        "svg+xml",
        "x-icon",
        "vnd.microsoft.icon",
    ];

    let (head, body) = address.strip_prefix("data:image/")?.split_once(',')?;
    let (kind, encoding) = head.split_once(';')?;
    let fits = address.len() <= LARGEST * 4 / 3 + 64;
    let base64 = body
        .bytes()
        .all(|one| one.is_ascii_alphanumeric() || matches!(one, b'+' | b'/' | b'='));

    (KINDS.contains(&kind.to_ascii_lowercase().as_str())
        && encoding.eq_ignore_ascii_case("base64")
        && !body.is_empty()
        && base64
        && fits)
        .then(|| address.to_string())
}

#[cfg(any(not(windows), feature = "cef"))]
pub fn listen(
    _webview: &tauri::webview::PlatformWebview,
    _app: AppHandle,
    _tab: String,
    _window: String,
) {
}

#[cfg(test)]
mod tests {
    use super::{best, data_url, fetching, picture, read_back, Declared, Declaring};

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

    #[test]
    fn a_png_travels_as_an_address_and_nothing_else_does() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        assert_eq!(
            data_url(&png).as_deref(),
            Some("data:image/png;base64,iVBORw0KGgoBAgM=")
        );
        assert_eq!(data_url(b"GIF89a"), None);
        assert_eq!(data_url(&[]), None);

        let poster = [png.as_slice(), &vec![0u8; 64 * 1024]].concat();
        assert_eq!(data_url(&poster), None);
    }

    #[test]
    fn a_picture_the_page_wrote_is_drawn_as_it_stands() {
        for said in [
            "data:image/png;base64,iVBORw0KGgo=",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "data:image/vnd.microsoft.icon;base64,AAABAA==",
        ] {
            assert_eq!(picture(said).as_deref(), Some(said));
        }
    }

    #[test]
    fn anything_else_the_page_says_is_not_a_picture() {
        for said in [
            "",
            "https://a.example/favicon.ico",
            "data:text/html;base64,PHNjcmlwdD4=",
            "data:image/png,rawbytes",
            "data:image/png;base64,",
            "data:image/png;base64,\"><script>",
            "javascript:alert(1)",
        ] {
            assert_eq!(picture(said), None, "{said}");
        }

        let poster = format!("data:image/png;base64,{}", "A".repeat(200 * 1024));
        assert_eq!(picture(&poster), None);
    }

    #[test]
    fn the_address_reaches_the_page_as_a_string_and_nothing_more() {
        let expression = fetching(r#"https://a.example/i.png?x='1'&y="2""#);
        assert!(expression.contains(r#"fetch("https://a.example/i.png?x='1'&y=\"2\"", "#));
        assert!(!expression.contains("__URI__") && !expression.contains("__LARGEST__"));
    }

    #[test]
    fn the_page_s_answer_is_read_back_as_a_picture_or_nothing() {
        let png = "data:image/png;base64,iVBORw0KGgo=";
        let answer = format!(r#"{{"result":{{"type":"string","value":"{png}"}}}}"#);
        assert_eq!(read_back(&answer).as_deref(), Some(png));

        assert_eq!(
            read_back(r#"{"result":{"type":"string","value":""}}"#),
            None
        );
        assert_eq!(
            read_back(r#"{"result":{"type":"object"},"exceptionDetails":{}}"#),
            None
        );
        assert_eq!(read_back("not json"), None);
    }
}
