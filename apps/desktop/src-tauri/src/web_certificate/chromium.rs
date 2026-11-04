//! Orden's own Chromium: the page's visible navigation entry carries the connection's
//! state and the certificate it was made with, with the issuers Chromium verified it
//! through (`CefNavigationEntry::GetSSLStatus`, `CefX509Certificate`).

use std::sync::mpsc::channel;
use std::time::Duration;

use cef::{
    ImplBinaryValue as _, ImplBrowser as _, ImplBrowserHost as _, ImplNavigationEntry as _,
    ImplSslstatus as _, ImplX509Certificate as _,
};
use tauri::Webview;

use super::Served;

/// How long the engine's thread is waited for.
const PATIENCE: Duration = Duration::from_secs(5);

/// The certificate statuses a browser warns about (`net::IsCertStatusError`): each a
/// reason the connection is not the secure kind, whatever its scheme says. Revocation
/// that could not be checked is not one of them, as it is not in a browser.
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

/// The chain, read on the engine's thread, where a browser may be spoken to.
pub async fn read(view: Webview, _address: &str) -> Option<Served> {
    use tauri::Manager as _;

    let (sending, said) = channel();
    // A command's thread; see `on_the_page`.
    crate::web_tabs::on_the_page(view.app_handle(), view.label(), move |view| {
        let _ = view.with_webview(move |platform| {
            let read = platform
                .downcast_ref::<tauri_runtime_cef::Webview>()
                .and_then(|page| of(&page.browser()));
            let _ = sending.send(read);
        });
    })
    .ok()?;
    tauri::async_runtime::spawn_blocking(move || said.recv_timeout(PATIENCE).ok().flatten())
        .await
        .ok()
        .flatten()
}

/// What the page now in sight was served with.
fn of(browser: &cef::Browser) -> Option<Served> {
    let status = browser.host()?.visible_navigation_entry()?.sslstatus()?;
    let certificate = status.x509_certificate()?;
    let mut chain = vec![bytes(certificate.derencoded())?];
    let mut issuers: Vec<Option<cef::BinaryValue>> =
        (0..certificate.issuer_chain_size()).map(|_| None).collect();
    if !issuers.is_empty() {
        certificate.derencoded_issuer_chain(Some(&mut issuers));
    }
    chain.extend(issuers.into_iter().map_while(bytes));
    Some(Served {
        secure: status.is_secure_connection() != 0 && status_of(&status) & WRONG == 0,
        chain,
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

/// What a binary value holds.
fn bytes(value: Option<cef::BinaryValue>) -> Option<Vec<u8>> {
    let value = value?;
    let mut held = vec![0; value.size()];
    let read = value.data(Some(&mut held), 0);
    held.truncate(read);
    (!held.is_empty()).then_some(held)
}
