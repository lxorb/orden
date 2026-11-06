use tauri::{AppHandle, Manager, Window};

pub(crate) const PRESENTER: &str = "nib-presenter";

fn ours(app: &AppHandle) -> Vec<Window> {
    app.windows()
        .into_values()
        .filter(|window| window.label() != PRESENTER)
        .collect()
}

pub fn own_frame<R: tauri::Runtime, M: Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'_, R, M>,
) -> tauri::WebviewWindowBuilder<'_, R, M> {
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    builder
}

#[tauri::command]
pub fn set_frame(app: AppHandle, system: bool) -> Result<(), String> {
    for window in ours(&app) {
        #[cfg(target_os = "macos")]
        let changed = window.set_title_bar_style(if system {
            tauri::TitleBarStyle::Visible
        } else {
            tauri::TitleBarStyle::Overlay
        });

        #[cfg(not(target_os = "macos"))]
        let changed = window.set_decorations(system);

        changed.map_err(|error| format!("the frame could not be changed: {error}"))?;

        #[cfg(not(target_os = "macos"))]
        crate::top_edge::mind(&window);

        #[cfg(target_os = "macos")]
        {
            crate::lights::refresh(&window);

            if let Some(page) = app.get_webview(window.label()) {
                crate::placement::keyboard_to(&page);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_translucency(
    window: Window,
    on: bool,
    dark: bool,
    kind: Option<String>,
) -> Result<&'static str, String> {
    if window.label() == PRESENTER {
        return Err("the presenter's window keeps the system's own".to_string());
    }

    if !on {
        material::clear(&window);
        return Ok("");
    }

    without_colour(&window);
    material::apply(&window, Some(dark), Kind::of(kind.as_deref()))
}

pub fn wear_from_the_start(window: &Window) {
    without_colour(window);
    let kind = crate::ground::material(window.app_handle());
    let _ = material::apply(window, None, Kind::of(kind.as_deref()));
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    MicaAlt,
    Mica,
    Acrylic,
    Clear,
}

impl Kind {
    pub fn of(said: Option<&str>) -> Self {
        match said {
            Some("mica") => Self::Mica,
            Some("acrylic") => Self::Acrylic,
            Some("clear") => Self::Clear,
            _ => Self::MicaAlt,
        }
    }
}

fn without_colour(window: &Window) {
    let _ = window.set_background_color(None);
    if let Some(view) = window.app_handle().get_webview_window(window.label()) {
        let _ = view.set_background_color(None);
    }
}

#[cfg(target_os = "windows")]
mod material {
    use super::Kind;
    use tauri::Window;
    use window_vibrancy::{
        apply_acrylic, apply_mica, apply_tabbed, clear_acrylic, clear_mica, clear_tabbed,
    };

    pub fn apply(window: &Window, dark: Option<bool>, kind: Kind) -> Result<&'static str, String> {
        clear(window);

        if kind == Kind::Clear {
            return Ok("clear");
        }

        if kind == Kind::MicaAlt && apply_tabbed(window, dark).is_ok() {
            return Ok("mica");
        }
        if kind != Kind::Acrylic && apply_mica(window, dark).is_ok() {
            return Ok("mica");
        }

        apply_acrylic(window, None)
            .map(|()| "acrylic")
            .map_err(|error| format!("this window cannot be made translucent: {error}"))
    }

    pub fn clear(window: &Window) {
        let _ = clear_tabbed(window);
        let _ = clear_mica(window);
        let _ = clear_acrylic(window);
    }
}

#[cfg(target_os = "macos")]
mod material {
    use super::Kind;
    use tauri::Window;
    use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

    pub fn apply(
        window: &Window,
        _dark: Option<bool>,
        _kind: Kind,
    ) -> Result<&'static str, String> {
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        )
        .map(|()| "vibrancy")
        .map_err(|error| format!("this window cannot be made translucent: {error}"))
    }

    pub fn clear(window: &Window) {
        let _ = clear_vibrancy(window);
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod material {
    use super::Kind;
    use tauri::utils::config::Color;
    use tauri::{Manager, Window};

    pub fn apply(window: &Window, _dark: Option<bool>, kind: Kind) -> Result<&'static str, String> {
        if kind == Kind::Clear {
            if let Some(view) = window.app_handle().get_webview_window(window.label()) {
                let _ = view.set_background_color(Some(Color(0, 0, 0, 0)));
            }
            return Ok("clear");
        }

        Err("this platform has no translucency to turn on".to_string())
    }

    pub fn clear(_window: &Window) {}
}

#[cfg(test)]
mod tests {
    use super::Kind;

    #[test]
    fn a_material_is_what_the_row_says_and_mica_alt_otherwise() {
        assert_eq!(Kind::of(Some("mica-alt")), Kind::MicaAlt);
        assert_eq!(Kind::of(Some("mica")), Kind::Mica);
        assert_eq!(Kind::of(Some("acrylic")), Kind::Acrylic);
        assert_eq!(Kind::of(Some("clear")), Kind::Clear);
        assert_eq!(Kind::of(None), Kind::MicaAlt);
        assert_eq!(Kind::of(Some("blur")), Kind::MicaAlt);
    }
}
