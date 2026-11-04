//! `WKWebView`: `serverTrust`, the trust the committed navigation was evaluated with,
//! whose chain runs from the site's certificate up to the anchor it was trusted through.
//!
//! `WebKit` refuses a page whose certificate it does not trust unless a navigation
//! delegate answers its challenge, and neither wry's nor nib's answers one; so a page
//! with a trust to read was trusted. What can still be wrong is the page itself: a
//! picture or a script it fetched over plain `http:`, which `hasOnlySecureContent`
//! says, and which a browser does not call secure either.
//!
//! The trust is a Security framework object that objc2's `WebKit` binding hands out only
//! with the Security binding, which is not in the lock file; the four calls it takes are
//! made directly instead, as `presence.rs` does for `CoreGraphics`.

use std::ffi::c_void;
use std::sync::mpsc::channel;
use std::time::Duration;

use objc2::encode::{Encoding, RefEncode};
use objc2::msg_send;
use objc2::rc::Retained;
use objc2_web_kit::WKWebView;
use tauri::Webview;

use super::Served;

/// How long the main thread is waited for.
const PATIENCE: Duration = Duration::from_secs(5);

/// The chain of the page now in sight, read on the main thread, where its webview is.
pub async fn read(view: Webview, _address: &str) -> Option<Served> {
    let (sending, said) = channel();
    view.with_webview(move |platform| {
        let _ = sending.send(of(platform.inner()));
    })
    .ok()?;
    tauri::async_runtime::spawn_blocking(move || said.recv_timeout(PATIENCE).ok().flatten())
        .await
        .ok()
        .flatten()
}

/// `struct __SecTrust`, which a `SecTrustRef` points to and nothing here looks into.
#[repr(C)]
struct Trust {
    _opaque: [u8; 0],
}

// SAFETY: the encoding `serverTrust` is declared with, `^{__SecTrust=}`.
#[allow(
    unsafe_code,
    reason = "the trust's type is told to the Objective-C runtime by hand"
)]
unsafe impl RefEncode for Trust {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("__SecTrust", &[]));
}

#[allow(
    unsafe_code,
    reason = "the Security framework's trust has no binding in the crates this app uses"
)]
#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    fn SecTrustCopyCertificateChain(trust: *mut Trust) -> *const c_void;
    fn SecCertificateCopyData(certificate: *const c_void) -> *const c_void;
}

#[allow(
    unsafe_code,
    reason = "Core Foundation's arrays and data, which the trust's chain is made of"
)]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFRelease(object: *const c_void);
}

/// The chain the webview's committed navigation was trusted through, site first.
#[allow(
    unsafe_code,
    reason = "WKWebView's trust and the Security framework's chain are reached through \
              the Objective-C runtime and C"
)]
fn of(webview: *mut c_void) -> Option<Served> {
    // SAFETY: the pointer is the WKWebView wry built for this tab, alive for as long as
    // the tab's page is, and this runs on the main thread where it belongs.
    let view = unsafe { Retained::retain(webview.cast::<WKWebView>()) }?;
    // SAFETY: a property read on the main thread; the trust is the webview's (the get
    // rule), held only while the webview is, which is the rest of this function.
    let trust: *mut Trust = unsafe { msg_send![&*view, serverTrust] };
    if trust.is_null() {
        return None;
    }
    // SAFETY: as above.
    let only_secure = unsafe { view.hasOnlySecureContent() };
    let mut chain = Vec::new();
    // SAFETY: the trust is a live `SecTrustRef`. The array and each certificate's data
    // are made by the copy calls (the create rule) and released here once read; each
    // certificate is the array's (the get rule), read while the array is held.
    unsafe {
        let certificates = SecTrustCopyCertificateChain(trust);
        if certificates.is_null() {
            return None;
        }
        for index in 0..CFArrayGetCount(certificates) {
            let data = SecCertificateCopyData(CFArrayGetValueAtIndex(certificates, index));
            if data.is_null() {
                break;
            }
            let length = usize::try_from(CFDataGetLength(data)).unwrap_or(0);
            let start = CFDataGetBytePtr(data);
            if !start.is_null() && length > 0 {
                chain.push(std::slice::from_raw_parts(start, length).to_vec());
            }
            CFRelease(data);
        }
        CFRelease(certificates);
    }
    (!chain.is_empty()).then_some(Served {
        secure: only_secure,
        chain,
    })
}
