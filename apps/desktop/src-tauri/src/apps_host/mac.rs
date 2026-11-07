pub mod access;
pub mod capture;
pub mod clipboard;
pub mod display;
pub mod input;
pub mod windows;

pub mod audio {
    pub struct Sound;

    impl Sound {
        pub fn start(_monitor: &str) -> Option<Sound> {
            None
        }

        #[allow(clippy::unused_self, reason = "the face of Linux's sound")]
        pub fn next(&mut self) -> Option<(Vec<u8>, u32)> {
            None
        }
    }
}
