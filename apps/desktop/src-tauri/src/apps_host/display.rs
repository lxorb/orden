use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use x11rb::connection::{Connection as _, RequestConnection};
use x11rb::cookie::VoidCookie;
use x11rb::errors::ReplyError;
use x11rb::protocol::randr::{self, ConnectionExt as _};
use x11rb::protocol::xproto::ConnectionExt as _;

use super::clipboard::Clipboard;
use super::wm::Desk;

const NUMBERS: std::ops::Range<u32> = 100..400;
const READY_WITHIN: Duration = Duration::from_secs(5);
const ROOM: u32 = 4096;
const MOST: u32 = 8192;
const LEAST: u32 = 64;
const TRIES: usize = 8;

enum Starting {
    Taken,
    Failed(String),
}

pub struct Display {
    pub number: u32,
    server: Child,
    room: (u32, u32),
    desk: Option<Desk>,
}

pub fn free_number(root: &Path) -> Option<u32> {
    NUMBERS.into_iter().find(|number| {
        !root.join(format!(".X{number}-lock")).exists()
            && !root.join(format!(".tX{number}-lock")).exists()
            && !root.join(format!(".X11-unix/X{number}")).exists()
    })
}

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

pub fn room(width: u32, height: u32) -> (u32, u32) {
    (width.clamp(ROOM, MOST), height.clamp(ROOM, MOST))
}

pub fn within(size: (u32, u32), room: (u32, u32)) -> (u32, u32) {
    let even = |one: u32, most: u32| one.clamp(LEAST, most) & !1;
    (even(size.0, room.0), even(size.1, room.1))
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a ratio the wire holds to at most 8"
)]
pub fn dpi(dpr: f64) -> u32 {
    (96.0 * ratio(dpr)).round() as u32
}

pub fn ratio(dpr: f64) -> f64 {
    if dpr.is_finite() {
        dpr.clamp(0.5, 8.0)
    } else {
        1.0
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a side of at most 8192 pixels"
)]
fn millimetres(pixels: u32, dpr: f64) -> u32 {
    (f64::from(pixels) * 25.4 / f64::from(dpi(dpr))).round() as u32
}

pub fn available() -> bool {
    super::installed::on_path("Xvfb")
}

impl Display {
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

    pub fn name(&self) -> String {
        format!(":{}", self.number)
    }

    pub fn clipboard(&self) -> Option<Arc<Clipboard>> {
        self.desk.as_ref().map(|desk| desk.clipboard().clone())
    }

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
    let _ = checked(x, x.randr_add_output_mode(output, mode)?);

    let now = x.get_geometry(root)?.reply()?;
    let (millis_wide, millis_high) = (millimetres(width, dpr), millimetres(height, dpr));
    let grown = (wide.max(now.width), high.max(now.height));
    if grown != (now.width, now.height) {
        checked(
            x,
            x.randr_set_screen_size(
                root,
                grown.0,
                grown.1,
                millimetres(u32::from(grown.0), dpr),
                millimetres(u32::from(grown.1), dpr),
            )?,
        )?;
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
    checked(
        x,
        x.randr_set_screen_size(root, wide, high, millis_wide, millis_high)?,
    )?;

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
        let _ = checked(x, x.randr_delete_output_mode(output, old.id)?);
        let _ = checked(x, x.randr_destroy_mode(old.id)?);
    }
    Ok(())
}

pub fn checked<C: RequestConnection>(x: &C, cookie: VoidCookie<'_, C>) -> Result<(), ReplyError> {
    let after = x.get_input_focus()?;
    let said = cookie.check();
    drop(after);
    said
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_answers_though_the_requests_own_event_was_read_first() {
        use x11rb::protocol::xproto::{AtomEnum, ChangeWindowAttributesAux, EventMask, PropMode};
        use x11rb::protocol::Event;
        use x11rb::wrapper::ConnectionExt as _;

        super::super::in_time(|| {
            if !available() {
                assert!(
                    std::env::var_os("CI").is_none(),
                    "CI installs xvfb for this test"
                );
                return;
            }
            let display = Display::start(320, 240, 1.0).unwrap();
            let (x, screen) = x11rb::connect(Some(display.name().as_str())).unwrap();
            let root = x.setup().roots[screen].root;
            checked(
                &x,
                x.change_window_attributes(
                    root,
                    &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
                )
                .unwrap(),
            )
            .unwrap();
            let asked = x
                .change_property8(
                    PropMode::REPLACE,
                    root,
                    AtomEnum::WM_NAME,
                    AtomEnum::STRING,
                    b"orden",
                )
                .unwrap();
            x.flush().unwrap();
            let event = x.wait_for_event().unwrap();
            assert!(matches!(event, Event::PropertyNotify(_)), "{event:?}");
            checked(&x, asked).unwrap();
        });
    }

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

    #[test]
    fn fits_the_screen_to_the_view_as_it_changes() {
        super::super::in_time(|| {
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
        });
    }
}
