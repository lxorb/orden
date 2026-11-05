//! A desktop of its own for each application this Windows computer hosts (issue 1063, step
//! 8; docs/apps.md): Windows' answer to Linux's Xvfb.
//!
//! **Nowhere the reader at the host works.** The desktop is made with `CreateDesktopW` in
//! this session's window station and never switched to, so no screen shows it, nothing on
//! it can take the reader's focus, and the reader's mouse and keyboard never reach it. The
//! application is started on it (`STARTUPINFO.lpDesktop`), and everything it starts is
//! started there too, in a job object that ends with it.
//!
//! **Its windows fill the holder's view.** A desktop has no monitor of its own, so a
//! thread of this module's on the desktop (`keep`) places each window as it comes: a main
//! window fills the view, and fills it again when the view changes; a dialog is centred;
//! menus and the like are left where they are. The same thread asks the windows to close
//! when the application is stopped.
//!
//! **Its picture and its input** are read and played by threads on the same desktop, since
//! Windows passes no message from one desktop to another: `capture.rs` with
//! `PrintWindow`, `input.rs` with posted messages.
//!
//! **What it cannot do**, said in the tab:
//! - an application already running on the reader's desktop is often handed the start by
//!   its new process, which then ends, and opens there (`handed`);
//! - a Store application cannot be started on another desktop at all (`packaged`);
//! - some GPU-drawn applications (full-screen `DirectX`, some games) give `PrintWindow` no
//!   picture, and those that read raw input do not hear the holder's keys.

pub mod capture;
pub mod input;

/// The clipboard, which on Windows is the session's and so the reader's own at the host:
/// nothing goes between it and the holder's yet.
pub mod clipboard {
    /// Whoever hears what the application copied.
    pub type Listener = std::sync::Arc<dyn Fn(String) + Send + Sync>;

    /// A clipboard that gives and takes nothing.
    pub struct Clipboard;

    impl Clipboard {
        /// Nothing is ever copied here to be heard.
        #[allow(clippy::unused_self, reason = "the face of Linux's clipboard")]
        pub fn listen(&self, _listener: Option<Listener>) {}

        /// Nothing is given to the application.
        #[allow(clippy::unused_self, reason = "the face of Linux's clipboard")]
        pub fn give(&self, _text: &str) {}
    }
}

/// The application's sound, which on Windows plays on the reader's own speakers at the
/// host: none is sent yet.
pub mod audio {
    /// A sound that never starts.
    pub struct Sound;

    impl Sound {
        /// None: there is no sink of the application's own to read.
        pub fn start(_monitor: &str) -> Option<Sound> {
            None
        }

        /// Nothing.
        #[allow(clippy::unused_self, reason = "the face of Linux's sound")]
        pub fn next(&mut self) -> Option<(Vec<u8>, u32)> {
            None
        }
    }
}

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, GetProcessWindowStation, GetUserObjectInformationW,
    SetThreadDesktop, DESKTOP_CONTROL_FLAGS, HDESK, UOI_NAME,
};
use windows::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, ResumeThread, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    PROCESS_INFORMATION, STARTUPINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetTopWindow, GetWindow, GetWindowLongW, GetWindowRect, IsIconic, IsWindow, IsWindowVisible,
    PostMessageW, SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, GW_HWNDNEXT, GW_OWNER,
    SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SW_RESTORE, WM_CLOSE, WS_CAPTION, WS_EX_TOOLWINDOW,
    WS_MAXIMIZE, WS_THICKFRAME,
};

/// `GENERIC_ALL`, for a desktop this process makes and closes itself.
const EVERYTHING: u32 = 0x1000_0000;
/// How often the desktop's thread looks for windows to place.
const KEEP_EVERY: Duration = Duration::from_millis(100);
/// How often a program's job is asked whether anything in it still runs.
const ASK_EVERY: Duration = Duration::from_millis(200);

/// What the desktop's threads share: its handle, the view it fills, and what it was told.
pub struct Desk {
    handle: isize,
    size: Mutex<(u32, u32)>,
    /// Set by a stop: every window asked to close, once.
    closing: AtomicBool,
    /// Whether a window was ever seen on it.
    pub shown: AtomicBool,
    ended: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Every desktop made and not yet closed, by its name.
fn desks() -> MutexGuard<'static, HashMap<String, Arc<Desk>>> {
    static ALL: OnceLock<Mutex<HashMap<String, Arc<Desk>>>> = OnceLock::new();
    lock(ALL.get_or_init(Mutex::default))
}

/// The desktop of this name, if it is one of ours, for a thread to go to.
pub fn desk(name: &str) -> Option<Arc<Desk>> {
    desks().get(name).cloned()
}

impl Desk {
    /// The view its windows fill, in pixels.
    pub fn size(&self) -> (u32, u32) {
        *lock(&self.size)
    }

    /// Whether the desktop has been closed.
    pub fn ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }

    /// Moves the calling thread onto this desktop, which it must not have a window on yet.
    #[allow(unsafe_code, reason = "a thread is moved to a desktop by a Win32 call")]
    pub fn enter(&self) -> Result<(), String> {
        // SAFETY: a handle this module keeps open until every thread has seen `ended`;
        // the calling thread is a new one with no window.
        unsafe { SetThreadDesktop(HDESK(self.handle as _)) }.map_err(|error| error.to_string())
    }
}

/// A desktop of its own, made the holder's size, with the thread that keeps it.
pub struct Desktop {
    name: String,
    desk: Arc<Desk>,
    keeper: Option<std::thread::JoinHandle<()>>,
}

/// The window station this process is in, by name: `WinSta0` where a person is signed in.
#[allow(unsafe_code, reason = "a window station's name is asked of Win32")]
fn station() -> String {
    let mut name = [0_u16; 256];
    let size = u32::try_from(name.len() * 2).unwrap_or(512);
    // SAFETY: the process's own station, which is not closed; a buffer of the size said.
    let asked = unsafe {
        GetProcessWindowStation().and_then(|station| {
            GetUserObjectInformationW(
                HANDLE(station.0),
                UOI_NAME,
                Some(name.as_mut_ptr().cast()),
                size,
                None,
            )
        })
    };
    let end = name.iter().position(|&one| one == 0).unwrap_or(0);
    if asked.is_ok() && end > 0 {
        String::from_utf16_lossy(&name[..end])
    } else {
        "WinSta0".to_owned()
    }
}

/// A string as Win32 reads one: UTF-16, ending in nought.
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

impl Desktop {
    /// A new desktop, its windows to fill `width` by `height`.
    #[allow(unsafe_code, reason = "a desktop is made by a Win32 call")]
    pub fn start(width: u32, height: u32) -> Result<Desktop, String> {
        static MADE: AtomicU32 = AtomicU32::new(0);
        let name = format!(
            "orden-app-{}-{}",
            std::process::id(),
            MADE.fetch_add(1, Ordering::SeqCst)
        );
        let named = wide(&name);
        // SAFETY: a name that outlives the call; the desktop is closed on drop.
        let handle = unsafe {
            CreateDesktopW(
                PCWSTR(named.as_ptr()),
                PCWSTR::null(),
                None,
                DESKTOP_CONTROL_FLAGS(0),
                EVERYTHING,
                None,
            )
        }
        .map_err(|error| error.to_string())?;
        let desk = Arc::new(Desk {
            handle: handle.0 as isize,
            size: Mutex::new((width, height)),
            closing: AtomicBool::new(false),
            shown: AtomicBool::new(false),
            ended: AtomicBool::new(false),
        });
        desks().insert(name.clone(), desk.clone());
        let kept = desk.clone();
        let keeper = std::thread::spawn(move || keep(&kept));
        Ok(Desktop {
            name,
            desk,
            keeper: Some(keeper),
        })
    }

    /// Its name, which the picture and the input open it by.
    pub fn name(&self) -> String {
        self.name.clone()
    }

    /// The desktop's shared half.
    pub fn desk(&self) -> Arc<Desk> {
        self.desk.clone()
    }

    /// The holder's view changed: the main windows are made to fill it.
    pub fn fit(&self, width: u32, height: u32) {
        *lock(&self.desk.size) = (width, height);
    }

    /// Runs a program on this desktop, in a job of its own.
    #[allow(
        unsafe_code,
        reason = "a process is started on a desktop, in a job, with Win32 calls"
    )]
    pub fn run(&self, argv: &[String], folder: &Path) -> Result<Program, String> {
        let said = |error: windows::core::Error| error.to_string();
        let mut line = wide(&command_line(argv));
        let mut desktop = wide(&format!("{}\\{}", station(), self.name));
        let folder = wide(&folder.to_string_lossy());
        let info = STARTUPINFOW {
            cb: u32::try_from(std::mem::size_of::<STARTUPINFOW>()).unwrap_or(0),
            lpDesktop: PWSTR(desktop.as_mut_ptr()),
            ..Default::default()
        };
        let mut started = PROCESS_INFORMATION::default();
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size =
            u32::try_from(std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).unwrap_or(0);
        // SAFETY: every buffer outlives the calls; the handles made are owned by the
        // `Program` answered, or closed here where it is not.
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).map_err(said)?;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                size,
            )
            .map_err(said)?;
            if let Err(error) = CreateProcessW(
                PCWSTR::null(),
                PWSTR(line.as_mut_ptr()),
                None,
                None,
                false,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                None,
                PCWSTR(folder.as_ptr()),
                &raw const info,
                &raw mut started,
            ) {
                let _ = CloseHandle(job);
                return Err(error.to_string());
            }
            let _ = AssignProcessToJobObject(job, started.hProcess);
            ResumeThread(started.hThread);
            let _ = CloseHandle(started.hThread);
            let program = Program {
                pid: started.dwProcessId,
                process: started.hProcess.0 as isize,
                job: job.0 as isize,
            };
            programs().insert(program.pid, (program.job, self.desk.clone()));
            Ok(program)
        }
    }
}

impl Drop for Desktop {
    #[allow(unsafe_code, reason = "a desktop is closed by a Win32 call")]
    fn drop(&mut self) {
        self.desk.ended.store(true, Ordering::SeqCst);
        if let Some(keeper) = self.keeper.take() {
            let _ = keeper.join();
        }
        desks().remove(&self.name);
        // Closed once the picture's and the input's threads have seen it end and gone:
        // Windows does not close a desktop a thread of this process is still on.
        let handle = self.desk.handle;
        std::thread::spawn(move || {
            for _ in 0..50 {
                // SAFETY: the desktop made in `start`, closed once it can be.
                if unsafe { CloseDesktop(HDESK(handle as _)) }.is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        });
    }
}

/// A program started on a desktop, and its job.
pub struct Program {
    pid: u32,
    process: isize,
    job: isize,
}

/// Every program running, by its first process's id: its job and its desktop.
type Programs = HashMap<u32, (isize, Arc<Desk>)>;

fn programs() -> MutexGuard<'static, Programs> {
    static ALL: OnceLock<Mutex<Programs>> = OnceLock::new();
    lock(ALL.get_or_init(Mutex::default))
}

impl Program {
    /// Its first process's id, which the host knows it by.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Waits until nothing it started still runs: answers the first process's exit code.
    #[allow(unsafe_code, reason = "a job and a process are asked with Win32 calls")]
    pub fn wait(&self) -> Option<i32> {
        while busy(self.job) {
            std::thread::sleep(ASK_EVERY);
        }
        let mut code = 0_u32;
        // SAFETY: the process handle this owns, open until drop.
        unsafe { GetExitCodeProcess(HANDLE(self.process as _), &raw mut code) }.ok()?;
        Some(i32::from_ne_bytes(code.to_ne_bytes()))
    }
}

impl Drop for Program {
    #[allow(unsafe_code, reason = "handles are closed by a Win32 call")]
    fn drop(&mut self) {
        programs().remove(&self.pid);
        // SAFETY: the two handles this owns, closed once; closing the job ends whatever is
        // still in it.
        unsafe {
            let _ = CloseHandle(HANDLE(self.process as _));
            let _ = CloseHandle(HANDLE(self.job as _));
        }
    }
}

/// Whether anything in a job still runs.
#[allow(unsafe_code, reason = "a job is asked with a Win32 call")]
fn busy(job: isize) -> bool {
    let mut counts = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    let size =
        u32::try_from(std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>()).unwrap_or(0);
    // SAFETY: a structure of the size said, which the call fills.
    let asked = unsafe {
        QueryInformationJobObject(
            HANDLE(job as _),
            JobObjectBasicAccountingInformation,
            (&raw mut counts).cast(),
            size,
            None,
        )
    };
    asked.is_ok() && counts.ActiveProcesses > 0
}

/// Whether the program started with this id still runs.
pub fn alive(pid: u32) -> bool {
    programs().get(&pid).is_some_and(|(job, _)| busy(*job))
}

/// Asks the program's windows to close, as their close buttons do.
pub fn close(pid: u32) {
    if let Some((_, desk)) = programs().get(&pid) {
        desk.closing.store(true, Ordering::SeqCst);
    }
}

/// Ends everything the program started.
#[allow(unsafe_code, reason = "a job is ended by a Win32 call")]
pub fn kill(pid: u32) {
    if let Some((job, _)) = programs().get(&pid) {
        // SAFETY: the job's handle, open while the program is listed.
        let _ = unsafe { TerminateJobObject(HANDLE(*job as _), 1) };
    }
}

/// A command line Windows' C runtime splits back into these words.
pub fn command_line(argv: &[String]) -> String {
    argv.iter()
        .map(|word| quoted(word))
        .collect::<Vec<_>>()
        .join(" ")
}

/// One word as a command line holds it: as it is where nothing in it needs quotes; in
/// quotes otherwise, with the backslashes before a quote, and at the end, doubled.
fn quoted(word: &str) -> String {
    if !word.is_empty() && !word.contains([' ', '\t', '\n', '\u{b}', '"']) {
        return word.to_owned();
    }
    let mut out = String::from('"');
    let mut slashes = 0;
    for one in word.chars() {
        match one {
            '\\' => slashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(slashes));
                out.push(one);
                slashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}

/// The top-level windows shown on the calling thread's desktop, the front one first.
#[allow(
    unsafe_code,
    reason = "a desktop's windows are walked with Win32 calls"
)]
pub fn shown() -> Vec<HWND> {
    let mut found = Vec::new();
    // SAFETY: windows the system lists, asked and not kept past this walk.
    unsafe {
        let mut next = GetTopWindow(HWND::default()).ok();
        while let Some(window) = next.filter(|one| !one.is_invalid()) {
            if IsWindowVisible(window).as_bool() && !IsIconic(window).as_bool() {
                found.push(window);
            }
            if found.len() > 512 {
                break;
            }
            next = GetWindow(window, GW_HWNDNEXT).ok();
        }
    }
    found
}

/// A window's place, in the desktop's pixels.
#[allow(unsafe_code, reason = "a window's place is asked of Win32")]
pub fn place_of(window: HWND) -> Option<RECT> {
    let mut place = RECT::default();
    // SAFETY: a window just listed; a RECT the call fills.
    unsafe { GetWindowRect(window, &raw mut place) }.ok()?;
    (place.right > place.left && place.bottom > place.top).then_some(place)
}

/// What a window is, for its place: a main window fills the view, a dialog is centred,
/// and anything else - a menu, a tooltip, a splash - is left where it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Main,
    Dialog,
    Other,
}

/// A window's kind, by its styles and whether it has an owner.
pub fn kind_of(style: u32, extended: u32, owned: bool) -> Kind {
    let caption = style & WS_CAPTION.0 == WS_CAPTION.0;
    let framed = style & WS_THICKFRAME.0 != 0;
    if extended & WS_EX_TOOLWINDOW.0 != 0 {
        return Kind::Other;
    }
    match (owned, caption || framed) {
        (false, true) => Kind::Main,
        (true, true) => Kind::Dialog,
        _ => Kind::Other,
    }
}

/// Where a window of `size` goes on a view of `view`: in the middle, and never off its top
/// or left edge.
pub fn centred(size: (i32, i32), view: (i32, i32)) -> (i32, i32) {
    (
        ((view.0 - size.0) / 2).max(0),
        ((view.1 - size.1) / 2).max(0),
    )
}

/// The desktop's own thread: its windows placed as they come and as the view changes,
/// and asked to close when the program is stopped, until the desktop is closed.
#[allow(
    unsafe_code,
    reason = "windows are placed and asked to close with Win32 calls"
)]
fn keep(desk: &Desk) {
    if desk.enter().is_err() {
        return;
    }
    let mut placed: HashSet<isize> = HashSet::new();
    let mut fitted = (0, 0);
    while !desk.ended() {
        let size = desk.size();
        let refit = size != fitted;
        fitted = size;
        let view = (
            i32::try_from(size.0).unwrap_or(i32::MAX),
            i32::try_from(size.1).unwrap_or(i32::MAX),
        );
        let windows = shown();
        if !windows.is_empty() {
            desk.shown.store(true, Ordering::SeqCst);
        }
        let closing = desk.closing.swap(false, Ordering::SeqCst);
        for &window in &windows {
            let key = window.0 as isize;
            if closing {
                // SAFETY: asks the window to close, as its close button does.
                let _ = unsafe { PostMessageW(window, WM_CLOSE, WPARAM(0), LPARAM(0)) };
                continue;
            }
            let new = placed.insert(key);
            if !new && !refit {
                continue;
            }
            // SAFETY: a window just listed, asked for its styles and moved, never kept.
            unsafe {
                let style = u32::from_ne_bytes(GetWindowLongW(window, GWL_STYLE).to_ne_bytes());
                let extended =
                    u32::from_ne_bytes(GetWindowLongW(window, GWL_EXSTYLE).to_ne_bytes());
                let owned = GetWindow(window, GW_OWNER).is_ok_and(|one| !one.is_invalid());
                match kind_of(style, extended, owned) {
                    Kind::Main => {
                        if style & WS_MAXIMIZE.0 != 0 {
                            let _ = ShowWindow(window, SW_RESTORE);
                        }
                        let _ = SetWindowPos(
                            window,
                            HWND::default(),
                            0,
                            0,
                            view.0,
                            view.1,
                            SWP_NOZORDER | SWP_NOACTIVATE,
                        );
                    }
                    Kind::Dialog if new => {
                        if let Some(at) = place_of(window) {
                            let (x, y) = centred((at.right - at.left, at.bottom - at.top), view);
                            let _ = SetWindowPos(
                                window,
                                HWND::default(),
                                x,
                                y,
                                0,
                                0,
                                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                            );
                        }
                    }
                    Kind::Dialog | Kind::Other => {}
                }
            }
        }
        // SAFETY: asks whether each window kept is still there.
        placed.retain(|&one| unsafe { IsWindow(HWND(one as _)) }.as_bool());
        std::thread::sleep(KEEP_EVERY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_command_line_windows_splits_back_into_its_words() {
        let line = |words: &[&str]| {
            command_line(
                &words
                    .iter()
                    .map(|one| (*one).to_owned())
                    .collect::<Vec<_>>(),
            )
        };
        assert_eq!(line(&["C:\\x\\app.exe", "--a"]), "C:\\x\\app.exe --a");
        assert_eq!(
            line(&["C:\\Program Files\\App\\app.exe", ""]),
            "\"C:\\Program Files\\App\\app.exe\" \"\""
        );
        assert_eq!(line(&["say \"hi\""]), "\"say \\\"hi\\\"\"");
        assert_eq!(line(&["C:\\a b\\"]), "\"C:\\a b\\\\\"");
        let words = [
            "C:\\Program Files\\x.exe",
            "a \"b\" c",
            "end\\",
            "two words\\",
        ];
        let joined = line(&words);
        let back = super::super::installed::arguments(&joined);
        assert_eq!(
            back,
            words
                .iter()
                .map(|one| (*one).to_owned())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn places_a_main_window_a_dialog_and_leaves_a_menu() {
        let popup = 0x8000_0000;
        assert_eq!(
            kind_of(WS_CAPTION.0 | WS_THICKFRAME.0, 0, false),
            Kind::Main
        );
        assert_eq!(kind_of(WS_CAPTION.0, 0, true), Kind::Dialog);
        assert_eq!(kind_of(popup, 0, false), Kind::Other);
        assert_eq!(
            kind_of(WS_CAPTION.0, WS_EX_TOOLWINDOW.0, false),
            Kind::Other
        );
        assert_eq!(centred((400, 300), (1200, 800)), (400, 250));
        assert_eq!(centred((1600, 900), (1200, 800)), (0, 0));
    }

    /// The process a window is of.
    #[allow(unsafe_code, reason = "a window's process is asked of Win32")]
    fn process_of(window: HWND) -> u32 {
        let mut pid = 0;
        // SAFETY: a window just listed; a number the call fills.
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                window,
                Some(&raw mut pid),
            )
        };
        pid
    }

    /// Notepad on a desktop of its own: it shows nowhere the reader works, its window
    /// fills the view, and stopping it ends it.
    #[test]
    fn runs_a_program_on_a_desktop_of_its_own() {
        let notepad = std::path::PathBuf::from(std::env::var("SystemRoot").unwrap())
            .join("System32\\notepad.exe");
        if !notepad.is_file() {
            eprintln!("no notepad.exe here: skipped");
            return;
        }
        let desktop = Desktop::start(900, 700).unwrap();
        let program = desktop
            .run(
                &[notepad.to_string_lossy().into_owned()],
                &std::env::temp_dir(),
            )
            .unwrap();
        let desk = desktop.desk();
        let until = std::time::Instant::now() + Duration::from_secs(20);
        let watcher = std::thread::spawn({
            let desk = desk.clone();
            move || {
                desk.enter().unwrap();
                while std::time::Instant::now() < until {
                    let full = shown()
                        .into_iter()
                        .filter_map(place_of)
                        .any(|at| at.right - at.left == 900 && at.bottom - at.top == 700);
                    if full {
                        return true;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                false
            }
        });
        let filled = watcher.join().unwrap();
        assert!(desk.shown.load(Ordering::SeqCst), "no window came");
        assert!(filled, "the window did not fill the view");
        // Nothing of it on the reader's desktop.
        assert!(
            shown()
                .into_iter()
                .all(|one| process_of(one) != program.pid()),
            "its window is on the reader's desktop"
        );
        assert!(alive(program.pid()));
        close(program.pid());
        let ended = std::thread::spawn(move || program.wait());
        let code = ended.join().unwrap();
        assert!(code.is_some());
        drop(desktop);
    }
}
