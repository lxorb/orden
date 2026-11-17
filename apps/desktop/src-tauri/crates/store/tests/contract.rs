use orden_store::ai_accounts;

#[test]
fn the_accounts_are_written_only_over_the_text_last_read() {
    let dir = tempfile::tempdir().expect("a folder");
    let root = dir.path().join("ai");
    let first = ai_accounts::write(&root, r#"{"accounts":[]}"#, "").expect("written");
    assert_eq!(first.len(), 16);
    assert_eq!(
        ai_accounts::write(&root, r#"{"accounts":[1]}"#, ""),
        Err("stale".to_owned())
    );
    ai_accounts::write(&root, r#"{"accounts":[2]}"#, &first).expect("written over what was read");
}

#[test]
fn only_an_object_is_kept_as_the_accounts() {
    let dir = tempfile::tempdir().expect("a folder");
    assert!(ai_accounts::write(dir.path(), "[]", "").is_err());
    assert!(ai_accounts::write(dir.path(), "not json", "").is_err());
}
