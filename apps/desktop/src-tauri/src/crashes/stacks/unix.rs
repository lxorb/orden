use std::ffi::{c_int, c_void};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, Once, PoisonError};
use std::time::{Duration, Instant};

use super::{Place, Raw, MOST_FRAMES, MOST_THREADS};

#[repr(C)]
struct UnwindContext {
    _opaque: [u8; 0],
}

type Step = extern "C" fn(*mut UnwindContext, *mut c_void) -> c_int;

#[allow(unsafe_code, reason = "the system unwinder is reached through C")]
unsafe extern "C" {
    fn _Unwind_Backtrace(step: Step, held: *mut c_void) -> c_int;
    fn _Unwind_GetIP(context: *mut UnwindContext) -> usize;
}

const NO_REASON: c_int = 0;

const END_OF_STACK: c_int = 5;

struct Gathered<'a> {
    ips: &'a mut [usize],
    len: usize,
}

#[allow(
    unsafe_code,
    reason = "the unwinder hands back the pointer it was given"
)]
extern "C" fn step(context: *mut UnwindContext, held: *mut c_void) -> c_int {
    let gathered = unsafe { &mut *held.cast::<Gathered>() };
    if gathered.len >= gathered.ips.len() {
        return END_OF_STACK;
    }
    let ip = unsafe { _Unwind_GetIP(context) };
    if ip == 0 {
        return END_OF_STACK;
    }
    gathered.ips[gathered.len] = ip;
    gathered.len += 1;
    NO_REASON
}

#[allow(
    unsafe_code,
    reason = "the system unwinder walks this thread's own stack"
)]
pub fn trace(ips: &mut [usize]) -> usize {
    let mut gathered = Gathered { ips, len: 0 };
    unsafe {
        _Unwind_Backtrace(step, (&raw mut gathered).cast());
    }
    gathered.len
}

#[cfg(target_os = "linux")]
fn asking_signal() -> c_int {
    libc::SIGRTMIN() + 6
}

#[cfg(target_os = "macos")]
fn asking_signal() -> c_int {
    libc::SIGUSR2
}

static ASKED: AtomicUsize = AtomicUsize::new(0);

static TARGET: AtomicUsize = AtomicUsize::new(0);

static ANSWERED: AtomicUsize = AtomicUsize::new(0);

static ANSWER_LEN: AtomicUsize = AtomicUsize::new(0);

static ANSWER: [AtomicUsize; MOST_FRAMES] = [const { AtomicUsize::new(0) }; MOST_FRAMES];

static ASKING: Mutex<()> = Mutex::new(());

static INSTALLED: Once = Once::new();

#[cfg(target_os = "linux")]
#[allow(unsafe_code, reason = "a thread's own number is gettid's to say")]
fn this_thread() -> usize {
    usize::try_from(unsafe { libc::gettid() }).unwrap_or(0)
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code, reason = "a thread's own handle is pthread_self's to say")]
fn this_thread() -> usize {
    unsafe { libc::pthread_self() }
}

extern "C" fn answer(_signal: c_int) {
    let asked = ASKED.load(Ordering::Acquire);
    if TARGET.load(Ordering::Acquire) != this_thread() {
        return;
    }
    let mut ips = [0usize; MOST_FRAMES];
    let len = trace(&mut ips);
    for (at, ip) in ips[..len].iter().enumerate() {
        ANSWER[at].store(*ip, Ordering::Relaxed);
    }
    ANSWER_LEN.store(len, Ordering::Relaxed);
    ANSWERED.store(asked, Ordering::Release);
}

#[allow(
    unsafe_code,
    reason = "a signal handler is installed through sigaction"
)]
pub fn start() {
    INSTALLED.call_once(|| unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = answer as extern "C" fn(c_int) as usize;
        action.sa_flags = libc::SA_RESTART | libc::SA_ONSTACK;
        libc::sigemptyset(&raw mut action.sa_mask);
        libc::sigaction(asking_signal(), &raw const action, std::ptr::null_mut());
    });
}

enum Asked {
    Answered(Vec<usize>),
    Unreached,
    Silent,
}

fn asked_of(target: usize, within: Duration, send: impl FnOnce(c_int) -> bool) -> Asked {
    TARGET.store(target, Ordering::Release);
    let asked = ASKED.fetch_add(1, Ordering::AcqRel) + 1;
    if !send(asking_signal()) {
        return Asked::Unreached;
    }
    let started = Instant::now();
    while ANSWERED.load(Ordering::Acquire) != asked {
        if started.elapsed() >= within {
            return Asked::Silent;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let len = ANSWER_LEN.load(Ordering::Relaxed).min(MOST_FRAMES);
    Asked::Answered(
        ANSWER[..len]
            .iter()
            .map(|one| one.load(Ordering::Relaxed))
            .collect(),
    )
}

fn asking(
    target: usize,
    silent: &mut u32,
    within: Duration,
    send: impl FnOnce(c_int) -> bool,
) -> Vec<usize> {
    if *silent >= 3 {
        return Vec::new();
    }
    match asked_of(target, within, send) {
        Asked::Answered(ips) => ips,
        Asked::Unreached => Vec::new(),
        Asked::Silent => {
            *silent += 1;
            Vec::new()
        }
    }
}

#[cfg(target_os = "linux")]
#[allow(
    unsafe_code,
    reason = "each thread is asked through tgkill, which only libc has"
)]
pub fn every_thread(within: Duration) -> Vec<Raw> {
    start();
    let _one_at_a_time = ASKING.lock().unwrap_or_else(PoisonError::into_inner);
    let started = Instant::now();
    let pid = std::process::id();
    let me = unsafe { libc::gettid() };
    let Ok(tasks) = std::fs::read_dir("/proc/self/task") else {
        return Vec::new();
    };
    let mut ids: Vec<i32> = tasks
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse().ok())
        .filter(|tid| *tid != me)
        .collect();
    ids.sort_unstable();

    let mut found = Vec::new();
    let mut silent = 0;
    for tid in ids.into_iter().take(MOST_THREADS) {
        let left = within.saturating_sub(started.elapsed());
        if left.is_zero() {
            break;
        }
        let name = std::fs::read_to_string(format!("/proc/self/task/{tid}/comm"))
            .map(|said| said.trim().to_owned())
            .unwrap_or_default();
        let Ok(process) = i32::try_from(pid) else {
            break;
        };
        let target = usize::try_from(tid).unwrap_or(0);
        let ips = asking(
            target,
            &mut silent,
            left.min(Duration::from_secs(1)),
            |signal| unsafe { libc::tgkill(process, tid, signal) == 0 },
        );
        found.push(Raw {
            name,
            main: i64::from(tid) == i64::from(pid),
            ips,
        });
    }
    found
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "a task's threads are listed through Mach, which only libc reaches"
)]
#[allow(
    deprecated,
    reason = "mach_task_self is all libc has for the task, and mach2 is not worth a dependency for one call"
)]
pub fn every_thread(within: Duration) -> Vec<Raw> {
    unsafe extern "C" {
        fn mach_port_deallocate(task: libc::mach_port_t, name: libc::mach_port_t) -> c_int;
    }

    start();
    let _one_at_a_time = ASKING.lock().unwrap_or_else(PoisonError::into_inner);
    let started = Instant::now();
    let me = unsafe { libc::pthread_self() };
    let task = unsafe { libc::mach_task_self() };
    let mut list: libc::thread_act_array_t = std::ptr::null_mut();
    let mut count: libc::mach_msg_type_number_t = 0;
    if unsafe { libc::task_threads(task, &raw mut list, &raw mut count) } != 0 || list.is_null() {
        return Vec::new();
    }
    let ports: Vec<libc::thread_act_t> = (0..count as usize)
        .map(|at| unsafe { *list.add(at) })
        .collect();

    let mut found = Vec::new();
    let mut silent = 0;
    for port in &ports {
        let thread = unsafe { libc::pthread_from_mach_thread_np(*port) };
        let left = within.saturating_sub(started.elapsed());
        if thread == 0 || unsafe { libc::pthread_equal(thread, me) } != 0 {
            continue;
        }
        if left.is_zero() || found.len() >= MOST_THREADS {
            break;
        }
        let mut named = [0u8; 64];
        let name =
            if unsafe { libc::pthread_getname_np(thread, named.as_mut_ptr().cast(), named.len()) }
                == 0
            {
                let len = named.iter().position(|one| *one == 0).unwrap_or(0);
                String::from_utf8_lossy(&named[..len]).into_owned()
            } else {
                String::new()
            };
        let main = Some(thread) == main_thread();
        let ips = asking(
            thread,
            &mut silent,
            left.min(Duration::from_secs(1)),
            |signal| unsafe { libc::pthread_kill(thread, signal) == 0 },
        );
        found.push(Raw { name, main, ips });
    }

    for port in ports {
        unsafe {
            mach_port_deallocate(task, port);
        }
    }
    unsafe {
        libc::vm_deallocate(
            task,
            list as libc::vm_address_t,
            count as usize * std::mem::size_of::<libc::thread_act_t>(),
        );
    }
    found
}

#[cfg(target_os = "macos")]
static MAIN: std::sync::OnceLock<libc::pthread_t> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
#[allow(unsafe_code, reason = "the main thread is known by asking pthreads")]
pub fn mark_main() {
    if unsafe { libc::pthread_main_np() } != 0 {
        let _ = MAIN.set(unsafe { libc::pthread_self() });
    }
}

#[cfg(target_os = "linux")]
pub fn mark_main() {}

#[cfg(target_os = "macos")]
fn main_thread() -> Option<libc::pthread_t> {
    MAIN.get().copied()
}

#[allow(
    unsafe_code,
    reason = "dladdr says which loaded image holds an address"
)]
pub fn place_of(ip: usize, place: &mut Place) {
    let mut found: libc::Dl_info = unsafe { std::mem::zeroed() };
    if unsafe { libc::dladdr(ip as *const c_void, &raw mut found) } == 0 {
        return;
    }
    if !found.dli_fname.is_null() {
        let path = unsafe { std::ffi::CStr::from_ptr(found.dli_fname) };
        place.name_module(path.to_bytes());
    }
    place.base = found.dli_fbase as usize;
    if !found.dli_sname.is_null() && !found.dli_saddr.is_null() && !own_image(found.dli_fbase) {
        let name = unsafe { std::ffi::CStr::from_ptr(found.dli_sname) };
        place.name_symbol(name.to_bytes());
    }
}

#[allow(
    unsafe_code,
    reason = "dladdr says which loaded image holds an address"
)]
fn own_image(base: *mut c_void) -> bool {
    let mut info: libc::Dl_info = unsafe { std::mem::zeroed() };
    let here = own_image as fn(*mut c_void) -> bool as *const c_void;
    (unsafe { libc::dladdr(here, &raw mut info) } != 0) && info.dli_fbase == base
}
