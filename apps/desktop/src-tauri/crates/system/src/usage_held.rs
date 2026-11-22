const SWITCH: &str = "ORDEN_USAGE";
const RUNNERS: [&str; 2] = ["CI", "GITHUB_ACTIONS"];
fn held_by(read: impl Fn(&str) -> Option<String>) -> bool {
    let set = |name: &str| {
        read(name).is_some_and(|value| {
            let value = value.trim();
            !value.is_empty() && value != "0" && !value.eq_ignore_ascii_case("false")
        })
    };
    read(SWITCH).is_some_and(|value| value.trim().eq_ignore_ascii_case("off"))
        || RUNNERS.into_iter().any(set)
}
#[tauri::command]
pub fn usage_held() -> bool {
    held_by(|name| std::env::var(name).ok())
}
#[cfg(test)]
mod tests {
    use super::held_by;
    fn with(pairs: &[(&str, &str)]) -> bool {
        held_by(|name| {
            pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| (*value).to_owned())
        })
    }
    #[test]
    fn a_runner_or_the_switch_holds_usage_back() {
        assert!(with(&[("CI", "true")]));
        assert!(with(&[("CI", "1")]));
        assert!(with(&[("GITHUB_ACTIONS", "true")]));
        assert!(with(&[("ORDEN_USAGE", "off")]));
        assert!(with(&[("ORDEN_USAGE", " OFF ")]));
    }
    #[test]
    fn a_user_s_machine_sends() {
        assert!(!with(&[]));
        assert!(!with(&[("CI", "false")]));
        assert!(!with(&[("CI", "0")]));
        assert!(!with(&[("CI", "")]));
        assert!(!with(&[("ORDEN_USAGE", "on")]));
    }
}
