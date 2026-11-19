#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_ai::ai_cli::Tool;

#[test]
fn each_tool_is_run_by_its_own_command() {
    assert_eq!(Tool::ClaudeCode.command(), "claude");
    assert_eq!(Tool::Codex.command(), "codex");
    assert_eq!(Tool::Gemini.command(), "gemini");
}
