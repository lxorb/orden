//! An application's sound on a Mac (issue 1063, step 8; docs/apps.md): not sent yet. A
//! Mac has no sink of an application's own to play it into, so it plays from this Mac's
//! speakers, and the holder hears nothing; `ScreenCaptureKit` can read one application's
//! sound, which is what comes next.

/// An application's sound, read and encoded; there is none on a Mac yet.
pub struct Sound;

impl Sound {
    /// Never on a Mac yet: the stream is never offered a sink's monitor here.
    pub fn start(_monitor: &str) -> Option<Sound> {
        None
    }

    /// The next Opus packet and the samples it holds.
    #[allow(clippy::unused_self, reason = "the Linux sound's own shape")]
    pub fn next(&mut self) -> Option<(Vec<u8>, u32)> {
        None
    }
}
