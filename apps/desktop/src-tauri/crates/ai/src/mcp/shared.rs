use serde_json::Value;

pub const SHARED: [&str; 6] = [
    "list_spaces",
    "list_notes",
    "read_note",
    "search_notes",
    "list_backlinks",
    "write_note",
];

pub fn text(tool: &str, args: &Value, result: &Value) -> Option<String> {
    if !SHARED.contains(&tool) {
        return None;
    }
    if let Some(said) = result.as_str() {
        return Some(said.to_owned());
    }
    let path = || words(args, "path");
    Some(match tool {
        "list_spaces" => lines(result, |row| field(row, "name"), "No spaces yet."),
        "list_notes" => lines(result, |row| field(row, "path"), "No notes yet."),
        "read_note" if args.get("include").is_none() => words(result, "text"),
        "search_notes" => lines(
            result,
            |row| {
                let at = field(row, "path")?;
                let said = words(row, "text");
                let said = said.trim();
                Some(match row.get("space").and_then(Value::as_str) {
                    Some(space) => format!("{space}/{at}: {said}"),
                    None => format!("{at}: {said}"),
                })
            },
            "Nothing found.",
        ),
        "list_backlinks" => lines(
            result,
            |row| {
                let at = field(row, "path")?;
                Some(match row.get("line").and_then(Value::as_u64) {
                    Some(line) => format!("{at}:{line}"),
                    None => at,
                })
            },
            &format!("Nothing links to {}.", path()),
        ),
        "write_note" => {
            let saved = result
                .get("path")
                .and_then(Value::as_str)
                .map_or_else(path, str::to_owned);
            format!("Saved {saved}.")
        }
        _ => return None,
    })
}

fn lines(result: &Value, row: impl Fn(&Value) -> Option<String>, none: &str) -> String {
    let rows: Vec<String> = result
        .as_array()
        .map(|all| all.iter().filter_map(row).collect())
        .unwrap_or_default();
    if rows.is_empty() {
        none.to_owned()
    } else {
        rows.join("\n")
    }
}

fn field(row: &Value, key: &str) -> Option<String> {
    row.as_str()
        .or_else(|| row.get(key).and_then(Value::as_str))
        .map(str::to_owned)
}

fn words(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_six_answer_in_the_connectors_words() {
        assert_eq!(
            text(
                "list_spaces",
                &json!({}),
                &json!([{ "name": "Work" }, "Home"])
            )
            .as_deref(),
            Some("Work\nHome")
        );
        assert_eq!(
            text("list_spaces", &json!({}), &json!([])).as_deref(),
            Some("No spaces yet.")
        );
        assert_eq!(
            text(
                "list_notes",
                &json!({ "space": "Work" }),
                &json!(["plan.md", { "path": "a/b.md" }])
            )
            .as_deref(),
            Some("plan.md\na/b.md")
        );
        assert_eq!(
            text("list_notes", &json!({}), &json!([])).as_deref(),
            Some("No notes yet.")
        );
        assert_eq!(
            text(
                "read_note",
                &json!({ "path": "plan.md" }),
                &json!({ "path": "plan.md", "rev": "r1", "text": "# Plan\n\nShip the thing.\n" })
            )
            .as_deref(),
            Some("# Plan\n\nShip the thing.\n")
        );
        assert_eq!(
            text(
                "search_notes",
                &json!({ "query": "ship" }),
                &json!([{ "space": "Work", "path": "plan.md", "text": "  Ship the thing. " }])
            )
            .as_deref(),
            Some("Work/plan.md: Ship the thing.")
        );
        assert_eq!(
            text("search_notes", &json!({ "query": "x" }), &json!([])).as_deref(),
            Some("Nothing found.")
        );
        assert_eq!(
            text(
                "list_backlinks",
                &json!({ "path": "plan.md" }),
                &json!([{ "path": "notes/b.md", "line": 3 }])
            )
            .as_deref(),
            Some("notes/b.md:3")
        );
        assert_eq!(
            text("list_backlinks", &json!({ "path": "plan.md" }), &json!([])).as_deref(),
            Some("Nothing links to plan.md.")
        );
        assert_eq!(
            text(
                "write_note",
                &json!({ "path": "plan.md", "content": "x" }),
                &json!({ "path": "plan.md", "rev": "r2", "edits": 1, "lines": [0] })
            )
            .as_deref(),
            Some("Saved plan.md.")
        );
    }

    #[test]
    fn a_read_that_asked_for_more_is_the_whole_answer() {
        let asked = json!({ "path": "plan.md", "include": ["outline"] });
        assert_eq!(text("read_note", &asked, &json!({ "text": "x" })), None);
    }

    #[test]
    fn a_window_that_says_the_text_itself_is_heard_as_it_is() {
        assert_eq!(
            text("list_spaces", &json!({}), &json!("Work\nHome")).as_deref(),
            Some("Work\nHome")
        );
    }

    #[test]
    fn any_other_tool_is_not_the_connectors() {
        assert_eq!(text("edit_note", &json!({}), &json!({})), None);
    }
}
