#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_agents::grants::{Grant, Scope};
use orden_agents::{may_ask_the_window, session_of, Caller};

#[test]
fn a_session_is_read_only_when_it_is_a_short_plain_name() {
    assert_eq!(session_of(&serde_json::json!({ "session": "a-1" })), "a-1");
    assert_eq!(session_of(&serde_json::json!({ "session": "../x" })), "");
    assert_eq!(session_of(&serde_json::json!({})), "");
}
#[test]
fn an_agent_asks_the_window_only_for_what_it_was_granted() {
    let mut grant = Grant::own("a".into(), "A");
    grant.scopes.retain(|one| *one != Scope::NotesWrite);
    let agent = Caller::Agent(Box::new(grant));
    assert!(may_ask_the_window(&agent, "read_note").is_ok());
    assert!(may_ask_the_window(&agent, "edit_note").is_err());
    assert!(may_ask_the_window(&Caller::Reader, "edit_note").is_ok());
}
