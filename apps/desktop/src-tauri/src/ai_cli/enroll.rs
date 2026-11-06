use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::program::{self, Program};
use super::run::run_to_end;
use super::{Tool, TELLING};

const SHIPPED: &str = "ch.emilvinu.nib";

const NAME: &str = "orden";

const OLD_NAME: &str = "nib";

const TEST_HOME: &str = "NIB_ENROLL_HOME";

#[derive(Debug, Default, Serialize, Deserialize)]
struct Kept {
    #[serde(default)]
    off: bool,
}

fn kept_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::paths::config_dir(app)?.join("enroll.json"))
}

fn is_on(app: &AppHandle) -> bool {
    kept_file(app)
        .ok()
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str::<Kept>(&text).ok())
        .is_none_or(|kept| !kept.off)
}

fn test_home() -> Option<PathBuf> {
    std::env::var_os(TEST_HOME)
        .filter(|one| !one.is_empty())
        .map(PathBuf::from)
}

fn offered(app: &AppHandle) -> bool {
    test_home().is_some()
        || (!cfg!(debug_assertions)
            && app.config().identifier == SHIPPED
            && crate::placement::away().is_none()
            && !crate::app_place::app_stuck())
}

fn get_args(name: &str) -> Vec<OsString> {
    ["mcp", "get", name].map(OsString::from).to_vec()
}

fn add_args(tool: Tool, nib: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = match tool {
        Tool::ClaudeCode => vec!["mcp", "add", "--scope", "user", NAME, "--"],
        Tool::Codex => vec!["mcp", "add", NAME, "--"],
    }
    .into_iter()
    .map(OsString::from)
    .collect();
    args.extend([nib.as_os_str().to_owned(), OsString::from("mcp")]);
    args
}

fn remove_args(tool: Tool, name: &str) -> Vec<OsString> {
    match tool {
        Tool::ClaudeCode => vec!["mcp", "remove", "--scope", "user", name],
        Tool::Codex => vec!["mcp", "remove", name],
    }
    .into_iter()
    .map(OsString::from)
    .collect()
}

fn homed(program: &Program, args: &[OsString], folder: &Path, home: Option<&Path>) -> Command {
    let mut command = super::command(program, args, folder, None);
    if let Some(home) = home {
        command
            .env("HOME", home)
            .env("USERPROFILE", home)
            .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
            .env("CODEX_HOME", home.join(".codex"));
    }
    command
}

fn entry(program: &Program, name: &str, folder: &Path, home: Option<&Path>) -> Option<String> {
    let said = run_to_end(homed(program, &get_args(name), folder, home), TELLING).ok()?;
    (said.ended.code == Some(0)).then_some(said.out)
}

#[derive(Debug, PartialEq, Eq)]
enum Held {
    None,
    Ours,
    Older,
    Theirs,
}

fn held(program: &Program, name: &str, folder: &Path, nib: &Path, home: Option<&Path>) -> Held {
    match entry(program, name, folder, home) {
        None => Held::None,
        Some(said) if said.contains(nib.to_string_lossy().as_ref()) => Held::Ours,
        Some(said)
            if crate::mcp::program::command_in(&said)
                .is_some_and(|command| crate::mcp::program::older_copy(command, nib)) =>
        {
            Held::Older
        }
        Some(_) => Held::Theirs,
    }
}

fn remove(program: &Program, tool: Tool, name: &str, folder: &Path, home: Option<&Path>) {
    let _ = run_to_end(
        homed(program, &remove_args(tool, name), folder, home),
        TELLING,
    );
}

pub fn carry_over(program: &Program, tool: Tool, folder: &Path, nib: &Path, home: Option<&Path>) {
    if held(program, NAME, folder, nib, home) == Held::Older {
        remove(program, tool, NAME, folder, home);
        let _ = run_to_end(homed(program, &add_args(tool, nib), folder, home), TELLING);
    }
    if !matches!(
        held(program, OLD_NAME, folder, nib, home),
        Held::Ours | Held::Older
    ) {
        return;
    }
    if held(program, NAME, folder, nib, home) == Held::None {
        let _ = run_to_end(homed(program, &add_args(tool, nib), folder, home), TELLING);
    }
    if held(program, NAME, folder, nib, home) == Held::Ours {
        remove(program, tool, OLD_NAME, folder, home);
    }
}

pub fn enroll(program: &Program, tool: Tool, folder: &Path, nib: &Path, home: Option<&Path>) {
    carry_over(program, tool, folder, nib, home);
    if entry(program, NAME, folder, home).is_some()
        || matches!(
            held(program, OLD_NAME, folder, nib, home),
            Held::Ours | Held::Older
        )
    {
        return;
    }
    let _ = run_to_end(homed(program, &add_args(tool, nib), folder, home), TELLING);
}

pub fn unenroll(program: &Program, tool: Tool, folder: &Path, nib: &Path, home: Option<&Path>) {
    for name in [NAME, OLD_NAME] {
        if matches!(
            held(program, name, folder, nib, home),
            Held::Ours | Held::Older
        ) {
            remove(program, tool, name, folder, home);
        }
    }
}

fn each(app: &AppHandle, act: fn(&Program, Tool, &Path, &Path, Option<&Path>)) {
    let Ok(folder) = super::workroom(app) else {
        return;
    };
    let Ok(nib) = crate::mcp::program::program() else {
        return;
    };
    let _ = std::thread::Builder::new()
        .name("agents enrolled".into())
        .spawn(move || {
            let home = test_home();
            for tool in [Tool::ClaudeCode, Tool::Codex] {
                if let Some(found) = program::find(tool) {
                    act(&found, tool, &folder, &nib, home.as_deref());
                }
            }
        });
}

pub fn keep_enrolled(app: &AppHandle) {
    if offered(app) {
        each(app, if is_on(app) { enroll } else { carry_over });
    }
}

#[derive(Serialize)]
pub struct Standing {
    offered: bool,
    on: bool,
}

pub fn standing(app: &AppHandle) -> Standing {
    Standing {
        offered: offered(app),
        on: is_on(app),
    }
}

pub fn turned(app: &AppHandle, on: bool) -> Result<(), String> {
    let text = serde_json::to_string(&Kept { off: !on }).map_err(|error| error.to_string())?;
    let file = kept_file(app)?;
    if let Some(dir) = file.parent() {
        crate::paths::made(dir)?;
    }
    crate::paths::write_privately(&file, text.as_bytes())?;
    if offered(app) {
        each(app, if on { enroll } else { unenroll });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_program_is_added_the_way_it_adds_a_server_itself() {
        let nib = Path::new("C:/nib/nib.exe");
        let line = |args: Vec<OsString>| {
            args.iter()
                .map(|one| one.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert_eq!(
            line(add_args(Tool::ClaudeCode, nib)),
            "mcp add --scope user orden -- C:/nib/nib.exe mcp"
        );
        assert_eq!(
            line(add_args(Tool::Codex, nib)),
            "mcp add orden -- C:/nib/nib.exe mcp"
        );
        assert_eq!(
            line(remove_args(Tool::ClaudeCode, OLD_NAME)),
            "mcp remove --scope user nib"
        );
        assert_eq!(line(remove_args(Tool::Codex, NAME)), "mcp remove orden");
        assert_eq!(line(get_args(OLD_NAME)), "mcp get nib");
    }

    #[test]
    fn the_switch_is_on_unless_turned_off() {
        let read = |text: &str| serde_json::from_str::<Kept>(text).map(|kept| !kept.off);
        assert_eq!(read("{}").ok(), Some(true));
        assert_eq!(read(r#"{"off":true}"#).ok(), Some(false));
    }
}
