#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_documents::handed_pdfs::pdfs_in;
use orden_documents::pdf::{printing, PdfPage};

#[test]
fn a_page_prints_on_its_own_sheet_with_its_backgrounds() {
    let asked = printing(&PdfPage { width: 8.5, height: 11.0, margin: -1.0, landscape: true });
    assert_eq!(asked["paperWidth"], 8.5);
    assert_eq!(asked["landscape"], true);
    assert_eq!(asked["marginTop"], 0.0);
    assert_eq!(asked["printBackground"], true);
}
#[test]
fn a_link_handed_over_brings_no_pdf() {
    let dir = tempfile::tempdir().expect("a folder");
    let paper = dir.path().join("a.pdf");
    std::fs::write(&paper, b"%PDF").expect("a pdf");
    let paper = paper.to_string_lossy().into_owned();
    assert_eq!(pdfs_in(&["orden", paper.as_str()], dir.path()).len(), 1);
    assert!(pdfs_in(&["orden", "--url", paper.as_str()], dir.path()).is_empty());
}
