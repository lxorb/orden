use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct About {
    pub name: String,
    #[serde(skip_serializing)]
    pub version: String,
    pub icon: Option<String>,
    pub popup: Option<String>,
    pub options: Option<String>,
    pub action: bool,
    pub permissions: Vec<String>,
}

pub fn read(folder: &Path) -> Result<About, String> {
    let text = fs::read_to_string(folder.join("manifest.json"))
        .map_err(|_| "that extension has no manifest".to_string())?;
    let manifest: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "that extension's manifest cannot be read".to_string())?;
    Ok(about(&manifest, |key| message(folder, &manifest, key)))
}

fn about(manifest: &Value, lookup: impl Fn(&str) -> Option<String>) -> About {
    let words = |field: &str| {
        let said = manifest
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or_default();
        said.strip_prefix("__MSG_")
            .and_then(|rest| rest.strip_suffix("__"))
            .and_then(&lookup)
            .unwrap_or_else(|| said.to_owned())
    };

    let action = manifest
        .get("action")
        .or_else(|| manifest.get("browser_action"))
        .or_else(|| manifest.get("page_action"));
    let popup = action
        .and_then(|one| one.get("default_popup"))
        .and_then(Value::as_str)
        .and_then(inside);
    let options = manifest
        .get("options_ui")
        .and_then(|one| one.get("page"))
        .or_else(|| manifest.get("options_page"))
        .and_then(Value::as_str)
        .and_then(inside);

    let mut permissions: Vec<String> = ["permissions", "host_permissions"]
        .iter()
        .filter_map(|field| manifest.get(field).and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let matched = manifest
        .get("content_scripts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|one| one.get("matches").and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned);
    permissions.extend(matched);
    let mut seen = std::collections::HashSet::new();
    permissions.retain(|one| seen.insert(one.clone()));

    let icon = largest(manifest.get("icons")).or_else(|| {
        action
            .and_then(|one| one.get("default_icon"))
            .and_then(|icon| match icon {
                Value::String(path) => inside(path),
                other => largest(Some(other)),
            })
    });

    About {
        name: words("name"),
        version: manifest
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        icon,
        popup,
        options,
        action: action.is_some(),
        permissions,
    }
}

fn largest(icons: Option<&Value>) -> Option<String> {
    icons?
        .as_object()?
        .iter()
        .filter_map(|(size, path)| Some((size.parse::<u32>().ok()?, path.as_str()?)))
        .max_by_key(|(size, _)| *size)
        .and_then(|(_, path)| inside(path))
}

fn inside(path: &str) -> Option<String> {
    let path = path.trim_start_matches('/');
    let page = path.split(['?', '#']).next().unwrap_or_default();
    let fine = !page.is_empty()
        && !page.contains(':')
        && !page.contains('\\')
        && page.split('/').all(|part| !part.is_empty() && part != "..");
    fine.then(|| path.to_owned())
}

fn message(folder: &Path, manifest: &Value, key: &str) -> Option<String> {
    let language = manifest.get("default_locale").and_then(Value::as_str)?;
    if language.contains(['/', '\\', '.']) {
        return None;
    }
    let text =
        fs::read_to_string(folder.join("_locales").join(language).join("messages.json")).ok()?;
    let messages: Map<String, Value> =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    messages
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .and_then(|(_, entry)| entry.get("message"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{about, inside};

    #[test]
    fn a_manifest_v3_extension_says_its_button_options_and_permissions() {
        let manifest = json!({
            "name": "__MSG_extName__",
            "version": "2025.1.1",
            "icons": { "16": "img/16.png", "128": "img/128.png", "48": "img/48.png" },
            "action": { "default_popup": "popup.html" },
            "options_ui": { "page": "options.html#general" },
            "permissions": ["storage", "tabs"],
            "host_permissions": ["<all_urls>"],
            "content_scripts": [{ "matches": ["<all_urls>", "https://*.example.com/*"] }]
        });
        let said = about(&manifest, |key| {
            (key == "extName").then(|| "uBlock".to_owned())
        });
        assert_eq!(said.name, "uBlock");
        assert_eq!(said.version, "2025.1.1");
        assert_eq!(said.icon.as_deref(), Some("img/128.png"));
        assert_eq!(said.popup.as_deref(), Some("popup.html"));
        assert_eq!(said.options.as_deref(), Some("options.html#general"));
        assert!(said.action);
        assert_eq!(
            said.permissions,
            ["storage", "tabs", "<all_urls>", "https://*.example.com/*"]
        );
    }

    #[test]
    fn a_manifest_v2_button_and_a_plain_name_are_read_too() {
        let manifest = json!({
            "name": "Vimium",
            "version": "2.1",
            "browser_action": { "default_icon": "icon.png" },
            "options_page": "/pages/options.html"
        });
        let said = about(&manifest, |_| None);
        assert_eq!(said.name, "Vimium");
        assert_eq!(said.icon.as_deref(), Some("icon.png"));
        assert_eq!(said.popup, None);
        assert_eq!(said.options.as_deref(), Some("pages/options.html"));
        assert!(said.action);
    }

    #[test]
    fn a_page_outside_the_extension_is_nobody_s() {
        for bad in [
            "../x.html",
            "https://evil.example/",
            "a/../../b.html",
            "a\\b.html",
            "",
        ] {
            assert_eq!(inside(bad), None, "{bad}");
        }
    }
}
