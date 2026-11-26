use std::collections::{BTreeSet, HashSet};
use std::fmt::Write as _;

use serde_json::{json, Map, Value};

use crate::proxy::ROUTES;

const PREFIX: &str = "#/components/schemas/";
const WORDING: [&str; 6] = ["description", "title", "summary", "example", "examples", "deprecated"];
pub fn used() -> Vec<(&'static str, &'static str)> {
    let mut all = ROUTES.to_vec();
    all.push(("GET", "/event"));
    all
}
fn shape(path: &str) -> String {
    path.split('/')
        .map(|part| if part.starts_with('{') { "{}" } else { part })
        .collect::<Vec<_>>()
        .join("/")
}
fn answer_of(operation: &Value) -> Value {
    let Some(responses) = operation["responses"].as_object() else {
        return Value::Null;
    };
    let Some((status, answer)) = responses
        .iter()
        .filter(|(code, _)| code.starts_with('2'))
        .min_by_key(|(code, _)| code.as_str())
    else {
        return Value::Null;
    };
    let schema = answer["content"]
        .as_object()
        .and_then(|all| all.values().next())
        .map_or(Value::Null, |one| one["schema"].clone());
    json!({ "status": status, "schema": schema })
}
fn referred(value: &Value, all: &Map<String, Value>, kept: &mut Map<String, Value>) {
    match value {
        Value::Object(fields) => {
            if let Some(name) =
                fields.get("$ref").and_then(Value::as_str).and_then(|one| one.strip_prefix(PREFIX))
            {
                if !kept.contains_key(name) {
                    let schema = all.get(name).cloned().unwrap_or(Value::Null);
                    kept.insert(name.to_owned(), schema.clone());
                    referred(&schema, all, kept);
                }
            }
            fields.values().for_each(|one| referred(one, all, kept));
        }
        Value::Array(items) => items.iter().for_each(|one| referred(one, all, kept)),
        _ => {}
    }
}
pub fn taken(doc: &Value) -> Value {
    let empty = Map::new();
    let paths = doc["paths"].as_object().unwrap_or(&empty);
    let all = doc["components"]["schemas"].as_object().unwrap_or(&empty);
    let mut routes = Map::new();
    for (method, route) in used() {
        let operation = paths
            .iter()
            .find(|(path, _)| shape(path) == shape(route))
            .map(|(_, item)| &item[method.to_ascii_lowercase()])
            .filter(|one| one.is_object());
        let Some(operation) = operation else {
            continue;
        };
        routes.insert(
            format!("{method} {route}"),
            json!({
                "request": operation["requestBody"]["content"]["application/json"]["schema"],
                "answer": answer_of(operation),
            }),
        );
    }
    let mut schemas = Map::new();
    referred(&Value::Object(routes.clone()), all, &mut schemas);
    let schemas: Map<String, Value> =
        schemas.into_iter().collect::<std::collections::BTreeMap<_, _>>().into_iter().collect();
    json!({ "routes": routes, "schemas": schemas })
}
pub fn written(snapshot: &Value) -> String {
    let mut out = String::from("{\n");
    for (at, key) in ["routes", "schemas"].into_iter().enumerate() {
        let _ = writeln!(out, "  \"{key}\": {{");
        let fields = snapshot[key].as_object().cloned().unwrap_or_default();
        let lines: Vec<String> = fields
            .iter()
            .map(|(name, one)| format!("    {}: {one}", Value::String(name.clone())))
            .collect();
        out.push_str(&lines.join(",\n"));
        out.push_str(if at == 0 { "\n  },\n" } else { "\n  }\n" });
    }
    out.push_str("}\n");
    out
}
#[derive(Clone, Copy, PartialEq)]
enum Side {
    Request,
    Answer,
}
struct Check<'a> {
    was: &'a Map<String, Value>,
    now: &'a Map<String, Value>,
    seen: HashSet<(String, String)>,
}
fn named(value: &Value) -> Option<&str> {
    value.get("$ref").and_then(Value::as_str).and_then(|one| one.strip_prefix(PREFIX))
}
fn required(value: &Map<String, Value>) -> BTreeSet<String> {
    value
        .get("required")
        .and_then(Value::as_array)
        .map(|all| all.iter().filter_map(|one| one.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}
impl Check<'_> {
    fn covered(
        &mut self,
        was: &Value,
        now: &Value,
        side: Side,
        at: &str,
        broken: &mut Vec<String>,
    ) {
        if let Some(name) = named(was) {
            let target = self.was.get(name).unwrap_or(&Value::Null);
            let (other, resolved) = match named(now) {
                Some(other) => (other.to_owned(), self.now.get(other).unwrap_or(&Value::Null)),
                None => (String::new(), now),
            };
            if self.seen.insert((name.to_owned(), other)) {
                self.covered(target, resolved, side, &format!("{at}<{name}>"), broken);
            }
            return;
        }
        if let Some(other) = named(now) {
            let resolved = self.now.get(other).unwrap_or(&Value::Null);
            self.covered(was, resolved, side, at, broken);
            return;
        }
        match (was, now) {
            (Value::Object(was), Value::Object(now)) => {
                let (before, after) = (required(was), required(now));
                let lost: Vec<&String> = match side {
                    Side::Answer => before.difference(&after).collect(),
                    Side::Request => after.difference(&before).collect(),
                };
                if !lost.is_empty() {
                    let how =
                        if side == Side::Answer { "no longer required" } else { "newly required" };
                    broken.push(format!("{at}: {lost:?} {how}"));
                }
                for (key, one) in was {
                    if WORDING.contains(&key.as_str()) || key == "required" {
                        continue;
                    }
                    match now.get(key) {
                        Some(other) => {
                            self.covered(one, other, side, &format!("{at}.{key}"), broken);
                        }
                        None => broken.push(format!("{at}.{key} is gone")),
                    }
                }
            }
            (Value::Array(was), Value::Array(now)) => {
                for one in was {
                    let mut first: Vec<&Value> = now
                        .iter()
                        .filter(|other| named(other).is_some() && named(other) == named(one))
                        .collect();
                    first.extend(
                        now.iter()
                            .filter(|other| named(other).is_none() || named(other) != named(one)),
                    );
                    if !first.into_iter().any(|other| self.fits(one, other, side)) {
                        let short: String = one.to_string().chars().take(120).collect();
                        broken.push(format!("{at}: nothing matches {short}"));
                    }
                }
            }
            (was, now) if was == now => {}
            (was, now) => {
                let (was, now): (String, String) = (
                    was.to_string().chars().take(120).collect(),
                    now.to_string().chars().take(120).collect(),
                );
                broken.push(format!("{at}: was {was}, now {now}"));
            }
        }
    }
    fn fits(&mut self, was: &Value, now: &Value, side: Side) -> bool {
        let seen = self.seen.clone();
        let mut broken = Vec::new();
        self.covered(was, now, side, "", &mut broken);
        if !broken.is_empty() {
            self.seen = seen;
        }
        broken.is_empty()
    }
}
pub fn broken(was: &Value, now: &Value) -> Vec<String> {
    let empty = Map::new();
    let mut check = Check {
        was: was["schemas"].as_object().unwrap_or(&empty),
        now: now["schemas"].as_object().unwrap_or(&empty),
        seen: HashSet::new(),
    };
    let mut broken = Vec::new();
    for (route, before) in was["routes"].as_object().unwrap_or(&empty) {
        let Some(after) = now["routes"].get(route) else {
            broken.push(format!("{route} is gone"));
            continue;
        };
        check.covered(
            &before["request"],
            &after["request"],
            Side::Request,
            &format!("{route} request"),
            &mut broken,
        );
        check.covered(
            &before["answer"],
            &after["answer"],
            Side::Answer,
            &format!("{route} answer"),
            &mut broken,
        );
    }
    broken
}
#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(request: Value, answer: Value, schemas: Value) -> Value {
        json!({ "routes": { "POST /session": { "request": request, "answer": answer } }, "schemas": schemas })
    }
    #[test]
    fn an_added_field_passes_and_a_removed_or_changed_one_fails() {
        let session = json!({ "type": "object", "properties": { "id": { "type": "string" }, "title": { "type": "string" } }, "required": ["id", "title"] });
        let request = json!({ "type": "object", "properties": { "title": { "type": "string" }, "reply": { "enum": ["once", "always", "reject"] } } });
        let answer =
            json!({ "status": "200", "schema": { "$ref": "#/components/schemas/Session" } });
        let was = snapshot(request.clone(), answer.clone(), json!({ "Session": session }));
        assert_eq!(broken(&was, &was), Vec::<String>::new());
        let mut grown = was.clone();
        grown["schemas"]["Session"]["properties"]["slug"] = json!({ "type": "string" });
        grown["schemas"]["Session"]["required"] = json!(["id", "title", "slug"]);
        grown["routes"]["POST /session"]["request"]["properties"]["reply"]["enum"] =
            json!(["once", "always", "reject", "later"]);
        grown["routes"]["POST /session"]["request"]["properties"]["parentID"] =
            json!({ "type": "string" });
        grown["schemas"]["Session"]["description"] = json!("reworded");
        assert_eq!(broken(&was, &grown), Vec::<String>::new());
        let mut renamed = was.clone();
        renamed["schemas"]["Session"]["properties"].as_object_mut().expect("props").remove("title");
        renamed["schemas"]["Session"]["required"] = json!(["id"]);
        let said = broken(&was, &renamed);
        assert!(said.iter().any(|one| one.contains("title")), "{said:?}");
        let mut retyped = was.clone();
        retyped["schemas"]["Session"]["properties"]["id"]["type"] = json!("number");
        assert!(!broken(&was, &retyped).is_empty());
        let mut narrowed = was.clone();
        narrowed["routes"]["POST /session"]["request"]["properties"]["reply"]["enum"] =
            json!(["once", "reject"]);
        assert!(!broken(&was, &narrowed).is_empty());
        let mut demanding = was.clone();
        demanding["routes"]["POST /session"]["request"]["required"] = json!(["title"]);
        assert!(broken(&was, &demanding).iter().any(|one| one.contains("newly required")));
        let mut moved = was.clone();
        moved["routes"]["POST /session"]["answer"]["status"] = json!("204");
        assert!(!broken(&was, &moved).is_empty());
        let gone = json!({ "routes": {}, "schemas": {} });
        assert_eq!(broken(&was, &gone), vec!["POST /session is gone".to_owned()]);
    }
    #[test]
    fn a_union_and_a_cycle_are_followed_by_name() {
        let schemas = json!({
            "Event": { "anyOf": [{ "$ref": "#/components/schemas/A" }, { "$ref": "#/components/schemas/B" }] },
            "A": { "type": "object", "properties": { "type": { "const": "a" }, "next": { "$ref": "#/components/schemas/A" } } },
            "B": { "type": "object", "properties": { "type": { "const": "b" } } },
        });
        let answer = json!({ "status": "200", "schema": { "$ref": "#/components/schemas/Event" } });
        let was = snapshot(Value::Null, answer.clone(), schemas.clone());
        let mut grown = was.clone();
        grown["schemas"]["Event"]["anyOf"] = json!([{ "$ref": "#/components/schemas/C" }, { "$ref": "#/components/schemas/B" }, { "$ref": "#/components/schemas/A" }]);
        grown["schemas"]["C"] =
            json!({ "type": "object", "properties": { "type": { "const": "c" } } });
        assert_eq!(broken(&was, &grown), Vec::<String>::new());
        let mut lost = was.clone();
        lost["schemas"]["Event"]["anyOf"] = json!([{ "$ref": "#/components/schemas/B" }]);
        assert!(!broken(&was, &lost).is_empty());
    }
    #[test]
    fn the_snapshot_is_taken_from_the_doc_by_route_shape_with_what_it_refers_to() {
        let doc = json!({
            "paths": {
                "/session/{sessionID}": { "get": { "responses": {
                    "404": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/NotFound" } } } },
                    "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Session" } } } },
                } } },
                "/session/{sessionID}/abort": { "post": { "responses": { "204": { "description": "ok" } } } },
            },
            "components": { "schemas": {
                "Session": { "type": "object", "properties": { "time": { "$ref": "#/components/schemas/Time" } } },
                "Time": { "type": "number" },
                "NotFound": { "type": "object" },
                "Unused": { "type": "object" },
            } },
        });
        let taken = taken(&doc);
        assert_eq!(taken["routes"]["GET /session/{id}"]["answer"]["status"], "200");
        assert_eq!(
            taken["routes"]["POST /session/{id}/abort"]["answer"],
            json!({ "status": "204", "schema": null })
        );
        let names: Vec<&String> = taken["schemas"].as_object().expect("schemas").keys().collect();
        assert_eq!(names, ["Session", "Time"]);
        let again: Value = serde_json::from_str(&written(&taken)).expect("json");
        assert_eq!(again, taken);
    }
}
