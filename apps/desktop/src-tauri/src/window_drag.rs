use orden_web_engine::Edge;

pub const SCRIPT: &str = include_str!("window_drag.js");

#[tauri::command]
pub async fn window_move_resize(
    webview: tauri::Webview,
    edge: Option<String>,
    at: Option<Pressed>,
) -> Result<(), String> {
    crate::lane::off_the_runtime(move || -> Result<(), String> {
        let direction = Edge::parse(edge.as_deref())
            .ok_or_else(|| format!("{} is not an edge", edge.unwrap_or_default()))?;
        {
            use tauri::Manager as _;
            let window = webview.window();
            if !direction.is_move()
                && (window.is_maximized().unwrap_or(false)
                    || window.is_fullscreen().unwrap_or(false))
            {
                return Ok(());
            }
            let Some(id) = crate::host::window_id(&window) else {
                return Err("the window has no native window to move".to_owned());
            };
            let done =
                match crate::host::system().move_resize(id, direction, at.map(|at| (at.x, at.y))) {
                    Err(refused) if refused.kind == orden_web_engine::FailureKind::Unsupported => {
                        by_the_runtime(&window, direction)
                    }
                    said => said.map_err(|error| error.to_string()),
                };
            crate::logs::say(
                webview.app_handle(),
                if done.is_ok() { "info" } else { "error" },
                &match &done {
                    Ok(said) => format!("window: {said}"),
                    Err(error) => format!("window: no move or resize ({error})"),
                },
            );
            done.map(|_| ())
        }
    })
    .await
}

#[tauri::command(async)]
pub fn window_frame(webview: tauri::Webview) -> Result<(), String> {
    {
        let window = webview.window();
        if !window.is_resizable().unwrap_or(false) {
            return Ok(());
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let Some(id) = crate::host::window_id(&window) else {
            return Err("the window has no native window to frame".to_owned());
        };
        crate::page_hide::no_ground_in(id);
        crate::host::system()
            .frame(id, scale)
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct Pressed {
    x: i32,
    y: i32,
}

fn by_the_runtime(window: &tauri::Window<crate::Engine>, edge: Edge) -> Result<String, String> {
    use tauri_runtime::ResizeDirection;

    let direction = match edge {
        Edge::Move => {
            window.start_dragging().map_err(|error| error.to_string())?;
            return Ok("a move the runtime began".to_owned());
        }
        Edge::NorthWest => ResizeDirection::NorthWest,
        Edge::North => ResizeDirection::North,
        Edge::NorthEast => ResizeDirection::NorthEast,
        Edge::East => ResizeDirection::East,
        Edge::SouthEast => ResizeDirection::SouthEast,
        Edge::South => ResizeDirection::South,
        Edge::SouthWest => ResizeDirection::SouthWest,
        Edge::West => ResizeDirection::West,
    };
    window
        .start_resize_dragging(direction)
        .map_err(|error| error.to_string())?;
    Ok(format!("a resize at {edge:?} the runtime began"))
}

#[cfg(test)]
mod tests {
    use super::SCRIPT;

    #[test]
    fn the_script_asks_by_the_command_s_names() {
        assert!(SCRIPT.contains("'window_move_resize'"));
        assert!(SCRIPT.contains("event.button !== 0"));
        for edge in ["'nw'", "'ne'", "'se'", "'sw'"] {
            assert!(SCRIPT.contains(edge), "{edge}");
        }
    }
}
