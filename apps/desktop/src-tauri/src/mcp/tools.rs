use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::agents::grants::{Grant, Scope};
use crate::agents::verbs::{window::AGENT_VERBS, NAMES};

#[derive(Debug, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input: Value,
    #[serde(default)]
    pub annotations: Option<Value>,
}

impl Tool {
    pub fn listed(&self) -> Value {
        let mut said = json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input,
        });
        if let Some(annotations) = &self.annotations {
            said["annotations"] = annotations.clone();
        }
        said
    }
}

pub fn table() -> &'static [Tool] {
    static TABLE: OnceLock<Vec<Tool>> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(include_str!("tools.json")).unwrap_or_default())
}

pub fn find(name: &str) -> Option<&'static Tool> {
    table().iter().find(|tool| tool.name == name)
}

pub fn of_the_crate(name: &str) -> bool {
    NAMES.contains(&name)
}

pub fn reaches(grant: &Grant, name: &str) -> bool {
    let browsing = grant.holds(Scope::Browser) || grant.holds(Scope::BrowserReader);
    match name {
        "agent_status" | "approval_status" => true,
        "browser_open" | "browser_close" | "browser_show" | "browser_downloads" => {
            grant.holds(Scope::Browser)
        }
        "browser_evaluate" => {
            browsing
                && grant.holds(Scope::BrowserScript)
                && (grant.asks_nothing() || !grant.scripts.is_empty())
        }
        name if name.starts_with("browser_") => browsing,
        "files" => grant.holds(Scope::Files),
        "process" | "system" => grant.holds(Scope::Processes),
        "http" => grant.holds(Scope::Network),
        name => AGENT_VERBS
            .iter()
            .find(|(verb, _)| *verb == name)
            .is_some_and(|(_, needs)| needs.is_none_or(|scope| grant.holds(scope))),
    }
}

pub fn listed(grant: &Grant, window: Option<&BTreeSet<String>>) -> Vec<&'static Tool> {
    table()
        .iter()
        .filter(|tool| reaches(grant, &tool.name))
        .filter(|tool| {
            of_the_crate(&tool.name) || window.is_some_and(|verbs| verbs.contains(&tool.name))
        })
        .collect()
}

pub fn unpaired() -> Vec<&'static Tool> {
    find("agent_status").into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::verbs::Verb;
    use std::collections::BTreeMap;

    const OWN: [&str; 2] = ["agent_pair", "agent_bye"];

    const PROBE: &str = "__nib_probe";

    fn names() -> BTreeSet<&'static str> {
        table().iter().map(|tool| tool.name.as_str()).collect()
    }

    #[test]
    fn the_table_reads_whole_with_one_row_a_name() {
        let raw: Vec<Value> =
            serde_json::from_str(include_str!("tools.json")).expect("tools.json is JSON");
        assert_eq!(table().len(), raw.len(), "a row did not read");
        assert_eq!(names().len(), table().len(), "a name is in the table twice");
        for tool in table() {
            assert_eq!(tool.input["type"], "object", "{}", tool.name);
            assert!(!tool.description.is_empty(), "{}", tool.name);
            let properties = tool.input["properties"].as_object().expect("properties");
            for needed in tool.input["required"].as_array().into_iter().flatten() {
                let needed = needed.as_str().expect("a name");
                assert!(properties.contains_key(needed), "{}: {needed}", tool.name);
            }
        }
    }

    #[test]
    fn every_verb_is_a_tool_and_every_tool_a_verb() {
        let verbs: BTreeSet<&str> = NAMES
            .iter()
            .copied()
            .filter(|name| !OWN.contains(name))
            .chain(AGENT_VERBS.iter().map(|(name, _)| *name))
            .collect();
        assert_eq!(names(), verbs);
    }

    fn sample(schema: &Value) -> Value {
        if let Some(first) = schema.get("enum").and_then(|all| all.get(0)) {
            return first.clone();
        }
        if let Some(first) = schema.get("anyOf").and_then(|all| all.get(0)) {
            return sample(first);
        }
        match schema.get("type").and_then(Value::as_str) {
            Some("integer") => json!(1),
            Some("number") => json!(1.5),
            Some("boolean") => json!(true),
            Some("array") => json!([sample(&schema["items"])]),
            Some("object") => Value::Object(
                schema["properties"]
                    .as_object()
                    .map(|all| {
                        all.iter()
                            .map(|(key, one)| (key.clone(), sample(one)))
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            _ => json!("e1"),
        }
    }

    fn objects(schema: &Value, at: &[Value], found: &mut Vec<(Vec<Value>, Value)>) {
        if schema.get("type").and_then(Value::as_str) == Some("object")
            && schema.get("properties").is_some()
        {
            found.push((at.to_vec(), schema.clone()));
            for (key, one) in schema["properties"].as_object().into_iter().flatten() {
                let mut deeper = at.to_vec();
                deeper.push(json!(key));
                objects(one, &deeper, found);
            }
        }
        if schema.get("type").and_then(Value::as_str) == Some("array") {
            let mut deeper = at.to_vec();
            deeper.push(json!(0));
            objects(&schema["items"], &deeper, found);
        }
    }

    fn at<'a>(value: &'a mut Value, place: &[Value]) -> &'a mut Value {
        place.iter().fold(value, |inside, step| match step {
            Value::String(key) => &mut inside[key.as_str()],
            _ => &mut inside[0],
        })
    }

    fn refusal(verb: &str, args: Value) -> String {
        match Verb::read(verb, args.clone()) {
            Some(Err(why)) => why,
            other => panic!("{verb} took {args}: {other:?}"),
        }
    }

    fn expected(why: &str) -> BTreeSet<String> {
        let Some((_, after)) = why.split_once("expected") else {
            return BTreeSet::new();
        };
        after
            .split('`')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }

    fn keys(schema: &Value) -> BTreeSet<String> {
        schema["properties"]
            .as_object()
            .map(|all| all.keys().cloned().collect())
            .unwrap_or_default()
    }

    fn required(schema: &Value) -> BTreeSet<String> {
        schema["required"]
            .as_array()
            .map(|all| {
                all.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn every_crate_tools_schema_is_its_verbs_own() {
        for tool in table().iter().filter(|tool| of_the_crate(&tool.name)) {
            let verb = tool.name.as_str();
            let full = sample(&tool.input);
            assert!(
                matches!(Verb::read(verb, full.clone()), Some(Ok(_))),
                "{verb}: a sample of its schema does not read: {full}"
            );

            let mut found = Vec::new();
            objects(&tool.input, &[], &mut found);
            for (place, schema) in found {
                let mut probed = full.clone();
                *at(&mut probed, &place) = json!({ PROBE: 0 });
                let why = refusal(verb, probed);
                let takes = if why.contains("there are no fields") {
                    BTreeSet::new()
                } else {
                    expected(&why)
                };
                assert_eq!(keys(&schema), takes, "{verb} at {place:?}: {why}");

                let mut needs = BTreeSet::new();
                for key in keys(&schema) {
                    let mut without = full.clone();
                    at(&mut without, &place)
                        .as_object_mut()
                        .expect("an object")
                        .remove(&key);
                    match Verb::read(verb, without) {
                        Some(Ok(_)) => {}
                        Some(Err(why)) if why.contains(&format!("missing field `{key}`")) => {
                            needs.insert(key);
                        }
                        other => panic!("{verb} without {key}: {other:?}"),
                    }
                }
                assert_eq!(required(&schema), needs, "{verb} at {place:?}");

                for (key, one) in schema["properties"].as_object().into_iter().flatten() {
                    let (words, inside_a_list) = match (one.get("enum"), one["items"].get("enum")) {
                        (Some(words), _) => (words, false),
                        (None, Some(words)) => (words, true),
                        _ => continue,
                    };
                    let mut bogus = full.clone();
                    let bad = if inside_a_list {
                        json!(["__nib_bogus"])
                    } else {
                        json!("__nib_bogus")
                    };
                    at(&mut bogus, &place)[key.as_str()] = bad;
                    let Some(Err(why)) = Verb::read(verb, bogus) else {
                        continue;
                    };
                    let listed: BTreeSet<String> = words
                        .as_array()
                        .expect("a list")
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect();
                    assert_eq!(listed, expected(&why), "{verb}.{key}: {why}");
                }
            }
        }
    }

    #[test]
    fn every_shape_of_several_reads_back() {
        for tool in table().iter().filter(|tool| of_the_crate(&tool.name)) {
            let full = sample(&tool.input);
            let mut found = Vec::new();
            objects(&tool.input, &[], &mut found);
            for (place, schema) in found {
                for (key, one) in schema["properties"].as_object().into_iter().flatten() {
                    for shape in one["anyOf"].as_array().into_iter().flatten() {
                        let words = shape["enum"].as_array().cloned().unwrap_or_default();
                        let values = if words.is_empty() {
                            vec![sample(shape)]
                        } else {
                            words
                        };
                        for value in values {
                            let mut args = full.clone();
                            at(&mut args, &place)[key.as_str()] = value.clone();
                            assert!(
                                matches!(Verb::read(&tool.name, args), Some(Ok(_))),
                                "{}.{key} = {value}",
                                tool.name
                            );
                        }
                    }
                }
            }
        }
    }

    fn grant(scopes: &[Scope]) -> Grant {
        let mut grant = Grant::own("a".into(), "A");
        grant.scopes = scopes.to_vec();
        grant
    }

    fn listed_names(grant: &Grant, window: Option<&BTreeSet<String>>) -> BTreeSet<String> {
        listed(grant, window)
            .into_iter()
            .map(|tool| tool.name.clone())
            .collect()
    }

    #[test]
    fn an_agent_with_notes_and_no_browser_is_shown_no_browser() {
        let every: BTreeSet<String> = AGENT_VERBS
            .iter()
            .map(|(one, _)| (*one).to_owned())
            .collect();
        let shown = listed_names(&grant(&[Scope::NotesRead]), Some(&every));
        assert!(shown.contains("read_note"));
        assert!(shown.contains("list_spaces"));
        assert!(shown.contains("agent_status"));
        assert!(!shown.iter().any(|one| one.starts_with("browser_")));
        assert!(!shown.contains("edit_note"));
    }

    #[test]
    fn the_readers_tabs_alone_reach_acting_but_not_a_tab_of_its_own() {
        let shown = listed_names(&grant(&[Scope::BrowserReader]), None);
        assert!(shown.contains("browser_click"));
        assert!(shown.contains("browser_snapshot"));
        assert!(!shown.contains("browser_open"));
        assert!(!shown.contains("browser_downloads"));
    }

    #[test]
    fn scripts_need_the_scope_and_a_site() {
        let mut scripted = grant(&[Scope::Browser, Scope::BrowserScript]);
        assert!(!reaches(&scripted, "browser_evaluate"));
        scripted.scripts.push("example.com".into());
        assert!(reaches(&scripted, "browser_evaluate"));
        assert!(!reaches(&grant(&[Scope::Browser]), "browser_evaluate"));
    }

    #[test]
    fn the_windows_verbs_wait_for_the_window_to_say_it_has_them() {
        let own = Grant::own("a".into(), "A");
        let before = listed_names(&own, None);
        assert!(before.contains("browser_open"));
        assert!(!before.contains("read_note"));
        let some: BTreeSet<String> = ["read_note".to_owned()].into();
        let after = listed_names(&own, Some(&some));
        assert!(after.contains("read_note"));
        assert!(!after.contains("edit_note"));
    }

    #[test]
    fn emils_defaults_list_all_but_three_kinds() {
        let every: BTreeSet<String> = AGENT_VERBS
            .iter()
            .map(|(one, _)| (*one).to_owned())
            .collect();
        let shown = listed_names(&Grant::own("a".into(), "A"), Some(&every));
        let hidden: BTreeSet<&str> = names()
            .into_iter()
            .filter(|one| !shown.contains(*one))
            .collect();
        assert_eq!(
            hidden,
            BTreeSet::from(["browser_evaluate", "write_setting"])
        );
    }

    #[test]
    fn a_client_not_yet_paired_is_shown_its_status_alone() {
        let names: Vec<&str> = unpaired().iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names, ["agent_status"]);
    }

    #[test]
    fn the_table_stays_small() {
        let mut sizes = BTreeMap::new();
        for tool in table() {
            sizes.insert(tool.name.clone(), tool.listed().to_string().len());
        }
        let total: usize = sizes.values().sum();
        assert!(
            total < 41_700,
            "the tools are {total} characters: {sizes:?}"
        );
        for (name, size) in &sizes {
            assert!(*size < 1_700, "{name} is {size} characters");
        }
    }
}
