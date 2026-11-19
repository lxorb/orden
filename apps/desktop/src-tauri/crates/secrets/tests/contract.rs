#![cfg(not(target_os = "android"))]
use orden_secrets::pass_stretch::secret_stretched;
use std::fmt::Write as _;

#[test]
fn a_pass_stretches_to_the_key_every_side_derives() {
    let key = secret_stretched(b"password", b"somesalt", 65536, 2, 1).expect("a key");
    let hex = key.iter().fold(String::new(), |mut out, one| {
        let _ = write!(out, "{one:02x}");
        out
    });
    assert_eq!(
        hex,
        "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7"
    );
}
#[test]
fn a_short_salt_is_refused() {
    assert!(secret_stretched(b"hunter2", b"short", 64, 1, 1).is_err());
}
