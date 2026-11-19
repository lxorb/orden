use std::path::PathBuf;
use tauri::utils::config::Color;
use tauri::{AppHandle, Manager};

use orden_base::paths::{config_dir, made, write_atomically};

const FILE: &str = "ground.txt";
const MOST: usize = 64;
static WORN: std::sync::Mutex<Option<Color>> = std::sync::Mutex::new(None);
pub fn worn() -> Option<Color> {
    WORN.lock().ok().and_then(|held| *held)
}
fn wear(ground: Option<Color>) -> Option<Color> {
    if let (Some(colour), Ok(mut held)) = (ground, WORN.lock()) {
        *held = Some(colour);
    }
    ground
}
fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}
#[tauri::command(async)]
pub fn remember_ground(
    app: AppHandle,
    colour: String,
    paint: Option<String>,
) -> Result<(), String> {
    let paint = paint.unwrap_or_default();
    if [&colour, &paint].iter().any(|one| one.len() > MOST || one.contains('\n')) {
        return Err("that is not a colour".into());
    }
    let path = file(&app)?;
    if let Some(parent) = path.parent() {
        made(parent)?;
    }
    write_atomically(&path, format!("{colour}\n{paint}").as_bytes())?;
    if let Some(ground) = wear(painted(&format!("{colour}\n{paint}"))) {
        for window in app.windows().into_values() {
            let _ = window.set_background_color(Some(ground));
        }
    }
    Ok(())
}
pub fn remembered(app: &AppHandle) -> Option<Color> {
    wear(painted(&std::fs::read_to_string(file(app).ok()?).ok()?))
}
fn painted(said: &str) -> Option<Color> {
    let mut lines = said.lines().map(str::trim);
    let ground = lines.next().unwrap_or_default();
    colour_of(ground).or_else(|| colour_of(lines.next().unwrap_or_default()))
}
fn colour_of(said: &str) -> Option<Color> {
    let inside =
        said.strip_prefix("rgba(").or_else(|| said.strip_prefix("rgb("))?.strip_suffix(')')?;
    let mut parts = inside.split(',').map(str::trim);
    let red = parts.next()?.parse::<u8>().ok()?;
    let green = parts.next()?.parse::<u8>().ok()?;
    let blue = parts.next()?.parse::<u8>().ok()?;
    match parts.next() {
        None => {}
        Some(alpha) if alpha.parse::<f32>().is_ok_and(|one| one >= 1.0) => {}
        Some(_) => return None,
    }
    if parts.next().is_some() {
        return None;
    }
    Some(Color(red, green, blue, 255))
}
#[cfg(test)]
mod tests {
    use super::{colour_of, painted};
    use tauri::utils::config::Color;

    #[test]
    fn a_resolved_colour_is_the_colour_it_says() {
        assert_eq!(colour_of("rgb(14, 16, 19)"), Some(Color(14, 16, 19, 255)));
        assert_eq!(colour_of("rgb(251,252,253)"), Some(Color(251, 252, 253, 255)));
        assert_eq!(colour_of("rgba(14, 16, 19, 1)"), Some(Color(14, 16, 19, 255)));
    }
    #[test]
    fn a_ground_somebody_can_see_through_is_no_ground_to_paint() {
        assert_eq!(colour_of("rgba(0, 0, 0, 0)"), None);
        assert_eq!(colour_of("rgba(14, 16, 19, 0.5)"), None);
        assert_eq!(colour_of("transparent"), None);
    }
    #[test]
    fn a_window_is_painted_its_ground_or_the_colour_beneath_a_ground_seen_through() {
        assert_eq!(painted("rgb(14, 16, 19)"), Some(Color(14, 16, 19, 255)));
        assert_eq!(painted("rgb(14, 16, 19)\nrgb(1, 2, 3)"), Some(Color(14, 16, 19, 255)));
        assert_eq!(painted("rgba(0, 0, 0, 0)\nrgb(35, 41, 50)"), Some(Color(35, 41, 50, 255)));
        assert_eq!(painted("rgba(0, 0, 0, 0)\n"), None);
        assert_eq!(painted(""), None);
    }
    #[test]
    fn nothing_that_is_not_a_colour_is_read_as_one() {
        for said in [
            "",
            "rgb(",
            "rgb(14, 16)",
            "rgb(14, 16, 19",
            "rgb(14, 16, 19, 1, 1)",
            "rgb(300, 16, 19)",
            "rgb(-1, 16, 19)",
            "#0e1013",
            "var(--bg)",
            "rgb(a, b, c)",
        ] {
            assert_eq!(colour_of(said), None, "{said}");
        }
    }
}
