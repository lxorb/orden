use sha2::{Digest as _, Sha256};

pub const LONGEST: usize = 64;
pub const PREFIX: &str = "mcp__";
pub fn exposed(server: &str, tool: &str) -> String {
    let named: String = format!("{PREFIX}{server}__{tool}")
        .chars()
        .map(|one| if one.is_ascii_alphanumeric() || one == '_' || one == '-' { one } else { '_' })
        .collect();
    if named.len() <= LONGEST {
        return named;
    }
    let digest = Sha256::digest(format!("{server}\n{tool}").as_bytes());
    format!("{}_{:02x}{:02x}{:02x}", &named[..LONGEST - 7], digest[0], digest[1], digest[2])
}
