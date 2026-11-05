//! A display of an application's own (issue 1063, step 3): an X server with no screen,
//! Xvfb, so the application draws where nothing of the reader's desktop is and nothing
//! it does reaches their mouse or keyboard. Its picture is read off it as it changes
//! (`capture.rs`).
//!
//! X11 rather than a headless Wayland compositor for now: GTK, Qt, SDL and Electron all
//! still speak it, every Wayland desktop runs X11 applications through Xwayland anyway,
//! and one kind of display is one capture to write. A program that speaks only Wayland
//! is the reason to add weston's headless backend later.
//!
//! **Its size is the holder's tab's** (step 5), in device pixels, and follows it live:
//! the tab resized, moved to another monitor, or taken over by another device. Xvfb's
//! screen cannot grow once it has started, so it is made at the largest size it may take
//! (at least `ROOM` on each side, more if the first view is larger), and `RandR` sets the
//! part of it in use, which is what applications and the picture see. The window manager
//! (`wm.rs`) fits the application's windows to it, and says the ratio to the toolkits.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use x11rb::connection::{Connection as _, RequestConnection as _};
use x11rb::protocol::randr::{self, ConnectionExt as _};
use x11rb::protocol::xproto::ConnectionExt as _;

use super::clipboard::Clipboard;
use super::wm::Desk;

/// The display numbers tried, clear of the ones a desktop and `ssh -X` use.
const NUMBERS: std::ops::Range<u32> = 100..400;
/// How long Xvfb has to put its socket down.
const READY_WITHIN: Duration = Duration::from_secs(5);
/// The room a display is made with on each side, whatever its first view: a 4K monitor's
/// whole width either way up. Xvfb fills its whole screen as it starts, so this is memory
/// taken (64 MiB) for as long as the application runs.
const ROOM: u32 = 4096;
/// The most a side may be, as X counts it.
const MOST: u32 = 8192;
/// The smallest a side is made.
const LEAST: u32 = 64;
/// How many numbers a display tries before it gives up.
const TRIES: usize = 8;

/// Why one try at a display did not start it.
enum Starting {
    /// Its number was another display's, which began at the same moment.
    Taken,
    Failed(String),
}

/// A running display: its number, the server, and its window manager.
pub struct Display {
    pub number: u32,
    server: Child,
    /// The size its screen was made at, which it is never made larger than.
    room: (u32, u32),
    desk: Option<Desk>,
}

/// The first number nobody holds: no lock file, no lock being made (a server's
/// `.tX` file, which one ended as it began leaves behind) and no socket under `root`
/// (`/tmp`).
pub fn free_number(root: &Path) -> Option<u32> {
    NUMBERS.into_iter().find(|number| {
        !root.join(format!(".X{number}-lock")).exists()
            && !root.join(format!(".tX{number}-lock")).exists()
            && !root.join(format!(".X11-unix/X{number}")).exists()
    })
}

/// The size the screen is made in device pixels, for a view in CSS pixels at a ratio:
/// even, since encoders want it so, and at least a small window's.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to a screen's size first"
)]
pub fn screen(width: f64, height: f64, dpr: f64) -> (u32, u32) {
    let side = |css: f64| {
        let pixels = (css * dpr).round().clamp(f64::from(LEAST), f64::from(MOST)) as u32;
        pixels & !1
    };
    (side(width), side(height))
}

/// The room a display is made with for its first size: `ROOM` a side, or the size itself
/// where that is larger.
pub fn room(width: u32, height: u32) -> (u32, u32) {
    (width.clamp(ROOM, MOST), height.clamp(ROOM, MOST))
}

/// A size kept within the room, even.
pub fn within(size: (u32, u32), room: (u32, u32)) -> (u32, u32) {
    let even = |one: u32, most: u32| one.clamp(LEAST, most) & !1;
    (even(size.0, room.0), even(size.1, room.1))
}

/// Dots an inch at a ratio, as X and the toolkits read them: 96 at 1.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a ratio the wire holds to at most 8"
)]
pub fn dpi(dpr: f64) -> u32 {
    (96.0 * ratio(dpr)).round() as u32
}

/// A ratio a display may be given.
pub fn ratio(dpr: f64) -> f64 {
    if dpr.is_finite() {
        dpr.clamp(0.5, 8.0)
    } else {
        1.0
    }
}

/// Millimetres a side of so many pixels is at a ratio, which `RandR` is told.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a side of at most 8192 pixels"
)]
fn millimetres(pixels: u32, dpr: f64) -> u32 {
    (f64::from(pixels) * 25.4 / f64::from(dpi(dpr))).round() as u32
}

/// Whether Xvfb is installed.
pub fn available() -> bool {
    super::installed::on_path("Xvfb")
}

impl Display {
    /// Starts one at this size and ratio, waits for its socket, and starts its window
    /// manager. A number taken by another display starting at the same moment - two
    /// applications at once - is given up for the next.
    pub fn start(width: u32, height: u32, dpr: f64) -> Result<Display, String> {
        for _ in 0..TRIES {
            match Display::start_once(width, height, dpr) {
                Ok(display) => return Ok(display),
                Err(Starting::Taken) => {}
                Err(Starting::Failed(why)) => return Err(why),
            }
        }
        Err("no display number would start".to_owned())
    }

    fn start_once(width: u32, height: u32, dpr: f64) -> Result<Display, Starting> {
        let root = Path::new("/tmp");
        let number =
            free_number(root).ok_or(Starting::Failed("no display number is free".to_owned()))?;
        let largest = room(width, height);
        let mut server = Command::new("Xvfb")
            .arg(format!(":{number}"))
            .args(["-screen", "0", &format!("{}x{}x24", largest.0, largest.1)])
            .args(["-dpi", &dpi(dpr).to_string()])
            .args(["-nolisten", "tcp", "-noreset"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| Starting::Failed(format!("Xvfb: {error}")))?;
        // Ready once its socket is down and the lock is its own: a socket and a lock of
        // another display that took the number first are not this one's.
        let socket = root.join(format!(".X11-unix/X{number}"));
        let lock = root.join(format!(".X{number}-lock"));
        let began = Instant::now();
        loop {
            let holder = std::fs::read_to_string(&lock)
                .ok()
                .and_then(|text| text.trim().parse::<u32>().ok());
            if holder == Some(server.id()) && socket.exists() {
                break;
            }
            let gone = matches!(server.try_wait(), Ok(Some(_)));
            if gone || holder.is_some_and(|pid| pid != server.id()) {
                let _ = server.kill();
                let _ = server.wait();
                return Err(Starting::Taken);
            }
            if began.elapsed() > READY_WITHIN {
                // Waiting on a number something else holds in a way not seen here: the
                // next one is tried.
                let _ = server.kill();
                let _ = server.wait();
                return Err(Starting::Taken);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let mut display = Display {
            number,
            server,
            room: largest,
            desk: None,
        };
        display.desk = Some(Desk::open(&display.name(), dpr).map_err(Starting::Failed)?);
        display.fit(width, height, dpr).map_err(Starting::Failed)?;
        Ok(display)
    }

    /// What an application is told its display is.
    pub fn name(&self) -> String {
        format!(":{}", self.number)
    }

    /// Its clipboard (`clipboard.rs`).
    pub fn clipboard(&self) -> Option<Arc<Clipboard>> {
        self.desk.as_ref().map(|desk| desk.clipboard().clone())
    }

    /// Makes the screen this size, within its room, at this ratio: `RandR`'s screen and
    /// its one monitor, and the window manager told, which fits the windows to it.
    pub fn fit(&self, width: u32, height: u32, dpr: f64) -> Result<(), String> {
        let desk = self
            .desk
            .as_ref()
            .ok_or("the display has no window manager")?;
        let (width, height) = within((width, height), self.room);
        resize(desk, width, height, dpr).map_err(|error| format!("RandR: {error}"))?;
        desk.scale(dpr);
        Ok(())
    }

    /// Ends the server, and takes away the lock and the socket it leaves when it is
    /// ended this way, or every display would leave its number taken for good.
    pub fn end(&mut self) {
        if let Ok(None) = self.server.try_wait() {
            let _ = self.server.kill();
        }
        if self.server.wait().is_ok() {
            let root = Path::new("/tmp");
            let _ = std::fs::remove_file(root.join(format!(".X{}-lock", self.number)));
            let _ = std::fs::remove_file(root.join(format!(".X11-unix/X{}", self.number)));
        }
    }
}

impl Drop for Display {
    fn drop(&mut self) {
        self.end();
    }
}

/// Sets `RandR`'s screen and its one monitor to a size, with a mode of that size made if
/// there is none, and the modes made before for other sizes taken away. The screen must
/// hold the monitor at every moment, so it grows first, then the monitor changes, then
/// it shrinks.
fn resize(
    desk: &Desk,
    width: u32,
    height: u32,
    dpr: f64,
) -> Result<(), Box<dyn std::error::Error>> {
    let x = desk.connection();
    let root = desk.root();
    let (wide, high) = (u16::try_from(width)?, u16::try_from(height)?);
    x.extension_information(randr::X11_EXTENSION_NAME)?
        .ok_or("the display has no RandR")?;
    let resources = x.randr_get_screen_resources_current(root)?.reply()?;
    let (&crtc, &output) = resources
        .crtcs
        .first()
        .zip(resources.outputs.first())
        .ok_or("the display has no monitor")?;
    let kept = resources
        .modes
        .iter()
        .find(|mode| mode.width == wide && mode.height == high)
        .map(|mode| mode.id);
    let mode = if let Some(mode) = kept {
        mode
    } else {
        let name = format!("{width}x{height}");
        let info = randr::ModeInfo {
            width: wide,
            height: high,
            htotal: wide,
            vtotal: high,
            name_len: u16::try_from(name.len())?,
            ..randr::ModeInfo::default()
        };
        x.randr_create_mode(root, info, name.as_bytes())?
            .reply()?
            .mode
    };
    // Already the monitor's, or added now; an error here says it already was.
    let _ = x.randr_add_output_mode(output, mode)?.check();

    let now = x.get_geometry(root)?.reply()?;
    let (millis_wide, millis_high) = (millimetres(width, dpr), millimetres(height, dpr));
    let grown = (wide.max(now.width), high.max(now.height));
    if grown != (now.width, now.height) {
        x.randr_set_screen_size(
            root,
            grown.0,
            grown.1,
            millimetres(u32::from(grown.0), dpr),
            millimetres(u32::from(grown.1), dpr),
        )?
        .check()?;
    }
    x.randr_set_crtc_config(
        crtc,
        x11rb::CURRENT_TIME,
        resources.config_timestamp,
        0,
        0,
        mode,
        randr::Rotation::ROTATE0,
        &[output],
    )?
    .reply()?;
    x.randr_set_screen_size(root, wide, high, millis_wide, millis_high)?
        .check()?;

    // The modes of the sizes it had before, which nothing shows now. Xvfb's own, the
    // room's, is kept.
    let made_at = x
        .setup()
        .roots
        .first()
        .map(|one| (one.width_in_pixels, one.height_in_pixels))
        .unwrap_or_default();
    for old in &resources.modes {
        if old.id == mode || (old.width, old.height) == made_at {
            continue;
        }
        let _ = x.randr_delete_output_mode(output, old.id)?.check();
        let _ = x.randr_destroy_mode(old.id)?.check();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_first_number_with_no_lock_and_no_socket() {
        let root = std::env::temp_dir().join(format!("orden-display-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".X11-unix")).unwrap();
        assert_eq!(free_number(&root), Some(100));
        std::fs::write(root.join(".X100-lock"), "").unwrap();
        std::fs::write(root.join(".X11-unix/X101"), "").unwrap();
        assert_eq!(free_number(&root), Some(102));
        std::fs::write(root.join(".tX102-lock"), "").unwrap();
        assert_eq!(free_number(&root), Some(103));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn makes_the_screen_in_even_device_pixels() {
        assert_eq!(screen(1200.0, 800.0, 2.0), (2400, 1600));
        assert_eq!(screen(1001.0, 701.5, 1.0), (1000, 702));
        assert_eq!(screen(10.0, 10.0, 1.0), (64, 64));
        assert_eq!(screen(9000.0, 100.0, 2.0), (8192, 200));
    }

    #[test]
    fn makes_room_for_a_4k_monitor_either_way_up_and_never_grows_past_it() {
        assert_eq!(room(1280, 800), (4096, 4096));
        assert_eq!(room(5120, 2880), (5120, 4096));
        assert_eq!(within((5000, 801), (4096, 4096)), (4096, 800));
        assert_eq!(within((10, 3), (4096, 4096)), (64, 64));
    }

    #[test]
    fn reads_a_ratio_as_dots_an_inch() {
        assert_eq!(dpi(1.0), 96);
        assert_eq!(dpi(2.0), 192);
        assert_eq!(dpi(1.25), 120);
        assert_eq!(dpi(f64::NAN), 96);
        assert_eq!(millimetres(1920, 1.0), 508);
    }

    /// A real Xvfb, made at one size and fitted to others: larger, smaller, past its
    /// room. CI installs Xvfb; elsewhere the test says nothing without it.
    #[test]
    fn fits_the_screen_to_the_view_as_it_changes() {
        use x11rb::connection::Connection as _;

        if !available() {
            assert!(
                std::env::var_os("CI").is_none(),
                "CI installs xvfb for this test"
            );
            return;
        }
        let display = Display::start(640, 480, 1.0).unwrap();
        let (x, screen) = x11rb::connect(Some(display.name().as_str())).unwrap();
        let root = x.setup().roots[screen].root;
        let size = || {
            let at = x.get_geometry(root).unwrap().reply().unwrap();
            (at.width, at.height)
        };
        assert_eq!(size(), (640, 480));
        display.fit(1600, 1000, 2.0).unwrap();
        assert_eq!(size(), (1600, 1000));
        display.fit(800, 600, 1.0).unwrap();
        assert_eq!(size(), (800, 600));
        display.fit(800, 600, 1.0).unwrap();
        assert_eq!(size(), (800, 600));
        display.fit(9000, 600, 1.0).unwrap();
        assert_eq!(size(), (4096, 600));
        // The monitor is the screen's size too, as toolkits read it.
        let resources = x
            .randr_get_screen_resources_current(root)
            .unwrap()
            .reply()
            .unwrap();
        let crtc = x
            .randr_get_crtc_info(resources.crtcs[0], 0)
            .unwrap()
            .reply()
            .unwrap();
        assert_eq!((crtc.width, crtc.height), (4096, 600));
        assert!(
            resources.modes.len() <= 2,
            "{} modes",
            resources.modes.len()
        );
    }
}
