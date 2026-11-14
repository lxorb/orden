use orden_web_engine::NativeWindow;
use orden_web_engine::WindowSystem;

#[cfg(target_os = "linux")]
mod x11;

pub(crate) fn system() -> &'static dyn WindowSystem {
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
pub(crate) fn window_id(window: &tauri::Window<crate::Engine>) -> Option<NativeWindow> {
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

#[allow(
    clippy::cast_possible_truncation,
    clippy::useless_conversion,
    reason = "the engine's window handle is an X11 id, a view pointer or an HWND by platform; one number holds any of them"
)]
pub(crate) fn page_id(webview: &tauri::webview::PlatformWebview) -> Option<NativeWindow> {
    use cef::{ImplBrowser as _, ImplBrowserHost as _};

    let handle = webview
        .downcast_ref::<tauri_runtime_cef::Webview>()
        .and_then(|view| view.browser().host())
        .map(|host| host.window_handle())?;
    #[cfg(windows)]
    let raw = handle.0 as usize as u64;
    #[cfg(not(windows))]
    let raw = handle as usize as u64;
    (raw != 0).then_some(NativeWindow(raw))
}

pub(crate) fn x11_page(webview: &tauri::webview::PlatformWebview) -> Option<u32> {
    page_id(webview).and_then(NativeWindow::as_x11)
}
