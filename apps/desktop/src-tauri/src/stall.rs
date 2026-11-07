use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri::Manager as _;

use crate::logs::say;

const STALL: Duration = Duration::from_secs(1);

const HUNG: Duration = Duration::from_secs(5);

const LOOK: Duration = Duration::from_millis(500);

const MARKER: &str = "not-responding.json";

static DOING: Mutex<Vec<String>> = Mutex::new(Vec::new());

const PAGE: &str = "main";

static PAGE_UP: AtomicBool = AtomicBool::new(false);

pub struct Doing(());

pub fn doing(what: &str) -> Doing {
    if let Ok(mut held) = DOING.lock() {
        held.push(what.to_owned());
    }
    Doing(())
}

impl Drop for Doing {
    fn drop(&mut self) {
        if let Ok(mut held) = DOING.lock() {
            held.pop();
        }
    }
}

pub fn doing_now() -> Option<String> {
    let held = DOING.lock().ok()?;
    (!held.is_empty()).then(|| held.iter().rev().cloned().collect::<Vec<_>>().join(" < "))
}

pub fn each_doing_now(mut each: impl FnMut(&str)) {
    if let Ok(held) = DOING.try_lock() {
        for one in held.iter().rev() {
            each(one);
        }
    }
}

fn now_doing() -> String {
    DOING
        .lock()
        .ok()
        .filter(|held| !held.is_empty())
        .map_or_else(
            || "nothing of Orden's own".to_owned(),
            |held| held.iter().rev().cloned().collect::<Vec<_>>().join(" < "),
        )
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let watched = Watched::this_thread(&app);
    let _ = std::thread::Builder::new()
        .name("stall watch".to_owned())
        .spawn(move || {
            if let Some(dir) = marker_dir(&app) {
                if let Some(said) = last_run(&dir.join(MARKER)) {
                    say(&app, "warn", &said);
                }
            }
            loop {
                std::thread::sleep(LOOK);
                let answers = watch_once(&app, &watched);
                #[cfg(desktop)]
                crate::crashes::tick(answers);
                #[cfg(not(desktop))]
                let _ = answers;
            }
        });
}

fn watch_once(app: &AppHandle, watched: &Watched) -> bool {
    let asked = Instant::now();
    let how = match watched.answers(STALL) {
        Answer::Answered => return true,
        Answer::Gone => return false,
        Answer::Late(how) => how,
    };

    let what = match how {
        Late::Stuck => now_doing(),
        Late::Nested => format!("{}, in a nested loop", now_doing()),
        Late::Page => format!("{}, its page not answering", now_doing()),
    };
    say(
        app,
        "warn",
        &format!("stall: the window has not answered for 1 s ({what})"),
    );

    let marker = marker_dir(app).map(|dir| dir.join(MARKER));
    let since = crate::clock::now().saturating_sub(millis(asked.elapsed()));
    let mut written = false;
    #[cfg(desktop)]
    let mut freeze: Option<crate::crashes::freeze::Freeze> = None;
    while matches!(watched.answers(STALL), Answer::Late(_)) {
        let held = asked.elapsed();
        if held >= HUNG {
            if let Some(marker) = &marker {
                let _ = std::fs::write(marker, marked(since, held, &what));
            }
            written = true;
            #[cfg(desktop)]
            match freeze.as_mut() {
                Some(freeze) => freeze.still(held),
                None => freeze = Some(crate::crashes::freeze::began(&what, held)),
            }
        }
    }
    #[cfg(desktop)]
    if let Some(freeze) = freeze {
        freeze.ended(asked.elapsed());
    }

    say(
        app,
        "warn",
        &format!(
            "stall: the window answered after {} ({what})",
            seconds(asked.elapsed())
        ),
    );
    if written {
        if let Some(marker) = &marker {
            let _ = std::fs::remove_file(marker);
        }
    }
    false
}

fn marker_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::paths::log_dir(app).ok()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Marked {
    since: u64,
    held: u64,
    doing: String,
}

fn marked(since: u64, held: Duration, doing: &str) -> String {
    serde_json::to_string(&Marked {
        since,
        held: millis(held),
        doing: doing.to_owned(),
    })
    .unwrap_or_default()
}

fn last_run(marker: &Path) -> Option<String> {
    let text = std::fs::read_to_string(marker).ok()?;
    let _ = std::fs::remove_file(marker);
    let left: Marked = serde_json::from_str(&text).ok()?;
    Some(format!(
        "stall: Orden was not responding for {} when it was ended ({}), since {}",
        seconds(Duration::from_millis(left.held)),
        left.doing,
        crate::clock::iso(left.since)
    ))
}

fn millis(span: Duration) -> u64 {
    u64::try_from(span.as_millis()).unwrap_or(u64::MAX)
}

fn seconds(span: Duration) -> String {
    let tenths = span.as_millis() / 100;
    if tenths < 600 {
        format!("{}.{} s", tenths / 10, tenths % 10)
    } else {
        format!("{} s", tenths / 10)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Answer {
    Answered,
    Late(Late),
    Gone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Late {
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "only Windows can tell a stuck thread from a nested loop"
        )
    )]
    Stuck,
    Nested,
    Page,
}

struct Watched {
    app: AppHandle,
    #[cfg(windows)]
    thread: u32,
}

impl Watched {
    #[cfg_attr(
        windows,
        allow(unsafe_code, reason = "the thread's number is Win32's to say")
    )]
    fn this_thread(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            #[cfg(windows)]
            thread: unsafe { windows::Win32::System::Threading::GetCurrentThreadId() },
        }
    }

    fn answers(&self, within: Duration) -> Answer {
        let asked = Instant::now();
        #[cfg(windows)]
        match pumps(self.thread, within) {
            Answer::Answered => {}
            other => return other,
        }
        let answer = match self.looped(within.saturating_sub(asked.elapsed())) {
            Answer::Answered => self.paged(within.saturating_sub(asked.elapsed())),
            other => other,
        };
        match answer {
            Answer::Late(_) if self.held_by_the_person() => Answer::Answered,
            other => other,
        }
    }

    fn paged(&self, within: Duration) -> Answer {
        let Some(page) = self.app.get_webview(PAGE) else {
            return Answer::Answered;
        };
        let (told, heard) = std::sync::mpsc::channel();
        if page
            .eval_with_callback("0", move |_| {
                let _ = told.send(());
            })
            .is_err()
        {
            return Answer::Answered;
        }
        match heard.recv_timeout(within) {
            Ok(()) => {
                PAGE_UP.store(true, Ordering::Relaxed);
                Answer::Answered
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) if PAGE_UP.load(Ordering::Relaxed) => {
                Answer::Late(Late::Page)
            }
            Err(_) => Answer::Answered,
        }
    }

    fn looped(&self, within: Duration) -> Answer {
        let (told, heard) = std::sync::mpsc::channel();
        if self
            .app
            .run_on_main_thread(move || {
                let _ = told.send(());
            })
            .is_err()
        {
            return Answer::Gone;
        }
        match heard.recv_timeout(within) {
            Ok(()) => Answer::Answered,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Answer::Late(Late::Nested),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Answer::Gone,
        }
    }

    #[cfg(windows)]
    #[allow(
        unsafe_code,
        reason = "a thread's state is asked through GetGUIThreadInfo"
    )]
    fn held_by_the_person(&self) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GUITHREADINFO};
        let mut info = GUITHREADINFO {
            cbSize: u32::try_from(std::mem::size_of::<GUITHREADINFO>()).unwrap_or(0),
            ..Default::default()
        };
        if unsafe { GetGUIThreadInfo(self.thread, &raw mut info) }.is_err() {
            return false;
        }
        held(info.flags.0, || menu_shown(self.thread))
    }

    #[cfg(not(windows))]
    #[allow(
        clippy::unused_self,
        reason = "one signature on every system; only Windows can ask a thread whether a hand holds it"
    )]
    fn held_by_the_person(&self) -> bool {
        false
    }
}

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only Windows can ask a thread whether a hand holds it"
    )
)]
fn held(flags: u32, menu_shown: impl FnOnce() -> bool) -> bool {
    const MOVE_SIZE: u32 = 0x0000_0002;
    const MENUS: u32 = 0x0000_0004 | 0x0000_0008 | 0x0000_0010;
    flags & MOVE_SIZE != 0 || (flags & MENUS != 0 && menu_shown())
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a thread's windows are walked through EnumThreadWindows, which only the Win32 API has"
)]
fn menu_shown(thread: u32) -> bool {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumThreadWindows, GetClassNameW, IsWindowVisible,
    };

    unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
        let mut name = [0u16; 8];
        let length = unsafe { GetClassNameW(window, &mut name) };
        let said = name
            .get(..usize::try_from(length).unwrap_or(0))
            .unwrap_or_default();
        let menu = String::from_utf16_lossy(said) == "#32768";
        if menu && unsafe { IsWindowVisible(window) }.as_bool() {
            unsafe { *(found.0 as *mut bool) = true };
            return BOOL(0);
        }
        BOOL(1)
    }

    let mut found = false;
    unsafe {
        let _ = EnumThreadWindows(thread, Some(each), LPARAM(&raw mut found as isize));
    }
    found
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a window's thread is asked through SendMessageTimeout, which only the Win32 API has"
)]
fn pumps(thread: u32, within: Duration) -> Answer {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumThreadWindows, IsWindow, SendMessageTimeoutW, SMTO_NORMAL, WM_NULL,
    };

    unsafe extern "system" fn first_window_of_thread(window: HWND, found: LPARAM) -> BOOL {
        unsafe { *(found.0 as *mut isize) = window.0 as isize };
        BOOL(0)
    }

    let mut found: isize = 0;
    unsafe {
        let _ = EnumThreadWindows(
            thread,
            Some(first_window_of_thread),
            LPARAM(&raw mut found as isize),
        );
    }
    if found == 0 {
        return Answer::Gone;
    }
    let window = HWND(found as *mut core::ffi::c_void);
    let mut result = 0usize;
    let wait = u32::try_from(within.as_millis()).unwrap_or(u32::MAX);
    let sent = unsafe {
        SendMessageTimeoutW(
            window,
            WM_NULL,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            wait,
            Some(&raw mut result),
        )
    };
    if sent.0 != 0 {
        Answer::Answered
    } else if unsafe { IsWindow(window) }.as_bool() {
        Answer::Late(Late::Stuck)
    } else {
        Answer::Gone
    }
}

#[cfg_attr(
    not(all(windows, not(feature = "cef"))),
    allow(dead_code, reason = "only WebView2 tells why a page's process failed")
)]
pub fn failed_words(kind: i32, reason: Option<i32>, exit: Option<i32>, process: &str) -> String {
    let what = match kind {
        0 => "lost its browser process",
        1 => "ended",
        2 => "stopped responding",
        3 => "lost a frame's process",
        4 => "lost a utility process",
        5 => "lost its sandbox helper",
        6 => "lost its GPU process",
        7 => "lost a plugin process",
        8 => "lost a plugin broker",
        _ => "lost a process",
    };
    let why = reason.map(|reason| match reason {
        1 => "unresponsive".to_owned(),
        2 => "terminated".to_owned(),
        3 => "crashed".to_owned(),
        4 => "could not start".to_owned(),
        5 => "out of memory".to_owned(),
        6 => "its profile was deleted".to_owned(),
        0 => "unexpectedly".to_owned(),
        other => format!("reason {other}"),
    });
    let how = exit.map(|code| format!("exit {:#x}", u32::from_ne_bytes(code.to_ne_bytes())));
    let process = (!process.is_empty()).then(|| process.to_owned());
    let told: Vec<String> = [why, how, process].into_iter().flatten().collect();
    if told.is_empty() {
        what.to_owned()
    } else {
        format!("{what}: {}", told.join(", "))
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "why a process failed is told through WebView2's own event arguments"
)]
pub fn failure_of(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ProcessFailedEventArgs,
) -> (
    webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND,
    String,
) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND,
        COREWEBVIEW2_PROCESS_FAILED_REASON,
    };
    use windows_core::{Interface as _, PWSTR};

    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
    let (reason, exit, process) = unsafe {
        let _ = args.ProcessFailedKind(&raw mut kind);
        match args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
            Ok(two) => {
                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
                let reason = two.Reason(&raw mut reason).ok().map(|()| reason.0);
                let mut code = 0i32;
                let exit = two.ExitCode(&raw mut code).ok().map(|()| code);
                let mut named = PWSTR::null();
                let process = if two.ProcessDescription(&raw mut named).is_ok() {
                    webview2_com::take_pwstr(named)
                } else {
                    String::new()
                };
                (reason, exit, process)
            }
            Err(_) => (None, None, String::new()),
        }
    };
    (kind, failed_words(kind.0, reason, exit, &process))
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a webview's processes are WebView2's own event, reached through its COM interfaces"
)]
pub fn watch_page(app: &AppHandle, webview: &tauri::Webview, whose: &'static str) {
    use webview2_com::ProcessFailedEventHandler;

    let app = app.clone();
    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let (kind, what) = failure_of(&args);
            say(
                &app,
                "error",
                &format!("stall: {whose} page {what} ({})", now_doing()),
            );
            crate::crashes::page_failed(whose, kind.0, &what);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_ProcessFailed(&handler, &raw mut token);
    });
}

#[cfg(not(all(windows, not(feature = "cef"))))]
pub fn watch_page(_app: &AppHandle, _webview: &tauri::Webview, _whose: &'static str) {}

static GONE: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

#[allow(
    dead_code,
    reason = "no engine Orden runs on notes its page gone yet; WebKitGTK's did, and CEF's will"
)]
fn gone(label: &str) {
    GONE.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(label.to_owned());
}

pub fn page_gone(label: &str) -> bool {
    GONE.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(label)
}

#[cfg(test)]
mod tests {
    use super::{doing, failed_words, held, last_run, marked, now_doing, seconds};
    use std::time::Duration;

    #[test]
    fn a_hand_holds_the_thread_in_a_move_or_a_menu_it_can_see_but_not_in_a_menu_with_none_shown() {
        assert!(held(0x2, || false));
        assert!(held(0x4 | 0x10, || true));
        assert!(held(0x4 | 0x8, || true));
        assert!(!held(0x4, || false));
        assert!(!held(0x4 | 0x8, || false));
        assert!(!held(0x0, || true));
    }

    #[test]
    fn a_stall_is_said_in_tenths_below_a_minute() {
        assert_eq!(seconds(Duration::from_millis(1040)), "1.0 s");
        assert_eq!(seconds(Duration::from_millis(3460)), "3.4 s");
        assert_eq!(seconds(Duration::from_secs(41)), "41.0 s");
        assert_eq!(seconds(Duration::from_secs(75)), "75 s");
    }

    #[test]
    fn what_is_running_is_said_innermost_first_and_ends_with_its_guard() {
        let outer = doing("web_open");
        {
            let _inner = doing("web_place");
            assert_eq!(now_doing(), "web_place < web_open");
        }
        assert_eq!(now_doing(), "web_open");
        drop(outer);
        assert_eq!(now_doing(), "nothing of Orden's own");
    }

    #[test]
    fn a_failed_process_is_said_with_why_and_how_it_ended() {
        assert_eq!(
            failed_words(0, Some(3), Some(-1_073_741_819), "msedgewebview2"),
            "lost its browser process: crashed, exit 0xc0000005, msedgewebview2"
        );
        assert_eq!(
            failed_words(1, Some(5), Some(1), ""),
            "ended: out of memory, exit 0x1"
        );
        assert_eq!(failed_words(2, None, None, ""), "stopped responding");
        assert_eq!(
            failed_words(42, Some(9), None, ""),
            "lost a process: reason 9"
        );
    }

    #[test]
    fn a_hang_the_last_run_ended_in_is_said_once() {
        let dir = tempfile::tempdir().expect("a folder");
        let marker = dir.path().join("not-responding.json");
        std::fs::write(
            &marker,
            marked(1_791_065_463_685, Duration::from_secs(41), "web_open"),
        )
        .expect("written");

        assert_eq!(
            last_run(&marker).as_deref(),
            Some("stall: Orden was not responding for 41.0 s when it was ended (web_open), since 2026-10-03T22:11:03.685Z")
        );
        assert!(!marker.exists());
        assert_eq!(last_run(&marker), None);
    }

    #[cfg(windows)]
    #[test]
    #[allow(
        unsafe_code,
        reason = "a window of the test's own, made and pumped through Win32"
    )]
    fn a_thread_that_stops_pumping_is_late_and_answers_after() {
        use super::{pumps, Answer, Late};
        use std::sync::mpsc;
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, DispatchMessageW, PeekMessageW, MSG, PM_REMOVE,
            WINDOW_EX_STYLE, WS_OVERLAPPED,
        };

        let (told, heard) = mpsc::channel();
        let (stop, stopping) = mpsc::channel::<()>();
        let (go, going) = mpsc::channel::<()>();
        let worker = std::thread::spawn(move || {
            let window = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("STATIC"),
                    w!(""),
                    WS_OVERLAPPED,
                    0,
                    0,
                    0,
                    0,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("a window");
            told.send(unsafe { windows::Win32::System::Threading::GetCurrentThreadId() })
                .expect("told");
            let pump = || {
                let mut message = MSG::default();
                while unsafe { PeekMessageW(&raw mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                    unsafe {
                        DispatchMessageW(&raw const message);
                    }
                }
            };
            while stopping.try_recv().is_err() {
                pump();
                std::thread::sleep(Duration::from_millis(5));
            }
            going.recv().expect("go");
            for _ in 0..100 {
                pump();
                std::thread::sleep(Duration::from_millis(5));
            }
            let _ = unsafe { DestroyWindow(window) };
        });
        let thread = heard.recv().expect("the worker");

        assert_eq!(pumps(thread, Duration::from_millis(500)), Answer::Answered);
        stop.send(()).expect("stop");
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(
            pumps(thread, Duration::from_millis(300)),
            Answer::Late(Late::Stuck)
        );
        go.send(()).expect("go");
        assert_eq!(pumps(thread, Duration::from_secs(2)), Answer::Answered);
        worker.join().expect("the worker");
    }
}
