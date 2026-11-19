use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::types::{Server, Transport};

pub const FILE: &str = "mcp-servers.json";
const LONGEST_ID: usize = 24;
const OWN: [&str; 2] = ["orden", "nib"];
#[derive(Default, Serialize, Deserialize)]
struct Kept {
    #[serde(default)]
    servers: Vec<Server>,
}
pub fn read(path: &Path) -> Result<Vec<Server>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Kept>(&bytes)
            .map(|kept| kept.servers)
            .map_err(|error| format!("the MCP server list would not read: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("could not read the MCP server list: {error}")),
    }
}
pub fn write(path: &Path, servers: &[Server]) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        orden_base::paths::made(folder)?;
    }
    let kept = Kept { servers: servers.to_vec() };
    let text = serde_json::to_vec_pretty(&kept).map_err(|error| error.to_string())?;
    orden_base::paths::write_atomically(path, &text)
}
pub fn valid_id(id: &str) -> bool {
    !OWN.contains(&id)
        && (1..=LONGEST_ID).contains(&id.len())
        && id.bytes().all(|one| one.is_ascii_lowercase() || one.is_ascii_digit() || one == b'-')
}
pub fn new_id(name: &str, taken: impl Fn(&str) -> bool) -> String {
    let taken = |id: &str| OWN.contains(&id) || taken(id);
    let mut slug = String::new();
    for one in name.chars().flat_map(char::to_lowercase) {
        if one.is_ascii_alphanumeric() {
            slug.push(one);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.truncate(LONGEST_ID);
    let slug = match slug.trim_matches('-') {
        "" => "server".to_owned(),
        trimmed => trimmed.to_owned(),
    };
    if !taken(&slug) {
        return slug;
    }
    (2_u32..=9999)
        .map(|count| {
            let tail = format!("-{count}");
            let room = LONGEST_ID - tail.len();
            format!("{}{tail}", slug[..slug.len().min(room)].trim_end_matches('-'))
        })
        .find(|candidate| !taken(candidate))
        .unwrap_or_default()
}
pub fn checked(server: &Server) -> Result<(), String> {
    if OWN.contains(&server.id.as_str()) {
        return Err(format!("{} names Orden's own tools, so no server takes it", server.id));
    }
    if !valid_id(&server.id) {
        return Err("a server's id is up to 24 small letters, digits and dashes".to_owned());
    }
    if server.name.trim().is_empty() {
        return Err("the server needs a name".to_owned());
    }
    match &server.transport {
        Transport::Stdio { command, env, .. } => {
            if command.trim().is_empty() {
                return Err("the server needs a command to run".to_owned());
            }
            if let Some(bad) = env.iter().find(|name| name.is_empty() || name.contains(['=', '\0']))
            {
                return Err(format!("'{bad}' cannot name an environment variable"));
            }
        }
        Transport::Http { url, headers } => {
            let parsed =
                reqwest::Url::parse(url).map_err(|_| format!("'{url}' is no web address"))?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(format!("'{url}' is no web address"));
            }
            if let Some(bad) = headers
                .iter()
                .find(|name| reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err())
            {
                return Err(format!("'{bad}' cannot name a header"));
            }
        }
    }
    Ok(())
}
