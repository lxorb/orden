//! How large the app's pages are drawn on Linux, and where a web tab's page goes.
//!
//! On a desktop scaled for X11 applications - KDE at 133 per cent, GNOME at 200 - a web
//! tab's page was drawn over the sidebar and the address bar, a quarter of the way short
//! of its hole, and the app's own page was drawn too large and cut off at the right and
//! the bottom (#427). Chromium takes its scale from the desktop's settings (`Xft/DPI` in
//! XSETTINGS), and CEF's windowed mode on X11 then reads the size it is given as that
//! many of its own units and multiplies: a window 1180 pixels wide held a page 1568
//! pixels wide. GTK, which sizes every window, kept its own scale, 1, so the app placed
//! each page by GTK's scale while Chromium measured by its own.
//!
//! So Chromium is told the scale is 1 (`SWITCH`), which is the one it sizes windows by
//! correctly, and the desktop's scale is given back as the app page's zoom (`desktop`),
//! which Chromium lays out by without touching a window's size - the app as large as
//! the rest of the desktop - and as every web tab's zoom, multiplied into the one the
//! reader chose (`web`). A page is placed by what the app's page says its own pixel
//! ratio is (`of`), its zoom included, which is the ratio between what it measures and
//! the screen's pixels it is drawn in; GTK's scale is not that ratio here.

/// Chromium's scale, which CEF on X11 sizes windows by correctly only at 1; see the top
/// of this file.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SWITCH: (&str, &str) = ("--force-device-scale-factor", "1");

/// What the app's own page runs to say its pixel ratio: once as it starts, and again
/// whenever it changes.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SCRIPT: &str = include_str!("page_scale.js");

/// The desktop's scale from `Xft/DPI` in XSETTINGS, in hundredths of a dot per inch: 96
/// dots an inch is 1, and a scale is kept between a half and four.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
fn scale_of_dpi(xft_dpi: i32) -> Option<f64> {
    (xft_dpi > 0).then(|| (f64::from(xft_dpi) / 1024.0 / 96.0).clamp(0.5, 4.0))
}

/// The desktop's settings for X11 applications, as XSETTINGS has them: the value of
/// `wanted` among the integers in `data`, the `_XSETTINGS_SETTINGS` property.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
fn xsettings_int(data: &[u8], wanted: &str) -> Option<i32> {
    let big = *data.first()? == b'B';
    let word = |at: usize| -> Option<u32> {
        let bytes: [u8; 4] = data.get(at..at + 4)?.try_into().ok()?;
        Some(if big {
            u32::from_be_bytes(bytes)
        } else {
            u32::from_le_bytes(bytes)
        })
    };
    let half = |at: usize| -> Option<u16> {
        let bytes: [u8; 2] = data.get(at..at + 2)?.try_into().ok()?;
        Some(if big {
            u16::from_be_bytes(bytes)
        } else {
            u16::from_le_bytes(bytes)
        })
    };
    let padded = |length: usize| length.div_ceil(4) * 4;
    let count = word(8)?;
    let mut at = 12;
    for _ in 0..count {
        let kind = *data.get(at)?;
        let name_length = usize::from(half(at + 2)?);
        let name = data.get(at + 4..at + 4 + name_length)?;
        at += 4 + padded(name_length) + 4;
        match kind {
            0 => {
                let value = word(at)?;
                if name == wanted.as_bytes() {
                    return Some(i32::from_ne_bytes(value.to_ne_bytes()));
                }
                at += 4;
            }
            1 => at += 4 + padded(usize::try_from(word(at)?).ok()?),
            2 => at += 8,
            _ => return None,
        }
    }
    None
}

#[cfg(feature = "cef")]
mod engine {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex, OnceLock, PoisonError};

    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};

    /// The desktop's scale, read from XSETTINGS as the app starts (`start`); 1 before
    /// that, and where there is no X server or no settings daemon, which is the scale
    /// Chromium itself would have taken there.
    static READ: OnceLock<f64> = OnceLock::new();

    pub fn desktop() -> f64 {
        READ.get().copied().unwrap_or(1.0)
    }

    pub fn start() -> f64 {
        *READ.get_or_init(|| read().unwrap_or(1.0))
    }

    fn read() -> Option<f64> {
        let (x, screen) = x11rb::connect(None).ok()?;
        let atom = |name: &str| {
            x.intern_atom(false, name.as_bytes())
                .ok()?
                .reply()
                .ok()
                .map(|reply| reply.atom)
        };
        let owner = x
            .get_selection_owner(atom(&format!("_XSETTINGS_S{screen}"))?)
            .ok()?
            .reply()
            .ok()?
            .owner;
        if owner == x11rb::NONE {
            return None;
        }
        let settings = atom("_XSETTINGS_SETTINGS")?;
        let data = x
            .get_property(false, owner, settings, AtomEnum::ANY, 0, u32::MAX / 4)
            .ok()?
            .reply()
            .ok()?
            .value;
        super::scale_of_dpi(super::xsettings_int(&data, "Xft/DPI")?)
    }

    /// Each window's page's pixel ratio as it last said it, by the window's label.
    static SAID: LazyLock<Mutex<HashMap<String, f64>>> = LazyLock::new(Mutex::default);

    /// A page whose ratio is not the desktop's scale is zoomed to it, each time it says
    /// so: the engine keeps a zoom by the page's origin, and the window's page starts
    /// on an inert page of the runtime's own, whose zoom is not the app's.
    pub fn heard(webview: &tauri::Webview<crate::Engine>, ratio: f64) {
        let window = webview.window().label().to_owned();
        SAID.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(window, ratio);
        let scale = desktop();
        if (ratio - scale).abs() > 0.01 {
            let _ = webview.set_zoom(scale);
        }
    }

    pub fn of(window: &tauri::Window<crate::Engine>) -> f64 {
        SAID.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(window.label())
            .copied()
            .unwrap_or_else(desktop)
    }
}

/// Reads the desktop's scale, once, as the app starts and before its window is made, and
/// says it in the log. See the top of this file.
#[cfg(feature = "cef")]
pub fn start(app: &tauri::AppHandle<crate::Engine>) {
    let scale = engine::start();
    crate::logs::say(
        app,
        "info",
        &format!(
            "scale: the desktop's is {scale:.3}; Chromium's is 1, and the pages are zoomed to it"
        ),
    );
}

/// What the app's page says its pixel ratio is, as it starts and whenever it changes:
/// kept for placing the window's web pages (`of`), and the first time, the page given
/// the desktop's scale as its zoom where it has not got it yet. See the top of this file.
#[tauri::command(async)]
#[cfg_attr(
    not(feature = "cef"),
    allow(
        clippy::needless_pass_by_value,
        reason = "a command's arguments are its own"
    )
)]
pub fn page_scale_seen(webview: tauri::Webview<crate::Engine>, ratio: f64) {
    if !ratio.is_finite() || ratio <= 0.0 {
        return;
    }
    #[cfg(feature = "cef")]
    engine::heard(&webview, ratio);
    #[cfg(not(feature = "cef"))]
    let _ = (webview, ratio);
}

/// The ratio between what a window's own page measures and the screen's pixels it is
/// drawn in: where its web pages go is what it measured times this. Its page's own word
/// on CEF on Linux, else the window's scale.
#[cfg_attr(
    feature = "cef",
    allow(
        clippy::unnecessary_wraps,
        reason = "the window's scale, elsewhere, can fail"
    )
)]
pub fn of(window: &tauri::Window<crate::Engine>) -> tauri::Result<f64> {
    #[cfg(feature = "cef")]
    {
        Ok(engine::of(window))
    }
    #[cfg(not(feature = "cef"))]
    {
        window.scale_factor()
    }
}

/// The zoom a web tab's page is given for the reader's `factor`: the desktop's scale
/// times it on CEF on Linux (see the top of this file), else the factor itself.
pub fn web(factor: f64) -> f64 {
    #[cfg(feature = "cef")]
    {
        factor * engine::desktop()
    }
    #[cfg(not(feature = "cef"))]
    {
        factor
    }
}

#[cfg(test)]
mod tests {
    use super::{scale_of_dpi, xsettings_int, SCRIPT};

    /// XSETTINGS as a daemon writes it: little-endian, a string, an integer and a colour.
    fn settings(dpi: i32) -> Vec<u8> {
        let mut data = vec![b'l', 0, 0, 0];
        data.extend(7_u32.to_le_bytes());
        data.extend(3_u32.to_le_bytes());
        // A string: Net/ThemeName = "Adwaita".
        data.extend([1, 0]);
        data.extend(13_u16.to_le_bytes());
        data.extend(b"Net/ThemeName\0\0\0");
        data.extend(0_u32.to_le_bytes());
        data.extend(7_u32.to_le_bytes());
        data.extend(b"Adwaita\0");
        // An integer: Xft/DPI.
        data.extend([0, 0]);
        data.extend(7_u16.to_le_bytes());
        data.extend(b"Xft/DPI\0");
        data.extend(0_u32.to_le_bytes());
        data.extend(dpi.to_le_bytes());
        // A colour.
        data.extend([2, 0]);
        data.extend(4_u16.to_le_bytes());
        data.extend(b"Tint");
        data.extend(0_u32.to_le_bytes());
        data.extend([0; 8]);
        data
    }

    #[test]
    fn the_desktop_s_scale_is_read_from_its_dpi() {
        let data = settings(131_072);
        assert_eq!(xsettings_int(&data, "Xft/DPI"), Some(131_072));
        assert_eq!(xsettings_int(&data, "Xft/Antialias"), None);
        let scale = scale_of_dpi(131_072).unwrap_or_default();
        assert!((scale - 4.0 / 3.0).abs() < 1e-9, "{scale}");
        assert_eq!(scale_of_dpi(96 * 1024), Some(1.0));
        assert_eq!(scale_of_dpi(-1), None);
        assert_eq!(xsettings_int(&data[..20], "Xft/DPI"), None);
    }

    #[test]
    fn the_script_says_the_ratio_by_the_command_s_name() {
        assert!(SCRIPT.contains("'page_scale_seen'"));
        assert!(SCRIPT.contains("devicePixelRatio"));
    }
}
