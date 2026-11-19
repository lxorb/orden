#![cfg(not(any(target_os = "android", target_os = "ios")))]
use std::collections::BTreeMap;
use std::io::{BufRead as _, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use orden_mcp_client::exposed::exposed;
use orden_mcp_client::import::{self, Shape};
use orden_mcp_client::kept;
use orden_mcp_client::{
    Client, Heard, Host, Hub, Permission, Pick, Secrets, Server, ServerView, State, Transport,
    PROTOCOL,
};
use serde_json::{json, Value};

fn fake() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fake-server.mjs")
        .to_string_lossy()
        .into_owned()
}
fn stdio(env: &[&str]) -> Transport {
    Transport::Stdio {
        command: "node".to_owned(),
        args: vec![fake()],
        cwd: None,
        env: env.iter().map(|one| (*one).to_owned()).collect(),
    }
}
fn with_env(pairs: &[(&str, &str)]) -> Secrets {
    Secrets {
        env: pairs.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())).collect(),
        headers: BTreeMap::new(),
    }
}
fn with_headers(pairs: &[(&str, &str)]) -> Secrets {
    Secrets {
        env: BTreeMap::new(),
        headers: pairs
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect(),
    }
}
fn connected(transport: &Transport, secrets: &Secrets) -> (Client, mpsc::Receiver<Heard>) {
    let (heard, hearing) = mpsc::channel();
    let client = Client::connect(transport, secrets, move |one| {
        let _ = heard.send(one);
    })
    .expect("the fake server connects");
    (client, hearing)
}
fn said(result: &Value) -> &str {
    result["content"][0]["text"].as_str().unwrap_or_default()
}
fn names(tools: &[Value]) -> Vec<&str> {
    tools.iter().filter_map(|tool| tool["name"].as_str()).collect()
}
const LONG: Duration = Duration::from_secs(20);
fn call(client: &Client, tool: &str, args: Value) -> Value {
    client.call(tool, args, LONG).expect("an answer")
}
#[test]
fn a_stdio_server_lists_every_page_of_tools_and_answers_calls_with_the_secret_env() {
    let (client, _heard) =
        connected(&stdio(&["FAKE_SECRET"]), &with_env(&[("FAKE_SECRET", "hunter22")]));
    assert_eq!(client.protocol(), PROTOCOL);
    let tools = client.tools().expect("tools");
    assert_eq!(
        names(&tools),
        ["echo", "add", "shout", "slow", "crash", "grow", "family", "whoami"]
    );
    let added = call(&client, "add", json!({ "a": 2, "b": 3 }));
    assert_eq!(said(&added), "5");
    assert_eq!(added["structuredContent"]["sum"], 5);
    assert_eq!(said(&call(&client, "whoami", json!({}))), "hunter22");
    assert_eq!(call(&client, "nothing", json!({}))["isError"], true);
}
#[test]
fn an_older_protocol_the_server_speaks_is_taken() {
    let (client, _heard) =
        connected(&stdio(&["FAKE_PROTOCOL"]), &with_env(&[("FAKE_PROTOCOL", "2024-11-05")]));
    assert_eq!(client.protocol(), "2024-11-05");
    assert_eq!(said(&call(&client, "echo", json!({ "text": "hi" }))), "hi");
}
#[test]
fn a_changed_tool_list_is_heard_and_listed_again() {
    let (client, heard) = connected(&stdio(&[]), &Secrets::default());
    call(&client, "grow", json!({}));
    assert_eq!(heard.recv_timeout(LONG), Ok(Heard::ToolsChanged));
    assert!(names(&client.tools().expect("tools")).contains(&"extra"));
}
#[test]
fn a_call_that_takes_too_long_gives_up_and_the_server_still_answers() {
    let (client, _heard) = connected(&stdio(&[]), &Secrets::default());
    let late = client.call("slow", json!({ "ms": 3000 }), Duration::from_millis(300));
    assert!(late.expect_err("too late").contains("no answer"));
    assert_eq!(said(&call(&client, "echo", json!({ "text": "still" }))), "still");
}
#[test]
fn a_server_that_falls_over_says_why() {
    let (client, heard) = connected(&stdio(&[]), &Secrets::default());
    let _ = client.call("crash", json!({}), LONG);
    let Ok(Heard::Ended(why)) = heard.recv_timeout(LONG) else {
        panic!("the end was not heard");
    };
    assert!(why.contains("exit code 3"), "{why}");
    assert!(why.contains("boom: the fake server fell over"), "{why}");
    assert!(client.call("echo", json!({}), LONG).is_err());
}
fn alive(pid: &str) -> bool {
    if cfg!(windows) {
        let listed =
            Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output();
        return listed.is_ok_and(|out| String::from_utf8_lossy(&out.stdout).contains(pid));
    }
    let listed = Command::new("ps").args(["-o", "stat=", "-p", pid]).output();
    listed.is_ok_and(|out| {
        let state = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        !state.is_empty() && !state.starts_with('Z')
    })
}
#[test]
fn ending_a_server_ends_what_it_started_too() {
    let (client, _heard) = connected(&stdio(&[]), &Secrets::default());
    let pid = said(&call(&client, "family", json!({}))).to_owned();
    assert!(alive(&pid), "the child {pid} did not start");
    drop(client);
    let started = Instant::now();
    while alive(&pid) && started.elapsed() < LONG {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(!alive(&pid), "the child {pid} outlived its server");
}
struct Served(Child, u16);
impl Drop for Served {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn served(how: &str) -> Served {
    let node = orden_base::program::which("node").expect("node");
    let mut child = Command::new(node)
        .args([fake(), how.to_owned(), "0".to_owned()])
        .stdout(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .expect("the fake web server");
    let mut line = String::new();
    BufReader::new(child.stdout.take().expect("its output")).read_line(&mut line).expect("a line");
    let port =
        line.trim().strip_prefix("listening ").and_then(|port| port.parse().ok()).expect("a port");
    Served(child, port)
}
fn web(port: u16, path: &str) -> Transport {
    Transport::Http {
        url: format!("http://127.0.0.1:{port}{path}"),
        headers: vec!["x-fake-secret".to_owned()],
    }
}
fn answers_over_the_web(how: &str, path: &str) {
    let server = served(how);
    let (client, heard) =
        connected(&web(server.1, path), &with_headers(&[("x-fake-secret", "tok-123")]));
    assert_eq!(names(&client.tools().expect("tools")).len(), 7);
    assert_eq!(said(&call(&client, "add", json!({ "a": 2, "b": 3 }))), "5");
    assert_eq!(said(&call(&client, "whoami", json!({}))), "tok-123");
    call(&client, "grow", json!({}));
    assert_eq!(heard.recv_timeout(LONG), Ok(Heard::ToolsChanged));
    assert!(names(&client.tools().expect("tools")).contains(&"extra"));
}
#[test]
fn streamable_http_answers_with_json_and_its_session() {
    answers_over_the_web("--http", "/mcp");
}
#[test]
fn streamable_http_answers_with_events() {
    answers_over_the_web("--http-sse", "/mcp");
}
#[test]
fn a_server_that_refuses_the_post_is_spoken_to_over_the_old_sse_transport() {
    answers_over_the_web("--legacy", "/sse");
}
#[test]
fn a_web_server_that_is_not_there_says_so() {
    let refused = Client::connect(&web(9, "/mcp"), &Secrets::default(), |_| {});
    assert!(refused.is_err());
}
#[derive(Default)]
struct Shared {
    secrets: Mutex<BTreeMap<String, String>>,
    said: Mutex<Vec<(String, State)>>,
}
struct Fake(PathBuf, Arc<Shared>);
impl Host for Fake {
    fn file(&self) -> Result<PathBuf, String> {
        Ok(self.0.clone())
    }
    fn secret(&self, name: &str) -> Result<Option<String>, String> {
        Ok(self.1.secrets.lock().expect("secrets").get(name).cloned())
    }
    fn keep(&self, name: &str, secret: Option<&str>) -> Result<(), String> {
        let mut secrets = self.1.secrets.lock().expect("secrets");
        match secret {
            Some(secret) => secrets.insert(name.to_owned(), secret.to_owned()),
            None => secrets.remove(name),
        };
        Ok(())
    }
    fn said(&self, id: &str, state: State) {
        self.1.said.lock().expect("said").push((id.to_owned(), state));
    }
}
fn hub() -> (Arc<Hub>, Arc<Shared>, PathBuf, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("a folder");
    let file = dir.path().join(kept::FILE);
    let shared = Arc::new(Shared::default());
    (Hub::new(Fake(file.clone(), Arc::clone(&shared))), shared, file, dir)
}
fn new_server(name: &str, transport: Transport) -> Server {
    Server {
        id: String::new(),
        name: name.to_owned(),
        on: true,
        transport,
        tools: BTreeMap::new(),
        from: None,
    }
}
#[test]
fn a_saved_server_keeps_its_secret_apart_starts_and_offers_its_tools() {
    let (hub, shared, file, _dir) = hub();
    let saved = hub
        .save(
            new_server("Fake Tools!", stdio(&["FAKE_SECRET"])),
            Some(with_env(&[("FAKE_SECRET", "s3cret-value")])),
        )
        .expect("saved");
    assert_eq!(saved.server.id, "fake-tools");
    assert_eq!(hub.wait("fake-tools", LONG), State::Ready);
    let kept = std::fs::read_to_string(&file).expect("the list");
    assert!(!kept.contains("s3cret-value"));
    assert!(shared.secrets.lock().expect("secrets")["mcp-fake-tools"].contains("s3cret-value"));
    let view = hub.views().expect("views").remove(0);
    assert_eq!(view.state, State::Ready);
    assert_eq!(view.secrets_set, ["FAKE_SECRET"]);
    let permission =
        |name: &str| view.listed.iter().find(|tool| tool.name == name).map(|tool| tool.permission);
    assert_eq!(permission("echo"), Some(Permission::Allow));
    assert_eq!(permission("shout"), Some(Permission::Ask));
    assert!(!serde_json::to_string(&view).expect("json").contains("s3cret-value"));
    hub.permission("fake-tools", "shout", Permission::Off).expect("set");
    let offered = hub.offered();
    let exposed: Vec<&str> = offered.iter().map(|one| one.exposed.as_str()).collect();
    assert!(exposed.contains(&"mcp__fake-tools__echo"));
    assert!(!exposed.contains(&"mcp__fake-tools__shout"));
    let add = hub.find("mcp__fake-tools__add").expect("add is offered");
    assert_eq!((add.server.as_str(), add.server_name.as_str()), ("fake-tools", "Fake Tools!"));
    assert!(!add.tool.read_only);
    let added = hub.call("fake-tools", "add", json!({ "a": 1, "b": 2 })).expect("added");
    assert_eq!(said(&added), "3");
    assert!(hub.call("fake-tools", "shout", json!({ "text": "x" })).is_err());
    let heard = shared.said.lock().expect("said").clone();
    assert!(heard.contains(&("fake-tools".to_owned(), State::Starting)));
    assert!(heard.contains(&("fake-tools".to_owned(), State::Ready)));
    hub.stop_all();
}
#[test]
fn a_view_has_each_key_once_and_its_permissions_come_back_whole() {
    let (hub, _shared, _file, _dir) = hub();
    let mut server = new_server("Off one", stdio(&[]));
    server.on = false;
    server.tools.insert("shout".to_owned(), Permission::Off);
    server.tools.insert("echo".to_owned(), Permission::Ask);
    let view = hub.save(server, None).expect("saved");
    let text = serde_json::to_string(&view).expect("json");
    let mut keys: Vec<String> = serde_json::from_str::<serde_json::Map<String, Value>>(&text)
        .expect("an object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    let mut expected = [
        "id",
        "name",
        "on",
        "transport",
        "tools",
        "from",
        "state",
        "error",
        "listed",
        "secretsSet",
    ]
    .map(str::to_owned);
    expected.sort();
    assert_eq!(keys, expected);
    for key in &expected {
        assert_eq!(text.matches(&format!("\"{key}\":")).count(), 1, "{key} in {text}");
    }
    let back: ServerView = serde_json::from_str(&text).expect("read back");
    assert_eq!(back.server.tools, view.server.tools);
    let saved = hub.save(back.server, None).expect("saved again");
    assert_eq!(saved.server.tools.get("shout"), Some(&Permission::Off));
    assert_eq!(saved.server.tools.get("echo"), Some(&Permission::Ask));
}
#[test]
fn secrets_given_are_merged_and_names_no_longer_used_are_dropped() {
    let (hub, shared, _file, _dir) = hub();
    let mut server = new_server("Merge", stdio(&["A", "B"]));
    server.on = false;
    let view = hub.save(server, Some(with_env(&[("A", "one"), ("B", "two")]))).expect("saved");
    let stored = || -> Secrets {
        serde_json::from_str(&shared.secrets.lock().expect("secrets")["mcp-merge"]).expect("stored")
    };
    let view = hub.save(view.server, None).expect("kept");
    assert_eq!(stored().env, with_env(&[("A", "one"), ("B", "two")]).env);
    let view = hub.save(view.server, Some(with_env(&[("B", "three")]))).expect("merged");
    assert_eq!(stored().env, with_env(&[("A", "one"), ("B", "three")]).env);
    let mut server = view.server;
    server.transport = stdio(&["B", "C"]);
    let view = hub.save(server, Some(with_env(&[("C", "four")]))).expect("renamed");
    assert_eq!(stored().env, with_env(&[("B", "three"), ("C", "four")]).env);
    assert_eq!(view.secrets_set, ["B", "C"]);
    let mut server = view.server;
    server.transport = stdio(&[]);
    hub.save(server, None).expect("emptied");
    assert!(!shared.secrets.lock().expect("secrets").contains_key("mcp-merge"));
}
#[test]
fn a_server_that_falls_over_is_started_again() {
    let (hub, shared, _file, _dir) = hub();
    hub.save(new_server("Crashy", stdio(&[])), None).expect("saved");
    assert_eq!(hub.wait("crashy", LONG), State::Ready);
    let _ = hub.call("crashy", "crash", json!({}));
    let readies =
        || shared.said.lock().expect("said").iter().filter(|one| one.1 == State::Ready).count();
    let started = Instant::now();
    while readies() < 2 && started.elapsed() < LONG {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(readies(), 2);
    assert_eq!(said(&hub.call("crashy", "echo", json!({ "text": "back" })).expect("echo")), "back");
    hub.stop_all();
}
#[test]
fn switching_off_stops_and_removing_forgets_the_secret() {
    let (hub, shared, _file, _dir) = hub();
    hub.save(new_server("Gone", stdio(&["X"])), Some(with_env(&[("X", "y-value")])))
        .expect("saved");
    assert_eq!(hub.wait("gone", LONG), State::Ready);
    assert_eq!(hub.switch("gone", false).expect("off").state, State::Off);
    assert!(hub.offered().is_empty());
    assert!(hub.call("gone", "echo", json!({})).is_err());
    hub.remove("gone").expect("removed");
    assert!(hub.views().expect("views").is_empty());
    assert!(shared.secrets.lock().expect("secrets").is_empty());
}
#[test]
fn a_restart_waits_for_the_server_and_a_failure_hides_the_secret() {
    let (hub, _shared, _file, _dir) = hub();
    let missing = Transport::Stdio {
        command: "orden-no-such-program".to_owned(),
        args: Vec::new(),
        cwd: None,
        env: Vec::new(),
    };
    hub.save(new_server("Missing", missing), None).expect("saved");
    let view = hub.restart("missing").expect("restarted");
    assert_eq!(view.state, State::Failed);
    assert!(view.error.unwrap_or_default().contains("was not found"));
    let leaky = Transport::Stdio {
        command: "node".to_owned(),
        args: vec![
            "-e".to_owned(),
            "console.error('key ' + process.env.LEAK); process.exit(1)".to_owned(),
        ],
        cwd: None,
        env: vec!["LEAK".to_owned()],
    };
    hub.save(new_server("Leaky", leaky), Some(with_env(&[("LEAK", "leaky-value-1")])))
        .expect("saved");
    let view = hub.restart("leaky").expect("restarted");
    assert_eq!(view.state, State::Failed);
    let error = view.error.unwrap_or_default();
    assert!(!error.contains("leaky-value-1"), "{error}");
    assert!(error.contains("[hidden]"), "{error}");
}
#[test]
fn exposed_names_are_safe_short_and_told_apart() {
    assert_eq!(exposed("fake", "echo"), "mcp__fake__echo");
    assert_eq!(exposed("a", "b.c d/é"), "mcp__a__b_c_d__");
    let long = "t".repeat(80);
    let one = exposed("server", &format!("{long}1"));
    let two = exposed("server", &format!("{long}2"));
    assert_eq!(one.len(), 64);
    assert_ne!(one, two);
    assert_eq!(one, exposed("server", &format!("{long}1")));
    assert!(one.chars().all(|one| one.is_ascii_alphanumeric() || one == '_' || one == '-'));
}
#[test]
fn ids_come_from_names_and_stay_apart() {
    assert_eq!(kept::new_id("My Server!", |_| false), "my-server");
    assert_eq!(kept::new_id("My Server", |id| id == "my-server"), "my-server-2");
    assert_eq!(kept::new_id("...", |_| false), "server");
    let long = kept::new_id(&"abc ".repeat(20), |id| id == "abc-abc-abc-abc-abc-abc");
    assert!(long.len() <= 24 && long.ends_with("-2"), "{long}");
    assert!(kept::valid_id(&long));
    assert_eq!(kept::new_id("Orden", |_| false), "orden-2");
    assert_eq!(kept::new_id("nib", |_| false), "nib-2");
    assert!(!kept::valid_id("orden") && !kept::valid_id("nib"));
}
#[test]
fn a_server_never_takes_the_id_orden_s_own_tools_go_by() {
    let (hub, _shared, _file, _dir) = hub();
    let mut server = new_server("Orden", stdio(&[]));
    server.on = false;
    assert_eq!(hub.save(server.clone(), None).expect("saved").server.id, "orden-2");
    server.id = "nib".to_owned();
    assert!(hub.save(server, None).is_err());
    let imported = new_server(
        "orden",
        Transport::Http { url: "http://127.0.0.1:9/mcp".to_owned(), headers: Vec::new() },
    );
    assert_ne!(hub.save(imported, None).expect("saved").server.id, "orden");
    hub.stop_all();
}
fn fixture(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(name),
    )
    .expect("a fixture")
}
fn no_env(_: &str) -> Option<String> {
    None
}
fn parsed(shape: Shape, name: &str) -> Vec<import::Entry> {
    import::entries(shape, &fixture(name), &no_env).expect("parsed")
}
fn entry<'a>(all: &'a [import::Entry], name: &str) -> &'a import::Entry {
    all.iter().find(|one| one.server.name == name).expect(name)
}
fn stdio_of(entry: &import::Entry) -> (&str, &[String], Option<&str>, &[String]) {
    match &entry.server.transport {
        Transport::Stdio { command, args, cwd, env } => (command, args, cwd.as_deref(), env),
        Transport::Http { .. } => panic!("{} is not stdio", entry.server.name),
    }
}
fn url_of(entry: &import::Entry) -> (&str, &[String]) {
    match &entry.server.transport {
        Transport::Http { url, headers } => (url, headers),
        Transport::Stdio { .. } => panic!("{} is not http", entry.server.name),
    }
}
#[test]
fn claude_desktop_servers_are_read_and_orden_itself_is_marked() {
    let all = parsed(Shape::McpServers, "claude-desktop.json");
    assert_eq!(all.len(), 2);
    let (command, args, _, _) = stdio_of(entry(&all, "filesystem"));
    assert_eq!((command, args.len()), ("npx", 3));
    assert!(entry(&all, "orden").server.orden);
    assert!(!entry(&all, "filesystem").server.orden);
}
#[test]
fn claude_code_user_servers_are_read_with_their_values_kept_apart() {
    let all = parsed(Shape::McpServers, "claude-code.json");
    assert_eq!(all.len(), 4);
    let github = entry(&all, "github");
    assert_eq!(
        url_of(github),
        ("https://api.githubcopilot.com/mcp/", &["Authorization".to_owned()][..])
    );
    assert_eq!(github.values.headers["Authorization"], "Bearer ghp_example");
    let local = entry(&all, "local");
    assert_eq!(stdio_of(local).3, ["API_KEY"]);
    assert_eq!(local.values.env["API_KEY"], "key-one");
    assert_eq!(url_of(entry(&all, "events")).0, "http://127.0.0.1:9/sse");
    assert!(entry(&all, "orden").server.orden);
}
#[test]
fn cursor_values_that_ask_for_input_are_left_out_and_flagged() {
    let all = parsed(Shape::McpServers, "cursor.json");
    let linear = entry(&all, "linear");
    assert_eq!(linear.server.needs_input, ["TOKEN"]);
    assert_eq!(stdio_of(linear).3, ["PLAIN", "TOKEN"]);
    assert!(!linear.values.env.contains_key("TOKEN"));
    assert_eq!(linear.values.env["PLAIN"], "yes");
    assert_eq!(url_of(entry(&all, "remote")).0, "https://example.com/mcp");
}
#[test]
fn vs_code_servers_are_read_from_mcp_json_and_from_settings() {
    let all = parsed(Shape::Servers, "vscode-mcp.jsonc");
    assert_eq!(all.len(), 2);
    assert_eq!(entry(&all, "memory").server.needs_input, ["KEY"]);
    assert_eq!(entry(&all, "docs").values.headers["Authorization"], "Bearer d0c5");
    let older = parsed(Shape::Settings, "vscode-settings.jsonc");
    assert_eq!(stdio_of(entry(&older, "older")).0, "deno");
}
#[test]
fn codex_servers_are_read_from_toml_with_bearer_tokens_from_the_environment() {
    let env = |name: &str| (name == "REMOTE_TOKEN").then(|| "rt-1".to_owned());
    let all = import::entries(Shape::Codex, &fixture("codex.toml"), &env).expect("parsed");
    assert_eq!(all.len(), 3);
    let (command, args, cwd, names) = stdio_of(entry(&all, "docs"));
    assert_eq!(
        (command, args.len(), cwd, names),
        ("npx", 2, Some("/home/me"), &["A".to_owned()][..])
    );
    let remote = entry(&all, "remote");
    assert_eq!(remote.values.headers["Authorization"], "Bearer rt-1");
    assert_eq!(remote.values.headers["X-Team"], "t1");
    let missing = entry(&all, "missing");
    assert_eq!(missing.server.needs_input, ["Authorization"]);
    assert_eq!(url_of(missing).1, ["Authorization"]);
}
#[test]
fn windsurf_server_urls_are_read() {
    let all = parsed(Shape::McpServers, "windsurf.json");
    assert_eq!(url_of(entry(&all, "hosted")).0, "https://hosted.example.com/mcp");
    assert_eq!(entry(&all, "brave").values.env["BRAVE_API_KEY"], "b-key");
}
#[test]
fn gemini_http_and_sse_urls_and_working_folders_are_read() {
    let all = parsed(Shape::McpServers, "gemini.json");
    assert_eq!(url_of(entry(&all, "streamed")).0, "https://stream.example.com/mcp");
    assert_eq!(url_of(entry(&all, "events")).0, "https://events.example.com/sse");
    assert_eq!(stdio_of(entry(&all, "python")).2, Some("./tools"));
}
fn placed(home: &Path, config: &Path) {
    let code = config.join("Code").join("User");
    for (name, at) in [
        ("claude-desktop.json", config.join("Claude").join("claude_desktop_config.json")),
        ("claude-code.json", home.join(".claude.json")),
        ("cursor.json", home.join(".cursor").join("mcp.json")),
        ("vscode-mcp.jsonc", code.join("mcp.json")),
        ("vscode-settings.jsonc", code.join("settings.json")),
        ("codex.toml", home.join(".codex").join("config.toml")),
        ("windsurf.json", home.join(".codeium").join("windsurf").join("mcp_config.json")),
        ("gemini.json", home.join(".gemini").join("settings.json")),
    ] {
        std::fs::create_dir_all(at.parent().expect("a folder")).expect("made");
        std::fs::write(at, fixture(name)).expect("written");
    }
}
#[test]
fn every_source_is_found_where_it_keeps_its_servers_and_imports_once() {
    let dir = tempfile::tempdir().expect("a folder");
    let (home, config) = (dir.path().join("home"), dir.path().join("config"));
    placed(&home, &config);
    let places = import::places(&home, &config, None);
    let (hub, shared, _file, _dir) = hub();
    let found = hub.scan(&places, &no_env);
    let mut sources: Vec<&str> = found.iter().map(|one| one.source.as_str()).collect();
    sources.dedup();
    assert_eq!(
        sources,
        ["claude-desktop", "claude-code", "cursor", "vscode", "codex", "windsurf", "gemini"]
    );
    let pick = |source: &str, name: &str| Pick { source: source.to_owned(), name: name.to_owned() };
    let picks =
        [pick("claude-code", "events"), pick("claude-code", "orden"), pick("cursor", "linear")];
    let views = hub.import(&places, &no_env, &picks).expect("imported");
    assert_eq!(views.len(), 2);
    assert_eq!(views[0].server.from.as_deref(), Some("claude-code"));
    assert!(views[0].server.on);
    assert!(!views[1].server.on);
    assert!(shared.secrets.lock().expect("secrets")["mcp-linear"].contains("yes"));
    let again = hub.scan(&places, &no_env);
    let events = again
        .iter()
        .filter(|one| one.source == "claude-code")
        .flat_map(|one| &one.servers)
        .find(|one| one.name == "events")
        .expect("events");
    assert!(events.already);
    assert!(hub.import(&places, &no_env, &picks).expect("imported").is_empty());
    hub.stop_all();
}
