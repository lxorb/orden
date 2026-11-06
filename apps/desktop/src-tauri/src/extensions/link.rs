use serde::{Deserialize, Serialize};
use tauri::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    Chrome,
    Edge,
    Firefox,
}

const ID_LENGTH: usize = 32;

pub fn is_id(word: &str) -> bool {
    word.len() == ID_LENGTH && word.bytes().all(|byte| (b'a'..=b'p').contains(&byte))
}

pub fn id_of(bytes: &[u8]) -> String {
    bytes
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .map(|nibble| char::from(b'a' + nibble))
        .collect()
}

pub fn is_slug(word: &str) -> bool {
    !word.is_empty()
        && word.len() <= 200
        && !word.starts_with('.')
        && !["%2f", "%5c", "%2e"]
            .iter()
            .any(|one| word.to_ascii_lowercase().contains(one))
        && word
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.@{}%~".contains(&byte))
}

pub fn named(said: &str) -> Option<(Store, String)> {
    let said = said.trim();
    if is_id(said) {
        return Some((Store::Chrome, said.to_owned()));
    }
    if !said.contains(['/', ':']) && is_slug(said) && !said.contains('%') {
        return Some((Store::Firefox, said.to_owned()));
    }

    let url = Url::parse(said).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    let store = store_of(&url)?;
    let parts: Vec<&str> = url.path_segments()?.filter(|one| !one.is_empty()).collect();
    if store == Store::Firefox {
        let addon = parts.iter().position(|one| *one == "addon")?;
        let slug = parts.get(addon + 1).filter(|one| is_slug(one))?;
        return Some((store, (*slug).to_owned()));
    }
    let detail = parts.iter().position(|one| *one == "detail")?;
    let id = parts[detail + 1..].iter().rev().find(|one| is_id(one))?;
    Some((store, (*id).to_owned()))
}

fn store_of(url: &Url) -> Option<Store> {
    let host = url.host_str()?.to_ascii_lowercase();
    let first = url.path_segments()?.next().unwrap_or_default();
    match host.as_str() {
        "chromewebstore.google.com" => Some(Store::Chrome),
        "chrome.google.com" if first == "webstore" => Some(Store::Chrome),
        "microsoftedge.microsoft.com" if first == "addons" => Some(Store::Edge),
        "addons.mozilla.org" => Some(Store::Firefox),
        _ => None,
    }
}

#[cfg_attr(
    not(feature = "cef"),
    allow(
        dead_code,
        reason = "only nib's own Chromium installs through the store's own page"
    )
)]
pub fn page_of(store: Store, id: &str) -> String {
    match store {
        Store::Chrome => format!("https://chromewebstore.google.com/detail/{id}"),
        Store::Edge => format!("https://microsoftedge.microsoft.com/addons/detail/{id}"),
        Store::Firefox => format!("https://addons.mozilla.org/firefox/addon/{id}/"),
    }
}

#[cfg(test)]
mod tests {
    use super::{is_id, is_slug, named, page_of, Store};

    const UBLOCK: &str = "ddkjiahejlhfcafbddmgiahcphecmpfh";

    #[test]
    fn every_store_page_shape_names_its_extension() {
        for (link, store) in [
            (
                format!("https://chromewebstore.google.com/detail/ublock-origin-lite/{UBLOCK}"),
                Store::Chrome,
            ),
            (
                format!("https://chromewebstore.google.com/detail/{UBLOCK}?hl=de"),
                Store::Chrome,
            ),
            (
                format!("https://chrome.google.com/webstore/detail/ublock/{UBLOCK}"),
                Store::Chrome,
            ),
            (
                format!(
                    "https://chromewebstore.google.com/detail/ublock-origin-lite/{UBLOCK}/reviews"
                ),
                Store::Chrome,
            ),
            (
                format!("https://microsoftedge.microsoft.com/addons/detail/ublock/{UBLOCK}"),
                Store::Edge,
            ),
            (format!("  {UBLOCK} "), Store::Chrome),
        ] {
            assert_eq!(named(&link), Some((store, UBLOCK.to_owned())), "{link}");
        }
    }

    #[test]
    fn every_amo_page_shape_names_its_add_on() {
        for link in [
            "https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/",
            "https://addons.mozilla.org/de/firefox/addon/ublock-origin/reviews/?src=search",
            "https://addons.mozilla.org/firefox/addon/ublock-origin",
            "https://addons.mozilla.org/en-US/android/addon/ublock-origin/",
            "ublock-origin",
            " ublock-origin ",
        ] {
            assert_eq!(
                named(link),
                Some((Store::Firefox, "ublock-origin".to_owned())),
                "{link}"
            );
        }
        assert_eq!(
            named("https://addons.mozilla.org/ja/firefox/addon/%E3%83%86%E3%82%B9%E3%83%88/"),
            Some((Store::Firefox, "%E3%83%86%E3%82%B9%E3%83%88".to_owned()))
        );
        assert_eq!(
            named("uBlock0@raymondhill.net"),
            Some((Store::Firefox, "uBlock0@raymondhill.net".to_owned()))
        );
        for link in [
            "https://addons.mozilla.org/en-US/firefox/",
            "https://addons.mozilla.org/en-US/firefox/search/?q=dark",
            "https://addons.mozilla.org/en-US/firefox/addon/",
            "https://addons.mozilla.org/en-US/firefox/addon/a%2F..%2F..",
            "../ublock",
            "a b",
        ] {
            assert_eq!(named(link), None, "{link}");
        }
        assert!(!is_slug(".."));
        assert_eq!(
            named("ddkjiahejlhfcafbddmgiahcphecmpfz").map(|one| one.0),
            Some(Store::Firefox)
        );
    }

    #[test]
    fn nothing_else_is_an_extension() {
        for link in [
            "",
            "https://example.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://chromewebstore.google.com/category/extensions",
            "https://chromewebstore.google.com/detail/ublock-origin-lite",
            "https://microsoftedge.microsoft.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "file:///C:/ddkjiahejlhfcafbddmgiahcphecmpfh",
        ] {
            assert_eq!(named(link), None, "{link}");
        }
    }

    #[test]
    fn an_id_is_thirty_two_letters_a_to_p() {
        assert!(is_id(UBLOCK));
        assert!(!is_id(&UBLOCK.to_uppercase()));
        assert!(!is_id("../../../../../../../../../../../"));
    }

    #[test]
    fn the_store_page_round_trips() {
        for store in [Store::Chrome, Store::Edge, Store::Firefox] {
            assert_eq!(
                named(&page_of(store, UBLOCK)),
                Some((store, UBLOCK.to_owned()))
            );
        }
    }
}
