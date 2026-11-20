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
pub const OLD: &str = "It uses an old format this browser no longer runs";
pub fn fault(folder: &Path) -> Option<String> {
    let Ok(text) = fs::read_to_string(folder.join("manifest.json")) else {
        return Some("Its files are missing".to_owned());
    };
    let Ok(manifest) = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) else {
        return Some("Its description of itself cannot be read".to_owned());
    };
    if manifest.get("manifest_version").and_then(Value::as_u64).is_none_or(|version| version < 3) {
        return Some(OLD.to_owned());
    }
    let locales = folder.join("_locales");
    match manifest.get("default_locale").and_then(Value::as_str) {
        Some(language) if !locales.join(language).join("messages.json").is_file() => {
            return Some(format!("Its files are incomplete: _locales/{language} is missing"));
        }
        None if locales.is_dir() => {
            return Some("Its files are incomplete: it names no default language".to_owned());
        }
        _ => {}
    }
    needed(&manifest)
        .into_iter()
        .find(|path| !folder.join(path).is_file())
        .map(|path| format!("Its files are incomplete: {path} is missing"))
}
fn needed(manifest: &Value) -> Vec<String> {
    let listed = |value: Option<&Value>| -> Vec<String> {
        value
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(inside)
            .collect()
    };
    let mut needed: Vec<String> = manifest
        .pointer("/background/service_worker")
        .and_then(Value::as_str)
        .and_then(inside)
        .into_iter()
        .collect();
    for script in manifest.get("content_scripts").and_then(Value::as_array).into_iter().flatten() {
        needed.extend(listed(script.get("js")));
        needed.extend(listed(script.get("css")));
    }
    if let Some(icons) = manifest.get("icons").and_then(Value::as_object) {
        needed.extend(icons.values().filter_map(Value::as_str).filter_map(inside));
    }
    needed
}
pub fn keyed(folder: &Path, key: &[u8]) -> Result<(), String> {
    use base64::Engine as _;

    let path = folder.join("manifest.json");
    let text =
        fs::read_to_string(&path).map_err(|_| "that extension has no manifest".to_string())?;
    let mut manifest: Map<String, Value> =
        serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| "that extension's manifest cannot be read".to_string())?;
    manifest
        .insert("key".into(), Value::String(base64::engine::general_purpose::STANDARD.encode(key)));
    let written = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(&path, written).map_err(|error| error.to_string())
}
fn about(manifest: &Value, lookup: impl Fn(&str) -> Option<String>) -> About {
    let words = |field: &str| {
        let said = manifest.get(field).and_then(Value::as_str).unwrap_or_default();
        said.strip_prefix("__MSG_")
            .and_then(|rest| rest.strip_suffix("__"))
            .and_then(&lookup)
            .unwrap_or_else(|| said.to_owned())
    };
    let action = manifest
        .get("action")
        .or_else(|| manifest.get("browser_action"))
        .or_else(|| manifest.get("page_action"));
    let popup =
        action.and_then(|one| one.get("default_popup")).and_then(Value::as_str).and_then(inside);
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
        action.and_then(|one| one.get("default_icon")).and_then(|icon| match icon {
            Value::String(path) => inside(path),
            other => largest(Some(other)),
        })
    });
    About {
        name: words("name"),
        version: manifest.get("version").and_then(Value::as_str).unwrap_or_default().to_owned(),
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

    use super::{about, fault, inside, OLD};

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
        let said = about(&manifest, |key| (key == "extName").then(|| "uBlock".to_owned()));
        assert_eq!(said.name, "uBlock");
        assert_eq!(said.version, "2025.1.1");
        assert_eq!(said.icon.as_deref(), Some("img/128.png"));
        assert_eq!(said.popup.as_deref(), Some("popup.html"));
        assert_eq!(said.options.as_deref(), Some("options.html#general"));
        assert!(said.action);
        assert_eq!(said.permissions, ["storage", "tabs", "<all_urls>", "https://*.example.com/*"]);
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
        for bad in ["../x.html", "https://evil.example/", "a/../../b.html", "a\\b.html", ""] {
            assert_eq!(inside(bad), None, "{bad}");
        }
    }
    #[test]
    fn what_chromium_would_refuse_to_load_is_named_before_it_is_handed_over() {
        let folder = tempfile::tempdir().expect("a folder");
        let at = folder.path();
        let said = |manifest: serde_json::Value| {
            std::fs::write(at.join("manifest.json"), manifest.to_string()).expect("a manifest");
            fault(at)
        };
        assert_eq!(fault(at).as_deref(), Some("Its files are missing"));
        std::fs::write(at.join("manifest.json"), "not json").expect("a manifest");
        assert_eq!(fault(at).as_deref(), Some("Its description of itself cannot be read"));
        for old in [json!({ "manifest_version": 2 }), json!({}), json!({ "manifest_version": "3" })]
        {
            assert_eq!(said(old).as_deref(), Some(OLD));
        }
        assert_eq!(said(json!({ "manifest_version": 3 })), None);
        let full = json!({
            "manifest_version": 3,
            "background": { "service_worker": "/sw.js" },
            "content_scripts": [{ "js": ["a.js"], "css": ["a.css"] }],
            "icons": { "16": "icons/16.png" }
        });
        assert_eq!(
            said(full.clone()).as_deref(),
            Some("Its files are incomplete: sw.js is missing")
        );
        std::fs::create_dir_all(at.join("icons")).expect("a folder");
        for file in ["sw.js", "a.js", "a.css", "icons/16.png"] {
            std::fs::write(at.join(file), "").expect("a file");
        }
        assert_eq!(said(full), None);
        let worded = json!({ "manifest_version": 3, "default_locale": "en" });
        assert_eq!(
            said(worded.clone()).as_deref(),
            Some("Its files are incomplete: _locales/en is missing")
        );
        std::fs::create_dir_all(at.join("_locales/en")).expect("a folder");
        assert_eq!(
            said(json!({ "manifest_version": 3 })).as_deref(),
            Some("Its files are incomplete: it names no default language")
        );
        std::fs::write(at.join("_locales/en/messages.json"), "{}").expect("words");
        assert_eq!(said(worded), None);
    }
}
