//! What a Linux desktop needs of the app beyond what GTK does by itself, and Wayland
//! above all.
//!
//! **Before GTK starts** (`prepare`, the first thing a launch does). `WebKitGTK` draws
//! through DMA-BUF buffers, which NVIDIA's own driver does not hand it the way Mesa does:
//! the window opens blank, or the session's compositor drops it with a protocol error.
//! Every Tauri app on that driver sets `WEBKIT_DISABLE_DMABUF_RENDERER`, and every
//! package of one sets it again for itself; here the app sets it, once, where the driver
//! is NVIDIA's and the reader has not said otherwise, so every package gets it. One file
//! looked for, which is microseconds of a launch.
//!
//! **An `AppImage`'s `GStreamer`** (`prepare` too). The media framework an `AppImage`
//! carries is a build machine's, and the plugin paths the host hands it are the host's:
//! a NixOS profile's lists folders of Qt and KDE plugins, every one of which `GStreamer`
//! tried to load against the image's own older libraries, and said so 82 times. Inside an
//! `AppImage` `GStreamer` is pointed at its own plugins and nothing else, with a registry of
//! its own in the app's cache, so it never mixes the two.
//!
//! **Coming forward.** A Wayland compositor gives the front only to a window that shows
//! a token from the press that asked for it (xdg-activation): the launcher's, handed to
//! a launch as `XDG_ACTIVATION_TOKEN`, or the portal's, handed with a key from any app.
//! GTK 3 reads the launcher's only under its old name, `DESKTOP_STARTUP_ID`, so the first
//! window is handed it under that one. A second launch's token is the second launch's,
//! so it travels with its arguments to the app already running (`handover.rs`), and
//! `placement::raised` gives it to GTK just before the window is brought forward. Without one the
//! compositor is right to refuse, and GNOME says the app is ready instead.
//!
//! **Where a window is.** Wayland never tells an app where its windows are and never
//! lets one put them anywhere: the compositor places every window itself. So a window's
//! size and whether it was maximised come back on a launch, and its place does not
//! (`places_windows`).
//!
//! **Accelerated compositing off on Wayland** (`prepare` too). With a web tab's page laid
//! over the window's own (`web_overlay.rs`), the window's page drawn by `WebKitGTK`'s
//! accelerated compositor lost its frame once the app's layers had come and gone over the
//! web tab a few times: the tab strip and the bar went, and the transparent window showed
//! whatever was behind it until something drew again, which under a compositor that
//! draws a dark wallpaper behind is a window flashing between light and dark (#387).
//! Headless sway, 2026-10-17, Mesa's software GL: the ⋯ menu opened and shut over a web
//! tab blanked the window's page from the fourth time on in both runs with compositing
//! on, and in none of 72 pictures with it off. A reader's own
//! `WEBKIT_DISABLE_COMPOSITING_MODE`, either way, is left as it is.

use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

/// The switch `WebKitGTK` reads to draw without DMA-BUF.
const DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// The switch `WebKitGTK` reads to draw without its accelerated compositor.
const COMPOSITING: &str = "WEBKIT_DISABLE_COMPOSITING_MODE";

/// Present only while NVIDIA's own kernel driver is loaded; nouveau has no such file.
const NVIDIA: &str = "/proc/driver/nvidia/version";

/// The token a launcher hands the program it starts, and the name GTK 3 reads it by.
const TOKEN: &str = "XDG_ACTIVATION_TOKEN";
const STARTUP_ID: &str = "DESKTOP_STARTUP_ID";

/// How long a token is worth holding on to: the compositor hands one out for a press,
/// and a press is answered at once or not at all.
const FRESH: Duration = Duration::from_secs(10);

/// The launcher's token, read before GTK took it.
static LAUNCHED_WITH: OnceLock<Option<String>> = OnceLock::new();

/// A token that arrived for the next window to come forward, and when.
static PENDING: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Whether GTK draws on Wayland, as it said on the event loop's thread; see `learn`.
static DRAWN_ON_WAYLAND: OnceLock<bool> = OnceLock::new();

/// Before GTK and before any thread: DMA-BUF off on NVIDIA's driver, accelerated
/// compositing off on Wayland, and the launcher's token where GTK 3 looks for it.
pub fn prepare() {
    if compositing_off(
        std::env::var("GDK_BACKEND").ok().as_deref(),
        std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        std::env::var_os(COMPOSITING).is_some(),
    ) {
        std::env::set_var(COMPOSITING, "1");
    }
    if dmabuf_off(
        std::path::Path::new(NVIDIA).exists(),
        std::env::var_os(DMABUF).is_some(),
    ) {
        std::env::set_var(DMABUF, "1");
    }
    let token = std::env::var(TOKEN).ok().filter(|token| !token.is_empty());
    if let Some(token) = &token {
        if std::env::var_os(STARTUP_ID).is_none() {
            std::env::set_var(STARTUP_ID, token);
        }
        // Not handed on to a terminal's shells, whose programs would show a token that
        // was never theirs.
        std::env::remove_var(TOKEN);
    }
    let _ = LAUNCHED_WITH.set(token);
    if let Some(root) = appdir() {
        for (name, value) in gstreamer_of(
            std::path::Path::new(&root),
            std::path::Path::exists,
            cache(),
        ) {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
}

/// The folder the `AppImage` this program runs from is unpacked in, as its `AppRun` says:
/// only where this program is in it, so a variable left over from another image's
/// launch is not taken for this one.
fn appdir() -> Option<std::ffi::OsString> {
    let root = std::env::var_os("APPDIR")?;
    let exe = std::env::current_exe().ok()?;
    exe.starts_with(&root).then_some(root)
}

/// The variables `GStreamer` reads its plugins by, as an `AppImage` unpacked at `root` should
/// have them: the host's own lists gone, the image's plugins and scanner where it has
/// them, and a registry of its own under `cache`.
fn gstreamer_of(
    root: &std::path::Path,
    exists: impl Fn(&std::path::Path) -> bool,
    cache: Option<std::path::PathBuf>,
) -> Vec<(&'static str, Option<std::ffi::OsString>)> {
    let found = |paths: &[&str]| {
        paths
            .iter()
            .map(|one| root.join(one))
            .find(|one| exists(one))
            .map(std::path::PathBuf::into_os_string)
    };
    let plugins = found(&[
        "usr/lib/gstreamer-1.0",
        "usr/lib/x86_64-linux-gnu/gstreamer-1.0",
        "usr/lib/aarch64-linux-gnu/gstreamer-1.0",
    ]);
    let scanner = found(&[
        "usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner",
        "usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner",
        "usr/lib/aarch64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner",
        "usr/libexec/gstreamer-1.0/gst-plugin-scanner",
    ]);
    let mut said = vec![
        ("GST_PLUGIN_PATH", None),
        ("GST_PLUGIN_PATH_1_0", None),
        ("GST_PLUGIN_SYSTEM_PATH", None),
        ("GST_PLUGIN_SYSTEM_PATH_1_0", plugins),
    ];
    if scanner.is_some() {
        said.push(("GST_PLUGIN_SCANNER_1_0", scanner));
    }
    if let Some(cache) = cache {
        said.push((
            "GST_REGISTRY_1_0",
            Some(cache.join("gstreamer-1.0-registry.bin").into_os_string()),
        ));
    }
    said
}

/// The app's own cache folder, read off the environment before anything of Tauri's is up.
fn cache() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(std::path::PathBuf::from)
        .filter(|one| one.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| std::path::Path::new(&home).join(".cache"))
        })?;
    Some(base.join("ch.emilvinu.nib"))
}

/// Whether to turn DMA-BUF off: NVIDIA's driver, and nobody having set it either way.
fn dmabuf_off(nvidia: bool, already_said: bool) -> bool {
    nvidia && !already_said
}

/// The token this launch was started with, if the launcher gave one.
pub fn launched_with() -> Option<&'static str> {
    LAUNCHED_WITH.get().and_then(Option::as_deref)
}

/// Whether this is a Wayland session, whatever GTK was told to draw with: under one, no
/// app hears a key pressed in another, `XWayland`'s included.
pub fn wayland_session() -> bool {
    static SESSION: OnceLock<bool> = OnceLock::new();
    *SESSION.get_or_init(|| {
        session_is_wayland(
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        )
    })
}

fn session_is_wayland(display: Option<&str>, kind: Option<&str>) -> bool {
    display.is_some_and(|display| !display.is_empty()) || kind == Some("wayland")
}

/// Asks GTK which display it opened. On the event loop's thread, once, before any window
/// is placed: GTK may be asked nothing anywhere else.
pub fn learn() {
    let _ = DRAWN_ON_WAYLAND.get_or_init(gdk_on_wayland);
}

fn gdk_on_wayland() -> bool {
    use gtk::glib::object::ObjectExt as _;
    gtk::gdk::Display::default()
        .is_some_and(|display| display.type_().name() == "GdkWaylandDisplay")
}

/// Whether the app may put its windows anywhere: not on Wayland, where the compositor
/// places them.
pub fn places_windows() -> bool {
    !DRAWN_ON_WAYLAND.get().copied().unwrap_or(false)
}

/// A token for the next window to come forward: a second launch's, or a key's from any
/// app.
pub fn token_arrived(token: String) {
    *PENDING.lock().unwrap_or_else(PoisonError::into_inner) = Some((token, Instant::now()));
}

/// The token waiting, where it is still fresh, taken.
fn fresh_token() -> Option<String> {
    let (token, at) = PENDING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()?;
    (at.elapsed() < FRESH).then_some(token)
}

/// The token waiting for the window coming forward now, where there is a compositor to
/// show it to; `raised` in placement.rs hands it to GTK on the event loop's thread, then
/// brings the window forward.
pub fn token_for_raise() -> Option<String> {
    if places_windows() {
        return None;
    }
    fresh_token()
}

/// The token handed to GTK, which shows it to the compositor with the next window that
/// asks to come forward.
#[allow(
    unsafe_code,
    reason = "GTK 3's Wayland display has no safe binding for its startup token"
)]
pub fn hand_gtk(token: &str) {
    use gtk::glib::object::{ObjectExt as _, ObjectType as _};

    let Some(display) = gtk::gdk::Display::default() else {
        return;
    };
    if display.type_().name() != "GdkWaylandDisplay" {
        return;
    }
    let Ok(token) = std::ffi::CString::new(token) else {
        return;
    };
    // SAFETY: the display is GDK's Wayland display, checked just above and alive for the
    // call, and GDK copies the string before it returns.
    unsafe {
        gdk_wayland_sys::gdk_wayland_display_set_startup_notification_id(
            display.as_ptr().cast(),
            token.as_ptr(),
        );
    }
}

/// Whether to turn accelerated compositing off: GTK on Wayland - by the backend it was
/// told to use first, or by a Wayland display where it was told none - and nobody having
/// set it either way.
fn compositing_off(backend: Option<&str>, display: Option<&str>, already_said: bool) -> bool {
    if already_said {
        return false;
    }
    match backend {
        Some(backend) => backend
            .split(',')
            .next()
            .is_some_and(|first| first.trim().eq_ignore_ascii_case("wayland")),
        None => display.is_some_and(|display| !display.is_empty()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dmabuf_goes_off_on_nvidia_unless_somebody_said() {
        assert!(dmabuf_off(true, false));
        assert!(!dmabuf_off(true, true));
        assert!(!dmabuf_off(false, false));
    }

    #[test]
    fn compositing_goes_off_where_gtk_draws_on_wayland_unless_somebody_said() {
        assert!(compositing_off(None, Some("wayland-1"), false));
        assert!(compositing_off(Some("wayland,x11"), None, false));
        assert!(compositing_off(Some(" Wayland "), Some("wayland-1"), false));
        assert!(!compositing_off(Some("x11"), Some("wayland-1"), false));
        assert!(!compositing_off(None, Some(""), false));
        assert!(!compositing_off(None, None, false));
        assert!(!compositing_off(None, Some("wayland-1"), true));
    }

    #[test]
    fn a_session_is_wayland_by_its_display_or_its_type() {
        assert!(session_is_wayland(Some("wayland-0"), None));
        assert!(session_is_wayland(None, Some("wayland")));
        assert!(!session_is_wayland(Some(""), Some("x11")));
        assert!(!session_is_wayland(None, None));
    }

    #[test]
    fn an_appimage_s_gstreamer_reads_its_own_plugins_and_nothing_of_the_host_s() {
        let root = std::path::Path::new("/tmp/.mount_x");
        let bundled = |path: &std::path::Path| {
            path.ends_with("usr/lib/x86_64-linux-gnu/gstreamer-1.0")
                || path.ends_with("gstreamer1.0/gstreamer-1.0/gst-plugin-scanner")
        };
        let said = gstreamer_of(root, bundled, Some("/home/e/.cache/ch.emilvinu.nib".into()));
        let of = |name: &str| {
            said.iter()
                .find(|(one, _)| *one == name)
                .map(|(_, value)| value.clone())
        };
        assert_eq!(of("GST_PLUGIN_PATH"), Some(None));
        assert_eq!(of("GST_PLUGIN_SYSTEM_PATH"), Some(None));
        assert_eq!(
            of("GST_PLUGIN_SYSTEM_PATH_1_0"),
            Some(Some(
                root.join("usr/lib/x86_64-linux-gnu/gstreamer-1.0")
                    .into_os_string()
            ))
        );
        assert!(of("GST_PLUGIN_SCANNER_1_0").is_some_and(|one| one.is_some()));
        assert!(of("GST_REGISTRY_1_0").is_some());
        // An image with no plugins of its own: the host's lists gone, nothing put instead.
        let none = gstreamer_of(root, |_| false, None);
        assert_eq!(none.len(), 4);
        assert!(none.iter().all(|(_, value)| value.is_none()));
    }

    #[test]
    fn a_token_is_taken_once() {
        token_arrived("one".into());
        assert_eq!(fresh_token().as_deref(), Some("one"));
        assert_eq!(fresh_token(), None);
    }
}
