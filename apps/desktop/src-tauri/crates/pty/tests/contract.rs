#![cfg(not(any(target_os = "android", target_os = "ios")))]
use orden_pty::terminal::{hold, process};

#[test]
fn a_held_terminal_starts_the_app_in_its_own_mode() {
    assert_eq!(hold::MODE, "terminal-hold");
}
#[test]
fn no_shell_is_never_busy_and_runs_nothing() {
    assert!(!process::busy(None));
    assert_eq!(process::program(None), None);
    assert_eq!(process::command(None), None);
    assert_eq!(process::folder(None), None);
}
#[test]
fn the_program_in_front_is_the_first_busy_one_below_the_shell() {
    let one = |id, parent, name: &str| process::Process { id, parent, name: name.to_owned() };
    let all = [one(1, 0, "pwsh.exe"), one(2, 1, "vim.exe"), one(3, 2, "rg.exe")];
    let born = |_: u32| Some(0);
    assert_eq!(process::front_below(1, &all, &born).map(|front| front.id), Some(2));
    assert!(process::busy_below(1, &all, &born));
    assert!(!process::busy_below(3, &all, &born));
}
