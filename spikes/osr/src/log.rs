use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::Mutex;

static LOG: Mutex<Option<BufWriter<File>>> = Mutex::new(None);

pub fn open(path: &str) {
    if let Ok(file) = File::create(path) {
        *LOG.lock().unwrap() = Some(BufWriter::new(file));
    }
}

pub fn line(text: String) {
    if let Ok(mut held) = LOG.lock() {
        if let Some(out) = held.as_mut() {
            let _ = writeln!(out, "{text}");
        }
    }
}

pub fn flush() {
    if let Ok(mut held) = LOG.lock() {
        if let Some(out) = held.as_mut() {
            let _ = out.flush();
        }
    }
}

pub fn qpc() -> i64 {
    let mut value = 0i64;
    unsafe {
        let _ = windows::Win32::System::Performance::QueryPerformanceCounter(&mut value);
    }
    value
}

pub fn freq() -> i64 {
    let mut value = 0i64;
    unsafe {
        let _ = windows::Win32::System::Performance::QueryPerformanceFrequency(&mut value);
    }
    value
}

pub fn us(ticks: i64) -> i64 {
    ticks * 1_000_000 / freq().max(1)
}

pub fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out
}
