use std::sync::OnceLock;

const TOKEN: &str = "XDG_ACTIVATION_TOKEN";
const STARTUP_ID: &str = "DESKTOP_STARTUP_ID";

static LAUNCHED_WITH: OnceLock<Option<String>> = OnceLock::new();

pub fn prepare() {
    let token = std::env::var(TOKEN).ok().filter(|token| !token.is_empty());
    if let Some(token) = &token {
        if std::env::var_os(STARTUP_ID).is_none() {
            std::env::set_var(STARTUP_ID, token);
        }
        std::env::remove_var(TOKEN);
    }
    let _ = LAUNCHED_WITH.set(token);
}

pub fn launched_with() -> Option<&'static str> {
    LAUNCHED_WITH.get().and_then(Option::as_deref)
}

pub fn wayland_session() -> bool {
    static SESSION: OnceLock<bool> = OnceLock::new();
    *SESSION.get_or_init(|| {
        session_is_wayland(
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        )
    })
}

fn session_is_wayland(display: Option<&str>, kind: Option<&str>) -> bool {
    display.is_some_and(|display| !display.is_empty()) || kind == Some("wayland")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_wayland_by_its_display_or_its_type() {
        assert!(session_is_wayland(Some("wayland-0"), None));
        assert!(session_is_wayland(None, Some("wayland")));
        assert!(!session_is_wayland(Some(""), Some("x11")));
        assert!(!session_is_wayland(None, None));
    }
}
