#![allow(
    unsafe_code,
    reason = "other threads' stacks are read through Win32's thread and unwind calls, which have no safe form"
)]

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL, HMODULE};
use windows::Win32::System::Diagnostics::Debug::{
    GetThreadContext, RtlCaptureStackBackTrace, RtlLookupFunctionEntry, RtlVirtualUnwind, CONTEXT,
    UNW_FLAG_NHANDLER,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, GetCurrentThreadId, GetThreadDescription, OpenThread, ResumeThread,
    SuspendThread, THREAD_GET_CONTEXT, THREAD_QUERY_LIMITED_INFORMATION, THREAD_SUSPEND_RESUME,
};

use super::{Place, Raw, MOST_FRAMES, MOST_THREADS};

static MAIN: AtomicU32 = AtomicU32::new(0);

static HELD: AtomicU32 = AtomicU32::new(0);

static ASKING: Mutex<()> = Mutex::new(());

pub fn start() {
    mark_main();
}

pub fn mark_main() {
    MAIN.store(unsafe { GetCurrentThreadId() }, Ordering::Relaxed);
}

pub fn is_main() -> bool {
    MAIN.load(Ordering::Relaxed) == unsafe { GetCurrentThreadId() }
}

pub fn trace(ips: &mut [usize]) -> usize {
    let mut held = [std::ptr::null_mut(); MOST_FRAMES];
    let room = ips.len().min(held.len());
    let len = usize::from(unsafe { RtlCaptureStackBackTrace(1, &mut held[..room], None) });
    for (at, one) in held[..len].iter().enumerate() {
        ips[at] = *one as usize;
    }
    len
}

pub fn every_thread(within: Duration) -> Vec<Raw> {
    let _one_at_a_time = ASKING.lock().unwrap_or_else(PoisonError::into_inner);
    let (told, heard) = mpsc::channel();
    let walker = std::thread::Builder::new()
        .name("nib stack walk".to_owned())
        .spawn(move || {
            let _ = told.send(walk_all());
        });
    if walker.is_err() {
        return Vec::new();
    }
    if let Ok(found) = heard.recv_timeout(within) {
        return found;
    }
    let stuck = HELD.swap(0, Ordering::AcqRel);
    if stuck != 0 {
        if let Ok(thread) = unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, stuck) } {
            unsafe {
                ResumeThread(thread);
                let _ = CloseHandle(thread);
            }
        }
    }
    Vec::new()
}

fn walk_all() -> Vec<Raw> {
    let me = unsafe { GetCurrentThreadId() };
    let main = MAIN.load(Ordering::Relaxed);
    thread_ids()
        .into_iter()
        .filter(|tid| *tid != me)
        .take(MOST_THREADS)
        .filter_map(|tid| walk_one(tid, tid == main))
        .collect()
}

fn thread_ids() -> Vec<u32> {
    let pid = unsafe { GetCurrentProcessId() };
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    let mut entry = THREADENTRY32 {
        dwSize: u32::try_from(std::mem::size_of::<THREADENTRY32>()).unwrap_or(0),
        ..Default::default()
    };
    let mut more = unsafe { Thread32First(snapshot, &raw mut entry) }.is_ok();
    while more {
        if entry.th32OwnerProcessID == pid {
            ids.push(entry.th32ThreadID);
        }
        more = unsafe { Thread32Next(snapshot, &raw mut entry) }.is_ok();
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    ids
}

fn walk_one(tid: u32, main: bool) -> Option<Raw> {
    let thread = unsafe {
        OpenThread(
            THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_LIMITED_INFORMATION,
            false,
            tid,
        )
    }
    .ok()?;
    let name = described(thread);
    let mut ips = [0usize; MOST_FRAMES];
    let mut len = 0;
    if unsafe { SuspendThread(thread) } != u32::MAX {
        HELD.store(tid, Ordering::Release);
        let mut context = blank();
        if unsafe { GetThreadContext(thread, &raw mut context) }.is_ok() {
            len = unwind(&mut context, &mut ips, None);
        }
        if HELD.swap(0, Ordering::AcqRel) == tid {
            unsafe {
                ResumeThread(thread);
            }
        }
    }
    unsafe {
        let _ = CloseHandle(thread);
    }
    Some(Raw {
        name,
        main,
        ips: ips[..len].to_vec(),
    })
}

fn described(thread: HANDLE) -> String {
    let Ok(said) = (unsafe { GetThreadDescription(thread) }) else {
        return String::new();
    };
    let name = unsafe { said.to_string() }.unwrap_or_default();
    unsafe {
        let _ = LocalFree(HLOCAL(said.0.cast()));
    }
    name
}

pub fn blank() -> CONTEXT {
    let mut context: CONTEXT = unsafe { std::mem::zeroed() };
    #[cfg(target_arch = "x86_64")]
    {
        context.ContextFlags = windows::Win32::System::Diagnostics::Debug::CONTEXT_FULL_AMD64;
    }
    #[cfg(target_arch = "aarch64")]
    {
        context.ContextFlags = windows::Win32::System::Diagnostics::Debug::CONTEXT_FULL_ARM64;
    }
    context
}

#[cfg(target_arch = "x86_64")]
fn registers(context: &CONTEXT) -> (usize, usize) {
    (
        usize::try_from(context.Rip).unwrap_or(0),
        usize::try_from(context.Rsp).unwrap_or(0),
    )
}

#[cfg(target_arch = "aarch64")]
fn registers(context: &CONTEXT) -> (usize, usize) {
    (
        usize::try_from(context.Pc).unwrap_or(0),
        usize::try_from(context.Sp).unwrap_or(0),
    )
}

#[cfg(target_arch = "x86_64")]
fn step_leaf(context: &mut CONTEXT, bounds: Option<(usize, usize)>) -> bool {
    let sp = usize::try_from(context.Rsp).unwrap_or(0);
    if sp == 0 || sp % 8 != 0 || bounds.is_some_and(|(low, high)| sp < low || sp + 8 > high) {
        return false;
    }
    context.Rip = unsafe { (sp as *const u64).read() };
    context.Rsp += 8;
    true
}

#[cfg(target_arch = "aarch64")]
fn step_leaf(context: &mut CONTEXT, _bounds: Option<(usize, usize)>) -> bool {
    context.Pc = unsafe { context.Anonymous.Anonymous.Lr };
    true
}

pub fn unwind(context: &mut CONTEXT, ips: &mut [usize], bounds: Option<(usize, usize)>) -> usize {
    let mut len = 0;
    while len < ips.len() {
        let (pc, sp) = registers(context);
        if pc == 0 || bounds.is_some_and(|(low, high)| sp < low || sp >= high) {
            break;
        }
        ips[len] = pc;
        len += 1;
        let mut base = 0;
        let entry = unsafe { RtlLookupFunctionEntry(pc as _, &raw mut base, None) };
        if entry.is_null() {
            if !step_leaf(context, bounds) {
                break;
            }
        } else {
            let mut data = std::ptr::null_mut();
            let mut frame = 0;
            unsafe {
                RtlVirtualUnwind(
                    UNW_FLAG_NHANDLER,
                    base,
                    pc as _,
                    entry,
                    context,
                    &raw mut data,
                    &raw mut frame,
                    None,
                );
            }
        }
        let (next_pc, next_sp) = registers(context);
        if next_sp < sp || (next_sp == sp && next_pc == pc) {
            break;
        }
    }
    len
}

pub fn place_of(ip: usize, into: &mut Place) {
    let mut module = HMODULE::default();
    if unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(ip as *const u16),
            &raw mut module,
        )
    }
    .is_err()
    {
        return;
    }
    into.base = module.0 as usize;
    let mut wide = [0u16; 260];
    let len = usize::try_from(unsafe { GetModuleFileNameW(module, &mut wide) }).unwrap_or(0);
    let mut narrow = [0u8; 520];
    let mut written = 0;
    for one in char::decode_utf16(wide[..len.min(wide.len())].iter().copied()) {
        let one = one.unwrap_or('?');
        let mut bytes = [0u8; 4];
        let said = one.encode_utf8(&mut bytes).as_bytes();
        if written + said.len() > narrow.len() {
            break;
        }
        narrow[written..written + said.len()].copy_from_slice(said);
        written += said.len();
    }
    into.name_module(&narrow[..written]);
}
