#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_agents::approvals::{answer_telling, unless_allowed_telling, Asking};
use orden_agents::grants::{Chat, Grant, Scope};
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
#[test]
fn a_chat_is_told_to_the_window_whole_and_never_read_back_from_the_file() {
    let mut grant = Grant::own("contract-chat".into(), "Chat");
    let mut stored = serde_json::to_value(&grant).expect("json");
    stored["chat"] = serde_json::json!({ "mode": "full", "without": ["edit_note"] });
    let read: Grant = serde_json::from_value(stored).expect("read");
    assert_eq!(read.chat, None);
    let told = Caller::Agent(Box::new(grant.clone())).told().expect("told");
    assert!(told.get("chat").is_none() && told.get("chat_mode").is_none());
    grant.chat = Some(Chat {
        mode: "plan".into(),
        without: vec!["browser_open".into()],
        only: Some(Vec::new()),
        space: Some("Work".into()),
    });
    let told = Caller::Agent(Box::new(grant.clone())).told().expect("told");
    assert_eq!(
        told["chat"],
        serde_json::json!({ "mode": "plan", "without": ["browser_open"], "only": [], "space": "Work" })
    );
    let threaded = Caller::Agent(Box::new(grant.clone())).in_thread(Some("thread-1".into()));
    assert_eq!(threaded.told().expect("told")["chat"], told["chat"]);
    grant.chat = Some(Chat { mode: "auto".into(), without: Vec::new(), only: None, space: None });
    let told = Caller::Agent(Box::new(grant)).told().expect("told");
    assert_eq!(told["chat"], serde_json::json!({ "mode": "auto" }));
}
