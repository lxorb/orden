#[cfg_attr(
    any(feature = "cef", target_os = "macos"),
    allow(
        dead_code,
        reason = "a Mac's own engine is handed an identifier rather than a folder, and Orden's own Chromium keeps every store in its primary profile; the folder is what Windows and Linux use"
    )
)]
pub(crate) const STORES: &str = "web-stores";

pub(crate) fn named(asked: Option<&str>) -> Result<Option<&str>, String> {
    match orden_web_engine::StoreName::parse(asked) {
        Ok(Some(_)) => Ok(asked.filter(|name| !name.is_empty())),
        Ok(None) => Ok(None),
        Err(refused) => Err(refused.message),
    }
}

#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
pub(crate) fn identifier(name: &str) -> [u8; 16] {
    fn hashed(name: &str, start: u64) -> u64 {
        name.bytes().fold(start, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
        })
    }

    let mut out = [0u8; 16];
    out[..8].copy_from_slice(&hashed(name, 0xcbf2_9ce4_8422_2325).to_be_bytes());
    out[8..].copy_from_slice(&hashed(name, 0x6e69_625f_7765_6273).to_be_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::{identifier, named};
    use orden_web_engine::LONGEST_STORE_NAME as LONGEST;

    #[test]
    fn no_name_is_the_shared_store() {
        assert_eq!(named(None), Ok(None));
        assert_eq!(named(Some("")), Ok(None));
    }

    #[test]
    fn a_note_a_space_and_a_site_are_names() {
        assert_eq!(
            named(Some("note_3f9a0c17e2b4d685")),
            Ok(Some("note_3f9a0c17e2b4d685"))
        );
        assert!(named(Some("note_")).is_err());
        assert_eq!(named(Some("space_0-k3j9x2")), Ok(Some("space_0-k3j9x2")));
        assert_eq!(
            named(Some("site_0-k3j9x2_ethz.ch")),
            Ok(Some("site_0-k3j9x2_ethz.ch"))
        );
        assert_eq!(
            named(Some("site_7-a_xn--mnchen-3ya.de")),
            Ok(Some("site_7-a_xn--mnchen-3ya.de"))
        );
    }

    #[test]
    fn a_name_is_one_plain_folder() {
        for bad in [
            "..",
            "nul",
            "con",
            "web",
            "space_",
            "site_",
            ".hidden",
            "../web",
            "space/0",
            "space\\0",
            "C:",
            "Space_0",
            "space 0",
            "space_0\0",
            "site_0_é.ch",
        ] {
            assert!(named(Some(bad)).is_err(), "{bad} was taken");
        }

        let long = format!("space_{}", "a".repeat(LONGEST - 6));
        assert!(named(Some(&long)).is_ok());
        assert!(named(Some(&format!("{long}a"))).is_err());
    }

    #[test]
    fn a_macs_store_is_the_same_every_time() {
        let one = identifier("space_0-k3j9x2");
        assert_eq!(one, identifier("space_0-k3j9x2"));
        assert_ne!(one, identifier("space_1-k3j9x2"));
        assert_ne!(
            identifier("site_0-a_ethz.ch"),
            identifier("site_0-a_uzh.ch")
        );
        assert_ne!(one[..8], one[8..], "two halves, not one written twice");
        assert_eq!(
            identifier("a")[..8],
            0xaf63_dc4c_8601_ec8c_u64.to_be_bytes()
        );
        assert_eq!(
            identifier(""),
            [
                0xcb, 0xf2, 0x9c, 0xe4, 0x84, 0x22, 0x23, 0x25, 0x6e, 0x69, 0x62, 0x5f, 0x77, 0x65,
                0x62, 0x73
            ]
        );
    }
}
