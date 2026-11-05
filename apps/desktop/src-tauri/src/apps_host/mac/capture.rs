//! The picture of an application's display on a Mac, read as it changes (issue 1063,
//! step 8; docs/apps.md): `ScreenCaptureKit`'s stream of that display, of the
//! application's own windows and nothing else.
//!
//! **Only when something changed.** `ScreenCaptureKit` sends a frame when the display's
//! content changes and says of each whether it is new (`Complete`) or the last one again
//! (`Idle`); only a new one is news, so a still application costs nothing, as with
//! DAMAGE on Linux.
//!
//! **Only the application.** The stream's filter takes the application's windows on its
//! display, not the desktop behind them or the Dock, nor a window of anyone else's that
//! strays there. An application that has not come up yet when the picture is first
//! asked for is waited for a few seconds, then the display is taken whole.
//!
//! **The pointer is not in the picture**: the holder's own pointer is over the tab. Its
//! shape is not sent yet; the tab keeps the arrow.
//!
//! Frames come on a queue of the stream's own, are copied out of their pixel buffer
//! row by row (a buffer's rows are padded), and wait for `grab`.

use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread as _, DefinedClass as _};
use objc2_core_graphics::CGDirectDisplayID;
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::{
    kCVPixelFormatType_32BGRA, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCFrameStatus, SCRunningApplication, SCShareableContent, SCStream,
    SCStreamConfiguration, SCStreamDelegate, SCStreamFrameInfoStatus, SCStreamOutput,
    SCStreamOutputType, SCWindow,
};

pub use super::wire::News;

/// How long the system has to say what can be captured, and to start the stream.
const ASKED_WITHIN: Duration = Duration::from_secs(5);
/// How long an application that is starting has to show up among what can be captured.
const APP_WITHIN: Duration = Duration::from_secs(4);
/// How long `grab` waits for a stream's first frame.
const FIRST_WITHIN: Duration = Duration::from_secs(2);

/// What the stream's queue and the reader share: the last frame, and who hears of one.
struct Frames {
    last: Mutex<Option<Frame>>,
    came: Condvar,
    seen: Mutex<Option<Sender<News>>>,
}

/// One frame: four bytes a pixel (blue, green, red, alpha), rows unpadded.
struct Frame {
    bytes: Vec<u8>,
    size: (u16, u16),
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Frames {
    fn tell(&self, news: News) {
        if let Some(seen) = lock(&self.seen).as_ref() {
            let _ = seen.send(news);
        }
    }
}

define_class!(
    /// What the stream hands its frames to, and tells when it stops.
    #[unsafe(super(NSObject))]
    #[name = "OrdenApplicationFrames"]
    #[ivars = Arc<Frames>]
    struct Output;

    unsafe impl NSObjectProtocol for Output {}

    unsafe impl SCStreamOutput for Output {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(
            &self,
            _stream: &SCStream,
            buffer: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind != SCStreamOutputType::Screen || !is_new(buffer) {
                return;
            }
            let Some(frame) = copied(buffer) else {
                return;
            };
            let frames = self.ivars();
            let resized = lock(&frames.last)
                .as_ref()
                .is_some_and(|last| last.size != frame.size);
            *lock(&frames.last) = Some(frame);
            frames.came.notify_all();
            frames.tell(if resized { News::Resized } else { News::Drawn });
        }
    }

    unsafe impl SCStreamDelegate for Output {
        #[unsafe(method(stream:didStopWithError:))]
        fn did_stop(&self, _stream: &SCStream, _error: &NSError) {
            self.ivars().tell(News::Gone);
        }
    }
);

impl Output {
    fn new(frames: Arc<Frames>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(frames);
        // SAFETY: NSObject's own `init`, on an object just allocated.
        #[allow(unsafe_code, reason = "a defined class's init through its superclass")]
        unsafe {
            msg_send![super(this), init]
        }
    }
}

/// Whether a frame is new, rather than the last one again.
#[allow(
    unsafe_code,
    reason = "a sample buffer's attachments are a CFArray of CFDictionary, read as the NSArray and NSDictionary they bridge to"
)]
fn is_new(buffer: &CMSampleBuffer) -> bool {
    // SAFETY: the attachments array is the buffer's own, valid while it is; its
    // dictionaries are toll-free bridged to NSDictionary, their keys NSStrings.
    unsafe {
        let Some(attachments) = buffer.sample_attachments_array(false) else {
            return false;
        };
        let attachments: &NSArray<NSDictionary<NSString, NSNumber>> =
            &*std::ptr::from_ref(&*attachments).cast();
        let Some(first) = attachments.firstObject() else {
            return false;
        };
        first
            .objectForKey(SCStreamFrameInfoStatus)
            .is_some_and(|status| status.integerValue() == SCFrameStatus::Complete.0)
    }
}

/// A frame's pixels, copied out of its buffer.
#[allow(
    unsafe_code,
    reason = "a pixel buffer's base address is read while it is locked, as CoreVideo asks"
)]
fn copied(buffer: &CMSampleBuffer) -> Option<Frame> {
    // SAFETY: the image buffer is the sample buffer's own; its base address is valid
    // and `bytes_per_row * height` long between the lock and the unlock.
    unsafe {
        let pixels = buffer.image_buffer()?;
        if CVPixelBufferLockBaseAddress(&pixels, CVPixelBufferLockFlags::ReadOnly) != 0 {
            return None;
        }
        let width = CVPixelBufferGetWidth(&pixels);
        let height = CVPixelBufferGetHeight(&pixels);
        let stride = CVPixelBufferGetBytesPerRow(&pixels);
        let base = CVPixelBufferGetBaseAddress(&pixels).cast::<u8>();
        let row = width * 4;
        let frame = if base.is_null() || stride < row {
            None
        } else {
            let all = std::slice::from_raw_parts(base, stride * height);
            let mut bytes = Vec::with_capacity(row * height);
            for line in all.chunks(stride).take(height) {
                bytes.extend_from_slice(&line[..row]);
            }
            match (u16::try_from(width), u16::try_from(height)) {
                (Ok(w), Ok(h)) => Some(Frame {
                    bytes,
                    size: (w, h),
                }),
                _ => None,
            }
        };
        CVPixelBufferUnlockBaseAddress(&pixels, CVPixelBufferLockFlags::ReadOnly);
        frame
    }
}

/// The display's picture, read as it changes.
pub struct Capture {
    stream: Retained<SCStream>,
    output: Retained<Output>,
    configuration: Retained<SCStreamConfiguration>,
    frames: Arc<Frames>,
    display: CGDirectDisplayID,
    /// The size the stream was last told, in device pixels.
    asked: (usize, usize),
    /// The frame `grab` handed out last.
    current: Vec<u8>,
}

/// An application's display, as `Screen` names it: the display's id and the
/// application's process, `"<display>/<pid>"`.
pub fn parse(name: &str) -> Option<(CGDirectDisplayID, i32)> {
    let (display, pid) = name.split_once('/')?;
    Some((display.parse().ok()?, pid.parse().ok()?))
}

impl Capture {
    /// Watches an application's display, saying what it sees to `seen`.
    pub fn open(name: &str, seen: Sender<News>) -> Result<Capture, String> {
        let (display, pid) = parse(name).ok_or("not an application's display")?;
        let frames = Arc::new(Frames {
            last: Mutex::new(None),
            came: Condvar::new(),
            seen: Mutex::new(Some(seen)),
        });
        let filter = filter(display, pid)?;
        let asked = super::display::pixels_of(display);
        let configuration = configuration(asked);
        let output = Output::new(frames.clone());
        let stream = start(&filter, &configuration, &output)?;
        Ok(Capture {
            stream,
            output,
            configuration,
            frames,
            display,
            asked,
            current: Vec::new(),
        })
    }

    /// The screen as it is now, four bytes a pixel (blue, green, red, unused), and its
    /// size. What is drawn from here on is news again.
    #[allow(
        unsafe_code,
        reason = "a running stream's configuration is changed by the method ScreenCaptureKit gives for it"
    )]
    pub fn grab(&mut self) -> Result<(&[u8], (u16, u16)), String> {
        let now = super::display::pixels_of(self.display);
        if now != self.asked && now.0 > 0 && now.1 > 0 {
            self.asked = now;
            // SAFETY: setters of a configuration this owns, then handed to its stream.
            unsafe {
                self.configuration.setWidth(now.0);
                self.configuration.setHeight(now.1);
                self.stream
                    .updateConfiguration_completionHandler(&self.configuration, None);
            }
        }
        let mut last = lock(&self.frames.last);
        let until = Instant::now() + FIRST_WITHIN;
        while last.is_none() && self.current.is_empty() {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("no frame came".to_owned());
            }
            last = self
                .frames
                .came
                .wait_timeout(last, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
        let size = if let Some(frame) = last.take() {
            self.current = frame.bytes;
            frame.size
        } else {
            self.size_of_current()
        };
        drop(last);
        Ok((&self.current, size))
    }

    /// The size of the frame handed out last, worked back from the stream's.
    fn size_of_current(&self) -> (u16, u16) {
        let width = u16::try_from(self.asked.0).unwrap_or(u16::MAX);
        let height =
            u16::try_from(self.current.len() / 4 / usize::from(width.max(1))).unwrap_or(u16::MAX);
        (width, height)
    }
}

impl Drop for Capture {
    #[allow(unsafe_code, reason = "a stream this owns, stopped as it ends")]
    fn drop(&mut self) {
        *lock(&self.frames.seen) = None;
        // SAFETY: the stream and its output are this capture's own.
        unsafe {
            let output = ProtocolObject::from_ref(&*self.output);
            let _ = self
                .stream
                .removeStreamOutput_type_error(output, SCStreamOutputType::Screen);
            self.stream.stopCaptureWithCompletionHandler(None);
        }
    }
}

/// What the stream is told: frames of the display's size in device pixels, as BGRA, at
/// most 60 a second, with no pointer drawn in.
#[allow(
    unsafe_code,
    reason = "a stream configuration's setters, on one this has just made"
)]
fn configuration(size: (usize, usize)) -> Retained<SCStreamConfiguration> {
    // SAFETY: a fresh configuration, set before any stream has it.
    unsafe {
        let configuration = SCStreamConfiguration::new();
        configuration.setWidth(size.0.max(2));
        configuration.setHeight(size.1.max(2));
        configuration.setPixelFormat(kCVPixelFormatType_32BGRA);
        configuration.setShowsCursor(false);
        configuration.setMinimumFrameInterval(CMTime::new(1, 60));
        configuration.setQueueDepth(3);
        configuration
    }
}

/// What can be captured, asked of the system.
#[allow(
    unsafe_code,
    reason = "ScreenCaptureKit answers on a queue of its own, through a block"
)]
fn shareable() -> Result<Retained<SCShareableContent>, String> {
    let (tell, heard) = std::sync::mpsc::channel();
    let tell = Mutex::new(Some(tell));
    let answered =
        block2::RcBlock::new(move |content: *mut SCShareableContent, _: *mut NSError| {
            // SAFETY: the system hands over an object it keeps alive for the call, or nil.
            let content = unsafe { Retained::retain(content) };
            if let Some(tell) = lock(&tell).take() {
                let _ = tell.send(content);
            }
        });
    // SAFETY: the block lives as long as the system holds it, which copies it.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true, false, &answered,
        );
    }
    heard
        .recv_timeout(ASKED_WITHIN)
        .ok()
        .flatten()
        .ok_or_else(|| "this Mac said nothing may be captured".to_owned())
}

/// The application's windows on its display, or - not up yet - the display whole.
#[allow(
    unsafe_code,
    reason = "ScreenCaptureKit's objects, read and made as its headers say"
)]
fn filter(display: CGDirectDisplayID, pid: i32) -> Result<Retained<SCContentFilter>, String> {
    let until = Instant::now() + APP_WITHIN;
    loop {
        let content = shareable()?;
        // SAFETY: the shareable content's arrays and their objects are its own.
        unsafe {
            let screen: Option<Retained<SCDisplay>> = content
                .displays()
                .iter()
                .find(|one| one.displayID() == display);
            let app: Option<Retained<SCRunningApplication>> = content
                .applications()
                .iter()
                .find(|one| one.processID() == pid);
            if let Some(screen) = screen {
                let none = NSArray::<SCWindow>::new();
                if let Some(app) = app {
                    let apps = NSArray::from_retained_slice(&[app]);
                    return Ok(
                        SCContentFilter::initWithDisplay_includingApplications_exceptingWindows(
                            SCContentFilter::alloc(),
                            &screen,
                            &apps,
                            &none,
                        ),
                    );
                }
                if Instant::now() > until {
                    return Ok(SCContentFilter::initWithDisplay_excludingWindows(
                        SCContentFilter::alloc(),
                        &screen,
                        &none,
                    ));
                }
            } else if Instant::now() > until {
                return Err("the application's display is not among the displays".to_owned());
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// The stream, started: frames to `output` on a queue of their own.
#[allow(unsafe_code, reason = "a stream made, given its output and started")]
fn start(
    filter: &SCContentFilter,
    configuration: &SCStreamConfiguration,
    output: &Output,
) -> Result<Retained<SCStream>, String> {
    let queue = dispatch2::DispatchQueue::new("orden.apps.frames", None);
    let delegate = ProtocolObject::from_ref(output);
    let (tell, heard) = std::sync::mpsc::channel();
    let tell = Mutex::new(Some(tell));
    let started = block2::RcBlock::new(move |error: *mut NSError| {
        if let Some(tell) = lock(&tell).take() {
            let _ = tell.send(error.is_null());
        }
    });
    // SAFETY: the stream is made of a filter and configuration that outlive the call,
    // the output and its queue are retained by the stream, and the block is copied.
    unsafe {
        let stream = SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            filter,
            configuration,
            Some(delegate),
        );
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(output),
                SCStreamOutputType::Screen,
                Some(&queue),
            )
            .map_err(|error| error.localizedDescription().to_string())?;
        stream.startCaptureWithCompletionHandler(Some(&started));
        match heard.recv_timeout(ASKED_WITHIN) {
            Ok(true) => Ok(stream),
            _ => Err("the stream did not start".to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_applications_display_by_its_id_and_process() {
        assert_eq!(parse("5/812"), Some((5, 812)));
        assert_eq!(parse(":99"), None);
        assert_eq!(parse("5/x"), None);
    }
}
