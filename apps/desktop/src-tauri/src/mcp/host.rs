use std::collections::BTreeSet;

use serde_json::Value;

use super::results::{rendered as written, Outcome, META};
use super::server::{defaults, INSTRUCTIONS};
use super::tools::{self, Tool};
use crate::agents::grants::Grant;

pub(crate) fn instructions() -> &'static str {
    INSTRUCTIONS
}

pub(crate) fn listed(grant: &Grant, window: Option<&BTreeSet<String>>) -> Vec<&'static Tool> {
    tools::listed(grant, window)
}

pub(crate) fn shown(tool: &Tool) -> Value {
    tool.listed()
}

pub(crate) fn reads_only(tool: &Tool) -> bool {
    tool.annotations
        .as_ref()
        .and_then(|one| one.get("readOnlyHint"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(crate) fn with_defaults(tool: &str, args: Value) -> Value {
    defaults(tool, args)
}

pub(crate) fn rendered(tool: &str, args: &Value, status: u16, body: &str) -> Value {
    let said = serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_owned()));
    written(tool, args, &Outcome::from_endpoint(status, &said))
}

pub(crate) fn categorized(
    rendered: &mut Value,
    category_of: impl Fn(&str) -> Option<(crate::agents::verbs::Category, Option<String>)>,
) {
    let Some(said) = rendered
        .pointer_mut("/_meta")
        .and_then(|meta| meta.get_mut(META))
    else {
        return;
    };
    if said["status"] != "needs_approval" {
        return;
    }
    let Some(question) = said["approval"].as_str().and_then(category_of) else {
        return;
    };
    said["category"] = serde_json::json!(question.0);
    if let Some(site) = question.1 {
        said["site"] = serde_json::json!(site);
    }
}

#[cfg(test)]
mod category_tests {
    use super::*;
    use crate::agents::verbs::Category;
    use serde_json::json;

    #[test]
    fn a_question_says_what_it_is_about_to_the_window() {
        let mut asked =
            json!({ "_meta": { META: { "status": "needs_approval", "approval": "a1" } } });
        categorized(&mut asked, |_| {
            Some((Category::Writing, Some("shop.example".to_owned())))
        });
        assert_eq!(asked["_meta"][META]["category"], "writing");
        assert_eq!(asked["_meta"][META]["site"], "shop.example");

        let mut done = json!({ "_meta": { META: { "status": "ok" } } });
        categorized(&mut done, |_| Some((Category::Terminal, None)));
        assert!(done["_meta"][META].get("category").is_none());
    }
}
