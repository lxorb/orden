use std::ffi::{OsStr, OsString};

const OLD: &str = "NIB_";
const NEW: &str = "ORDEN_";

pub fn carry_env() {
    for (old, new) in carried(std::env::vars_os()) {
        if let Some((name, value)) = new {
            std::env::set_var(name, value);
        }
        std::env::remove_var(old);
    }
}

fn renamed(name: &OsStr) -> Option<OsString> {
    let rest = name.to_str()?.strip_prefix(OLD)?;
    (!rest.is_empty()).then(|| OsString::from(format!("{NEW}{rest}")))
}

type Move = (OsString, Option<(OsString, OsString)>);

fn carried(vars: impl IntoIterator<Item = (OsString, OsString)>) -> Vec<Move> {
    let vars: Vec<(OsString, OsString)> = vars.into_iter().collect();
    vars.iter()
        .filter_map(|(name, value)| {
            let new = renamed(name)?;
            let taken = vars.iter().any(|(other, _)| *other == new);
            Some((name.clone(), (!taken).then(|| (new, value.clone()))))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(list: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        list.iter()
            .map(|(name, value)| (OsString::from(name), OsString::from(value)))
            .collect()
    }

    fn os(text: &str) -> OsString {
        OsString::from(text)
    }

    #[test]
    fn an_old_variable_moves_to_the_new_name() {
        let moved = carried(pairs(&[
            ("NIB_SPACES_DIR", "/notes"),
            ("HOME", "/home/ada"),
        ]));
        assert_eq!(
            moved,
            vec![(
                os("NIB_SPACES_DIR"),
                Some((os("ORDEN_SPACES_DIR"), os("/notes")))
            )]
        );
    }

    #[test]
    fn the_new_name_wins_and_the_old_one_still_leaves() {
        let moved = carried(pairs(&[
            ("NIB_MCP_TOKEN", "old"),
            ("ORDEN_MCP_TOKEN", "new"),
        ]));
        assert_eq!(moved, vec![(os("NIB_MCP_TOKEN"), None)]);
    }

    #[test]
    fn only_the_prefix_counts() {
        assert!(carried(pairs(&[("NIB_", "x"), ("NIBBLE", "x"), ("A_NIB_X", "x")])).is_empty());
    }
}
