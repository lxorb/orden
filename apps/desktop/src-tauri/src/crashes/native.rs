use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::OnceLock;

use super::report::{self, Crumb, Report};
use super::stacks::{self, Frame, Place, Thread, MOST_FRAMES};

pub const STUB: &str = "native-crash.txt";

const ROOM: usize = 12 * 1024;

const MOST_CRUMBS: usize = 20;

static WRITING: AtomicBool = AtomicBool::new(false);

static ROOMY: AtomicPtr<u8> = AtomicPtr::new(std::ptr::null_mut());

static VERSION: OnceLock<String> = OnceLock::new();

pub fn install(dir: &Path, version: &str) {
    let _ = VERSION.set(version.chars().take(64).collect());
    if ROOMY.load(Ordering::Acquire).is_null() {
        let room = Box::leak(vec![0u8; ROOM].into_boxed_slice());
        ROOMY.store(room.as_mut_ptr(), Ordering::Release);
    }
    here::install(&dir.join(STUB));
}

struct Out<'a> {
    room: &'a mut [u8],
    len: usize,
}

impl Out<'_> {
    fn push(&mut self, said: &[u8]) {
        let fits = said.len().min(self.room.len() - self.len);
        self.room[self.len..self.len + fits].copy_from_slice(&said[..fits]);
        self.len += fits;
    }

    fn clean(&mut self, said: &[u8]) {
        for one in said {
            let kept = if one.is_ascii_graphic() || *one == b' ' || *one >= 0x80 {
                *one
            } else {
                b'?'
            };
            self.push(&[kept]);
        }
    }

    fn number(&mut self, mut value: u64) {
        let mut digits = [0u8; 20];
        let mut at = digits.len();
        loop {
            at -= 1;
            digits[at] = b'0' + u8::try_from(value % 10).unwrap_or(0);
            value /= 10;
            if value == 0 {
                break;
            }
        }
        self.push(&digits[at..]);
    }

    fn hex(&mut self, mut value: u64) {
        let mut digits = [0u8; 16];
        let mut at = digits.len();
        loop {
            at -= 1;
            digits[at] = b"0123456789abcdef"[usize::try_from(value & 0xf).unwrap_or(0)];
            value >>= 4;
            if value == 0 {
                break;
            }
        }
        self.push(b"0x");
        self.push(&digits[at..]);
    }

    fn line(&mut self, key: &[u8], value: &[u8]) {
        self.push(key);
        self.push(b" ");
        self.clean(value);
        self.push(b"\n");
    }
}

fn written(
    what: &[u8],
    code: u64,
    address: Option<u64>,
    thread: &[u8],
    main: bool,
    ips: &[usize],
) -> Option<usize> {
    if WRITING.swap(true, Ordering::AcqRel) || super::panics::panicking() {
        return None;
    }
    let room = ROOMY.load(Ordering::Acquire);
    if room.is_null() {
        return None;
    }
    #[allow(
        unsafe_code,
        reason = "the room was leaked at install and only this one writer, once, ever touches it"
    )]
    let room = unsafe { std::slice::from_raw_parts_mut(room, ROOM) };
    let mut out = Out { room, len: 0 };
    out.push(b"orden-crash 1\nat ");
    out.number(crate::clock::now());
    out.push(b"\n");
    out.line(
        b"version",
        VERSION.get().map_or(&b""[..], |one| one.as_bytes()),
    );
    out.line(b"what", what);
    out.push(b"code ");
    out.hex(code);
    out.push(b"\n");
    if let Some(address) = address {
        out.push(b"address ");
        out.hex(address);
        out.push(b"\n");
    }
    out.line(b"thread", thread);
    out.line(b"main", if main { b"1" } else { b"0" });
    let mut place = Place::new();
    for ip in ips {
        place.module_len = 0;
        place.symbol_len = 0;
        place.base = 0;
        stacks::place_of(*ip, &mut place);
        out.push(b"frame ");
        out.clean(place.module());
        out.push(b"\t");
        out.hex(u64::try_from(ip.wrapping_sub(place.base)).unwrap_or(0));
        out.push(b"\t");
        out.clean(place.symbol());
        out.push(b"\n");
    }
    crate::stall::each_doing_now(|one| out.line(b"doing", one.as_bytes()));
    if let Some(crumbs) = report::crumbs_now() {
        for crumb in crumbs.iter().rev().take(MOST_CRUMBS).rev() {
            out.push(b"crumb ");
            out.number(crumb.at);
            out.push(b"\t");
            out.clean(crumb.what.as_bytes());
            out.push(b"\n");
        }
    }
    Some(out.len)
}

fn room_bytes(len: usize) -> &'static [u8] {
    let room = ROOMY.load(Ordering::Acquire);
    #[allow(
        unsafe_code,
        reason = "the room was leaked at install and outlives every reader"
    )]
    unsafe {
        std::slice::from_raw_parts(room, len.min(ROOM))
    }
}

#[cfg(unix)]
mod here {
    #![allow(
        unsafe_code,
        reason = "a crash is heard through sigaction and written with open and write, which only libc has"
    )]

    use std::ffi::{c_int, c_void, CString};
    use std::path::Path;
    use std::sync::OnceLock;

    use super::{room_bytes, written, MOST_FRAMES};

    const SIGNALS: [c_int; 6] = [
        libc::SIGSEGV,
        libc::SIGBUS,
        libc::SIGILL,
        libc::SIGFPE,
        libc::SIGABRT,
        libc::SIGTRAP,
    ];

    static PATH: OnceLock<CString> = OnceLock::new();

    static BEFORE: OnceLock<Vec<(c_int, libc::sigaction)>> = OnceLock::new();

    static OWN: OnceLock<usize> = OnceLock::new();

    pub fn install(stub: &Path) {
        use std::os::unix::ffi::OsStrExt as _;
        let Ok(path) = CString::new(stub.as_os_str().as_bytes()) else {
            return;
        };
        let _ = PATH.set(path);
        let mut place = crate::crashes::stacks::Place::new();
        crate::crashes::stacks::place_of(install as fn(&Path) as usize, &mut place);
        let _ = OWN.set(place.base);
        let _ = BEFORE.get_or_init(|| {
            SIGNALS
                .iter()
                .map(|signal| unsafe {
                    let mut action: libc::sigaction = std::mem::zeroed();
                    action.sa_sigaction =
                        caught as extern "C" fn(c_int, *mut libc::siginfo_t, *mut c_void) as usize;
                    action.sa_flags = libc::SA_SIGINFO;
                    libc::sigemptyset(&raw mut action.sa_mask);
                    let mut before: libc::sigaction = std::mem::zeroed();
                    libc::sigaction(*signal, &raw const action, &raw mut before);
                    (*signal, before)
                })
                .collect()
        });
    }

    fn name_of(signal: c_int) -> &'static [u8] {
        match signal {
            libc::SIGSEGV => b"SIGSEGV",
            libc::SIGBUS => b"SIGBUS",
            libc::SIGILL => b"SIGILL",
            libc::SIGFPE => b"SIGFPE",
            libc::SIGABRT => b"SIGABRT",
            libc::SIGTRAP => b"SIGTRAP",
            _ => b"signal",
        }
    }

    fn skipped(ips: &[usize]) -> usize {
        let own = OWN.get().copied().unwrap_or(0);
        let base = |ip: usize| {
            let mut place = crate::crashes::stacks::Place::new();
            crate::crashes::stacks::place_of(ip, &mut place);
            place.base
        };
        let mut start = 0;
        while start < ips.len() && base(ips[start]) != own {
            start += 1;
        }
        while start < ips.len() && base(ips[start]) == own {
            start += 1;
        }
        start += 1;
        if start >= ips.len() {
            0
        } else {
            start
        }
    }

    #[cfg(target_os = "linux")]
    fn thread_name(into: &mut [u8; 32]) -> usize {
        unsafe {
            libc::prctl(libc::PR_GET_NAME, into.as_mut_ptr());
        }
        into.iter().position(|one| *one == 0).unwrap_or(0)
    }

    #[cfg(target_os = "macos")]
    fn thread_name(into: &mut [u8; 32]) -> usize {
        unsafe {
            libc::pthread_getname_np(libc::pthread_self(), into.as_mut_ptr().cast(), into.len());
        }
        into.iter().position(|one| *one == 0).unwrap_or(0)
    }

    #[cfg(target_os = "linux")]
    fn on_main() -> bool {
        i64::from(unsafe { libc::gettid() }) == i64::from(std::process::id())
    }

    #[cfg(target_os = "macos")]
    fn on_main() -> bool {
        unsafe { libc::pthread_main_np() != 0 }
    }

    extern "C" fn caught(signal: c_int, info: *mut libc::siginfo_t, _context: *mut c_void) {
        let mut ips = [0usize; MOST_FRAMES];
        let len = crate::crashes::stacks::trace_into(&mut ips);
        let from = skipped(&ips[..len]);
        let mut name = [0u8; 32];
        let named = thread_name(&mut name);
        let address = if info.is_null() || signal == libc::SIGABRT {
            None
        } else {
            Some(unsafe { (*info).si_addr() } as u64)
        };
        let code = if info.is_null() {
            0
        } else {
            u64::try_from(unsafe { (*info).si_code }).unwrap_or(0)
        };
        if let Some(len) = written(
            name_of(signal),
            code,
            address,
            &name[..named],
            on_main(),
            &ips[from..len],
        ) {
            if let Some(path) = PATH.get() {
                let bytes = room_bytes(len);
                unsafe {
                    let file = libc::open(
                        path.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC,
                        0o600,
                    );
                    if file >= 0 {
                        libc::write(file, bytes.as_ptr().cast(), bytes.len());
                        libc::close(file);
                    }
                }
            }
        }
        if let Some((_, before)) = BEFORE
            .get()
            .and_then(|all| all.iter().find(|(one, _)| *one == signal))
        {
            unsafe {
                libc::sigaction(signal, before, std::ptr::null_mut());
            }
        }
        let sent = !info.is_null() && unsafe { (*info).si_code } <= 0;
        if sent {
            unsafe {
                libc::raise(signal);
            }
        }
    }
}

#[cfg(windows)]
mod here {
    #![allow(
        unsafe_code,
        reason = "a crash is heard through the unhandled-exception filter and written through CreateFileW, which only Win32 has"
    )]

    use std::os::windows::ffi::OsStrExt as _;
    use std::path::Path;
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GENERIC_WRITE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, WriteFile, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_MODE,
    };
    use windows::Win32::System::Diagnostics::Debug::{
        SetUnhandledExceptionFilter, EXCEPTION_POINTERS, LPTOP_LEVEL_EXCEPTION_FILTER,
    };
    use windows::Win32::System::Threading::GetCurrentThreadStackLimits;

    use super::{room_bytes, written, MOST_FRAMES};
    use crate::crashes::stacks::win;

    static PATH: OnceLock<Vec<u16>> = OnceLock::new();

    static BEFORE: OnceLock<LPTOP_LEVEL_EXCEPTION_FILTER> = OnceLock::new();

    pub fn install(stub: &Path) {
        let mut wide: Vec<u16> = stub.as_os_str().encode_wide().collect();
        wide.push(0);
        let _ = PATH.set(wide);
        let _ = BEFORE.get_or_init(|| unsafe { SetUnhandledExceptionFilter(Some(caught)) });
    }

    unsafe extern "system" fn caught(pointers: *const EXCEPTION_POINTERS) -> i32 {
        if !pointers.is_null() {
            let record = unsafe { (*pointers).ExceptionRecord };
            let context = unsafe { (*pointers).ContextRecord };
            if !record.is_null() && !context.is_null() {
                let code = u64::from(unsafe { (*record).ExceptionCode.0 }.cast_unsigned());
                let address = (unsafe { (*record).NumberParameters } >= 2).then(|| {
                    u64::try_from(unsafe { (*record).ExceptionInformation[1] }).unwrap_or(0)
                });
                let mut copied = unsafe { *context };
                let (mut low, mut high) = (0usize, 0usize);
                unsafe { GetCurrentThreadStackLimits(&raw mut low, &raw mut high) };
                let mut ips = [0usize; MOST_FRAMES];
                let len = win::unwind(&mut copied, &mut ips, (high > low).then_some((low, high)));
                let main = win::is_main();
                if let Some(len) = written(
                    b"exception",
                    code,
                    address,
                    if main { b"main" } else { b"" },
                    main,
                    &ips[..len],
                ) {
                    if let Some(path) = PATH.get() {
                        let bytes = room_bytes(len);
                        if let Ok(file) = unsafe {
                            CreateFileW(
                                PCWSTR(path.as_ptr()),
                                GENERIC_WRITE.0,
                                FILE_SHARE_MODE(0),
                                None,
                                CREATE_ALWAYS,
                                FILE_ATTRIBUTE_NORMAL,
                                None,
                            )
                        } {
                            unsafe {
                                let _ = WriteFile(file, Some(bytes), None, None);
                                let _ = CloseHandle(file);
                            }
                        }
                    }
                }
            }
        }
        match BEFORE.get() {
            Some(Some(before)) => unsafe { before(pointers) },
            _ => 0,
        }
    }
}

pub struct Stub {
    pub at: u64,
    pub version: String,
    pub report: Report,
}

pub fn exception_name(code: u64) -> Option<&'static str> {
    Some(match code {
        0xC000_0005 => "EXCEPTION_ACCESS_VIOLATION",
        0xC000_0006 => "EXCEPTION_IN_PAGE_ERROR",
        0xC000_001D => "EXCEPTION_ILLEGAL_INSTRUCTION",
        0xC000_0094 => "EXCEPTION_INT_DIVIDE_BY_ZERO",
        0xC000_0095 => "EXCEPTION_INT_OVERFLOW",
        0xC000_0096 => "EXCEPTION_PRIV_INSTRUCTION",
        0xC000_00FD => "EXCEPTION_STACK_OVERFLOW",
        0xC000_0374 => "STATUS_HEAP_CORRUPTION",
        0xC000_0409 => "STATUS_STACK_BUFFER_OVERRUN",
        0x8000_0003 => "EXCEPTION_BREAKPOINT",
        0xE06D_7363 => "a C++ exception",
        _ => return None,
    })
}

fn parsed_hex(said: &str) -> Option<u64> {
    u64::from_str_radix(said.trim().strip_prefix("0x")?, 16).ok()
}

pub fn read_stub(text: &str) -> Option<Stub> {
    let mut lines = text.lines();
    if lines.next()? != "orden-crash 1" {
        return None;
    }
    let mut at = 0;
    let mut version = String::new();
    let mut what = String::new();
    let mut code = 0;
    let mut address = None;
    let mut thread = Thread::default();
    let mut doing = Vec::new();
    let mut crumbs = Vec::new();
    for line in lines {
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "at" => at = value.parse().unwrap_or(0),
            "version" => value.clone_into(&mut version),
            "what" => value.clone_into(&mut what),
            "code" => code = parsed_hex(value).unwrap_or(0),
            "address" => address = parsed_hex(value),
            "thread" => value.clone_into(&mut thread.name),
            "main" => thread.main = (value == "1").then_some(true),
            "frame" => {
                let mut parts = value.split('\t');
                let module = parts.next().unwrap_or_default();
                let offset = parts.next().unwrap_or_default();
                let symbol = parts.next().unwrap_or_default();
                thread.frames.push(Frame {
                    module: if module.is_empty() { "?" } else { module }.to_owned(),
                    offset: offset.to_owned(),
                    symbol: (!symbol.is_empty()).then(|| symbol.to_owned()),
                });
            }
            "doing" => doing.push(value.to_owned()),
            "crumb" => {
                if let Some((when, said)) = value.split_once('\t') {
                    crumbs.push(Crumb {
                        at: when.parse().unwrap_or(0),
                        what: said.to_owned(),
                    });
                }
            }
            _ => {}
        }
    }
    thread.crashed = Some(true);
    let named = if what == "exception" {
        exception_name(code).map_or_else(|| format!("exception {code:#x}"), str::to_owned)
    } else {
        what.clone()
    };
    let place = thread
        .frames
        .first()
        .map(|frame| format!(" in {}", frame.module))
        .unwrap_or_default();
    let summary = match address {
        Some(address) if what != "SIGABRT" => format!("{named} at {address:#x}{place}"),
        _ => format!("{named}{place}"),
    };
    let report = Report {
        v: 1,
        id: report::fresh_id(),
        kind: "crash".to_owned(),
        at,
        summary,
        doing: (!doing.is_empty()).then(|| doing.join(" < ")),
        threads: vec![thread],
        breadcrumbs: crumbs,
        ..Report::default()
    };
    Some(Stub {
        at,
        version,
        report,
    })
}

pub fn stub_path(dir: &Path) -> PathBuf {
    dir.join(STUB)
}

#[cfg(test)]
mod tests {
    use super::{exception_name, install, read_stub, STUB};
    use crate::crashes::stacks::{place_of, Place};
    use std::path::Path;

    const CHILD: &str = "NIB_CRASH_TEST_CHILD";

    #[inline(never)]
    #[allow(unsafe_code, reason = "the test crashes on purpose")]
    fn crash_here() {
        unsafe {
            std::hint::black_box(std::ptr::null_mut::<u32>()).write_volatile(7);
        }
    }

    #[cfg(windows)]
    #[allow(unsafe_code, reason = "Windows is asked not to show its crash dialog")]
    fn quietly() {
        use windows::Win32::System::Diagnostics::Debug::{
            SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX,
        };
        unsafe {
            SetErrorMode(SEM_NOGPFAULTERRORBOX | SEM_FAILCRITICALERRORS);
        }
    }

    #[cfg(not(windows))]
    fn quietly() {}

    #[test]
    fn a_forced_native_crash_leaves_a_report_the_next_launch_reads() {
        if let Some(dir) = std::env::var_os(CHILD) {
            let dir = Path::new(&dir);
            let mut place = Place::new();
            let at = crash_here as fn() as usize;
            place_of(at, &mut place);
            std::fs::write(dir.join("expected"), format!("{}", at - place.base)).expect("written");
            quietly();
            install(dir, "9.9.9");
            crash_here();
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let status = std::process::Command::new(std::env::current_exe().expect("the tests"))
            .args([
                "--exact",
                "crashes::native::tests::a_forced_native_crash_leaves_a_report_the_next_launch_reads",
                "--test-threads=1",
            ])
            .env(CHILD, dir.path())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("the child ran");
        assert!(!status.success());

        let text = std::fs::read_to_string(dir.path().join(STUB)).expect("the crash was written");
        let stub = read_stub(&text).expect("a stub");
        assert_eq!(stub.version, "9.9.9");
        assert!(
            stub.report.summary.starts_with("SIGSEGV")
                || stub.report.summary.starts_with("SIGBUS")
                || stub
                    .report
                    .summary
                    .starts_with("EXCEPTION_ACCESS_VIOLATION"),
            "{}",
            stub.report.summary
        );
        let expected: usize = std::fs::read_to_string(dir.path().join("expected"))
            .expect("expected")
            .parse()
            .expect("a number");
        let first = &stub.report.threads[0].frames[0];
        let offset = usize::from_str_radix(first.offset.trim_start_matches("0x"), 16).expect("hex");
        assert!(
            (expected..expected + 2048).contains(&offset),
            "the crash was placed at {offset:#x}, not in crash_here at {expected:#x}: {text}"
        );
    }

    #[test]
    fn a_crash_written_in_its_handler_is_read_back_as_a_report() {
        let stub = read_stub(
            "orden-crash 1\nat 1791065463685\nversion 0.20.1-1184\nwhat SIGSEGV\ncode 0x1\naddress 0x10\nthread main\nmain 1\nframe nib\t0x1a2b\t\nframe libc.so.6\t0x29d90\t__libc_start_main\ndoing web_open\ncrumb 1791065463000\tweb_open\n",
        )
        .expect("a stub");
        assert_eq!(stub.version, "0.20.1-1184");
        assert_eq!(stub.report.summary, "SIGSEGV at 0x10 in nib");
        assert_eq!(stub.report.doing.as_deref(), Some("web_open"));
        let thread = &stub.report.threads[0];
        assert_eq!(thread.crashed, Some(true));
        assert_eq!(thread.main, Some(true));
        assert_eq!(thread.frames.len(), 2);
        assert_eq!(
            thread.frames[1].symbol.as_deref(),
            Some("__libc_start_main")
        );
        assert_eq!(stub.report.breadcrumbs[0].what, "web_open");
        assert!(read_stub("something else").is_none());
    }

    #[test]
    fn a_windows_exception_is_named() {
        assert_eq!(
            exception_name(0xC000_0005),
            Some("EXCEPTION_ACCESS_VIOLATION")
        );
        let stub = read_stub("orden-crash 1\nat 5\nwhat exception\ncode 0xc00000fd\nthread main\nmain 1\nframe nib.exe\t0x10\t\n")
            .expect("a stub");
        assert_eq!(stub.report.summary, "EXCEPTION_STACK_OVERFLOW in nib.exe");
    }
}
