use std::ffi::c_void;

use objc2_foundation::{NSDictionary, NSNumber, NSString};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

pub fn allowed() -> bool {
    let screen = objc2_core_graphics::CGPreflightScreenCaptureAccess()
        || objc2_core_graphics::CGRequestScreenCaptureAccess();
    let input = trusted();
    screen && input
}

#[allow(
    unsafe_code,
    reason = "Accessibility's trust check is a C call taking a CFDictionary, built as the NSDictionary it bridges to"
)]
fn trusted() -> bool {
    unsafe {
        let key: &NSString = &*kAXTrustedCheckOptionPrompt.cast::<NSString>();
        let yes = NSNumber::new_bool(true);
        let options = NSDictionary::from_slices(&[key], &[&*yes]);
        AXIsProcessTrustedWithOptions(std::ptr::from_ref(&*options).cast()) != 0
    }
}
