//! The picture of an application's display, read as it changes (issue 1063, step 5;
//! docs/apps.md), and the shape of its pointer.
//!
//! **Only when something changed.** The display's DAMAGE says when anything is drawn
//! on it; nothing drawn, nothing is read, encoded or sent, so a still application costs
//! the host and the network nothing. What is drawn faster than the holder's screen
//! refreshes is read once a refresh.
//!
//! **Read in shared memory** (MIT-SHM): the server copies the screen into a segment both
//! map, rather than down the socket, as ffmpeg's `x11grab` reads it. The segment is the
//! screen's size, made again when the screen is.
//!
//! **The pointer is not in the picture.** The holder's own pointer is over the tab, where
//! it moves with no delay; the application's shape for it - a text bar, a hand, a resize
//! arrow, or none - is sent to the tab whenever it changes (XFIXES), as a PNG, and the
//! tab draws its pointer so.
//!
//! One thread waits on the display and says what it saw to whoever reads the picture
//! (`News`); it ends when the capture does, or the display.

use std::sync::mpsc::Sender;
use std::sync::Arc;

use base64::Engine as _;

use x11rb::connection::{Connection as _, RequestConnection as _};
use x11rb::protocol::damage::{self, ConnectionExt as _};
use x11rb::protocol::shm::{self, ConnectionExt as _};
use x11rb::protocol::xfixes::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{
    ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt as _, CreateWindowAux, EventMask,
    ImageFormat, Window, WindowClass,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::NONE;

/// What the thread that reads the picture hears: what the display's thread saw, and
/// what the connection to the tab asked.
#[derive(Debug, PartialEq)]
pub enum News {
    /// Something was drawn.
    Drawn,
    /// The screen was made another size.
    Resized,
    /// The pointer's shape changed: the message the tab is sent.
    Pointer(String),
    /// The holder's tab asked for a whole picture, its last having been lost on the way.
    Whole,
    /// The display has gone.
    Gone,
}

/// A segment of memory shared with the server, mapped here to read.
struct Mapped {
    at: *mut libc::c_void,
    length: usize,
}

impl Mapped {
    /// Maps the segment the server made, by the descriptor it handed over, to read.
    #[allow(
        unsafe_code,
        reason = "mmap(2) is how memory shared with the X server is read; nothing safe wraps it"
    )]
    fn new(descriptor: &std::os::fd::OwnedFd, length: usize) -> Option<Mapped> {
        use std::os::fd::AsRawFd as _;
        // SAFETY: a fresh mapping of a descriptor this holds, at an address the kernel
        // chooses; nothing of ours is touched.
        let at = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                length,
                libc::PROT_READ,
                libc::MAP_SHARED,
                descriptor.as_raw_fd(),
                0,
            )
        };
        (at != libc::MAP_FAILED).then_some(Mapped { at, length })
    }

    /// The bytes the server last wrote.
    #[allow(
        unsafe_code,
        reason = "the mapped segment, read as the bytes it is; see `Mapped::new`"
    )]
    fn bytes(&self, length: usize) -> &[u8] {
        // SAFETY: `at` is a live mapping of `self.length` readable bytes, and the server
        // writes to it only while a `GetImage` of this capture's is answered, which is
        // never while these bytes are borrowed.
        unsafe { std::slice::from_raw_parts(self.at.cast::<u8>(), length.min(self.length)) }
    }
}

impl Drop for Mapped {
    #[allow(
        unsafe_code,
        reason = "munmap(2) undoes the mapping `Mapped::new` made; nothing safe wraps it"
    )]
    fn drop(&mut self) {
        // SAFETY: the mapping is this one's, and nothing borrows it any more.
        unsafe {
            libc::munmap(self.at, self.length);
        }
    }
}

/// A segment the server writes the screen into.
struct Segment {
    id: shm::Seg,
    mapped: Mapped,
    size: (u16, u16),
}

/// The display's picture, read as it changes.
pub struct Capture {
    x: Arc<RustConnection>,
    root: Window,
    damage: damage::Damage,
    segment: Option<Segment>,
    /// A window of this connection's own, which the thread is woken through to end.
    waker: Window,
}

impl Capture {
    /// Watches a display, saying what it sees to `seen`: the pointer's shape as it is
    /// now first, then whatever changes.
    pub fn open(display: &str, seen: Sender<News>) -> Result<Capture, String> {
        let said = |error: &dyn std::fmt::Display| error.to_string();
        let (x, screen) = x11rb::connect(Some(display)).map_err(|e| said(&e))?;
        let root = x
            .setup()
            .roots
            .get(screen)
            .ok_or("the display has no screen")?
            .root;
        let depth_ok = x
            .setup()
            .pixmap_formats
            .iter()
            .any(|one| one.depth == 24 && one.bits_per_pixel == 32);
        if !depth_ok {
            return Err("the display does not keep four bytes a pixel".to_owned());
        }
        for name in [
            shm::X11_EXTENSION_NAME,
            damage::X11_EXTENSION_NAME,
            xfixes::X11_EXTENSION_NAME,
        ] {
            if x.extension_information(name)
                .map_err(|e| said(&e))?
                .is_none()
            {
                return Err(format!("the display has no {name}"));
            }
        }
        let shm = x
            .shm_query_version()
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;
        if (shm.major_version, shm.minor_version) < (1, 2) {
            return Err("the display's MIT-SHM cannot hand a segment over".to_owned());
        }
        // Both have to be asked their version before they are used.
        x.xfixes_query_version(5, 0)
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;
        x.damage_query_version(1, 1)
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;

        let damage = x.generate_id().map_err(|e| said(&e))?;
        x.damage_create(damage, root, damage::ReportLevel::NON_EMPTY)
            .map_err(|e| said(&e))?;
        x.xfixes_select_cursor_input(root, xfixes::CursorNotifyMask::DISPLAY_CURSOR)
            .map_err(|e| said(&e))?;
        // The root's own size changing is the screen's.
        x.change_window_attributes(
            root,
            &ChangeWindowAttributesAux::new().event_mask(EventMask::STRUCTURE_NOTIFY),
        )
        .map_err(|e| said(&e))?;
        let waker = x.generate_id().map_err(|e| said(&e))?;
        x.create_window(
            0,
            waker,
            root,
            -1,
            -1,
            1,
            1,
            0,
            WindowClass::INPUT_ONLY,
            0,
            &CreateWindowAux::new(),
        )
        .map_err(|e| said(&e))?;
        x.flush().map_err(|e| said(&e))?;

        let x = Arc::new(x);
        if let Some(now) = pointer(&x) {
            let _ = seen.send(News::Pointer(now));
        }
        let watching = x.clone();
        std::thread::spawn(move || watch(&watching, root, waker, &seen));
        Ok(Capture {
            x,
            root,
            damage,
            segment: None,
            waker,
        })
    }

    /// The screen as it is now, four bytes a pixel (blue, green, red, unused), and its
    /// size. What is drawn from here on is news again.
    pub fn grab(&mut self) -> Result<(&[u8], (u16, u16)), String> {
        let said = |error: &dyn std::fmt::Display| error.to_string();
        let x = &self.x;
        x.damage_subtract(self.damage, NONE, NONE)
            .map_err(|e| said(&e))?;
        let at = x
            .get_geometry(self.root)
            .map_err(|e| said(&e))?
            .reply()
            .map_err(|e| said(&e))?;
        let size = (at.width, at.height);
        let length = usize::from(size.0) * usize::from(size.1) * 4;
        if self.segment.as_ref().is_none_or(|one| one.size != size) {
            if let Some(old) = self.segment.take() {
                let _ = x.shm_detach(old.id);
            }
            let id = x.generate_id().map_err(|e| said(&e))?;
            let made = x
                .shm_create_segment(id, u32::try_from(length).map_err(|e| said(&e))?, false)
                .map_err(|e| said(&e))?
                .reply()
                .map_err(|e| said(&e))?;
            let mapped =
                Mapped::new(&made.shm_fd, length).ok_or("the segment could not be mapped")?;
            self.segment = Some(Segment { id, mapped, size });
        }
        let segment = self.segment.as_ref().ok_or("no segment")?;
        x.shm_get_image(
            self.root,
            0,
            0,
            size.0,
            size.1,
            u32::MAX,
            ImageFormat::Z_PIXMAP.into(),
            segment.id,
            0,
        )
        .map_err(|e| said(&e))?
        .reply()
        .map_err(|e| said(&e))?;
        Ok((segment.mapped.bytes(length), size))
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let x = &self.x;
        if let Some(old) = self.segment.take() {
            let _ = x.shm_detach(old.id);
        }
        let _ = x.damage_destroy(self.damage);
        let _ = x.send_event(
            false,
            self.waker,
            EventMask::NO_EVENT,
            ClientMessageEvent::new(32, self.waker, NONE, [0; 5]),
        );
        let _ = x.flush();
    }
}

/// The display's thread: what it sees, said until the capture ends or the display does.
fn watch(x: &RustConnection, root: Window, waker: Window, seen: &Sender<News>) {
    loop {
        let Ok(event) = x.wait_for_event() else {
            let _ = seen.send(News::Gone);
            return;
        };
        let news = match event {
            Event::DamageNotify(_) => Some(News::Drawn),
            Event::ConfigureNotify(changed) if changed.window == root => Some(News::Resized),
            Event::XfixesCursorNotify(_) => pointer(x).map(News::Pointer),
            Event::ClientMessage(message) if message.window == waker => return,
            _ => None,
        };
        if let Some(news) = news {
            if seen.send(news).is_err() {
                return;
            }
        }
    }
}

/// The pointer's shape now, as the tab is sent it.
fn pointer(x: &RustConnection) -> Option<String> {
    let image = x.xfixes_get_cursor_image().ok()?.reply().ok()?;
    Some(pointer_text(
        image.width,
        image.height,
        (image.xhot, image.yhot),
        &image.cursor_image,
    ))
}

/// The tab's message for a pointer's shape: `{"t":"pointer","png":...,"x":...,"y":...}`
/// with its hot spot, or `{"t":"pointer","hidden":true}` for a shape with nothing in it,
/// which is how an application hides its pointer.
pub fn pointer_text(width: u16, height: u16, hot: (u16, u16), argb: &[u32]) -> String {
    let count = usize::from(width) * usize::from(height);
    if count == 0 || argb.len() < count || argb[..count].iter().all(|one| one >> 24 == 0) {
        return serde_json::json!({ "t": "pointer", "hidden": true }).to_string();
    }
    let Some(png) = png_of(width, height, &argb[..count]) else {
        return serde_json::json!({ "t": "pointer", "hidden": false }).to_string();
    };
    serde_json::json!({
        "t": "pointer",
        "png": format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ),
        "x": hot.0,
        "y": hot.1,
    })
    .to_string()
}

/// XFIXES's pixels, ARGB with the colour already multiplied by the alpha, as a PNG.
fn png_of(width: u16, height: u16, argb: &[u32]) -> Option<Vec<u8>> {
    let mut rgba = Vec::with_capacity(argb.len() * 4);
    for &pixel in argb {
        let [blue, green, red, alpha] = pixel.to_le_bytes();
        let unmultiplied = |one: u8| {
            if alpha == 0 {
                0
            } else {
                u8::try_from((u32::from(one) * 255 + u32::from(alpha) / 2) / u32::from(alpha))
                    .unwrap_or(u8::MAX)
            }
        };
        rgba.extend_from_slice(&[
            unmultiplied(red),
            unmultiplied(green),
            unmultiplied(blue),
            alpha,
        ]);
    }
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, u32::from(width), u32::from(height));
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(&rgba).ok()?;
    writer.finish().ok()?;
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_the_pointers_shape_as_a_png_with_its_hot_spot() {
        let text = pointer_text(2, 1, (1, 0), &[0xff00_00ff, 0x8000_0080]);
        let said: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(said["t"], "pointer");
        assert_eq!(said["x"], 1);
        assert_eq!(said["y"], 0);
        assert!(said["png"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,iVBOR"));
        assert_eq!(
            pointer_text(2, 1, (0, 0), &[0, 0]),
            r#"{"hidden":true,"t":"pointer"}"#
        );
        assert_eq!(
            pointer_text(0, 0, (0, 0), &[]),
            r#"{"hidden":true,"t":"pointer"}"#
        );
    }

    #[test]
    fn takes_the_alpha_back_out_of_the_colour() {
        let png = png_of(1, 1, &[0x8040_0000]).unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(png));
        let mut reader = decoder.read_info().unwrap();
        let mut pixel = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut pixel).unwrap();
        assert_eq!(pixel, [128, 0, 0, 128]);
    }

    /// On a real Xvfb: the first look has the screen as drawn, nothing more is said
    /// while nothing is drawn, a window drawn is news, and so is the screen resized.
    /// CI installs Xvfb; elsewhere the test says nothing without it.
    #[test]
    fn reads_the_screen_when_it_is_drawn_on_and_not_otherwise() {
        super::super::in_time(|| {
            use std::time::Duration;
            use x11rb::protocol::xproto::Rectangle;

            if !super::super::display::available() {
                assert!(
                    std::env::var_os("CI").is_none(),
                    "CI installs xvfb for this test"
                );
                return;
            }
            let display = super::super::display::Display::start(320, 240, 1.0).unwrap();
            let (sender, seen) = std::sync::mpsc::channel();
            let mut capture = Capture::open(&display.name(), sender).unwrap();
            assert!(matches!(
                seen.recv_timeout(Duration::from_secs(2)),
                Ok(News::Pointer(_))
            ));
            // What was drawn as it started is in the first look.
            while seen.recv_timeout(Duration::from_millis(100)).is_ok() {}
            let (bytes, size) = capture.grab().unwrap();
            assert_eq!(size, (320, 240));
            assert_eq!(bytes.len(), 320 * 240 * 4);
            let still = seen.recv_timeout(Duration::from_millis(300));
            assert!(still.is_err(), "{still:?} with nothing drawn");

            let (x, screen) = x11rb::connect(Some(display.name().as_str())).unwrap();
            let root = x.setup().roots[screen].root;
            let pen = x.generate_id().unwrap();
            x.create_gc(
                pen,
                root,
                &x11rb::protocol::xproto::CreateGCAux::new().foreground(0x00ff_0000),
            )
            .unwrap();
            x.poly_fill_rectangle(
                root,
                pen,
                &[Rectangle {
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                }],
            )
            .unwrap();
            x.flush().unwrap();
            let mut news = seen.recv_timeout(Duration::from_secs(2));
            while matches!(news, Ok(News::Pointer(_))) {
                news = seen.recv_timeout(Duration::from_secs(2));
            }
            assert_eq!(news, Ok(News::Drawn));
            let (bytes, _) = capture.grab().unwrap();
            // Blue, green, red: the corner is red now.
            assert_eq!(&bytes[..3], &[0, 0, 0xff]);

            display.fit(400, 300, 1.0).unwrap();
            let until = std::time::Instant::now() + Duration::from_secs(2);
            let mut resized = false;
            while !resized && std::time::Instant::now() < until {
                resized = seen.recv_timeout(Duration::from_millis(100)) == Ok(News::Resized);
            }
            assert!(resized);
            let (bytes, size) = capture.grab().unwrap();
            assert_eq!(size, (400, 300));
            assert_eq!(bytes.len(), 400 * 300 * 4);
        });
    }
}
