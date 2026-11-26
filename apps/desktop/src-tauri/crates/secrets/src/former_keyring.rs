pub(crate) const FORMER_SERVICE: &str = "nibeditor";
pub(crate) struct Carried {
    pub secret: Option<String>,
    pub trouble: Option<String>,
}
pub(crate) fn carried<E: std::fmt::Display>(
    service: &str,
    read: impl Fn(&str) -> Result<Option<String>, E>,
    write: impl FnOnce(&str, &str) -> Result<(), E>,
    forget: impl FnOnce(&str) -> Result<(), E>,
) -> Result<Carried, E> {
    if let Some(secret) = read(service)? {
        return Ok(Carried { secret: Some(secret), trouble: None });
    }
    let Some(secret) = read(FORMER_SERVICE)? else {
        return Ok(Carried { secret: None, trouble: None });
    };
    let trouble = match write(service, &secret).and_then(|()| read(service)) {
        Ok(Some(back)) if back == secret => forget(FORMER_SERVICE)
            .err()
            .map(|error| format!("the copy under the former name could not be removed: {error}")),
        Ok(_) => Some("it did not read back as written, so it stays under the former name".into()),
        Err(error) => Some(format!("it stays under the former name: {error}")),
    };
    Ok(Carried { secret: Some(secret), trouble })
}
#[cfg(test)]
mod tests {
    use super::{carried, FORMER_SERVICE};
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    const NOW: &str = "orden";
    struct Ring {
        held: RefCell<BTreeMap<String, String>>,
        refuses: bool,
        garbles: bool,
    }
    impl Ring {
        fn holding(pairs: &[(&str, &str)]) -> Self {
            let held = pairs.iter().map(|(at, secret)| ((*at).to_owned(), (*secret).to_owned()));
            Self { held: RefCell::new(held.collect()), refuses: false, garbles: false }
        }
        fn carry(&self) -> (Option<String>, Option<String>) {
            let read = |service: &str| Ok::<_, String>(self.held.borrow().get(service).cloned());
            let write = |service: &str, secret: &str| {
                if self.refuses {
                    return Err("locked".to_owned());
                }
                let kept = if self.garbles { "other".to_owned() } else { secret.to_owned() };
                self.held.borrow_mut().insert(service.to_owned(), kept);
                Ok(())
            };
            let forget = |service: &str| {
                self.held.borrow_mut().remove(service);
                Ok(())
            };
            let done = carried(NOW, read, write, forget).expect("read");
            (done.secret, done.trouble)
        }
        fn at(&self, service: &str) -> Option<String> {
            self.held.borrow().get(service).cloned()
        }
    }
    #[test]
    fn a_key_under_the_former_name_moves_whole_and_only_then_leaves() {
        let ring = Ring::holding(&[(FORMER_SERVICE, "sk-old")]);
        assert_eq!(ring.carry(), (Some("sk-old".to_owned()), None));
        assert_eq!(ring.at(NOW).as_deref(), Some("sk-old"));
        assert_eq!(ring.at(FORMER_SERVICE), None);
        assert_eq!(ring.carry(), (Some("sk-old".to_owned()), None));
    }
    #[test]
    fn a_key_already_under_the_new_name_is_never_written_over() {
        let ring = Ring::holding(&[(FORMER_SERVICE, "sk-old"), (NOW, "sk-new")]);
        assert_eq!(ring.carry(), (Some("sk-new".to_owned()), None));
        assert_eq!(ring.at(NOW).as_deref(), Some("sk-new"));
        assert_eq!(ring.at(FORMER_SERVICE).as_deref(), Some("sk-old"));
    }
    #[test]
    fn a_key_that_will_not_move_stays_where_it_was_and_is_still_read() {
        let mut ring = Ring::holding(&[(FORMER_SERVICE, "sk-old")]);
        ring.refuses = true;
        let (secret, trouble) = ring.carry();
        assert_eq!(secret.as_deref(), Some("sk-old"));
        assert!(trouble.is_some_and(|said| said.contains("locked")));
        assert_eq!(ring.at(FORMER_SERVICE).as_deref(), Some("sk-old"));
        assert_eq!(ring.at(NOW), None);
    }
    #[test]
    fn a_key_that_reads_back_changed_keeps_its_former_copy() {
        let mut ring = Ring::holding(&[(FORMER_SERVICE, "sk-old")]);
        ring.garbles = true;
        let (secret, trouble) = ring.carry();
        assert_eq!(secret.as_deref(), Some("sk-old"));
        assert!(trouble.is_some());
        assert_eq!(ring.at(FORMER_SERVICE).as_deref(), Some("sk-old"));
    }
    #[test]
    fn nothing_kept_is_nothing_carried() {
        let ring = Ring::holding(&[]);
        assert_eq!(ring.carry(), (None, None));
        assert!(ring.held.borrow().is_empty());
    }
}
