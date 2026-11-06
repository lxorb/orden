use std::ffi::c_void;
use std::sync::mpsc::channel;
use std::time::Duration;

use objc2::encode::{Encoding, RefEncode};
use objc2::msg_send;
use objc2::rc::Retained;
use objc2_web_kit::WKWebView;
use tauri::Webview;

use super::Served;

const PATIENCE: Duration = Duration::from_secs(5);

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

#[repr(C)]
struct Trust {
    _opaque: [u8; 0],
}

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

#[allow(
    unsafe_code,
    reason = "WKWebView's trust and the Security framework's chain are reached through \
              the Objective-C runtime and C"
)]
fn of(webview: *mut c_void) -> Option<Served> {
    let view = unsafe { Retained::retain(webview.cast::<WKWebView>()) }?;
    let trust: *mut Trust = unsafe { msg_send![&*view, serverTrust] };
    if trust.is_null() {
        return None;
    }
    let only_secure = unsafe { view.hasOnlySecureContent() };
    let mut chain = Vec::new();
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
