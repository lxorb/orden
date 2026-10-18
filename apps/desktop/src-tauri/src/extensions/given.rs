//! What a store's profile is handed, from what it holds and what the list says: each
//! extension installed in a store once, and a store loaded again handed nothing (#409).
//!
//! An install is not a quiet thing. `WebView2` runs an extension's `onInstalled` as it
//! takes the folder, and most extensions answer that with a page of their own - "thanks
//! for installing" - so every extension handed to a store a second time is that page
//! again. Pure, so the rule has tests; carried out in webview2.rs.

use std::collections::{BTreeMap, BTreeSet};

use super::library::Kept;

/// What one store is to be given.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan<'a> {
    /// Handed the folder: not in the store, or in it at a version behind the list's.
    pub add: Vec<&'a Kept>,
    /// In the store at the list's version: only turned on or off as the list says.
    pub switch: Vec<&'a Kept>,
    /// In the store and on the list no more: taken out.
    pub remove: Vec<String>,
}

/// What a store holding `installed`, last handed the versions in `given`, is to be
/// given for it to hold `list`, while the extensions in `adding` are on their way into
/// it already.
///
/// An extension on its way is left alone: it is being installed, and the answer that
/// writes its version down has not come yet. Asked again in that moment - a second page
/// of the store built, the list changing - it used to be handed over a second time.
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

    /// A store nothing was ever handed to - a note just turned Separate - is handed every
    /// extension on the list, once each.
    #[test]
    fn a_new_store_is_handed_each_extension_once() {
        let list = [kept(A, "1.0"), kept(B, "2.0")];
        let plan = plan(&list, &set(&[]), &given(&[]), &set(&[]));
        assert_eq!(plan.add, vec![&list[0], &list[1]]);
        assert!(plan.switch.is_empty());
        assert!(plan.remove.is_empty());
    }

    /// The same store loaded again - the next launch, the tab built again, back from
    /// Memory saver - is handed nothing, so no extension runs as freshly installed.
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

    /// An extension on its way into the store is not handed over again while it is.
    #[test]
    fn an_install_on_its_way_is_not_asked_for_twice() {
        let list = [kept(A, "1.0"), kept(B, "2.0")];
        let plan = plan(&list, &set(&[A]), &given(&[]), &set(&[A, B]));
        assert_eq!(plan, super::Plan::default());
    }

    /// A store at a version behind the list's is handed the new folder; one the store
    /// holds that the list no longer names is taken out.
    #[test]
    fn an_update_is_handed_over_and_a_removed_one_taken_out() {
        let list = [kept(A, "1.1")];
        let plan = plan(&list, &set(&[A, B]), &given(&[(A, "1.0")]), &set(&[]));
        assert_eq!(plan.add, vec![&list[0]]);
        assert_eq!(plan.remove, vec![B.to_owned()]);
    }
}
