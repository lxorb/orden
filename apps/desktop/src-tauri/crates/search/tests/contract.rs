use orden_search::{front_matter, tags, tasks};

#[test]
fn a_tag_starts_a_word_and_a_heading_is_none() {
    assert_eq!(tags::tags_in("# Heading\n#work/2026 and #a-b"), vec!["#work/2026", "#a-b"]);
    assert!(tags::tags_in("issue #42 and a#b").is_empty());
}
#[test]
fn a_task_is_a_list_item_with_a_box() {
    let done = tasks::task_at("  - [x] shipped").expect("a task");
    assert!(done.done);
    assert_eq!(done.indent, 2);
    assert!(!tasks::task_at("1. [ ] first").expect("a task").done);
    assert!(tasks::task_at("- not a task").is_none());
}
#[test]
fn front_matter_is_read_only_at_the_top() {
    let body = "---\ntitle: Plan\ntags: [a, b]\n---\n# Plan\n";
    let block = front_matter::block(body).expect("front matter");
    assert_eq!(front_matter::value(body, &block, "title").as_deref(), Some("Plan"));
    assert_eq!(front_matter::list(body, &block, "tags"), vec!["a", "b"]);
    assert!(front_matter::block("# Plan\n---\ntitle: x\n---\n").is_none());
}
