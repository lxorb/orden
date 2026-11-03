//! The same server, hosted inside the app for the AI sidebar's own agent (`ai_agent.rs`):
//! the tool table, the instructions every outside agent's model is given, and a result
//! written the way `nib mcp` writes it, marks included. Nothing of the protocol: the
//! sidebar's loop is in the window, and the call is the endpoint's own dispatch.

use std::collections::BTreeSet;

use serde_json::Value;

use super::results::{rendered as written, Outcome, META};
use super::server::{defaults, INSTRUCTIONS};
use super::tools::{self, Tool};
use crate::agents::grants::Grant;

/// What every client puts before its model.
pub(crate) fn instructions() -> &'static str {
    INSTRUCTIONS
}

/// The tools a grant reaches, of the window's verbs only those the window answers.
pub(crate) fn listed(grant: &Grant, window: Option<&BTreeSet<String>>) -> Vec<&'static Tool> {
    tools::listed(grant, window)
}

/// A tool as `tools/list` writes it.
pub(crate) fn shown(tool: &Tool) -> Value {
    tool.listed()
}

/// Whether a tool only reads: its own `readOnlyHint`, the line Ask mode is drawn at.
pub(crate) fn reads_only(tool: &Tool) -> bool {
    tool.annotations
        .as_ref()
        .and_then(|one| one.get("readOnlyHint"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// A call's arguments with what a model is spared filled in, as `nib mcp` fills them.
pub(crate) fn with_defaults(tool: &str, args: Value) -> Value {
    defaults(tool, args)
}

/// The endpoint's answer to a call, written for a model.
pub(crate) fn rendered(tool: &str, args: &Value, status: u16, body: &str) -> Value {
    let said = serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_owned()));
    written(tool, args, &Outcome::from_endpoint(status, &said))
}

/// A question's category beside its id in what the window reads, for its Always, which
/// covers everyday questions and never paying or the terminal (ai/chat/approvals.ts). The
/// window's alone: the answer an outside agent reads keeps 9.3's shape.
pub(crate) fn categorized(
    rendered: &mut Value,
    category_of: impl Fn(&str) -> Option<crate::agents::verbs::Category>,
) {
    let Some(said) = rendered.pointer_mut("/_meta").and_then(|meta| meta.get_mut(META)) else {
        return;
    };
    if said["status"] != "needs_approval" {
        return;
    }
    if let Some(category) = said["approval"].as_str().and_then(category_of) {
        said["category"] = serde_json::json!(category);
    }
}

#[cfg(test)]
mod category_tests {
    use super::*;
    use crate::agents::verbs::Category;
    use serde_json::json;

    #[test]
    fn a_question_says_what_it_is_about_to_the_window() {
        let mut asked = json!({ "_meta": { META: { "status": "needs_approval", "approval": "a1" } } });
        categorized(&mut asked, |_| Some(Category::Terminal));
        assert_eq!(asked["_meta"][META]["category"], "terminal");

        let mut done = json!({ "_meta": { META: { "status": "ok" } } });
        categorized(&mut done, |_| Some(Category::Terminal));
        assert!(done["_meta"][META].get("category").is_none());
    }
}
