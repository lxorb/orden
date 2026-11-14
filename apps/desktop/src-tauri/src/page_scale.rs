pub const SWITCH: (&str, &str) = ("--force-device-scale-factor", "1");

pub const SCRIPT: &str = include_str!("page_scale.js");

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn scale_of_dpi(xft_dpi: i32) -> Option<f64> {
    (xft_dpi > 0).then(|| (f64::from(xft_dpi) / 1024.0 / 96.0).clamp(0.5, 4.0))
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn xsettings_int(data: &[u8], wanted: &str) -> Option<i32> {
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

const RUNGS: [f64; 8] = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

fn zoom_of(factor: f64) -> Option<f64> {
    (factor.is_finite() && factor > 0.0).then(|| {
        RUNGS
            .into_iter()
            .min_by(|a, b| (a - factor).abs().total_cmp(&(b - factor).abs()))
            .unwrap_or(1.0)
    })
}

#[tauri::command(async)]
pub fn interface_zoom_chosen() -> f64 {
    {
        engine::in_force()
    }
}

#[tauri::command(async)]
pub fn interface_zoom_choose(
    app: tauri::AppHandle<crate::Engine>,
    factor: f64,
) -> Result<(), String> {
    {
        engine::choose(&app, factor)
    }
}

pub fn read_chosen(app: &tauri::AppHandle<crate::Engine>) {
    engine::read_chosen(app);
}

mod engine {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex, OnceLock, PoisonError};

    const FILE: &str = "interface-zoom";

    static CHOSEN: Mutex<f64> = Mutex::new(1.0);

    pub fn in_force() -> f64 {
        *CHOSEN.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn read_chosen(app: &tauri::AppHandle<crate::Engine>) {
        let kept = crate::paths::config_dir(app)
            .ok()
            .and_then(|config| std::fs::read_to_string(config.join(FILE)).ok())
            .and_then(|text| text.trim().parse().ok())
            .and_then(super::zoom_of);
        if let Some(zoom) = kept {
            *CHOSEN.lock().unwrap_or_else(PoisonError::into_inner) = zoom;
        }
    }

    pub fn choose(app: &tauri::AppHandle<crate::Engine>, factor: f64) -> Result<(), String> {
        use tauri::Manager as _;

        let zoom = super::zoom_of(factor).ok_or("that is not a zoom")?;
        let config = crate::paths::config_dir(app)?;
        crate::paths::made(&config)?;
        crate::paths::write_atomically(&config.join(FILE), zoom.to_string().as_bytes())?;
        *CHOSEN.lock().unwrap_or_else(PoisonError::into_inner) = zoom;

        for window in crate::launch::document_windows(app) {
            zooming(window.label());
            if let Some(view) = app.get_webview(window.label()) {
                let _ = view.set_zoom(zoom * desktop());
            }
        }
        Ok(())
    }

    static READ: OnceLock<f64> = OnceLock::new();

    pub fn desktop() -> f64 {
        READ.get().copied().unwrap_or(1.0)
    }

    pub fn start() -> f64 {
        *READ.get_or_init(|| read().unwrap_or(1.0))
    }

    fn read() -> Option<f64> {
        crate::host::system().desktop_scale()
    }

    static SAID: LazyLock<Mutex<HashMap<String, f64>>> = LazyLock::new(Mutex::default);

    pub fn heard(webview: &tauri::Webview<crate::Engine>, ratio: f64) {
        let window = webview.window().label().to_owned();
        SAID.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(window, ratio);
        let scale = desktop() * in_force();
        if (ratio - scale).abs() > 0.01 {
            let _ = webview.set_zoom(scale);
        }
    }

    pub fn zooming(window: &str) {
        SAID.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(window.to_owned(), desktop() * in_force());
    }

    pub fn of(window: &tauri::Window<crate::Engine>) -> f64 {
        SAID.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(window.label())
            .copied()
            .unwrap_or_else(|| desktop() * in_force())
    }
}

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

#[tauri::command(async)]
pub fn page_scale_seen(webview: tauri::Webview<crate::Engine>, ratio: f64) {
    if !ratio.is_finite() || ratio <= 0.0 {
        return;
    }
    engine::heard(&webview, ratio);
}

#[allow(
    clippy::unnecessary_wraps,
    reason = "the window's scale, elsewhere, can fail"
)]
pub fn of(window: &tauri::Window<crate::Engine>) -> tauri::Result<f64> {
    {
        Ok(engine::of(window))
    }
}

pub fn web(factor: f64) -> f64 {
    {
        factor * engine::desktop()
    }
}

#[cfg(test)]
mod tests {
    use super::{scale_of_dpi, xsettings_int, zoom_of, RUNGS, SCRIPT};

    #[test]
    fn a_zoom_is_the_nearest_rung() {
        assert_eq!(zoom_of(1.25), Some(1.25));
        assert_eq!(zoom_of(1.3), Some(1.25));
        assert_eq!(zoom_of(1.4), Some(1.5));
        assert_eq!(zoom_of(9.0), Some(2.0));
        assert_eq!(zoom_of(0.1), Some(0.8));
        assert_eq!(zoom_of(0.0), None);
        assert_eq!(zoom_of(f64::NAN), None);
    }

    #[test]
    fn the_rungs_are_the_ones_settings_offers() {
        let modes = include_str!("../../src/lib/modes.svelte.ts");
        let listed = RUNGS.map(|one| one.to_string()).join(", ");
        assert!(
            modes.contains(&format!("INTERFACE_ZOOMS = [{listed}]")),
            "{listed}"
        );
    }

    fn settings(dpi: i32) -> Vec<u8> {
        let mut data = vec![b'l', 0, 0, 0];
        data.extend(7_u32.to_le_bytes());
        data.extend(3_u32.to_le_bytes());
        data.extend([1, 0]);
        data.extend(13_u16.to_le_bytes());
        data.extend(b"Net/ThemeName\0\0\0");
        data.extend(0_u32.to_le_bytes());
        data.extend(7_u32.to_le_bytes());
        data.extend(b"Adwaita\0");
        data.extend([0, 0]);
        data.extend(7_u16.to_le_bytes());
        data.extend(b"Xft/DPI\0");
        data.extend(0_u32.to_le_bytes());
        data.extend(dpi.to_le_bytes());
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
