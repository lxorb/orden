use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE: &str = "dns.json";

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const PROVIDERS: [(&str, &str); 3] = [
    ("cloudflare", "https://chrome.cloudflare-dns.com/dns-query"),
    ("google", "https://dns.google/dns-query{?dns}"),
    ("quad9", "https://dns.quad9.net/dns-query"),
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dns {
    pub choice: String,
    #[serde(default)]
    pub custom: String,
}

impl Default for Dns {
    fn default() -> Self {
        Self {
            choice: "automatic".to_string(),
            custom: String::new(),
        }
    }
}

impl Dns {
    #[cfg_attr(not(feature = "cef"), allow(dead_code))]
    pub fn told(&self) -> (&'static str, String) {
        match self.choice.as_str() {
            "system" => ("off", String::new()),
            "custom" if usable(&self.custom) => ("secure", self.custom.trim().to_string()),
            chosen => PROVIDERS
                .iter()
                .find(|(name, _)| *name == chosen)
                .map_or(("automatic", String::new()), |(_, address)| {
                    ("secure", (*address).to_string())
                }),
        }
    }
}

pub fn usable(address: &str) -> bool {
    address
        .trim()
        .strip_prefix("https://")
        .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/') && !rest.contains(' '))
}

fn kept(config: &Path) -> Dns {
    std::fs::read_to_string(config.join(FILE))
        .ok()
        .and_then(|said| serde_json::from_str(&said).ok())
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn dns_chosen(app: tauri::AppHandle<crate::Engine>) -> Result<Option<Dns>, String> {
    if !cfg!(feature = "cef") {
        return Ok(None);
    }
    Ok(Some(kept(&crate::paths::config_dir(&app)?)))
}

#[tauri::command(async)]
pub fn dns_choose(app: tauri::AppHandle<crate::Engine>, dns: Dns) -> Result<(), String> {
    if dns.choice == "custom" && !dns.custom.trim().is_empty() && !usable(&dns.custom) {
        return Err("a provider's address starts with https://".to_string());
    }
    let config = crate::paths::config_dir(&app)?;
    crate::paths::made(&config)?;
    let written = serde_json::to_vec(&dns).map_err(|error| error.to_string())?;
    crate::paths::write_atomically(&config.join(FILE), &written)?;
    engine::tell(&app, &dns);
    Ok(())
}

#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn start(app: &tauri::AppHandle<crate::Engine>) {
    if let Ok(config) = crate::paths::config_dir(app) {
        engine::tell(app, &kept(&config));
    }
}

#[cfg(feature = "cef")]
mod engine {
    use cef::{CefString, ImplPreferenceManager as _, ImplValue as _};

    use super::Dns;

    const MODE: &str = "dns_over_https.mode";
    const TEMPLATES: &str = "dns_over_https.templates";

    pub fn tell(app: &tauri::AppHandle<crate::Engine>, dns: &Dns) {
        let (mode, templates) = dns.told();
        let app = app.clone();
        let posted = crate::agents::engines::cef::on_ui(move || {
            let Some(manager) = cef::preference_manager_get_global() else {
                eprintln!("dns: the browser's preferences could not be reached");
                return;
            };
            for (name, said) in [(TEMPLATES, templates.as_str()), (MODE, mode)] {
                let Some(mut value) = cef::value_create() else {
                    return;
                };
                value.set_string(Some(&CefString::from(said)));
                let mut error = CefString::from(" ");
                if manager.set_preference(
                    Some(&CefString::from(name)),
                    Some(&mut value),
                    Some(&mut error),
                ) == 0
                {
                    eprintln!("dns: {name} was refused: {error}");
                }
            }
            let provider = if templates.is_empty() {
                String::new()
            } else {
                format!(" ({templates})")
            };
            crate::logs::say(&app, "info", &format!("dns: {mode}{provider}"));
        });
        if !posted {
            eprintln!("dns: the engine's thread could not be reached");
        }
    }
}

#[cfg(not(feature = "cef"))]
mod engine {
    use super::Dns;

    pub fn tell(_app: &tauri::AppHandle<crate::Engine>, _dns: &Dns) {}
}

#[cfg(test)]
mod tests {
    use super::{usable, Dns, PROVIDERS};

    fn dns(choice: &str, custom: &str) -> Dns {
        Dns {
            choice: choice.into(),
            custom: custom.into(),
        }
    }

    #[test]
    fn each_choice_is_told_as_chrome_tells_it() {
        assert_eq!(dns("system", "").told(), ("off", String::new()));
        assert_eq!(dns("automatic", "").told(), ("automatic", String::new()));
        assert_eq!(
            dns("google", "").told(),
            ("secure", PROVIDERS[1].1.to_string())
        );
        assert_eq!(
            dns("custom", " https://dns.example/dns-query ").told(),
            ("secure", "https://dns.example/dns-query".to_string())
        );
    }

    #[test]
    fn a_choice_that_will_not_do_is_chrome_s_default() {
        assert_eq!(dns("custom", "").told(), ("automatic", String::new()));
        assert_eq!(
            dns("custom", "http://dns.example/").told(),
            ("automatic", String::new())
        );
        assert_eq!(dns("nonsense", "").told(), ("automatic", String::new()));
        assert_eq!(Dns::default().told(), ("automatic", String::new()));
    }

    #[test]
    fn only_an_https_address_with_a_host_is_a_provider() {
        assert!(usable("https://1.1.1.1/dns-query"));
        assert!(usable("https://dns.example/q{?dns}"));
        assert!(!usable("http://dns.example/"));
        assert!(!usable("https://"));
        assert!(!usable("https:///dns-query"));
        assert!(!usable("1.1.1.1"));
    }
}
