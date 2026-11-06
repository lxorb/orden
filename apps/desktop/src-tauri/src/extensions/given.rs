use std::collections::{BTreeMap, BTreeSet};

use super::library::Kept;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan<'a> {
    pub add: Vec<&'a Kept>,
    pub switch: Vec<&'a Kept>,
    pub remove: Vec<String>,
}

pub fn plan<'a>(
    list: &'a [Kept],
    installed: &BTreeSet<String>,
    given: &BTreeMap<String, String>,
    adding: &BTreeSet<String>,
) -> Plan<'a> {
    let mut out = Plan::default();
    for kept in list {
        if adding.contains(&kept.id) {
            continue;
        }
        if installed.contains(&kept.id) && given.get(&kept.id) == Some(&kept.version) {
            out.switch.push(kept);
        } else {
            out.add.push(kept);
        }
    }
    out.remove = installed
        .iter()
        .filter(|id| !adding.contains(*id) && !list.iter().any(|kept| &kept.id == *id))
        .cloned()
        .collect();
    out
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::super::library::Kept;
    use super::super::link::Store;
    use super::plan;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn kept(id: &str, version: &str) -> Kept {
        Kept {
            id: id.into(),
            store: Store::Chrome,
            version: version.into(),
            enabled: true,
            pinned: true,
            addon: None,
        }
    }

    fn set(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|one| (*one).to_owned()).collect()
    }

    fn given(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(id, version)| ((*id).to_owned(), (*version).to_owned()))
            .collect()
    }

    #[test]
    fn a_new_store_is_handed_each_extension_once() {
        let list = [kept(A, "1.0"), kept(B, "2.0")];
        let plan = plan(&list, &set(&[]), &given(&[]), &set(&[]));
        assert_eq!(plan.add, vec![&list[0], &list[1]]);
        assert!(plan.switch.is_empty());
        assert!(plan.remove.is_empty());
    }

    #[test]
    fn a_store_loaded_again_is_handed_nothing() {
        let list = [kept(A, "1.0"), kept(B, "2.0")];
        let plan = plan(
            &list,
            &set(&[A, B]),
            &given(&[(A, "1.0"), (B, "2.0")]),
            &set(&[]),
        );
        assert!(plan.add.is_empty());
        assert_eq!(plan.switch, vec![&list[0], &list[1]]);
        assert!(plan.remove.is_empty());
    }

    #[test]
    fn an_install_on_its_way_is_not_asked_for_twice() {
        let list = [kept(A, "1.0"), kept(B, "2.0")];
        let plan = plan(&list, &set(&[A]), &given(&[]), &set(&[A, B]));
        assert_eq!(plan, super::Plan::default());
    }

    #[test]
    fn an_update_is_handed_over_and_a_removed_one_taken_out() {
        let list = [kept(A, "1.1")];
        let plan = plan(&list, &set(&[A, B]), &given(&[(A, "1.0")]), &set(&[]));
        assert_eq!(plan.add, vec![&list[0]]);
        assert_eq!(plan.remove, vec![B.to_owned()]);
    }
}
