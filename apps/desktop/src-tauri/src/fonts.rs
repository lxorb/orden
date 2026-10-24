//! The font families installed on this machine, for Settings' font pickers (#772).
//!
//! A reader on a NixOS laptop asked for a font of their own, and a field that takes a
//! family by its name only is a field that has to be typed into from memory, letter for
//! letter. So the pickers list what is installed, and a face for code lists the
//! monospaced families first. Read on demand - when a picker opens - and off the window's
//! own thread, because reading every font file's name table on a machine with a few
//! thousand of them takes a moment.

use std::collections::BTreeMap;

use serde::Serialize;

/// One family, as a stylesheet names it.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Family {
    name: String,
    /// Whether every face of it that says so is fixed-pitch, which is what a code font
    /// has to be.
    mono: bool,
}

/// Every family installed, by name, once each; the monospaced ones say so.
#[tauri::command]
pub async fn font_families() -> Vec<Family> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        families(db.faces().map(|face| {
            let name = face
                .families
                .first()
                .map(|(name, _)| name.clone())
                .unwrap_or_default();
            (name, face.monospaced)
        }))
    })
    .await
    .unwrap_or_default()
}

/// The faces' families folded into one row each, in the order a list is read: a name
/// with nothing in it, or one that starts with a dot - a platform's own hidden faces,
/// such as the Mac's `.SF NS` - is no family anybody chooses. A family is monospaced
/// when any of its faces is, since a family's italic often leaves the flag unset.
fn families(faces: impl Iterator<Item = (String, bool)>) -> Vec<Family> {
    let mut found: BTreeMap<String, (String, bool)> = BTreeMap::new();
    for (name, mono) in faces {
        let name = name.trim().to_owned();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let entry = found.entry(name.to_lowercase()).or_insert((name, false));
        entry.1 |= mono;
    }
    found
        .into_values()
        .map(|(name, mono)| Family { name, mono })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{families, Family};

    fn family(name: &str, mono: bool) -> Family {
        Family {
            name: name.to_owned(),
            mono,
        }
    }

    #[test]
    fn each_family_is_one_row_however_many_faces_it_has() {
        let faces = [
            ("Noto Sans", false),
            ("Noto Sans", false),
            ("noto sans", false),
            ("DejaVu Sans Mono", false),
            ("DejaVu Sans Mono", true),
        ];
        assert_eq!(
            families(
                faces
                    .into_iter()
                    .map(|(name, mono)| (name.to_owned(), mono))
            ),
            vec![family("DejaVu Sans Mono", true), family("Noto Sans", false)]
        );
    }

    #[test]
    fn a_platform_s_hidden_faces_and_nameless_ones_are_not_offered() {
        let faces = [
            (".SF NS", false),
            ("", true),
            ("  ", false),
            ("Inter", false),
        ];
        assert_eq!(
            families(
                faces
                    .into_iter()
                    .map(|(name, mono)| (name.to_owned(), mono))
            ),
            vec![family("Inter", false)]
        );
    }
}
