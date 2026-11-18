pub const STORES: &str = "web-stores";

pub fn named(asked: Option<&str>) -> Result<Option<&str>, String> {
    match orden_web_engine::StoreName::parse(asked) {
        Ok(Some(_)) => Ok(asked.filter(|name| !name.is_empty())),
        Ok(None) => Ok(None),
        Err(refused) => Err(refused.message),
    }
}

#[cfg(test)]
mod tests {
    use super::named;
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
}
