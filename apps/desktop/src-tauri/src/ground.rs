use std::path::PathBuf;
use tauri::utils::config::Color;
use tauri::AppHandle;

use crate::paths::{config_dir, made, write_atomically};

const FILE: &str = "ground.txt";

const MOST: usize = 64;

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}

#[tauri::command(async)]
pub fn remember_ground(app: AppHandle, colour: String) -> Result<(), String> {
    if colour.len() > MOST {
        return Err("that is not a colour".into());
    }

    let path = file(&app)?;
    if let Some(parent) = path.parent() {
        made(parent)?;
    }

    write_atomically(&path, colour.as_bytes())
}

pub fn remembered(app: &AppHandle) -> Option<Color> {
    let said = std::fs::read_to_string(file(app).ok()?).ok()?;
    colour_of(said.trim())
}

pub fn see_through(app: &AppHandle) -> bool {
    file(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .is_some_and(|said| clear(said.trim()))
}

const MATERIAL: &str = "material.txt";

const KINDS: [&str; 4] = ["mica-alt", "mica", "acrylic", "clear"];

#[tauri::command(async)]
pub fn remember_material(app: AppHandle, kind: String) -> Result<(), String> {
    if !KINDS.contains(&kind.as_str()) {
        return Err("that is not a material".into());
    }

    let path = config_dir(&app)?.join(MATERIAL);
    if let Some(parent) = path.parent() {
        made(parent)?;
    }

    write_atomically(&path, kind.as_bytes())
}

pub fn material(app: &AppHandle) -> Option<String> {
    let said = std::fs::read_to_string(config_dir(app).ok()?.join(MATERIAL)).ok()?;
    kind_of(said.trim())
}

fn kind_of(said: &str) -> Option<String> {
    KINDS.contains(&said).then(|| said.to_string())
}

fn clear(said: &str) -> bool {
    said.strip_prefix("rgba(")
        .and_then(|inside| inside.strip_suffix(')'))
        .and_then(|inside| inside.rsplit(',').next())
        .is_some_and(|alpha| alpha.trim().parse::<f32>().is_ok_and(|one| one <= 0.0))
}

fn colour_of(said: &str) -> Option<Color> {
    let inside = said
        .strip_prefix("rgba(")
        .or_else(|| said.strip_prefix("rgb("))?
        .strip_suffix(')')?;

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
    use super::{clear, colour_of, kind_of};
    use tauri::utils::config::Color;

    #[test]
    fn a_resolved_colour_is_the_colour_it_says() {
        assert_eq!(colour_of("rgb(14, 16, 19)"), Some(Color(14, 16, 19, 255)));
        assert_eq!(
            colour_of("rgb(251,252,253)"),
            Some(Color(251, 252, 253, 255))
        );
        assert_eq!(
            colour_of("rgba(14, 16, 19, 1)"),
            Some(Color(14, 16, 19, 255))
        );
    }

    #[test]
    fn a_ground_somebody_can_see_through_is_no_ground_to_paint() {
        assert_eq!(colour_of("rgba(0, 0, 0, 0)"), None);
        assert_eq!(colour_of("rgba(14, 16, 19, 0.5)"), None);
        assert_eq!(colour_of("transparent"), None);
    }

    #[test]
    fn only_a_ground_with_nothing_in_it_asks_for_the_material() {
        assert!(clear("rgba(0, 0, 0, 0)"));
        assert!(clear("rgba(14, 16, 19, 0)"));
        for said in [
            "rgb(14, 16, 19)",
            "rgba(14, 16, 19, 1)",
            "rgba(0, 0, 0, 0.5)",
            "",
            "transparent",
        ] {
            assert!(!clear(said), "{said}");
        }
    }

    #[test]
    fn only_a_material_glass_offers_is_read() {
        for said in ["mica-alt", "mica", "acrylic", "clear"] {
            assert_eq!(kind_of(said).as_deref(), Some(said));
        }
        for said in ["", "Mica", "blur", "mica-alt ", "../x"] {
            assert_eq!(kind_of(said), None, "{said}");
        }
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
