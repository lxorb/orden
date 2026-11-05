//! What a Mac has to allow before it hosts an application (issue 1063, step 8;
//! docs/apps.md): Screen Recording, for its picture, and Accessibility, for its windows
//! and the holder's input. Each is asked of the system once, which shows its own
//! prompt and lists Orden in System Settings; until both are given the tab says so.

use std::ffi::c_void;

use objc2_foundation::{NSDictionary, NSNumber, NSString};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

/// Whether both are given; asks for whichever is not.
pub fn allowed() -> bool {
    let screen = objc2_core_graphics::CGPreflightScreenCaptureAccess()
        || objc2_core_graphics::CGRequestScreenCaptureAccess();
    let input = trusted();
    screen && input
}

/// Whether Accessibility is given, asking for it with the system's prompt if not.
#[allow(
    unsafe_code,
    reason = "Accessibility's trust check is a C call taking a CFDictionary, built as the NSDictionary it bridges to"
)]
fn trusted() -> bool {
    // SAFETY: the key is the framework's own CFString constant, toll-free an NSString;
    // the dictionary lives across the call.
    unsafe {
        let key: &NSString = &*kAXTrustedCheckOptionPrompt.cast::<NSString>();
        let yes = NSNumber::new_bool(true);
        let options = NSDictionary::from_slices(&[key], &[&*yes]);
        AXIsProcessTrustedWithOptions(std::ptr::from_ref(&*options).cast()) != 0
    }
}
