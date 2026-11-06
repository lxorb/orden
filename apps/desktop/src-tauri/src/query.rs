use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Line,
    Block,
    Section,
    Task,
    #[serde(rename = "task-todo")]
    TaskTodo,
    #[serde(rename = "task-done")]
    TaskDone,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Compare {
    #[default]
    Has,
    Is,
    Null,
    Lt,
    Lte,
    Gt,
    Gte,
    Range,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Query {
    All {
        of: Vec<Query>,
    },
    Any {
        of: Vec<Query>,
    },
    Not {
        of: Box<Query>,
    },
    Text {
        text: String,
        fold: bool,
    },
    Content {
        text: String,
        fold: bool,
    },
    Regex {
        source: String,
        fold: bool,
    },
    Path {
        text: String,
        fold: bool,
    },
    File {
        text: String,
        fold: bool,
    },
    Tag {
        tag: String,
    },
    Property {
        name: String,
        value: Option<String>,
        #[serde(default)]
        compare: Compare,
        #[serde(default)]
        upto: Option<String>,
    },
    Scope {
        unit: Unit,
        of: Box<Query>,
    },
}
