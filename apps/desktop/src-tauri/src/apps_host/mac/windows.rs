//! Keeping an application's windows on its own display on a Mac (issue 1063, step 8;
//! docs/apps.md), what `wm.rs` is on Linux.
//!
//! A Mac has no display of an application's own to start it on: its windows open where
//! the system puts them, on the reader's screen. So its windows are looked at a few
//! times a second through Accessibility, and each one not on its display yet is moved
//! there: a main window to fill it, a dialog or a panel to its middle at its own size. A
//! window it opens is on the reader's screen for that moment only.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGDirectDisplayID, CGDisplayBounds};

/// How often the windows are looked at.
const EVERY: Duration = Duration::from_millis(120);
/// How far a window may be from where it goes before it is moved, in points.
const NEAR: f64 = 1.5;

/// `kAXValueCGPointType` and `kAXValueCGSizeType`.
const POINT: u32 = 1;
const SIZE: u32 = 2;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *const c_void,
        attribute: &CFString,
        value: *mut *const c_void,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: *const c_void,
        attribute: &CFString,
        value: *const c_void,
    ) -> i32;
    fn AXValueCreate(kind: u32, value: *const c_void) -> *mut c_void;
    fn AXValueGetValue(value: *const c_void, kind: u32, out: *mut c_void) -> u8;
}

/// The windows of one application kept on its display; dropped, it stops.
pub struct Placer {
    ended: Arc<AtomicBool>,
}

impl Placer {
    /// Starts keeping the windows of process `pid` on `display`.
    pub fn start(pid: i32, display: CGDirectDisplayID) -> Placer {
        let ended = Arc::new(AtomicBool::new(false));
        let ending = ended.clone();
        let _ = std::thread::Builder::new()
            .name("app windows".to_owned())
            .spawn(move || {
                let Some(app) = application(pid) else {
                    return;
                };
                while !ending.load(Ordering::SeqCst) {
                    place_all(&app, CGDisplayBounds(display));
                    std::thread::sleep(EVERY);
                }
            });
        Placer { ended }
    }
}

impl Drop for Placer {
    fn drop(&mut self) {
        self.ended.store(true, Ordering::SeqCst);
    }
}

/// Where a window goes on a display: a main window fills it, anything else keeps its
/// size in the middle.
pub fn placed(fills: bool, size: CGSize, screen: CGRect) -> CGRect {
    if fills {
        return screen;
    }
    let width = size.width.min(screen.size.width);
    let height = size.height.min(screen.size.height);
    CGRect::new(
        CGPoint::new(
            screen.origin.x + (screen.size.width - width) / 2.0,
            screen.origin.y + (screen.size.height - height) / 2.0,
        ),
        CGSize::new(width, height),
    )
}

/// Whether a window is where it goes.
fn there(now: CGRect, goes: CGRect, fills: bool) -> bool {
    let near = |a: f64, b: f64| (a - b).abs() <= NEAR;
    let inside = now.origin.x >= goes.origin.x - NEAR
        && now.origin.y >= goes.origin.y - NEAR
        && now.origin.x + now.size.width <= goes.origin.x + goes.size.width + NEAR
        && now.origin.y + now.size.height <= goes.origin.y + goes.size.height + NEAR;
    if fills {
        // The menu bar may hold it a little lower than the display's top.
        inside && near(now.origin.x, goes.origin.x) && near(now.size.width, goes.size.width)
    } else {
        inside
    }
}

/// An application's Accessibility element.
#[allow(
    unsafe_code,
    reason = "Accessibility has no Rust binding here; its C calls hand out CF objects"
)]
fn application(pid: i32) -> Option<CFRetained<CFType>> {
    // SAFETY: the call makes a new element the caller owns, or none.
    let made = NonNull::new(unsafe { AXUIElementCreateApplication(pid) })?;
    // SAFETY: it is a CF object, owned once, released when dropped.
    Some(unsafe { CFRetained::from_raw(made.cast()) })
}

/// One attribute of an element, owned, or none.
#[allow(unsafe_code, reason = "see `application`")]
fn attribute(element: &CFType, name: &CFString) -> Option<CFRetained<CFType>> {
    let mut value: *const c_void = std::ptr::null();
    // SAFETY: the element is live; a value written is one the caller owns.
    let said = unsafe {
        AXUIElementCopyAttributeValue(std::ptr::from_ref(element).cast(), name, &raw mut value)
    };
    if said != 0 {
        return None;
    }
    let value = NonNull::new(value.cast_mut())?;
    // SAFETY: as in `application`.
    Some(unsafe { CFRetained::from_raw(value.cast()) })
}

/// A point or a size attribute.
#[allow(unsafe_code, reason = "see `application`")]
fn geometry<T: Default>(element: &CFType, name: &CFString, kind: u32) -> Option<T> {
    let value = attribute(element, name)?;
    let mut out = T::default();
    // SAFETY: an AXValue of `kind` is written into a value of its type.
    let read = unsafe {
        AXValueGetValue(
            std::ptr::from_ref(&*value).cast(),
            kind,
            std::ptr::from_mut(&mut out).cast(),
        )
    };
    (read != 0).then_some(out)
}

/// Sets a point or a size attribute.
#[allow(unsafe_code, reason = "see `application`")]
fn set_geometry<T>(element: &CFType, name: &CFString, kind: u32, value: &T) {
    // SAFETY: an AXValue is made of a value of `kind`'s type, and released after.
    unsafe {
        let Some(made) = NonNull::new(AXValueCreate(kind, std::ptr::from_ref(value).cast())) else {
            return;
        };
        let made: CFRetained<CFType> = CFRetained::from_raw(made.cast());
        AXUIElementSetAttributeValue(
            std::ptr::from_ref(element).cast(),
            name,
            std::ptr::from_ref(&*made).cast(),
        );
    }
}

/// Every window of the application, moved onto its display where it is not.
#[allow(
    unsafe_code,
    reason = "an Accessibility array's elements, read as what they are"
)]
fn place_all(app: &CFType, screen: CGRect) {
    let windows_name = CFString::from_static_str("AXWindows");
    let Some(windows) = attribute(app, &windows_name) else {
        return;
    };
    let Some(windows) = windows.downcast_ref::<CFArray>() else {
        return;
    };
    for index in 0..windows.count() {
        // SAFETY: an index below the count; the array holds AXUIElements, CF objects.
        let window = unsafe { windows.value_at_index(index) };
        let Some(window) = NonNull::new(window.cast_mut()) else {
            continue;
        };
        // SAFETY: the array keeps the window alive for this call.
        let window: &CFType = unsafe { window.cast().as_ref() };
        place(window, screen);
    }
}

/// One window, moved and sized where it goes.
fn place(window: &CFType, screen: CGRect) {
    let position = CFString::from_static_str("AXPosition");
    let size = CFString::from_static_str("AXSize");
    let (Some(at), Some(big)) = (
        geometry::<CGPoint>(window, &position, POINT),
        geometry::<CGSize>(window, &size, SIZE),
    ) else {
        return;
    };
    let fills = attribute(window, &CFString::from_static_str("AXSubrole"))
        .and_then(|one| one.downcast_ref::<CFString>().map(ToString::to_string))
        .is_some_and(|subrole| subrole == "AXStandardWindow");
    let goes = placed(fills, big, screen);
    if there(CGRect::new(at, big), goes, fills) {
        return;
    }
    set_geometry(window, &position, POINT, &goes.origin);
    if fills {
        // Put below the menu bar, it fills what is left.
        let landed = geometry::<CGPoint>(window, &position, POINT).unwrap_or(goes.origin);
        let left = CGSize::new(
            goes.size.width,
            (goes.origin.y + goes.size.height - landed.y).max(100.0),
        );
        set_geometry(window, &size, SIZE, &left);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> CGRect {
        CGRect::new(CGPoint::new(x, y), CGSize::new(w, h))
    }

    #[test]
    fn fills_the_display_with_a_main_window_and_centres_the_rest() {
        let screen = rect(3000.0, 1000.0, 800.0, 600.0);
        assert_eq!(placed(true, CGSize::new(10.0, 10.0), screen), screen);
        assert_eq!(
            placed(false, CGSize::new(400.0, 200.0), screen),
            rect(3200.0, 1200.0, 400.0, 200.0)
        );
        assert_eq!(
            placed(false, CGSize::new(1000.0, 200.0), screen),
            rect(3000.0, 1200.0, 800.0, 200.0)
        );
    }

    #[test]
    fn leaves_a_window_that_is_where_it_goes() {
        let screen = rect(3000.0, 1000.0, 800.0, 600.0);
        assert!(there(rect(3000.0, 1025.0, 800.0, 575.0), screen, true));
        assert!(!there(rect(0.0, 25.0, 800.0, 575.0), screen, true));
        assert!(there(rect(3200.0, 1200.0, 400.0, 200.0), screen, false));
    }
}
