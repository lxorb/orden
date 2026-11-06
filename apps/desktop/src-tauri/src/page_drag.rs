#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SCRIPT: &str = include_str!("page_drag.js");

#[cfg(test)]
mod tests {
    use super::SCRIPT;

    #[test]
    fn the_script_takes_the_engine_s_drag_and_says_each_event_itself() {
        assert!(SCRIPT.contains("'dragstart'"));
        assert!(SCRIPT.contains("isTrusted"));
        for event in ["dragenter", "dragover", "dragleave", "drop", "dragend"] {
            assert!(SCRIPT.contains(&format!("'{event}'")), "{event}");
        }
    }
}
