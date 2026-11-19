use orden_notes::notes;

#[test]
fn a_note_reads_back_its_words_without_the_byte_order_mark() {
    let dir = tempfile::tempdir().expect("a folder");
    let note = dir.path().join("a.md");
    std::fs::write(&note, "\u{feff}# A\n").expect("a note");
    assert_eq!(notes::words_of(&note).expect("read"), "# A\n");
    let (words, meta) = notes::words_stamped(&note).expect("read");
    assert_eq!(words, "# A\n");
    assert_eq!(meta.len(), 7);
}
#[test]
fn only_a_file_has_a_stamp() {
    let dir = tempfile::tempdir().expect("a folder");
    let note = dir.path().join("a.md");
    std::fs::write(&note, "abc").expect("a note");
    assert!(notes::stamp_of(&note).is_some());
    assert!(notes::stamp_of(dir.path()).is_none());
    assert!(notes::stamp_of(&dir.path().join("gone.md")).is_none());
}
#[test]
fn words_that_are_not_text_are_refused() {
    let dir = tempfile::tempdir().expect("a folder");
    let note = dir.path().join("a.md");
    std::fs::write(&note, [0x80, 0x80]).expect("a note");
    assert!(notes::words_of(&note).is_err());
}
