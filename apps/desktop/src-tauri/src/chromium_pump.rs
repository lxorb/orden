use std::ffi::{c_char, c_int, c_uint, c_void, CStr};
use std::sync::OnceLock;

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

#[repr(C)]
struct Source {
    callback_data: *mut c_void,
    callback_funcs: *mut c_void,
    funcs: *const SourceFuncs,
    ref_count: c_uint,
    context: *mut c_void,
    priority: c_int,
}

const DEFAULT_IDLE: c_int = 200;

type Prepare = unsafe extern "C" fn(*mut Source, *mut c_int) -> c_int;

static CHROMIUM: OnceLock<Prepare> = OnceLock::new();

#[allow(
    unsafe_code,
    reason = "a GLib callback, called by GLib with its own source"
)]
unsafe extern "C" fn prepare(source: *mut Source, timeout: *mut c_int) -> c_int {
    let Some(own) = CHROMIUM.get() else {
        return 0;
    };
    unsafe {
        let ready = own(source, timeout);
        if ready == 0 && !timeout.is_null() && *timeout == 0 {
            *timeout = -1;
        }
        ready
    }
}

#[allow(unsafe_code, reason = "dladdr only reads the dynamic linker's tables")]
fn in_cef(address: *const c_void) -> bool {
    let mut info = libc::Dl_info {
        dli_fname: std::ptr::null(),
        dli_fbase: std::ptr::null_mut(),
        dli_sname: std::ptr::null(),
        dli_saddr: std::ptr::null_mut(),
    };
    unsafe {
        if libc::dladdr(address, &raw mut info) == 0 || info.dli_fname.is_null() {
            return false;
        }
        CStr::from_ptr(info.dli_fname)
            .to_string_lossy()
            .ends_with("libcef.so")
    }
}

#[allow(unsafe_code, reason = "dlsym only reads the dynamic linker's tables")]
fn glib(name: &CStr) -> Option<*mut c_void> {
    let found = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr().cast::<c_char>()) };
    (!found.is_null()).then_some(found)
}

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
    let (default, find) = unsafe {
        (
            std::mem::transmute::<*mut c_void, Default>(default),
            std::mem::transmute::<*mut c_void, Find>(find),
        )
    };
    let mut quieted = 0;
    unsafe {
        let context = default();
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

pub fn start(app: &tauri::AppHandle) {
    crate::logs::say(
        app,
        "info",
        &format!("pump: {} of Chromium's sources quieted", quiet()),
    );
}
