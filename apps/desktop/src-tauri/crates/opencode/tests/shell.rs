#![cfg(not(any(target_os = "android", target_os = "ios")))]
use std::process::Command;

#[test]
fn the_shell_guard_runs_the_real_shell_with_its_arguments_and_none_of_the_engines_secrets() {
    let (real, listed, failed): (&str, [&str; 2], [&str; 2]) = if cfg!(windows) {
        ("cmd.exe", ["/c", "set"], ["/c", "exit 3"])
    } else {
        ("/bin/sh", ["-c", "env"], ["-c", "exit 3"])
    };
    let guarded = |args: [&str; 2]| {
        Command::new(env!("CARGO_BIN_EXE_orden-shell"))
            .args(args)
            .env("ORDEN_USER_SHELL", real)
            .env("OPENCODE_SERVER_PASSWORD", "pw-secret")
            .env("OPENCODE_CONFIG_CONTENT", "config-secret")
            .env("ORDEN_MCP_TOKEN", "token-secret")
            .env("OPENCODE_TEST_HOME", "home-secret")
            .env("XDG_CONFIG_HOME", "/orden/config")
            .env("ORDEN_USER_XDG_CONFIG_HOME", "/me/.config")
            .env("XDG_DATA_HOME", "/orden/data")
            .env("ORDEN_USER_XDG_DATA_HOME_UNSET", "1")
            .output()
            .expect("ran")
    };
    let said = guarded(listed);
    assert!(said.status.success(), "{said:?}");
    let said = String::from_utf8_lossy(&said.stdout).to_lowercase();
    for secret in [
        "pw-secret",
        "config-secret",
        "token-secret",
        "home-secret",
        "orden_user_",
        "=/orden/config",
        "=/orden/data",
    ] {
        assert!(!said.contains(secret), "{secret} reached the shell: {said}");
    }
    assert!(said.lines().any(|line| line.trim() == "xdg_config_home=/me/.config"), "{said}");
    assert_eq!(guarded(failed).status.code(), Some(3));
    let alone = Command::new(env!("CARGO_BIN_EXE_orden-shell"))
        .arg("-c")
        .env_remove("ORDEN_USER_SHELL")
        .output()
        .expect("ran");
    assert_eq!(alone.status.code(), Some(127));
}
