use crate::grants::{Grant, BUILT_IN, SIDEBAR};

const SIDEBAR_BEFORE: &str = "nib \u{b7} ";
const BUILT_IN_BEFORE: &str = "nib-";
fn relabelled(grant: &mut Grant) -> bool {
    let mut changed = false;
    for label in [&mut grant.client, &mut grant.name] {
        if let Some(rest) = label.strip_prefix(SIDEBAR_BEFORE) {
            *label = format!("{SIDEBAR}{rest}");
            changed = true;
        }
    }
    changed
}
pub(crate) fn carried(grants: &mut [&mut Grant], labelled: bool) -> bool {
    let mut changed = false;
    for grant in &mut *grants {
        if !labelled {
            changed |= relabelled(grant);
        }
        let ours = grant.id.starts_with(BUILT_IN_BEFORE) && grant.client.starts_with(SIDEBAR);
        if ours && !grant.built_in {
            grant.built_in = true;
            changed = true;
        }
    }
    let mut taken: Vec<String> = grants.iter().map(|grant| grant.id.clone()).collect();
    for grant in &mut *grants {
        let Some(rest) = grant.id.strip_prefix(BUILT_IN_BEFORE) else {
            continue;
        };
        let id = format!("{BUILT_IN}{rest}");
        if grant.built_in && !taken.contains(&id) {
            taken.push(id.clone());
            grant.id = id;
            changed = true;
        }
    }
    changed
}
#[cfg(test)]
mod tests {
    use super::carried;
    use crate::grants::Grant;

    fn grant(id: &str, client: &str, name: &str) -> Grant {
        let mut grant = Grant::own(id.into(), client);
        grant.name = name.into();
        grant
    }
    fn after(mut all: Vec<Grant>, labelled: bool) -> (bool, Vec<(String, String, String, bool)>) {
        let mut each: Vec<&mut Grant> = all.iter_mut().collect();
        let changed = carried(&mut each, labelled);
        let said =
            all.into_iter().map(|one| (one.id, one.client, one.name, one.built_in)).collect();
        (changed, said)
    }
    fn row(id: &str, client: &str, name: &str, built_in: bool) -> (String, String, String, bool) {
        (id.into(), client.into(), name.into(), built_in)
    }
    #[test]
    fn the_sidebar_s_grants_take_the_new_id_and_label_and_nothing_else_does() {
        let (changed, said) = after(
            vec![
                grant("nib-anthropic", "nib \u{b7} Claude", "nib \u{b7} Claude"),
                grant("nib-openai", "nib \u{b7} OpenAI", "My own OpenAI"),
                grant("claude-code", "Claude Code", "Claude Code"),
                grant("x", "nibbler \u{b7} X", "nib \u{b7}X"),
                grant("nib-foo", "nib-foo", "nib-foo"),
            ],
            false,
        );
        assert!(changed);
        assert_eq!(
            said,
            [
                row("orden-anthropic", "Orden Claude", "Orden Claude", true),
                row("orden-openai", "Orden OpenAI", "My own OpenAI", true),
                row("claude-code", "Claude Code", "Claude Code", false),
                row("x", "nibbler \u{b7} X", "nib \u{b7}X", false),
                row("nib-foo", "nib-foo", "nib-foo", false),
            ]
        );
    }
    #[test]
    fn a_grant_already_under_the_new_id_is_not_written_over() {
        let mut now = grant("orden-anthropic", "Orden Claude", "Mine");
        now.built_in = true;
        let (_, said) = after(vec![now, grant("nib-anthropic", "Orden Claude", "Older")], true);
        assert_eq!(
            said,
            [
                row("orden-anthropic", "Orden Claude", "Mine", true),
                row("nib-anthropic", "Orden Claude", "Older", true),
            ]
        );
    }
    #[test]
    fn a_file_whose_labels_were_carried_keeps_a_name_its_reader_chose() {
        let (changed, said) =
            after(vec![grant("claude-code", "Claude Code", "nib \u{b7} mine")], true);
        assert!(!changed);
        assert_eq!(said, [row("claude-code", "Claude Code", "nib \u{b7} mine", false)]);
    }
    #[test]
    fn two_grants_of_one_former_id_do_not_end_as_one() {
        let (_, said) = after(
            vec![
                grant("nib-anthropic", "Orden Claude", "One"),
                grant("nib-anthropic", "Orden Claude", "Two"),
            ],
            true,
        );
        assert_eq!(said[0].0, "orden-anthropic");
        assert_eq!(said[1].0, "nib-anthropic");
    }
}
