#[test]
fn every_window_is_built_where_the_run_sends_them() {
    let excused = ["crates/documents/src/pdf.rs", "engine.rs"];

    let mut unplaced = Vec::new();
    for (name, path) in crate::sources() {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let builds = text.contains("WebviewWindowBuilder::new(")
            || text.contains("WebviewWindowBuilder::from_config(");
        let placed = text.contains("placement::built(") || text.contains("placement::built_away(");
        if builds
            && !placed
            && name != "crates/placement/src/placement.rs"
            && !excused.contains(&&*name)
        {
            unplaced.push(name);
        }
    }
    assert!(
        unplaced.is_empty(),
        "built past `placement::built`: {unplaced:?}"
    );
}

#[test]
fn nothing_takes_the_keyboard_or_the_front_past_the_guard() {
    let asks_the_system = [
        "SetForegroundWindow",
        "AllowSetForegroundWindow",
        "BringWindowToTop",
        "SetActiveWindow",
        "SwitchToThisWindow",
        "SetFocus",
        "SendInput",
        "keybd_event",
        "MoveFocus",
        "focus_parent",
    ];
    let mut found = Vec::new();
    for (name, path) in crate::sources() {
        if name == "crates/placement/src/placement.rs"
            || name == "crates/placement/src/foreground.rs"
        {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        if name == "crates/web/src/keyboard.rs" {
            assert_eq!(
                text.matches("orden_placement::placement::away().is_some()")
                    .count(),
                2,
                "keyboard.rs hands the keyboard over past the guard"
            );
            continue;
        }
        for (at, line) in text.lines().enumerate() {
            let code = line.trim_start();
            if code.starts_with("//") {
                continue;
            }
            let named = asks_the_system.iter().any(|call| {
                code.match_indices(call).any(|(from, _)| {
                    !code[..from].ends_with(|c: char| c.is_alphanumeric() || c == '_')
                })
            });
            if code.contains(".set_focus(") || named {
                found.push(format!("{name}:{}", at + 1));
            }
        }
    }
    assert!(
        found.is_empty(),
        "the keyboard or the front asked for past `raised` and `keyboard_to`: {found:?}"
    );
}

#[test]
fn nothing_moves_a_window_but_moved_as_it_is() {
    let excused = ["quick_add.rs", "extensions/popup.rs"];
    let calls = [".set_position(", ".set_size(", ".set_outer_position("];
    let mut found = Vec::new();
    for (name, path) in crate::sources() {
        if excused.contains(&&*name) {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let code = text.split("mod tests {").next().unwrap_or("");
        for (at, line) in code.lines().enumerate() {
            let line = line.trim_start();
            if !line.starts_with("//") && calls.iter().any(|call| line.contains(call)) {
                found.push(format!("{name}:{}", at + 1));
            }
        }
    }
    let inside_moved = found
        .iter()
        .filter(|at| at.starts_with("crates/placement/src/placement.rs:"))
        .count();
    found.retain(|at| !at.starts_with("crates/placement/src/placement.rs:"));
    assert_eq!(
        inside_moved, 1,
        "placement.rs moves a window past `moved_as_it_is`"
    );
    assert!(
        found.is_empty(),
        "a window moved past `moved_as_it_is`: {found:?}"
    );
}

#[test]
fn no_window_is_built_to_show_the_desk_where_nothing_is_drawn() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut through = Vec::new();
    for name in [
        "tauri.conf.json",
        "tauri.linux.conf.json",
        "tauri.macos.conf.json",
        "tauri.windows.conf.json",
    ] {
        let text = std::fs::read_to_string(root.join(name)).expect("the config");
        if text.contains("\"transparent\": true") {
            through.push(name.to_string());
        }
    }
    for (name, path) in crate::sources() {
        if std::fs::read_to_string(&path)
            .unwrap_or_default()
            .contains(concat!(".transparent", "(true)"))
        {
            through.push(name);
        }
    }
    assert!(through.is_empty(), "built to show through: {through:?}");
}
