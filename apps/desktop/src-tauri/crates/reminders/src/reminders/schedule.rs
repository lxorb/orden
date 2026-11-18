use super::{Planned, Words};

pub trait System {
    fn scheduled(&self) -> Result<Vec<String>, String>;
    fn add(&self, one: &Planned, nonce: &str, words: &Words) -> Result<(), String>;
    fn remove(&self, id: &str) -> Result<(), String>;
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Changes {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

pub fn make_so(
    system: &impl System,
    wanted: &[(Planned, String)],
    moved: &[String],
    words: &Words,
    now: i64,
) -> Result<Changes, String> {
    let held = system.scheduled()?;
    let mut changes = Changes::default();

    for id in &held {
        if moved.contains(id) || !wanted.iter().any(|(one, _)| &one.id == id && one.at > now) {
            system.remove(id)?;
            changes.removed.push(id.clone());
        }
    }
    for (one, nonce) in wanted {
        if one.at <= now || (held.contains(&one.id) && !moved.contains(&one.id)) {
            continue;
        }
        system.add(one, nonce, words)?;
        changes.added.push(one.id.clone());
    }
    Ok(changes)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    pub struct Fake {
        pub held: RefCell<Vec<String>>,
        pub refuse: bool,
        pub asked: RefCell<Vec<String>>,
    }

    impl System for Fake {
        fn scheduled(&self) -> Result<Vec<String>, String> {
            Ok(self.held.borrow().clone())
        }
        fn add(&self, one: &Planned, nonce: &str, _words: &Words) -> Result<(), String> {
            if self.refuse {
                return Err("element not found".into());
            }
            self.asked
                .borrow_mut()
                .push(format!("add {} {nonce}", one.id));
            self.held.borrow_mut().push(one.id.clone());
            Ok(())
        }
        fn remove(&self, id: &str) -> Result<(), String> {
            self.asked.borrow_mut().push(format!("remove {id}"));
            self.held.borrow_mut().retain(|one| one != id);
            Ok(())
        }
    }

    pub fn planned(id: &str, at: i64) -> Planned {
        Planned {
            id: id.into(),
            at,
            title: "Call the bank".into(),
            body: "Plan".into(),
            space: "Work".into(),
            path: "Plan.md".into(),
            hash: "abc".into(),
            line: 2,
            tomorrow: None,
        }
    }

    fn wanted(ids: &[(&str, i64)]) -> Vec<(Planned, String)> {
        ids.iter()
            .map(|(id, at)| (planned(id, *at), format!("n-{id}")))
            .collect()
    }

    #[test]
    fn adds_what_is_new_and_takes_off_what_went() {
        let fake = Fake::default();
        fake.held.borrow_mut().push("old".into());
        fake.held.borrow_mut().push("kept".into());

        let changes = make_so(
            &fake,
            &wanted(&[("kept", 2000), ("new", 3000)]),
            &[],
            &Words::default(),
            1000,
        )
        .expect("the pass");
        assert_eq!(
            changes,
            Changes {
                added: vec!["new".into()],
                removed: vec!["old".into()]
            }
        );
        assert_eq!(*fake.held.borrow(), ["kept", "new"]);
        assert_eq!(*fake.asked.borrow(), ["remove old", "add new n-new"]);
    }

    #[test]
    fn the_same_plan_twice_touches_nothing() {
        let fake = Fake::default();
        let plan = wanted(&[("a", 2000), ("b", 3000)]);
        make_so(&fake, &plan, &[], &Words::default(), 1000).expect("the first pass");
        fake.asked.borrow_mut().clear();

        let changes = make_so(&fake, &plan, &[], &Words::default(), 1000).expect("the second");
        assert_eq!(changes, Changes::default());
        assert!(fake.asked.borrow().is_empty());
    }

    #[test]
    fn a_moment_gone_is_not_handed_over_and_one_held_is_let_go() {
        let fake = Fake::default();
        fake.held.borrow_mut().push("late".into());
        let changes = make_so(
            &fake,
            &wanted(&[("late", 900), ("past", 500)]),
            &[],
            &Words::default(),
            1000,
        )
        .expect("the pass");
        assert_eq!(changes.added, Vec::<String>::new());
        assert_eq!(changes.removed, ["late"]);
    }

    #[test]
    fn one_held_at_another_moment_is_set_again_at_its_own() {
        let fake = Fake::default();
        fake.held.borrow_mut().push("moved".into());
        fake.held.borrow_mut().push("still".into());
        let changes = make_so(
            &fake,
            &wanted(&[("moved", 3000), ("still", 2000)]),
            &["moved".to_owned()],
            &Words::default(),
            1000,
        )
        .expect("the pass");
        assert_eq!(changes.removed, ["moved"]);
        assert_eq!(changes.added, ["moved"]);
    }

    #[test]
    fn a_refusal_is_answered_so_the_page_rings_instead() {
        let fake = Fake {
            refuse: true,
            ..Fake::default()
        };
        assert!(make_so(&fake, &wanted(&[("a", 2000)]), &[], &Words::default(), 1000).is_err());
    }
}
