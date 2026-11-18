use orden_web_engine::NativeWindow;
use orden_web_engine::WindowSystem;

#[cfg(target_os = "linux")]
mod x11;

pub fn system() -> &'static dyn WindowSystem {
    #[cfg(target_os = "linux")]
    {
        &x11::X11
    }
    #[cfg(not(target_os = "linux"))]
    {
        &orden_web_engine::Plain
    }
}

#[allow(
    clippy::cast_sign_loss,
    clippy::useless_conversion,
    reason = "a window's handle is an X11 id, a view pointer or an HWND by platform; one number holds any of them"
)]
pub fn window_id(window: &tauri::Window<orden_base::Engine>) -> Option<NativeWindow> {
    use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};

    let handle = window.window_handle().ok()?;
    let raw = match handle.as_raw() {
        RawWindowHandle::Xlib(x) => u64::from(x.window),
        RawWindowHandle::Xcb(x) => u64::from(x.window.get()),
        RawWindowHandle::AppKit(view) => view.ns_view.as_ptr() as usize as u64,
        RawWindowHandle::Win32(window) => window.hwnd.get() as usize as u64,
        _ => return None,
    };
    (raw != 0).then_some(NativeWindow(raw))
}

static PAGE_ID: std::sync::OnceLock<fn(&tauri::webview::PlatformWebview) -> Option<NativeWindow>> =
    std::sync::OnceLock::new();

pub fn hand_page_id(page_id: fn(&tauri::webview::PlatformWebview) -> Option<NativeWindow>) {
    let _ = PAGE_ID.set(page_id);
}

pub fn page_id(webview: &tauri::webview::PlatformWebview) -> Option<NativeWindow> {
    PAGE_ID.get().and_then(|page_id| page_id(webview))
}

pub fn x11_page(webview: &tauri::webview::PlatformWebview) -> Option<u32> {
    page_id(webview).and_then(NativeWindow::as_x11)
}
