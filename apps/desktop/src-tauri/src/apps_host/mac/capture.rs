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

#[derive(Debug, PartialEq)]
pub enum News {
    Drawn,
    Resized,
    #[allow(dead_code, reason = "the Linux capture's news, which the stream reads")]
    Pointer(String),
    Whole,
    Gone,
}

const ASKED_WITHIN: Duration = Duration::from_secs(5);
const APP_WITHIN: Duration = Duration::from_secs(4);
const FIRST_WITHIN: Duration = Duration::from_secs(2);

struct Frames {
    last: Mutex<Option<Frame>>,
    came: Condvar,
    seen: Mutex<Option<Sender<News>>>,
}

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
        #[allow(unsafe_code, reason = "a defined class's init through its superclass")]
        unsafe {
            msg_send![super(this), init]
        }
    }
}

#[allow(
    unsafe_code,
    reason = "a sample buffer's attachments are a CFArray of CFDictionary, read as the NSArray and NSDictionary they bridge to"
)]
fn is_new(buffer: &CMSampleBuffer) -> bool {
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

#[allow(
    unsafe_code,
    reason = "a pixel buffer's base address is read while it is locked, as CoreVideo asks"
)]
fn copied(buffer: &CMSampleBuffer) -> Option<Frame> {
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

pub struct Capture {
    stream: Retained<SCStream>,
    output: Retained<Output>,
    configuration: Retained<SCStreamConfiguration>,
    frames: Arc<Frames>,
    display: CGDirectDisplayID,
    asked: (usize, usize),
    current: Vec<u8>,
    current_size: (u16, u16),
}

pub fn parse(name: &str) -> Option<(CGDirectDisplayID, i32)> {
    let (display, pid) = name.split_once('/')?;
    Some((display.parse().ok()?, pid.parse().ok()?))
}

impl Capture {
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
            current_size: (0, 0),
        })
    }

    #[allow(
        unsafe_code,
        reason = "a running stream's configuration is changed by the method ScreenCaptureKit gives for it"
    )]
    pub fn grab(&mut self) -> Result<(&[u8], (u16, u16)), String> {
        let now = super::display::pixels_of(self.display);
        if now != self.asked && now.0 > 0 && now.1 > 0 {
            self.asked = now;
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
        if let Some(frame) = last.take() {
            self.current = frame.bytes;
            self.current_size = frame.size;
        }
        drop(last);
        Ok((&self.current, self.current_size))
    }
}

impl Drop for Capture {
    #[allow(unsafe_code, reason = "a stream this owns, stopped as it ends")]
    fn drop(&mut self) {
        *lock(&self.frames.seen) = None;
        unsafe {
            let output = ProtocolObject::from_ref(&*self.output);
            let _ = self
                .stream
                .removeStreamOutput_type_error(output, SCStreamOutputType::Screen);
            self.stream.stopCaptureWithCompletionHandler(None);
        }
    }
}

#[allow(
    unsafe_code,
    reason = "a stream configuration's setters, on one this has just made"
)]
fn configuration(size: (usize, usize)) -> Retained<SCStreamConfiguration> {
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

#[allow(
    unsafe_code,
    reason = "ScreenCaptureKit answers on a queue of its own, through a block"
)]
fn shareable() -> Result<Retained<SCShareableContent>, String> {
    let (tell, heard) = std::sync::mpsc::channel();
    let tell = Mutex::new(Some(tell));
    let answered =
        block2::RcBlock::new(move |content: *mut SCShareableContent, _: *mut NSError| {
            let content = unsafe { Retained::retain(content) };
            if let Some(tell) = lock(&tell).take() {
                let _ = tell.send(content);
            }
        });
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

#[allow(
    unsafe_code,
    reason = "ScreenCaptureKit's objects, read and made as its headers say"
)]
fn filter(display: CGDirectDisplayID, pid: i32) -> Result<Retained<SCContentFilter>, String> {
    let until = Instant::now() + APP_WITHIN;
    loop {
        let content = shareable()?;
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
