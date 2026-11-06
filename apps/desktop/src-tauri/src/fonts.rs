use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Family {
    name: String,
    mono: bool,
}

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
