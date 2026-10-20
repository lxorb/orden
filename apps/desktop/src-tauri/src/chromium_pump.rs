//! The app's main thread asleep while nothing happens, on Linux.
//!
//! Orden on Linux sat at a whole core while idle - no web tab, the window not even in
//! front - where Firefox and Chromium sit near nothing (#427, KDE). All of it was the
//! browser process's main thread, which never slept: it polled its file descriptors
//! with a timeout of nothing, found nothing on any of them, and polled again, thousands
//! of times a second.
//!
//! The thread is GTK's: the runtime runs `GLib`'s default main context, and CEF's work
//! is given to it through a `GLib` source of the runtime's own, which wakes the loop when
//! Chromium has work and at most thirty times a second otherwise (`tauri-runtime-cef`'s
//! external message pump). But Chromium attaches the `GLib` sources of its own pump to the
//! same default context as it starts - its `MessagePumpGlib`, which an external pump on
//! Linux is built on - and that pump is never run: CEF runs its work through
//! `CefDoMessageLoopWork` instead. Outside a run the pump has no state, and its source
//! then answers every "how long may the loop sleep?" with "not at all", while its check
//! says there is nothing to do. So the loop never slept, and never did anything either.
//!
//! The answer is the one that source would give if it had been running and had nothing
//! due: no limit. Its own `prepare` still runs, and its `check` and `dispatch` are
//! untouched; only a timeout of nothing becomes none, which leaves the loop to sleep
//! until a descriptor has something on it, a timer is due, or the runtime's own source
//! is woken. Measured with `scripts/idle-cpu.py`.
//!
//! `GLib` is reached by name at run time, not linked: the crate's `GLib` binding is GTK 3's
//! on the system engine and GTK 4's here, and the two cannot be in one dependency graph.

use std::ffi::{c_char, c_int, c_uint, c_void, CStr};
use std::sync::OnceLock;

/// `GLib`'s `GSourceFuncs`, as gmain.h lays it out.
#[repr(C)]
#[derive(Clone, Copy)]
struct SourceFuncs {
    prepare: Option<Prepare>,
    check: *const c_void,
    dispatch: *const c_void,
    finalize: *const c_void,
    closure_callback: *const c_void,
    closure_marshal: *const c_void,
}

/// The start of `GLib`'s `GSource`, as gmain.h lays it out: as far as its priority.
#[repr(C)]
struct Source {
    callback_data: *mut c_void,
    callback_funcs: *mut c_void,
    funcs: *const SourceFuncs,
    ref_count: c_uint,
    context: *mut c_void,
    priority: c_int,
}

/// `GLib`'s `G_PRIORITY_DEFAULT_IDLE`, which Chromium gives its pump's work source.
const DEFAULT_IDLE: c_int = 200;

/// A source's `prepare`.
type Prepare = unsafe extern "C" fn(*mut Source, *mut c_int) -> c_int;

/// Chromium's own `prepare` for the source, kept to be called from `prepare`.
static CHROMIUM: OnceLock<Prepare> = OnceLock::new();

/// Chromium's `prepare`, with a timeout of nothing read as none; see the top of this
/// file.
#[allow(
    unsafe_code,
    reason = "a GLib callback, called by GLib with its own source"
)]
unsafe extern "C" fn prepare(source: *mut Source, timeout: *mut c_int) -> c_int {
    let Some(own) = CHROMIUM.get() else {
        return 0;
    };
    // Safe: GLib hands this the source it was set on and a place for the timeout, as it
    // would hand them to Chromium's own `prepare`.
    unsafe {
        let ready = own(source, timeout);
        if ready == 0 && !timeout.is_null() && *timeout == 0 {
            *timeout = -1;
        }
        ready
    }
}

/// Whether `address` is in CEF's own library.
#[allow(unsafe_code, reason = "dladdr only reads the dynamic linker's tables")]
fn in_cef(address: *const c_void) -> bool {
    let mut info = libc::Dl_info {
        dli_fname: std::ptr::null(),
        dli_fbase: std::ptr::null_mut(),
        dli_sname: std::ptr::null(),
        dli_saddr: std::ptr::null_mut(),
    };
    // Safe: `info` is a whole `Dl_info` for dladdr to fill, and its file name, where
    // there is one, is a string the dynamic linker keeps for as long as the library
    // is loaded.
    unsafe {
        if libc::dladdr(address, &raw mut info) == 0 || info.dli_fname.is_null() {
            return false;
        }
        CStr::from_ptr(info.dli_fname)
            .to_string_lossy()
            .ends_with("libcef.so")
    }
}

/// Looks up a function of `GLib`'s, already loaded with GTK, by name.
#[allow(unsafe_code, reason = "dlsym only reads the dynamic linker's tables")]
fn glib(name: &CStr) -> Option<*mut c_void> {
    // Safe: a name looked up in what the process already has loaded.
    let found = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr().cast::<c_char>()) };
    (!found.is_null()).then_some(found)
}

/// Puts Chromium's pump's source on `GLib`'s default context to sleep with everything
/// else; see the top of this file. Called once, on the main thread, after CEF has
/// started and before the loop runs. Says how many sources it found to quiet: one,
/// where Chromium's pump is as this was written; none, where it has changed.
#[allow(
    unsafe_code,
    reason = "GLib's sources are read and one of them given other functions, on the thread that runs them"
)]
fn quiet() -> usize {
    type Default = unsafe extern "C" fn() -> *mut c_void;
    type Find = unsafe extern "C" fn(*mut c_void, c_uint) -> *mut Source;
    let (Some(default), Some(find)) = (
        glib(c"g_main_context_default"),
        glib(c"g_main_context_find_source_by_id"),
    ) else {
        return 0;
    };
    // Safe: both are GLib's own functions under their own names, with these signatures.
    let (default, find) = unsafe {
        (
            std::mem::transmute::<*mut c_void, Default>(default),
            std::mem::transmute::<*mut c_void, Find>(find),
        )
    };
    let mut quieted = 0;
    // Safe: the default context is GLib's for the life of the process; a source found by
    // its id is alive while the context holds it, which it does until it is destroyed on
    // this thread; and its functions are Chromium's static table, which is copied rather
    // than changed, the copy kept for the life of the process.
    unsafe {
        let context = default();
        // Sources are numbered from one as they are attached, and Chromium's are among
        // the first few dozen: everything that starts before the window.
        for id in 1..256 {
            let source = find(context, id);
            if source.is_null() {
                continue;
            }
            let funcs = (*source).funcs;
            if funcs.is_null() || (*source).priority != DEFAULT_IDLE {
                continue;
            }
            let Some(own) = (*funcs).prepare else {
                continue;
            };
            if (*funcs).dispatch.is_null() || !in_cef(own as *const c_void) {
                continue;
            }
            if CHROMIUM.set(own).is_err() {
                continue;
            }
            let quiet: &'static SourceFuncs = Box::leak(Box::new(SourceFuncs {
                prepare: Some(prepare),
                ..*funcs
            }));
            (*source).funcs = quiet;
            quieted += 1;
        }
    }
    quieted
}

/// Quiets Chromium's pump (`quiet`) and says so in the log, once, as the app starts.
pub fn start(app: &tauri::AppHandle) {
    crate::logs::say(
        app,
        "info",
        &format!("pump: {} of Chromium's sources quieted", quiet()),
    );
}
