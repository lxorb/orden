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
    let _walking = walking();
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

const MOST_WALKING: usize = 32;

static WALKING: [AtomicUsize; MOST_WALKING] = [const { AtomicUsize::new(0) }; MOST_WALKING];

pub struct Walking(Option<usize>);

impl Drop for Walking {
    fn drop(&mut self) {
        if let Some(at) = self.0 {
            WALKING[at].store(0, Ordering::Release);
        }
    }
}

pub fn walking() -> Walking {
    let me = this_thread();
    if me == 0 || is_walking(me) {
        return Walking(None);
    }
    Walking(WALKING.iter().position(|slot| {
        slot.compare_exchange(0, me, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    }))
}

fn is_walking(me: usize) -> bool {
    WALKING
        .iter()
        .any(|slot| slot.load(Ordering::Acquire) == me)
}

#[cfg(target_os = "linux")]
fn unwinding() -> bool {
    std::thread::panicking()
}

#[cfg(target_os = "macos")]
fn unwinding() -> bool {
    false
}

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
    let me = this_thread();
    if TARGET.load(Ordering::Acquire) != me {
        return;
    }
    let mut ips = [0usize; MOST_FRAMES];
    let len = if is_walking(me) || unwinding() {
        0
    } else {
        trace(&mut ips)
    };
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
        action.sa_flags = libc::SA_RESTART;
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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    const CHILD: &str = "ORDEN_STACKS_TEST_CHILD";

    #[allow(
        unsafe_code,
        reason = "the thread is given a small alternate signal stack with a guard below it, as std gives each of its threads one"
    )]
    fn small_alternate_stack() {
        let page = 4096;
        unsafe {
            let room = libc::mmap(
                std::ptr::null_mut(),
                2 * page,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
                -1,
                0,
            );
            assert_ne!(room, libc::MAP_FAILED);
            assert_eq!(libc::mprotect(room, page, libc::PROT_NONE), 0);
            let stack = libc::stack_t {
                ss_sp: room.cast::<u8>().add(page).cast(),
                ss_flags: 0,
                ss_size: page,
            };
            assert_eq!(libc::sigaltstack(&raw const stack, std::ptr::null_mut()), 0);
        }
    }

    #[test]
    fn a_thread_is_walked_on_its_own_stack_not_its_small_alternate_one() {
        if std::env::var_os(CHILD).is_some() {
            let (told, heard) = mpsc::channel::<()>();
            let (ready, readied) = mpsc::channel::<()>();
            let waiter = std::thread::Builder::new()
                .name("orden small alt".to_owned())
                .spawn(move || {
                    small_alternate_stack();
                    ready.send(()).expect("ready");
                    let _ = heard.recv();
                })
                .expect("a thread");
            readied.recv().expect("readied");
            let threads = super::every_thread(Duration::from_secs(10));
            told.send(()).expect("told");
            waiter.join().expect("joined");
            let found = threads
                .iter()
                .find(|one| one.name.contains("orden small"))
                .expect("the thread");
            assert!(found.ips.len() >= 3, "only {} frames", found.ips.len());
            return;
        }
        let status = Command::new(std::env::current_exe().expect("the tests"))
            .args([
                "--exact",
                "crashes::stacks::unix::tests::a_thread_is_walked_on_its_own_stack_not_its_small_alternate_one",
                "--test-threads=1",
            ])
            .env(CHILD, "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("the child ran");
        assert!(status.success(), "the child ended with {status}");
    }

    fn frames_of(
        name: &str,
        waiting: impl FnOnce(mpsc::Sender<()>, mpsc::Receiver<()>) + Send + 'static,
    ) -> usize {
        let (told, heard) = mpsc::channel::<()>();
        let (ready, readied) = mpsc::channel::<()>();
        let waiter = std::thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || waiting(ready, heard))
            .expect("a thread");
        readied.recv().expect("readied");
        let threads = super::every_thread(Duration::from_secs(10));
        told.send(()).expect("told");
        let _ = waiter.join();
        threads
            .iter()
            .find(|one| one.name == name)
            .expect("the thread")
            .ips
            .len()
    }

    #[test]
    fn a_thread_already_walking_its_stack_is_not_walked_again_inside_itself() {
        let frames = frames_of("orden walking", |ready, heard| {
            let _walking = super::walking();
            ready.send(()).expect("ready");
            let _ = heard.recv();
        });
        assert_eq!(frames, 0);
        let frames = frames_of("orden walked", |ready, heard| {
            drop(super::walking());
            ready.send(()).expect("ready");
            let _ = heard.recv();
        });
        assert!(frames >= 3, "only {frames} frames");
    }

    struct WaitsWhileUnwinding {
        ready: mpsc::Sender<()>,
        heard: mpsc::Receiver<()>,
    }

    impl Drop for WaitsWhileUnwinding {
        fn drop(&mut self) {
            self.ready.send(()).expect("ready");
            let _ = self.heard.recv();
        }
    }

    #[test]
    fn a_thread_unwinding_from_a_panic_is_not_walked_inside_its_unwinder() {
        let frames = frames_of("orden unwinding", |ready, heard| {
            let _waits = WaitsWhileUnwinding { ready, heard };
            std::panic::resume_unwind(Box::new("unwinding"));
        });
        assert_eq!(frames, 0);
    }
}
