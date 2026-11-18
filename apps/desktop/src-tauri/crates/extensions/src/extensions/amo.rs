use serde_json::Value;
use sha2::{Digest as _, Sha256};

const API: &str = "https://addons.mozilla.org/api/v5/addons/addon";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listing {
    pub guid: String,
    pub slug: String,
    pub version: String,
    pub url: String,
    pub hash: String,
    pub size: u64,
}

pub fn address(slug: &str) -> String {
    let slug = slug
        .replace('{', "%7B")
        .replace('}', "%7D")
        .replace('@', "%40");
    format!("{API}/{slug}/?app=firefox&lang=en-US")
}

pub fn listing_of(said: &Value) -> Result<Listing, String> {
    match said["type"].as_str() {
        Some("extension") => {}
        Some("statictheme") => return Err("that is a theme, not an add-on Orden runs".into()),
        Some(other) => return Err(format!("that is a {other}, not an add-on Orden runs")),
        None => return Err("addons.mozilla.org has no add-on by that name".into()),
    }
    let text = |value: &Value| value.as_str().map(str::to_owned);
    let version = &said["current_version"];
    let file = &version["file"];
    let hash = file["hash"]
        .as_str()
        .and_then(|hash| hash.strip_prefix("sha256:"))
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase)
        .ok_or("addons.mozilla.org did not say the file's hash")?;
    let url = text(&file["url"])
        .filter(|url| url.starts_with("https://"))
        .ok_or("addons.mozilla.org did not say where the file is")?;
    if file["status"]
        .as_str()
        .is_some_and(|status| status != "public")
    {
        return Err("that add-on's file is not public".into());
    }
    Ok(Listing {
        guid: text(&said["guid"]).ok_or("addons.mozilla.org did not say the add-on's id")?,
        slug: text(&said["slug"]).unwrap_or_default(),
        version: text(&version["version"]).ok_or("addons.mozilla.org did not say its version")?,
        url,
        hash,
        size: file["size"].as_u64().unwrap_or(0),
    })
}

pub async fn listing(slug: &str) -> Result<Listing, String> {
    let response = super::fetch::client()?
        .get(address(slug))
        .send()
        .await
        .map_err(super::fetch::offline)?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("addons.mozilla.org has no add-on by that name".into());
    }
    let text = response
        .error_for_status()
        .map_err(super::fetch::offline)?
        .text()
        .await
        .map_err(super::fetch::offline)?;
    let said: Value = serde_json::from_str(&text)
        .map_err(|_| "addons.mozilla.org's answer cannot be read".to_string())?;
    listing_of(&said)
}

pub async fn file(listing: &Listing) -> Result<Vec<u8>, String> {
    let bytes = super::fetch::download(&listing.url).await?;
    checked(&bytes, listing)?;
    Ok(bytes)
}

pub fn checked(bytes: &[u8], listing: &Listing) -> Result<(), String> {
    if listing.size != 0 && bytes.len() as u64 != listing.size {
        return Err("that add-on's file is not the one addons.mozilla.org lists".into());
    }
    if hex(&Sha256::digest(bytes)) != listing.hash {
        return Err("that add-on's file is not the one addons.mozilla.org lists".into());
    }
    let signed = |name: &str| {
        let name = name.as_bytes();
        bytes.windows(name.len()).any(|window| window == name)
    };
    if !signed("META-INF/mozilla.rsa") && !signed("META-INF/cose.sig") {
        return Err("that add-on's file is not signed by Mozilla".into());
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sha2::{Digest as _, Sha256};

    use super::{address, checked, hex, listing_of, Listing};

    fn answer(kind: &str, hash: &str) -> serde_json::Value {
        json!({
            "guid": "sponsorBlocker@ajay.app",
            "slug": "sponsorblock",
            "type": kind,
            "current_version": {
                "version": "6.1.7",
                "file": {
                    "hash": hash,
                    "size": 3,
                    "status": "public",
                    "url": "https://addons.mozilla.org/firefox/downloads/file/4897574/sponsorblock-6.1.7.xpi",
                }
            }
        })
    }

    const HASH: &str = "sha256:0D50E1632C6F15EE15A543E670E1C572974605A5C02622916E08E026803DF83F";

    #[test]
    fn amo_s_answer_says_the_add_on_and_its_file() {
        let listing = listing_of(&answer("extension", HASH)).expect("a listing");
        assert_eq!(listing.guid, "sponsorBlocker@ajay.app");
        assert_eq!(listing.version, "6.1.7");
        assert_eq!(listing.size, 3);
        assert_eq!(
            listing.hash,
            "0d50e1632c6f15ee15a543e670e1c572974605a5c02622916e08e026803df83f"
        );
    }

    #[test]
    fn what_is_not_an_add_on_with_a_file_is_refused() {
        assert!(listing_of(&answer("dictionary", HASH)).is_err());
        assert_eq!(
            listing_of(&answer("statictheme", HASH)).err().as_deref(),
            Some("that is a theme, not an add-on Orden runs")
        );
        assert!(listing_of(&json!({ "detail": "Not found." })).is_err());
        assert!(listing_of(&answer("extension", "md5:abc")).is_err());
        let mut plain = answer("extension", HASH);
        plain["current_version"]["file"]["url"] = json!("http://addons.mozilla.org/x.xpi");
        assert!(listing_of(&plain).is_err());
    }

    #[test]
    fn a_file_is_taken_only_as_amo_lists_it_and_signed() {
        let bytes = b"PK\x03\x04META-INF/cose.sig".to_vec();
        let hash = hex(&Sha256::digest(&bytes));
        let listing = Listing {
            guid: "a@b".into(),
            slug: "a".into(),
            version: "1".into(),
            url: "https://addons.mozilla.org/a.xpi".into(),
            hash,
            size: bytes.len() as u64,
        };
        assert_eq!(checked(&bytes, &listing), Ok(()));

        let mut changed = bytes.clone();
        changed[0] ^= 1;
        assert!(checked(&changed, &listing).is_err());
        let unsigned = b"PK\x03\x04nothing".to_vec();
        let mut listed = listing.clone();
        listed.size = unsigned.len() as u64;
        listed.hash = hex(&Sha256::digest(&unsigned));
        assert!(checked(&unsigned, &listed).is_err());
    }

    #[test]
    fn the_question_names_the_add_on_on_amo_s_own_host() {
        assert_eq!(
            address("{a-b}"),
            "https://addons.mozilla.org/api/v5/addons/addon/%7Ba-b%7D/?app=firefox&lang=en-US"
        );
        assert!(address("x@y").contains("/x%40y/"));
    }
}
