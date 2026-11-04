//! A display of an application's own (issue 1063, step 3): an X server with no screen,
//! Xvfb, so the application draws where nothing of the reader's desktop is and nothing
//! it does reaches their mouse or keyboard. Step 4 reads its pictures off it (`XShm`).
//!
//! X11 rather than a headless Wayland compositor for now: GTK, Qt, SDL and Electron all
//! still speak it, every Wayland desktop runs X11 applications through Xwayland anyway,
//! and one kind of display is one capture to write. A program that speaks only Wayland
//! is the reason to add weston's headless backend later.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// The display numbers tried, clear of the ones a desktop and `ssh -X` use.
const NUMBERS: std::ops::Range<u32> = 100..400;
/// How long Xvfb has to put its socket down.
const READY_WITHIN: Duration = Duration::from_secs(5);

/// A running display: its number and the server.
pub struct Display {
    pub number: u32,
    server: Child,
}

/// The first number nobody holds: no lock file and no socket under `root` (`/tmp`).
pub fn free_number(root: &Path) -> Option<u32> {
    NUMBERS.into_iter().find(|number| {
        !root.join(format!(".X{number}-lock")).exists()
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
        let pixels = (css * dpr).round().clamp(64.0, 16_384.0) as u32;
        pixels & !1
    };
    (side(width), side(height))
}

/// Whether Xvfb is installed.
pub fn available() -> bool {
    super::installed::on_path("Xvfb")
}

impl Display {
    /// Starts one at this size and waits for its socket.
    pub fn start(width: u32, height: u32, dpr: f64) -> Result<Display, String> {
        let root = Path::new("/tmp");
        let number = free_number(root).ok_or("no display number is free")?;
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a ratio the wire holds to at most 8"
        )]
        let dpi = (96.0 * dpr.clamp(0.5, 8.0)).round() as u32;
        let server = Command::new("Xvfb")
            .arg(format!(":{number}"))
            .args(["-screen", "0", &format!("{width}x{height}x24")])
            .args(["-dpi", &dpi.to_string()])
            .args(["-nolisten", "tcp", "-noreset"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Xvfb: {error}"))?;
        let mut display = Display { number, server };
        let socket = root.join(format!(".X11-unix/X{number}"));
        let began = Instant::now();
        while !socket.exists() {
            if let Ok(Some(_)) = display.server.try_wait() {
                return Err("Xvfb ended as it started".to_owned());
            }
            if began.elapsed() > READY_WITHIN {
                display.end();
                return Err("Xvfb did not start in time".to_owned());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Ok(display)
    }

    /// What an application is told its display is.
    pub fn name(&self) -> String {
        format!(":{}", self.number)
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
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn makes_the_screen_in_even_device_pixels() {
        assert_eq!(screen(1200.0, 800.0, 2.0), (2400, 1600));
        assert_eq!(screen(1001.0, 701.5, 1.0), (1000, 702));
        assert_eq!(screen(10.0, 10.0, 1.0), (64, 64));
    }
}
