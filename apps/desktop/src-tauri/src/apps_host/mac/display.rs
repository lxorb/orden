//! A display of an application's own on a Mac (issue 1063, step 8; docs/apps.md): a
//! monitor that is not there, made with `CGVirtualDisplay`, as `DeskPad`,
//! `BetterDisplay` and Chromium's own tests make theirs.
//!
//! **A private class.** `CGVirtualDisplay` and its descriptor, settings and mode are in
//! `CoreGraphics` with no header of Apple's, so they are reached through the Objective-C
//! runtime by name; a macOS without them is a Mac that cannot host (`available`), and the
//! tab says so as it does for Windows.
//!
//! **Out of the way.** A new display is put where the system puts one, beside the others,
//! where the reader's pointer would wander onto it; it is moved to the far corner of
//! everything else, touching it at one point only, so that a pointer reaches it only by
//! being pushed through that corner.
//!
//! **One thread holds them.** The objects are made, changed and let go on a thread of
//! this module's own, which a `Display` asks; nothing of the runtime's crosses threads.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBeginDisplayConfiguration, CGCompleteDisplayConfiguration, CGConfigureDisplayOrigin,
    CGConfigureOption, CGDirectDisplayID, CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayMode,
    CGError, CGGetActiveDisplayList,
};
use objc2_foundation::{NSArray, NSString};

/// The largest display made, in device pixels: room for a 6K monitor either way up.
const MOST_PIXELS: u32 = 6144;
/// How long a display has to come up once made.
const COMES_UP_WITHIN: Duration = Duration::from_secs(3);

/// What the display thread is asked.
enum Ask {
    Make {
        width: u32,
        height: u32,
        dpr: f64,
        made: Sender<Result<CGDirectDisplayID, String>>,
    },
    Fit {
        id: CGDirectDisplayID,
        width: u32,
        height: u32,
        dpr: f64,
    },
    End {
        id: CGDirectDisplayID,
    },
}

/// One display of an application's own; dropped, it goes.
pub struct Display {
    pub id: CGDirectDisplayID,
    asks: Sender<Ask>,
}

/// Whether this Mac can make a display that is not there.
pub fn available() -> bool {
    AnyClass::get(c"CGVirtualDisplay").is_some()
        && AnyClass::get(c"CGVirtualDisplayDescriptor").is_some()
        && AnyClass::get(c"CGVirtualDisplaySettings").is_some()
        && AnyClass::get(c"CGVirtualDisplayMode").is_some()
}

/// The device pixels of a view: its CSS pixels at its ratio, each side even and at
/// least 64, at most `MOST_PIXELS`.
pub fn screen(width: f64, height: f64, dpr: f64) -> (u32, u32) {
    let side = |css: f64| {
        let pixels = (css * dpr.clamp(1.0, 4.0)).round();
        let pixels = if pixels.is_finite() { pixels } else { 0.0 };
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "clamped to 64..=MOST_PIXELS first"
        )]
        let whole = pixels.clamp(64.0, f64::from(MOST_PIXELS)) as u32;
        whole & !1
    };
    (side(width), side(height))
}

impl Display {
    /// A display of `width` by `height` device pixels at `dpr`, out of the way.
    pub fn start(width: u32, height: u32, dpr: f64) -> Result<Display, String> {
        let asks = thread()?;
        let (made, answer) = mpsc::channel();
        asks.send(Ask::Make {
            width,
            height,
            dpr,
            made,
        })
        .map_err(|_| "the display thread has gone")?;
        let id = answer
            .recv_timeout(COMES_UP_WITHIN * 2)
            .map_err(|_| "the display did not come up")??;
        Ok(Display { id, asks })
    }

    /// Made another size and ratio: the holder's tab changed.
    pub fn fit(&self, width: u32, height: u32, dpr: f64) {
        let _ = self.asks.send(Ask::Fit {
            id: self.id,
            width,
            height,
            dpr,
        });
    }
}

impl Drop for Display {
    fn drop(&mut self) {
        let _ = self.asks.send(Ask::End { id: self.id });
    }
}

/// A display's size in device pixels, as its mode is now.
pub fn pixels_of(id: CGDirectDisplayID) -> (usize, usize) {
    let mode = CGDisplayCopyDisplayMode(id);
    (
        CGDisplayMode::pixel_width(mode.as_deref()),
        CGDisplayMode::pixel_height(mode.as_deref()),
    )
}

/// The display thread, started the first time a display is asked for.
fn thread() -> Result<Sender<Ask>, String> {
    static ASKS: OnceLock<Option<Sender<Ask>>> = OnceLock::new();
    ASKS.get_or_init(|| {
        let (asks, heard) = mpsc::channel();
        std::thread::Builder::new()
            .name("app displays".to_owned())
            .spawn(move || serve(&heard))
            .ok()?;
        Some(asks)
    })
    .clone()
    .ok_or_else(|| "the display thread did not start".to_owned())
}

/// Every display made, held until it is let go.
fn serve(heard: &Receiver<Ask>) {
    let mut held: Vec<(CGDirectDisplayID, Retained<AnyObject>)> = Vec::new();
    for ask in heard {
        match ask {
            Ask::Make {
                width,
                height,
                dpr,
                made,
            } => {
                let answer = make(width, height, dpr).map(|(id, display)| {
                    held.push((id, display));
                    id
                });
                let _ = made.send(answer);
            }
            Ask::Fit {
                id,
                width,
                height,
                dpr,
            } => {
                if let Some((_, display)) = held.iter().find(|(one, _)| *one == id) {
                    if apply(display, width, height, dpr) {
                        out_of_the_way(id);
                    }
                }
            }
            Ask::End { id } => held.retain(|(one, _)| *one != id),
        }
    }
}

/// Makes one display and waits for it to come up.
#[allow(
    unsafe_code,
    reason = "CGVirtualDisplay has no header; its selectors are sent through the runtime"
)]
fn make(
    width: u32,
    height: u32,
    dpr: f64,
) -> Result<(CGDirectDisplayID, Retained<AnyObject>), String> {
    let class = |name: &std::ffi::CStr| AnyClass::get(name).ok_or("no virtual displays here");
    let descriptor_class = class(c"CGVirtualDisplayDescriptor")?;
    let display_class = class(c"CGVirtualDisplay")?;
    let name = NSString::from_str("Orden");
    // SAFETY: each selector is the class's own, as `DeskPad` and Chromium's
    // `virtual_display_mac_util.mm` declare them, with the argument types they take.
    let display: Option<Retained<AnyObject>> = unsafe {
        let descriptor: Retained<AnyObject> = msg_send![descriptor_class, new];
        let queue = dispatch2::DispatchQueue::main();
        let () = msg_send![&*descriptor, setQueue: queue];
        let () = msg_send![&*descriptor, setName: &*name];
        let () = msg_send![&*descriptor, setMaxPixelsWide: MOST_PIXELS];
        let () = msg_send![&*descriptor, setMaxPixelsHigh: MOST_PIXELS];
        // A 27-inch monitor's, which is what its pixels' ratio is read against.
        let () = msg_send![&*descriptor, setSizeInMillimeters: CGSize::new(597.0, 336.0)];
        let () = msg_send![&*descriptor, setVendorID: 0x4f52_u32];
        let () = msg_send![&*descriptor, setProductID: 0x0444_u32];
        let () = msg_send![&*descriptor, setSerialNum: std::process::id()];
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![display_class, alloc];
        msg_send![allocated, initWithDescriptor: &*descriptor]
    };
    let display = display.ok_or("the display was not made")?;
    // SAFETY: `displayID` is a read-only property of the display just made.
    let id: CGDirectDisplayID = unsafe { msg_send![&*display, displayID] };
    if id == 0 || !apply(&display, width, height, dpr) {
        return Err("the display took no mode".to_owned());
    }
    let until = Instant::now() + COMES_UP_WITHIN;
    while !active().contains(&id) {
        if Instant::now() > until {
            return Err("the display did not come up".to_owned());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    out_of_the_way(id);
    Ok((id, display))
}

/// Gives a display the one mode it has: the holder's size, Retina where the holder's
/// screen is.
#[allow(
    unsafe_code,
    reason = "CGVirtualDisplaySettings and its mode are reached through the runtime"
)]
fn apply(display: &AnyObject, width: u32, height: u32, dpr: f64) -> bool {
    let (Some(settings_class), Some(mode_class)) = (
        AnyClass::get(c"CGVirtualDisplaySettings"),
        AnyClass::get(c"CGVirtualDisplayMode"),
    ) else {
        return false;
    };
    let retina = dpr >= 1.5;
    // SAFETY: as in `make`; `initWithWidth:height:refreshRate:` takes two unsigned ints
    // and a double, `setModes:` an array of modes, `applySettings:` the settings.
    unsafe {
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![mode_class, alloc];
        let mode: Option<Retained<AnyObject>> =
            msg_send![allocated, initWithWidth: width, height: height, refreshRate: 60.0_f64];
        let Some(mode) = mode else {
            return false;
        };
        let modes = NSArray::from_retained_slice(&[mode]);
        let settings: Retained<AnyObject> = msg_send![settings_class, new];
        let () = msg_send![&*settings, setHiDPI: u32::from(retina)];
        let () = msg_send![&*settings, setModes: &*modes];
        let applied: Bool = msg_send![display, applySettings: &*settings];
        applied.as_bool()
    }
}

/// The displays that are up.
#[allow(
    unsafe_code,
    reason = "CGGetActiveDisplayList writes into a buffer the caller hands it"
)]
fn active() -> Vec<CGDirectDisplayID> {
    let mut ids = [0 as CGDirectDisplayID; 32];
    let mut count = 0_u32;
    // SAFETY: the buffer holds 32 ids, which is what it is told.
    let said = unsafe { CGGetActiveDisplayList(32, ids.as_mut_ptr(), &raw mut count) };
    if said != CGError::Success {
        return Vec::new();
    }
    ids[..usize::try_from(count).unwrap_or(0).min(32)].to_vec()
}

/// Where a display goes: at the far corner of everything else, below and to the right,
/// touching it at its corner only.
pub fn corner(others: &[CGRect]) -> CGPoint {
    let right = others
        .iter()
        .map(|one| one.origin.x + one.size.width)
        .fold(0.0, f64::max);
    let bottom = others
        .iter()
        .map(|one| one.origin.y + one.size.height)
        .fold(0.0, f64::max);
    CGPoint::new(right, bottom)
}

/// Moves a display to the far corner of the others, for this login only.
#[allow(
    unsafe_code,
    reason = "a display configuration is a handle CoreGraphics hands out and takes back"
)]
fn out_of_the_way(id: CGDirectDisplayID) {
    let others: Vec<CGRect> = active()
        .into_iter()
        .filter(|&one| one != id)
        .map(|one| CGDisplayBounds(one))
        .collect();
    if others.is_empty() {
        return;
    }
    let at = corner(&others);
    #[allow(
        clippy::cast_possible_truncation,
        reason = "display origins are whole points well within an i32"
    )]
    let (x, y) = (at.x.round() as i32, at.y.round() as i32);
    let mut config = std::ptr::null_mut();
    // SAFETY: the configuration is begun, used and completed (or cancelled) here only.
    unsafe {
        if CGBeginDisplayConfiguration(&raw mut config) != CGError::Success {
            return;
        }
        if CGConfigureDisplayOrigin(config, id, x, y) != CGError::Success {
            objc2_core_graphics::CGCancelDisplayConfiguration(config);
            return;
        }
        CGCompleteDisplayConfiguration(config, CGConfigureOption::ForSession);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_the_holders_view_device_pixels_even_and_bounded() {
        assert_eq!(screen(800.0, 600.0, 2.0), (1600, 1200));
        assert_eq!(screen(801.0, 10.0, 1.0), (800, 64));
        assert_eq!(screen(100_000.0, 500.0, 2.0), (MOST_PIXELS, 1000));
    }

    #[test]
    fn goes_to_the_far_corner_of_the_others() {
        let main = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1512.0, 982.0));
        let beside = CGRect::new(CGPoint::new(1512.0, -200.0), CGSize::new(1920.0, 1080.0));
        let at = corner(&[main, beside]);
        assert!((at.x - 3432.0).abs() < f64::EPSILON);
        assert!((at.y - 982.0).abs() < f64::EPSILON);
    }
}
