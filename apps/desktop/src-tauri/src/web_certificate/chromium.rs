use std::sync::mpsc::channel;
use std::time::Duration;

use cef::{
    ImplBinaryValue as _, ImplBrowser as _, ImplBrowserHost as _, ImplNavigationEntry as _,
    ImplSslstatus as _, ImplX509Certificate as _,
};
use tauri::Webview;

use super::Served;

const PATIENCE: Duration = Duration::from_secs(5);

const WRONG: u32 = 1 | 2 | 4 | 64 | 128 | 256 | 1024 | 2048 | 8192 | 16384 | 32768 | 1_048_576;

pub async fn read(view: Webview, _address: &str) -> Option<Served> {
    use tauri::Manager as _;

    let (sending, said) = channel();
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

#[allow(
    unsafe_code,
    reason = "the flags are one u32 that CEF's binding types as an enum of single flags"
)]
fn status_of(status: &cef::Sslstatus) -> u32 {
    let flags = status.cert_status();
    unsafe { *std::ptr::from_ref(flags.as_ref()).cast::<u32>() }
}

fn bytes(value: Option<cef::BinaryValue>) -> Option<Vec<u8>> {
    let value = value?;
    let mut held = vec![0; value.size()];
    let read = value.data(Some(&mut held), 0);
    held.truncate(read);
    (!held.is_empty()).then_some(held)
}
