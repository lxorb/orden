#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_agents::approvals::{answer_telling, unless_allowed_telling, Asking};
use orden_agents::grants::{Grant, Scope};
use orden_agents::verbs::{Answer, Category, Event};
use orden_agents::{may_ask_the_window, session_of, thread_of, Caller};

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
fn in_thread(thread: &str) -> Grant {
    let asked = serde_json::json!({ "verb": "edit_note", "thread": thread });
    match Caller::Agent(Box::new(Grant::own("contract-cc".into(), "CC")))
        .in_thread(thread_of(&asked))
    {
        Caller::Agent(grant) => *grant,
        Caller::Reader => panic!("an agent stays an agent"),
    }
}
fn asked(grant: &Grant, heard: &mut Vec<Event>) -> Option<String> {
    let asking = Asking::of(grant, Category::Writing, "Edit a.md".into(), "edit_note:a.md".into());
    match unless_allowed_telling(asking, |event| heard.push(event)) {
        Some(Answer::NeedsApproval { approval, .. }) => Some(approval),
        Some(other) => panic!("{other:?}"),
        None => None,
    }
}
#[test]
fn a_question_names_the_thread_whose_call_raised_it_and_its_answer_stays_there() {
    let (x, y) = (in_thread("thread-x"), in_thread("thread-y"));
    assert_eq!(x.thread.as_deref(), Some("thread-x"));
    let mut heard = Vec::new();
    let from_x = asked(&x, &mut heard).expect("x is asked");
    assert!(
        matches!(&heard[..], [Event::Asked { approval }] if approval.thread.as_deref() == Some("thread-x"))
    );
    let from_y = asked(&y, &mut heard).expect("y is asked on its own");
    assert_ne!(from_x, from_y);
    answer_telling(&from_y, true, |_| {}).expect("answered");
    assert_eq!(asked(&x, &mut heard), Some(from_x.clone()));
    assert_eq!(asked(&y, &mut heard), None);
    let again_y = asked(&y, &mut heard).expect("an allowance is spent once");
    answer_telling(&again_y, false, |_| {}).expect("answered");
    assert_eq!(asked(&x, &mut heard), Some(from_x.clone()));
    answer_telling(&from_x, true, |_| {}).expect("answered");
    assert_eq!(asked(&x, &mut heard), None);
    let bare = Grant::own("contract-cc".into(), "CC");
    assert!(asked(&bare, &mut heard).is_some());
    assert_eq!(thread_of(&serde_json::json!({ "thread": "../x" })), None);
    assert_eq!(thread_of(&serde_json::json!({ "thread": "x".repeat(81) })), None);
}
#[test]
fn an_agent_path_on_another_computer_is_refused_by_its_words_alone() {
    for far in [r"\\host\share\a.md", "//host/share/a.md", r"\\?\UNC\host\share", r"\\.\pipe\x"] {
        assert!(orden_agents::files::under_home(far, None).is_err(), "{far}");
    }
    assert!(orden_agents::files::on_this_computer(r"\\?\C:\a.md").is_ok());
}
