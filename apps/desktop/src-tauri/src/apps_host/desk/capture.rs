use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, PatBlt,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLACKNESS, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::PW_RENDERFULLCONTENT;

use super::{place_of, shown, Desk};

const DRAW_EVERY: Duration = Duration::from_millis(33);
const FIRST_WITHIN: Duration = Duration::from_secs(5);

#[derive(Debug, PartialEq)]
pub enum News {
    Drawn,
    Resized,
    #[allow(dead_code, reason = "the Linux capture's news, which the stream reads")]
    Pointer(String),
    Whole,
    Gone,
}

#[derive(Default)]
struct Shot {
    pixels: Vec<u8>,
    size: (u16, u16),
}

pub struct Capture {
    shot: Arc<(Mutex<Option<Shot>>, Condvar)>,
    stop: Arc<AtomicBool>,
    local: Vec<u8>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Capture {
    pub fn open(display: &str, seen: Sender<News>) -> Result<Capture, String> {
        let desk = super::desk(display).ok_or("no such desktop")?;
        let shot = Arc::new((Mutex::new(None), Condvar::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (drawn, stopped) = (shot.clone(), stop.clone());
        let thread = std::thread::spawn(move || draw(&desk, &drawn, &stopped, &seen));
        Ok(Capture {
            shot,
            stop,
            local: Vec::new(),
            thread: Some(thread),
        })
    }

    pub fn grab(&mut self) -> Result<(&[u8], (u16, u16)), String> {
        let (lock, came) = &*self.shot;
        let held = lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (held, _) = came
            .wait_timeout_while(held, FIRST_WITHIN, |shot| shot.is_none())
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let shot = held.as_ref().ok_or("no picture yet")?;
        self.local.clear();
        self.local.extend_from_slice(&shot.pixels);
        let size = shot.size;
        drop(held);
        Ok((&self.local, size))
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn draw(
    desk: &Desk,
    shot: &(Mutex<Option<Shot>>, Condvar),
    stop: &AtomicBool,
    seen: &Sender<News>,
) {
    if desk.enter().is_err() {
        let _ = seen.send(News::Gone);
        return;
    }
    let mut canvas = Canvas::default();
    let mut last: Vec<u8> = Vec::new();
    let mut last_size = (0, 0);
    while !stop.load(Ordering::SeqCst) {
        if desk.ended() {
            let _ = seen.send(News::Gone);
            break;
        }
        let size = desk.size();
        let even = |one: u32| u16::try_from(one.clamp(2, 16384) & !1).unwrap_or(16384);
        let size = (even(size.0), even(size.1));
        if let Some(pixels) = canvas.draw(size) {
            let news = if size != last_size {
                Some(News::Resized)
            } else if pixels != last.as_slice() {
                Some(News::Drawn)
            } else {
                None
            };
            if let Some(news) = news {
                last.clear();
                last.extend_from_slice(pixels);
                last_size = size;
                let (lock, came) = shot;
                *lock
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Shot {
                    pixels: last.clone(),
                    size,
                });
                came.notify_all();
                if seen.send(news).is_err() {
                    break;
                }
            }
        }
        std::thread::sleep(DRAW_EVERY);
    }
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    bits: *mut u8,
    size: (i32, i32),
}

impl Surface {
    #[allow(unsafe_code, reason = "a bitmap in memory is made with GDI")]
    fn new(width: i32, height: i32) -> Option<Surface> {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).ok()?,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        unsafe {
            let dc = CreateCompatibleDC(HDC::default());
            if dc.is_invalid() {
                return None;
            }
            let Ok(bitmap) = CreateDIBSection(
                dc,
                &raw const info,
                DIB_RGB_COLORS,
                &raw mut bits,
                HANDLE::default(),
                0,
            ) else {
                let _ = DeleteDC(dc);
                return None;
            };
            let old = SelectObject(dc, bitmap);
            Some(Surface {
                dc,
                bitmap,
                old,
                bits: bits.cast(),
                size: (width, height),
            })
        }
    }

    #[allow(
        unsafe_code,
        reason = "a bitmap's memory is read once GDI has drawn into it"
    )]
    fn pixels(&self) -> &[u8] {
        let length = usize::try_from(self.size.0).unwrap_or(0)
            * usize::try_from(self.size.1).unwrap_or(0)
            * 4;
        unsafe {
            let _ = GdiFlush();
            std::slice::from_raw_parts(self.bits, length)
        }
    }
}

impl Drop for Surface {
    #[allow(
        unsafe_code,
        reason = "a bitmap and its device context are deleted with GDI"
    )]
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bitmap);
            let _ = DeleteDC(self.dc);
        }
    }
}

#[derive(Default)]
struct Canvas {
    view: Option<Surface>,
    scratch: Option<Surface>,
}

impl Canvas {
    #[allow(
        unsafe_code,
        reason = "windows are asked to draw themselves with Win32 calls"
    )]
    fn draw(&mut self, size: (u16, u16)) -> Option<&[u8]> {
        let (width, height) = (i32::from(size.0), i32::from(size.1));
        if self
            .view
            .as_ref()
            .is_none_or(|one| one.size != (width, height))
        {
            self.view = Some(Surface::new(width, height)?);
        }
        let view = self.view.as_ref()?;
        unsafe {
            let _ = PatBlt(view.dc, 0, 0, width, height, BLACKNESS);
        }
        let windows: Vec<HWND> = shown().into_iter().rev().collect();
        for window in windows {
            let Some(at) = place_of(window) else {
                continue;
            };
            let (w, h) = (at.right - at.left, at.bottom - at.top);
            if at.left >= width || at.top >= height || w > 16384 || h > 16384 {
                continue;
            }
            let fits = self
                .scratch
                .as_ref()
                .is_some_and(|one| one.size.0 >= w && one.size.1 >= h);
            if !fits {
                let grown = self.scratch.as_ref().map_or((0, 0), |one| one.size);
                self.scratch = Surface::new(grown.0.max(w), grown.1.max(h));
            }
            let (Some(scratch), Some(view)) = (self.scratch.as_ref(), self.view.as_ref()) else {
                continue;
            };
            unsafe {
                let drawn =
                    PrintWindow(window, scratch.dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT));
                if !drawn.as_bool() {
                    let _ = PrintWindow(window, scratch.dc, PRINT_WINDOW_FLAGS(0));
                }
                let _ = BitBlt(view.dc, at.left, at.top, w, h, scratch.dc, 0, 0, SRCCOPY);
            }
        }
        Some(self.view.as_ref()?.pixels())
    }
}

#[cfg(test)]
mod tests {
    use super::super::Desktop;
    use super::*;

    #[test]
    fn draws_a_desktop_nobody_looks_at() {
        let notepad = std::path::PathBuf::from(std::env::var("SystemRoot").unwrap())
            .join("System32\\notepad.exe");
        if !notepad.is_file() {
            eprintln!("no notepad.exe here: skipped");
            return;
        }
        let desktop = Desktop::start(640, 480).unwrap();
        let program = desktop
            .run(
                &[notepad.to_string_lossy().into_owned()],
                &std::env::temp_dir(),
            )
            .unwrap();
        let (tell, news) = std::sync::mpsc::channel();
        let mut capture = Capture::open(&desktop.name(), tell).unwrap();
        let until = std::time::Instant::now() + Duration::from_secs(20);
        let mut lit = false;
        while std::time::Instant::now() < until && !lit {
            let _ = news.recv_timeout(Duration::from_millis(500));
            if let Ok((pixels, size)) = capture.grab() {
                assert_eq!(size, (640, 480));
                lit = pixels.chunks(4).any(|one| one[..3] != [0, 0, 0]);
            }
        }
        assert!(lit, "nothing of notepad was drawn");
        super::super::close(program.pid());
        drop(capture);
        let _ = program.wait();
    }
}
