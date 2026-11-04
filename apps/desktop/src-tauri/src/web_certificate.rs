//! The certificates the page in a web tab was served with, for the site's popover.
//!
//! "I have connection is secure, but I cannot see the certificate" (#776, from #678).
//! The popover said the connection was secure from the address alone - `https:` - and
//! had nothing behind it. A browser's says who the certificate was issued to and by,
//! from when until when it holds, and its fingerprint, and shows the chain it was
//! trusted through: the site's certificate, the intermediates, and the root. So the
//! popover asks this for the chain of the page as it is now, and says the connection is
//! secure only where the engine says so too.
//!
//! Each engine is asked for the certificates the page itself came with, as the bytes
//! the site sent, and those are read the one way (see `x509.rs`):
//!
//! - Orden's own Chromium: the page's visible navigation entry carries the connection's
//!   state and the certificate with its issuers (`CefNavigationEntry::GetSSLStatus`).
//! - `WebView2`: the `DevTools` Protocol's `Network.getCertificate`, which answers the
//!   chain the page's frame was committed with. `WebView2` has no certificate API of its
//!   own for a connection that had nothing wrong with it; it raises one only for an
//!   error, and refuses the page then.
//! - `WKWebView`: `serverTrust`, the trust the committed navigation was evaluated with,
//!   which holds the chain up to the anchor it was trusted through.
//!
//! An engine that has nothing to say for an `https:` page has the chain read from the
//! site over a connection of this module's own (`separately.rs`), and the popover then
//! says that is where it came from: what the site serves now, not necessarily what the
//! page was served.

use serde::Serialize;
use sha2::{Digest as _, Sha256};
use tauri::AppHandle;

mod separately;
mod x509;

#[cfg(feature = "cef")]
#[path = "web_certificate/chromium.rs"]
mod engine;
#[cfg(all(windows, not(feature = "cef")))]
#[path = "web_certificate/webview2.rs"]
mod engine;
#[cfg(all(target_os = "macos", not(feature = "cef")))]
#[path = "web_certificate/webkit.rs"]
mod engine;
#[cfg(not(any(feature = "cef", windows, target_os = "macos")))]
mod engine {
    use tauri::Webview;

    use super::Served;

    /// Nothing: no other engine says what a page came with.
    #[allow(clippy::unused_async, reason = "the same call as on the other engines")]
    pub async fn read(_view: Webview, _address: &str) -> Option<Served> {
        None
    }
}

/// Who a certificate names: whom it was issued to, or who issued it.
#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    /// The common name: the site's host for the one issued to, the authority's name
    /// for the one that issued it.
    pub name: String,
    /// The organisations it names, in the order the certificate does; often none.
    pub organization: Vec<String>,
}

/// One certificate of the chain, as the popover shows it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    /// Whom it was issued to.
    pub to: Party,
    /// Who issued it.
    pub by: Party,
    /// When it starts to hold, in milliseconds since the Unix epoch.
    pub from: i64,
    /// When it stops holding, the same way.
    pub until: i64,
    /// Its serial number, as colon-separated hex.
    pub serial: String,
    /// The SHA-256 of the certificate as it was sent, as colon-separated hex.
    pub sha256: String,
    /// Whether it is a root: issued by itself.
    pub root: bool,
}

/// What the popover shows of a page's certificates.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Certificate {
    /// Whether the engine took the connection for a secure one and found nothing wrong
    /// with the certificate: a name that does not match, a date it does not hold on, an
    /// authority nobody trusts, and the rest of what a browser warns about. For a chain
    /// read separately, what the address says, as the engine said nothing.
    pub secure: bool,
    /// Whether the chain was read from the site over a connection of this module's
    /// own, because the engine said nothing of the page's.
    pub separately: bool,
    /// The site's certificate first, then each that issued the one before it, up to
    /// the root where the engine has it.
    pub chain: Vec<Link>,
}

/// What an engine says of a page: whether the connection was secure, and the
/// certificates it was made with, as DER, the site's first.
pub struct Served {
    secure: bool,
    chain: Vec<Vec<u8>>,
}

/// The certificates the tab's page was served with, or `None` where the page came
/// over no secure connection or nothing could be read. `address` is the page's, as the
/// tab shows it: where a chain read separately is read from, and the origin the
/// `DevTools` Protocol is asked about.
#[tauri::command]
pub async fn web_certificate(
    app: AppHandle,
    tab: String,
    address: String,
) -> Result<Option<Certificate>, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    if let Some(served) = engine::read(view, &address).await {
        if let Some(said) = Certificate::from_chain(served.secure, false, &served.chain) {
            return Ok(Some(said));
        }
    }
    let Ok(address) = tauri::Url::parse(&address) else {
        return Ok(None);
    };
    if address.scheme() != "https" {
        return Ok(None);
    }
    let chain = separately::read(address).await;
    Ok(Certificate::from_chain(true, true, &chain))
}

impl Certificate {
    /// The chain as the popover shows it, or `None` where the site's own certificate
    /// cannot be read. A certificate further up that cannot be read ends the chain
    /// there, as nothing above it could be said to have issued it.
    fn from_chain(secure: bool, separately: bool, chain: &[Vec<u8>]) -> Option<Self> {
        let chain: Vec<Link> = chain.iter().map_while(|der| Link::from_der(der)).collect();
        (!chain.is_empty()).then_some(Self {
            secure,
            separately,
            chain,
        })
    }
}

impl Link {
    /// One certificate, from the bytes the site sent.
    fn from_der(der: &[u8]) -> Option<Self> {
        let read = x509::fields(der)?;
        Some(Self {
            to: read.to,
            by: read.by,
            from: read.from,
            until: read.until,
            serial: hex(&read.serial),
            sha256: hex(&Sha256::digest(der)),
            root: read.own_issuer,
        })
    }
}

/// Bytes as colon-separated upper-case hex, the way a browser shows a fingerprint.
fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::x509::tests::{der, INTERMEDIATE, ROOT, SITE};
    use super::{hex, Certificate};

    #[test]
    fn a_fingerprint_is_written_as_a_browser_writes_one() {
        assert_eq!(hex(&[0x0a, 0xff, 0x10]), "0A:FF:10");
        assert_eq!(hex(&[]), "");
    }

    #[test]
    fn the_whole_chain_is_told_site_first_up_to_the_root() {
        let said = Certificate::from_chain(true, false, &[der(SITE), der(INTERMEDIATE), der(ROOT)])
            .expect("a chain");
        let names: Vec<&str> = said.chain.iter().map(|one| one.to.name.as_str()).collect();
        assert_eq!(names, ["example.test", "Orden Test R1", "Orden Test Root"]);
        let roots: Vec<bool> = said.chain.iter().map(|one| one.root).collect();
        assert_eq!(roots, [false, false, true]);
        assert_eq!(said.chain[0].serial, "01:02:03:04:05");
        assert_eq!(
            said.chain[0].sha256,
            "69:78:C9:7A:DE:D0:CA:09:18:2D:0E:ED:A7:D5:C4:48:8C:18:83:26:80:C8:D6:8C:D1:FA:66:60:9A:D8:9E:E8"
        );
    }

    #[test]
    fn a_chain_is_cut_where_a_certificate_cannot_be_read() {
        let said = Certificate::from_chain(false, true, &[der(SITE), vec![1, 2, 3], der(ROOT)])
            .expect("a chain");
        assert_eq!(said.chain.len(), 1);
        assert!(said.separately);
        assert_eq!(
            Certificate::from_chain(true, false, &[vec![0x30, 0x00]]),
            None
        );
        assert_eq!(Certificate::from_chain(true, false, &[]), None);
    }

    #[test]
    fn the_popover_is_told_in_its_own_words() {
        let told = serde_json::to_value(
            Certificate::from_chain(true, false, &[der(SITE), der(INTERMEDIATE)]).expect("a chain"),
        )
        .expect("json");
        assert_eq!(told["secure"], true);
        assert_eq!(told["separately"], false);
        assert_eq!(told["chain"][0]["to"]["name"], "example.test");
        assert_eq!(
            told["chain"][0]["by"]["organization"][0],
            "Orden Test Authority"
        );
        assert_eq!(told["chain"][1]["root"], false);
        assert_eq!(told["chain"][0]["until"], 1_780_272_000_000_i64);
    }
}
