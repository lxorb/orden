//! The certificate the page in a web tab was served with, for the site's popover.
//!
//! "I have connection is secure, but I cannot see the certificate" (#776, from #678).
//! The popover said the connection was secure from the address alone - `https:` - and
//! had nothing behind it. A browser's says who the certificate was issued to and by,
//! from when until when it holds, and its fingerprint, which is what somebody checks a
//! site's certificate for. So the popover asks this for the certificate of the page as
//! it is now, and says the connection is secure only where the engine says so too.
//!
//! On nib's own Chromium the page's visible navigation entry carries the connection's
//! state and the certificate it was made with (`CefNavigationEntry::GetSSLStatus`).
//! Elsewhere nothing is answered and the popover keeps to what the address says.

use serde::Serialize;
use tauri::AppHandle;

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

/// What the popover shows of a page's certificate.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Certificate {
    /// Whether the engine took the connection for a secure one and found nothing wrong
    /// with the certificate: a name that does not match, a date it does not hold on, an
    /// authority nobody trusts, and the rest of what a browser warns about.
    pub secure: bool,
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
}

/// The certificate the tab's page was served with, or `None` where the page came
/// over no secure connection, has none to say, or the engine cannot tell.
#[tauri::command]
pub async fn web_certificate(app: AppHandle, tab: String) -> Result<Option<Certificate>, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    Ok(engine::read(view).await)
}

/// Bytes as colon-separated upper-case hex, the way a browser shows a fingerprint.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

/// Microseconds since the Windows epoch, which is how Chromium keeps a time, as
/// milliseconds since the Unix one.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const fn unix_millis(windows_micros: i64) -> i64 {
    /// From 1601-01-01 to 1970-01-01, in microseconds.
    const BETWEEN: i64 = 11_644_473_600_000_000;
    (windows_micros - BETWEEN) / 1000
}

/// The certificate statuses a browser warns about (`net::IsCertStatusError`): each a
/// reason the connection is not the secure kind, whatever its scheme says. Revocation
/// that could not be checked is not one of them, as it is not in a browser.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
const WRONG: u32 = 1 // the name does not match
    | 2 // a date it does not hold on
    | 4 // an authority nobody trusts
    | 64 // revoked
    | 128 // invalid
    | 256 // a weak signature
    | 1024 // a name that is not unique
    | 2048 // a weak key
    | 8192 // a pinned key missing
    | 16384 // a name its authority may not issue
    | 32768 // valid for too long
    | 1_048_576; // not in the certificate logs

#[cfg(feature = "cef")]
mod engine {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use cef::{
        ImplBinaryValue as _, ImplBrowser as _, ImplBrowserHost as _, ImplNavigationEntry as _,
        ImplSslstatus as _, ImplX509CertPrincipal as _, ImplX509Certificate as _,
    };
    use sha2::{Digest as _, Sha256};
    use tauri::Webview;

    use super::{hex, unix_millis, Certificate, Party, WRONG};

    /// How long the engine's thread is waited for.
    const PATIENCE: Duration = Duration::from_secs(5);

    /// The certificate, read on the engine's thread, where a browser may be spoken to.
    pub async fn read(view: Webview) -> Option<Certificate> {
        let (sending, said) = channel();
        view.with_webview(move |platform| {
            let read = platform
                .downcast_ref::<tauri_runtime_cef::Webview>()
                .and_then(|page| of(&page.browser()));
            let _ = sending.send(read);
        })
        .ok()?;
        tauri::async_runtime::spawn_blocking(move || said.recv_timeout(PATIENCE).ok().flatten())
            .await
            .ok()
            .flatten()
    }

    /// What the page now in sight was served with.
    fn of(browser: &cef::Browser) -> Option<Certificate> {
        let status = browser.host()?.visible_navigation_entry()?.sslstatus()?;
        let certificate = status.x509_certificate()?;
        let sent = bytes(certificate.derencoded())?;
        Some(Certificate {
            secure: status.is_secure_connection() != 0 && status_of(&status) & WRONG == 0,
            to: party(certificate.subject()),
            by: party(certificate.issuer()),
            from: unix_millis(certificate.valid_start().val),
            until: unix_millis(certificate.valid_expiry().val),
            serial: bytes(certificate.serial_number())
                .map_or_else(String::new, |serial| hex(&serial)),
            sha256: hex(&Sha256::digest(&sent)),
        })
    }

    /// The status flags as the number Chromium keeps them in. CEF hands them over as an
    /// enum of single flags, which a certificate with two of them is not one of, so the
    /// number is read rather than the enum matched.
    #[allow(
        unsafe_code,
        reason = "the flags are one u32 that CEF's binding types as an enum of single flags"
    )]
    fn status_of(status: &cef::Sslstatus) -> u32 {
        let flags = status.cert_status();
        // SAFETY: `cef_cert_status_t` is `#[repr(u32)]`, so the value is a u32 in memory.
        unsafe { *std::ptr::from_ref(flags.as_ref()).cast::<u32>() }
    }

    /// A name and its organisations, or nothing for a certificate that names none.
    fn party(principal: Option<cef::X509CertPrincipal>) -> Party {
        let Some(principal) = principal else {
            return Party::default();
        };
        let mut names = cef::CefStringList::new();
        principal.organization_names(Some(&mut names));
        Party {
            name: cef::CefString::from(&principal.common_name()).to_string(),
            organization: names.into_iter().filter(|name| !name.is_empty()).collect(),
        }
    }

    /// What a binary value holds.
    fn bytes(value: Option<cef::BinaryValue>) -> Option<Vec<u8>> {
        let value = value?;
        let mut held = vec![0; value.size()];
        let read = value.data(Some(&mut held), 0);
        held.truncate(read);
        (!held.is_empty()).then_some(held)
    }
}

#[cfg(not(feature = "cef"))]
mod engine {
    use tauri::Webview;

    use super::Certificate;

    /// Nothing: these engines do not say what certificate a page came with.
    #[allow(
        clippy::unused_async,
        reason = "the same call as on nib's own Chromium"
    )]
    pub async fn read(_view: Webview) -> Option<Certificate> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{hex, unix_millis, Certificate, Party};

    #[test]
    fn a_fingerprint_is_written_as_a_browser_writes_one() {
        assert_eq!(hex(&[0x0a, 0xff, 0x10]), "0A:FF:10");
        assert_eq!(hex(&[]), "");
    }

    #[test]
    fn chromium_s_time_is_read_from_the_windows_epoch() {
        assert_eq!(unix_millis(11_644_473_600_000_000), 0);
        // 2026-01-01T00:00:00Z.
        assert_eq!(
            unix_millis(11_644_473_600_000_000 + 1_767_225_600_000_000),
            1_767_225_600_000
        );
    }

    #[test]
    fn the_popover_is_told_in_its_own_words() {
        let told = serde_json::to_value(Certificate {
            secure: true,
            to: Party {
                name: "example.com".into(),
                organization: vec![],
            },
            by: Party {
                name: "R3".into(),
                organization: vec!["Let's Encrypt".into()],
            },
            from: 1,
            until: 2,
            serial: "01".into(),
            sha256: "AB".into(),
        })
        .expect("json");
        assert_eq!(told["to"]["name"], "example.com");
        assert_eq!(told["by"]["organization"][0], "Let's Encrypt");
        assert_eq!(told["until"], 2);
        assert_eq!(told["sha256"], "AB");
    }
}
