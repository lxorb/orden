use std::time::Duration;

use serde::{Deserialize, Serialize};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
pub mod win;

#[cfg(unix)]
use unix as here_on;
#[cfg(windows)]
use win as here_on;

pub const MOST_FRAMES: usize = 64;

pub const MOST_THREADS: usize = 256;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
pub struct Frame {
    pub module: String,
    pub offset: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq, Eq)]
pub struct Thread {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crashed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main: Option<bool>,
    pub frames: Vec<Frame>,
}

pub struct Raw {
    pub name: String,
    pub main: bool,
    pub ips: Vec<usize>,
}

pub struct Place {
    pub module: [u8; 128],
    pub module_len: usize,
    pub base: usize,
    pub symbol: [u8; 128],
    pub symbol_len: usize,
}

impl Default for Place {
    fn default() -> Self {
        Self::new()
    }
}

impl Place {
    pub const fn new() -> Self {
        Self {
            module: [0; 128],
            module_len: 0,
            base: 0,
            symbol: [0; 128],
            symbol_len: 0,
        }
    }

    pub fn module(&self) -> &[u8] {
        &self.module[..self.module_len]
    }

    pub fn symbol(&self) -> &[u8] {
        &self.symbol[..self.symbol_len]
    }

    pub fn name_module(&mut self, path: &[u8]) {
        let name = path
            .rsplit(|one| *one == b'/' || *one == b'\\')
            .next()
            .unwrap_or_default();
        self.module_len = fill(&mut self.module, name);
    }

    #[cfg_attr(
        windows,
        allow(
            dead_code,
            reason = "Windows names no symbol without the program's PDB"
        )
    )]
    pub fn name_symbol(&mut self, said: &[u8]) {
        self.symbol_len = fill(&mut self.symbol, said);
    }
}

fn fill(into: &mut [u8], from: &[u8]) -> usize {
    let len = from.len().min(into.len());
    into[..len].copy_from_slice(&from[..len]);
    len
}

pub fn start() {
    here_on::start();
}

#[cfg_attr(
    windows,
    allow(dead_code, reason = "Windows unwinds a crash from its own context")
)]
pub fn trace_into(ips: &mut [usize]) -> usize {
    here_on::trace(ips)
}

pub fn mark_main() {
    here_on::mark_main();
}

pub fn here() -> Vec<usize> {
    let mut ips = [0usize; MOST_FRAMES];
    let len = here_on::trace(&mut ips);
    ips[..len].to_vec()
}

pub fn every_thread(within: Duration) -> Vec<Raw> {
    let mut found = here_on::every_thread(within);
    found.sort_by_key(|one| (!one.main, one.ips.is_empty()));
    found
}

pub fn place_of(ip: usize, into: &mut Place) {
    here_on::place_of(ip, into);
}

pub fn frame_of(ip: usize) -> Frame {
    let mut place = Place::new();
    place_of(ip, &mut place);
    let module = String::from_utf8_lossy(place.module()).into_owned();
    let symbol =
        (place.symbol_len > 0).then(|| String::from_utf8_lossy(place.symbol()).into_owned());
    let offset = if place.base == 0 || module.is_empty() {
        format!("{ip:#x}")
    } else {
        format!("{:#x}", ip.wrapping_sub(place.base))
    };
    Frame {
        module: if module.is_empty() {
            "?".to_owned()
        } else {
            module
        },
        offset,
        symbol,
    }
}

pub fn resolved(raw: &Raw, crashed: bool) -> Thread {
    Thread {
        name: raw.name.clone(),
        crashed: crashed.then_some(true),
        main: raw.main.then_some(true),
        frames: raw.ips.iter().map(|ip| frame_of(*ip)).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::{every_thread, frame_of, here, Place};
    use std::sync::mpsc;
    use std::time::Duration;

    #[inline(never)]
    fn deeper(left: u32) -> Vec<usize> {
        if left == 0 {
            here()
        } else {
            std::hint::black_box(deeper(left - 1))
        }
    }

    #[test]
    fn this_thread_is_traced_through_its_callers() {
        let ips = deeper(4);
        assert!(ips.len() > 5, "only {} frames", ips.len());
        let frame = frame_of(ips[0]);
        assert_ne!(frame.module, "?");
        assert!(frame.offset.starts_with("0x"));
    }

    #[test]
    fn a_module_is_named_by_its_file_alone() {
        let mut place = Place::new();
        place.name_module(b"C:\\Users\\someone\\AppData\\Local\\Orden\\nib.exe");
        assert_eq!(place.module(), b"nib.exe");
        place.name_module(b"/home/someone/.local/bin/nib");
        assert_eq!(place.module(), b"nib");
    }

    #[test]
    fn a_thread_that_waits_is_found_where_it_waits() {
        let (told, heard) = mpsc::channel::<()>();
        let (ready, readied) = mpsc::channel::<()>();
        let waiter = std::thread::Builder::new()
            .name("nib test waiter".to_owned())
            .spawn(move || {
                ready.send(()).expect("ready");
                let _ = heard.recv();
            })
            .expect("a thread");
        readied.recv().expect("readied");
        std::thread::sleep(Duration::from_millis(50));

        let threads = every_thread(Duration::from_secs(30));
        told.send(()).expect("told");
        waiter.join().expect("joined");

        assert!(threads.len() >= 2, "only {} threads", threads.len());
        let found = threads
            .iter()
            .find(|one| one.name.contains("nib test waiter"))
            .expect("the waiting thread");
        assert!(found.ips.len() >= 3, "only {} frames", found.ips.len());
    }
}
