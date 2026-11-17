use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::utils::config::WindowConfig;
use tauri::{
    AppHandle, LogicalPosition, Manager, Monitor, Runtime, Webview, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::paths::{config_dir, made, write_atomically};

const FILE: &str = "window.json";

const STAYS: f64 = 64.0;

const MOST: u64 = 512;

const OFF_SCREEN: &str = "ORDEN_OFF_SCREEN";

const OFF: f64 = -32000.0;

static AWAY: OnceLock<(f64, f64)> = OnceLock::new();

static PUT: OnceLock<(f64, f64)> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scale: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

const DESK_IN_PIXELS: bool = cfg!(not(target_os = "macos"));

impl Area {
    fn overlap(&self, placed: &Placement) -> f64 {
        let (mine, its) = scales(self, placed);
        let (x, y, width, height) = (
            self.x * mine,
            self.y * mine,
            self.width * mine,
            self.height * mine,
        );
        let (px, py, pw, ph) = (
            placed.x * its,
            placed.y * its,
            placed.width * its,
            placed.height * its,
        );
        let wide = (x + width).min(px + pw) - x.max(px);
        let tall = (y + height).min(py + ph) - y.max(py);
        wide.max(0.0) * tall.max(0.0)
    }
}

fn scales(screen: &Area, placed: &Placement) -> (f64, f64) {
    match placed.scale {
        Some(its) if DESK_IN_PIXELS && its > 0.0 && screen.scale > 0.0 => (screen.scale, its),
        _ => (1.0, 1.0),
    }
}

#[derive(Default)]
struct Placements {
    windows: Mutex<HashMap<String, Followed>>,
    remembered: Mutex<Option<Placement>>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Followed {
    latest: Option<Placement>,
    before: Option<Placement>,
    maximized: bool,
}

impl Followed {
    fn starting(remembered: Option<Placement>) -> Self {
        let normal = remembered.map(|was| Placement {
            maximized: false,
            ..was
        });
        Followed {
            latest: normal,
            before: normal,
            maximized: remembered.is_some_and(|was| was.maximized),
        }
    }

    fn saw(&mut self, bounds: Option<Placement>, maximized: bool) {
        if maximized {
            if !self.maximized {
                self.latest = self.before;
            }
            self.maximized = true;
            return;
        }

        self.maximized = false;
        if let Some(bounds) = bounds {
            self.before = self.latest;
            self.latest = Some(bounds);
        }
    }

    fn placement(&self) -> Option<Placement> {
        self.latest.map(|was| Placement {
            maximized: self.maximized,
            ..was
        })
    }
}

pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder.manage(Placements::default()).on_window_event(noted)
}

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}

pub fn restored(app: &AppHandle, config: &WindowConfig) -> WindowConfig {
    let mut config = named(config, asked_away());
    if let (Some(x), Some(y)) = (config.x, config.y) {
        let _ = AWAY.set((x, y));
    }
    if names_its_place(&config) {
        return config;
    }
    let Some(placed) = last_place(app) else {
        if let Some(first) = first_place(app, config.width, config.height) {
            config.x = Some(first.x);
            config.y = Some(first.y);
            config.width = first.width;
            config.height = first.height;
            config.center = false;
        }
        return config;
    };

    put_into(config, placed)
}

fn put_into(mut config: WindowConfig, placed: Placement) -> WindowConfig {
    if positions() {
        config.x = Some(placed.x);
        config.y = Some(placed.y);
        config.center = false;
    }
    config.width = placed.width;
    config.height = placed.height;
    config.maximized = placed.maximized;
    config
}

pub fn reopened<'a, R: tauri::Runtime, M: Manager<R>>(
    app: &AppHandle,
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let Some(placed) = last_place(app) else {
        return match first_place(app, DEFAULT_WIDTH, DEFAULT_HEIGHT) {
            Some(first) => builder
                .position(first.x, first.y)
                .inner_size(first.width, first.height),
            None => builder,
        };
    };
    let builder = if positions() {
        builder.position(placed.x, placed.y)
    } else {
        builder
    };
    builder
        .inner_size(placed.width, placed.height)
        .maximized(placed.maximized)
}

const DEFAULT_WIDTH: f64 = 1180.0;
const DEFAULT_HEIGHT: f64 = 760.0;

fn first_place(app: &AppHandle, width: f64, height: f64) -> Option<Placement> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    areas(app)
        .first()
        .map(|screen| under_the_menu_bar(screen, width, height))
}

fn under_the_menu_bar(screen: &Area, width: f64, height: f64) -> Placement {
    let width = width.min(screen.width);
    let height = height.min(screen.height);
    Placement {
        x: screen.x + (screen.width - width) / 2.0,
        y: screen.y,
        width,
        height,
        maximized: false,
        scale: None,
    }
}

fn positions() -> bool {
    true
}

fn last_place(app: &AppHandle) -> Option<Placement> {
    let placed = read(app)?;
    if let Some(kept) = app.try_state::<Placements>() {
        if let Ok(mut remembered) = kept.remembered.lock() {
            *remembered = Some(placed);
        }
    }
    let screens = areas(app);
    Some(if positions() {
        let back = onto(placed, &screens);
        if let Some(scale) = back.scale {
            let _ = PUT.set((back.x * scale, back.y * scale));
        }
        back
    } else {
        sized_for_any(placed, &screens)
    })
}

pub fn settled<R: Runtime, M: Manager<R>>(
    building: WebviewWindowBuilder<'_, R, M>,
) -> tauri::Result<WebviewWindow<R>> {
    let window = crate::engine::one_at_a_time(|| building.build())?;
    settle(&window);
    Ok(window)
}

fn settle<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(windows)]
    {
        let Some(&put) = PUT.get() else {
            return;
        };
        let Ok(at) = window.outer_position() else {
            return;
        };
        let maximized = window.is_maximized().unwrap_or(false);
        let screen = window.current_monitor().ok().flatten().map(|screen| {
            let (at, size) = (screen.position(), screen.size());
            (
                f64::from(at.x),
                f64::from(at.y),
                f64::from(size.width),
                f64::from(size.height),
            )
        });
        if moves(put, (f64::from(at.x), f64::from(at.y)), maximized, screen) {
            let _ = moved_as_it_is(window, tauri::PhysicalPosition::new(put.0, put.1));
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg_attr(
    not(any(windows, test)),
    allow(dead_code, reason = "only Windows puts a window back to the pixel")
)]
fn moves(
    put: (f64, f64),
    at: (f64, f64),
    maximized: bool,
    screen: Option<(f64, f64, f64, f64)>,
) -> bool {
    if !maximized {
        return (at.0 - put.0).abs() > 1.0 || (at.1 - put.1).abs() > 1.0;
    }
    screen.is_some_and(|(x, y, width, height)| {
        put.0 < x || put.0 >= x + width || put.1 < y || put.1 >= y + height
    })
}

pub fn moved_as_it_is<R: Runtime>(
    window: &WebviewWindow<R>,
    to: impl Into<tauri::Position>,
) -> tauri::Result<()> {
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }
    let maximized = window.is_maximized().unwrap_or(false);
    window.set_position(to)?;
    if maximized {
        window.maximize()?;
    }
    Ok(())
}

fn sized_for_any(placed: Placement, screens: &[Area]) -> Placement {
    let widest = screens
        .iter()
        .map(|screen| screen.width)
        .fold(0.0, f64::max);
    let tallest = screens
        .iter()
        .map(|screen| screen.height)
        .fold(0.0, f64::max);
    if widest <= 0.0 || tallest <= 0.0 {
        return placed;
    }
    Placement {
        width: placed.width.min(widest),
        height: placed.height.min(tallest),
        ..placed
    }
}

pub fn names_its_place(config: &WindowConfig) -> bool {
    config.x.is_some() || config.y.is_some()
}

fn named(config: &WindowConfig, away: bool) -> WindowConfig {
    let mut config = config.clone();
    if away {
        config.x = Some(OFF);
        config.y = Some(OFF);
    }
    if names_its_place(&config) {
        config.focus = false;
    }
    config
}

pub(crate) fn asked_away() -> bool {
    std::env::var_os(OFF_SCREEN).is_some_and(|value| !value.is_empty() && value != "0")
}

pub fn away() -> Option<(f64, f64)> {
    AWAY.get().copied()
}

pub fn built_away<R: Runtime, M: Manager<R>>(
    building: WebviewWindowBuilder<'_, R, M>,
    (x, y): (f64, f64),
) -> tauri::Result<WebviewWindow<R>> {
    let building = building
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .always_on_bottom(true);
    #[cfg(windows)]
    let window = crate::engine::one_at_a_time(|| created_away::during(|| building.build()))?;
    #[cfg(not(windows))]
    let window = crate::engine::one_at_a_time(|| building.build())?;
    crate::top_edge::mind(&window.as_ref().window());
    moved_as_it_is(&window, LogicalPosition::new(x, y))?;
    window.show()?;
    Ok(window)
}

#[cfg(windows)]
mod created_away {
    use std::cell::Cell;

    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, CBT_CREATEWNDW, HCBT_CREATEWND,
        HHOOK, WH_CBT, WS_CHILD,
    };

    const PARKED: i32 = -32_000;

    thread_local! {
        static ASKING: Cell<bool> = const { Cell::new(false) };
    }

    #[allow(
        unsafe_code,
        reason = "a window hook is a callback the system calls with pointers it owns"
    )]
    unsafe extern "system" fn creating(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if u32::try_from(code) == Ok(HCBT_CREATEWND) && ASKING.get() {
            unsafe {
                let told = lparam.0 as *const CBT_CREATEWNDW;
                if let Some(creating) = told.as_ref().and_then(|told| told.lpcs.as_mut()) {
                    if u32::from_ne_bytes(creating.style.to_ne_bytes()) & WS_CHILD.0 == 0 {
                        creating.x = PARKED;
                        creating.y = PARKED;
                    }
                }
            }
        }
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }

    #[allow(
        unsafe_code,
        reason = "setting and removing a window hook is a Win32 call"
    )]
    pub fn during<T>(making: impl FnOnce() -> T) -> T {
        let hook = unsafe {
            SetWindowsHookExW(
                WH_CBT,
                Some(creating),
                HINSTANCE::default(),
                GetCurrentThreadId(),
            )
        };
        ASKING.set(true);
        let made = making();
        ASKING.set(false);
        if let Ok(hook) = hook {
            let _ = unsafe { UnhookWindowsHookEx(hook) };
        }
        made
    }
}

pub fn built<R: Runtime, M: Manager<R>>(
    building: WebviewWindowBuilder<'_, R, M>,
) -> tauri::Result<WebviewWindow<R>> {
    if let Some(at) = away() {
        return built_away(building, at);
    }
    let window = crate::engine::one_at_a_time(|| building.build())?;
    crate::top_edge::mind(&window.as_ref().window());
    Ok(window)
}

pub fn raised<R: Runtime>(window: &Window<R>) {
    if away().is_some() {
        return;
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn keyboard_to<R: Runtime>(webview: &Webview<R>) {
    if away().is_some() {
        return;
    }
    let _ = webview.set_focus();
}

#[tauri::command]
pub fn take_keyboard(webview: Webview) {
    keyboard_to(&webview);
}

#[tauri::command]
pub fn raise_window(app: AppHandle, label: String) {
    if let Some(window) = app.get_window(&label) {
        raised(&window);
    }
}

fn read(app: &AppHandle) -> Option<Placement> {
    let path = file(app).ok()?;
    if std::fs::metadata(&path).ok()?.len() > MOST {
        return None;
    }
    let placed: Placement = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    sane(&placed).then_some(placed)
}

fn sane(placed: &Placement) -> bool {
    [placed.x, placed.y, placed.width, placed.height]
        .iter()
        .all(|one| one.is_finite())
        && placed.width >= 1.0
        && placed.height >= 1.0
}

fn areas(app: &AppHandle) -> Vec<Area> {
    let mut screens = app.available_monitors().unwrap_or_default();
    if let Ok(Some(primary)) = app.primary_monitor() {
        if let Some(at) = screens
            .iter()
            .position(|one| one.position() == primary.position())
        {
            screens.swap(0, at);
        }
    }
    screens.iter().map(area_of).collect()
}

fn area_of(screen: &Monitor) -> Area {
    let scale = screen.scale_factor();
    let work = screen.work_area();
    Area {
        x: f64::from(work.position.x) / scale,
        y: f64::from(work.position.y) / scale,
        width: f64::from(work.size.width) / scale,
        height: f64::from(work.size.height) / scale,
        scale,
    }
}

fn onto(placed: Placement, screens: &[Area]) -> Placement {
    let best = screens
        .iter()
        .map(|screen| (screen, screen.overlap(&placed)))
        .fold(None::<(&Area, f64)>, |best, (screen, overlap)| match best {
            Some((_, most)) if most >= overlap => best,
            _ => Some((screen, overlap)),
        });
    let Some((screen, overlap)) = best else {
        return placed;
    };

    let (mine, its) = scales(screen, &placed);
    let placed = Placement {
        x: placed.x * its / mine,
        y: placed.y * its / mine,
        scale: placed.scale.map(|_| screen.scale),
        ..placed
    };

    let width = placed.width.min(screen.width);
    let height = placed.height.min(screen.height);

    let (x, y) = if overlap > 0.0 {
        (
            placed
                .x
                .min(screen.x + screen.width - STAYS)
                .max(screen.x + STAYS - width),
            placed.y.min(screen.y + screen.height - STAYS).max(screen.y),
        )
    } else {
        (
            screen.x + (screen.width - width) / 2.0,
            screen.y + (screen.height - height) / 2.0,
        )
    };

    Placement {
        x,
        y,
        width,
        height,
        maximized: placed.maximized,
        scale: placed.scale,
    }
}

fn noted(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => follow(window),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => keep(window),
        _ => {}
    }
}

pub fn note_every_window(app: &AppHandle) {
    for window in app.windows().values() {
        follow(window);
    }
}

fn follow(window: &Window) {
    if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        return;
    }
    let Some(kept) = window.try_state::<Placements>() else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    let bounds = if maximized { None } else { bounds(window) };
    let Ok(mut windows) = kept.windows.lock() else {
        return;
    };
    windows
        .entry(window.label().to_owned())
        .or_insert_with(|| Followed::starting(kept.remembered.lock().ok().and_then(|was| *was)))
        .saw(bounds, maximized);
}

fn bounds(window: &Window) -> Option<Placement> {
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let placed = Placement {
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
        maximized: false,
        scale: Some(scale),
    };
    sane(&placed).then_some(placed)
}

fn keep(window: &Window) {
    follow(window);
    let Some(kept) = window.try_state::<Placements>() else {
        return;
    };
    let placed = kept
        .windows
        .lock()
        .ok()
        .and_then(|windows| windows.get(window.label()).and_then(Followed::placement));
    let Some(placed) = placed else {
        return;
    };
    let Ok(text) = serde_json::to_string(&placed) else {
        return;
    };
    let Ok(path) = file(window.app_handle()) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if made(parent).is_err() {
            return;
        }
    }
    let _ = write_atomically(&path, text.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::{
        moves, named, names_its_place, onto, put_into, sane, sized_for_any, under_the_menu_bar,
        Area, Followed, Placement, DESK_IN_PIXELS, OFF,
    };
    use tauri::utils::config::WindowConfig;

    fn placed(x: f64, y: f64, width: f64, height: f64) -> Placement {
        Placement {
            x,
            y,
            width,
            height,
            maximized: false,
            scale: None,
        }
    }

    const LAPTOP: Area = Area {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 860.0,
        scale: 1.0,
    };

    const MONITOR: Area = Area {
        x: 1440.0,
        y: -200.0,
        width: 2560.0,
        height: 1400.0,
        scale: 1.0,
    };

    #[test]
    fn a_window_on_a_screen_stays_where_it_was() {
        let was = placed(100.0, 80.0, 1180.0, 760.0);
        assert_eq!(onto(was, &[LAPTOP, MONITOR]), was);

        let there = placed(1800.0, 0.0, 1600.0, 1000.0);
        assert_eq!(onto(there, &[LAPTOP, MONITOR]), there);
    }

    #[test]
    fn a_window_on_a_screen_that_has_gone_comes_back_to_the_first() {
        let was = placed(1800.0, 0.0, 1600.0, 1000.0);
        assert_eq!(
            onto(was, &[LAPTOP]),
            placed(0.0, 0.0, 1440.0, 860.0),
            "made to fit"
        );

        let small = placed(3000.0, 300.0, 800.0, 600.0);
        assert_eq!(onto(small, &[LAPTOP]), placed(320.0, 130.0, 800.0, 600.0));
    }

    #[test]
    fn a_window_hanging_off_an_edge_keeps_a_strip_on_screen() {
        let half = placed(-500.0, 100.0, 1000.0, 600.0);
        assert_eq!(onto(half, &[LAPTOP]), half);

        let mostly_off = placed(1420.0, 100.0, 1000.0, 600.0);
        assert_eq!(
            onto(mostly_off, &[LAPTOP]),
            placed(1440.0 - 64.0, 100.0, 1000.0, 600.0)
        );

        let low = placed(100.0, 850.0, 1000.0, 600.0);
        assert_eq!(
            onto(low, &[LAPTOP]),
            placed(100.0, 860.0 - 64.0, 1000.0, 600.0)
        );
    }

    #[test]
    fn the_top_edge_is_never_above_the_screen() {
        let high = placed(100.0, -300.0, 1000.0, 600.0);
        assert_eq!(onto(high, &[LAPTOP]), placed(100.0, 0.0, 1000.0, 600.0));
    }

    #[test]
    fn where_the_compositor_places_it_only_the_biggest_screen_bounds_it() {
        let portrait = Area {
            x: 0.0,
            y: 0.0,
            width: 813.0,
            height: 1446.0,
            scale: 1.0,
        };
        let was = placed(0.0, 0.0, 1180.0, 760.0);
        assert_eq!(sized_for_any(was, &[portrait, MONITOR]), was);
        assert_eq!(
            sized_for_any(placed(0.0, 0.0, 4000.0, 3000.0), &[portrait, MONITOR]),
            placed(0.0, 0.0, MONITOR.width, portrait.height)
        );
        assert_eq!(sized_for_any(was, &[]), was);
    }

    #[test]
    fn a_window_bigger_than_its_screen_is_made_to_fit() {
        let big = placed(0.0, 0.0, 2000.0, 1200.0);
        assert_eq!(onto(big, &[LAPTOP]), placed(0.0, 0.0, 1440.0, 860.0));
    }

    #[test]
    fn the_screen_it_is_mostly_on_is_the_one_it_is_kept_on() {
        let was = placed(1400.0, 1180.0, 1200.0, 800.0);
        assert_eq!(
            onto(was, &[LAPTOP, MONITOR]),
            placed(1400.0, -200.0 + 1400.0 - 64.0, 1200.0, 800.0)
        );
    }

    #[test]
    fn maximised_stays_maximised() {
        let was = Placement {
            maximized: true,
            ..placed(1800.0, 0.0, 1600.0, 1000.0)
        };
        assert!(onto(was, &[LAPTOP]).maximized);
    }

    #[test]
    fn no_screens_leaves_it_where_it_was() {
        let was = placed(-9000.0, 0.0, 800.0, 600.0);
        assert_eq!(onto(was, &[]), was);
    }

    #[test]
    fn a_maximise_goes_back_to_the_bounds_before_it() {
        let normal = placed(140.0, 120.0, 887.0, 612.0);
        let screen = placed(-6.5, -6.5, 1472.0, 919.5);

        let mut followed = Followed::starting(None);
        followed.saw(Some(normal), false);
        followed.saw(Some(normal), false);
        followed.saw(Some(screen), false);
        followed.saw(None, true);
        assert_eq!(
            followed.placement(),
            Some(Placement {
                maximized: true,
                ..normal
            })
        );

        followed.saw(Some(normal), false);
        assert_eq!(followed.placement(), Some(normal));
    }

    #[test]
    fn opened_maximised_keeps_what_the_file_said() {
        let was = Placement {
            maximized: true,
            ..placed(100.0, 80.0, 1000.0, 700.0)
        };
        let mut followed = Followed::starting(Some(was));
        followed.saw(None, true);
        assert_eq!(followed.placement(), Some(was));

        followed.saw(Some(placed(100.0, 80.0, 1000.0, 700.0)), false);
        assert_eq!(
            followed.placement(),
            Some(placed(100.0, 80.0, 1000.0, 700.0))
        );
    }

    #[test]
    fn a_window_that_cannot_be_read_keeps_the_place_last_noted() {
        let dragged = placed(300.0, 140.0, 940.0, 640.0);

        let mut followed = Followed::starting(None);
        followed.saw(Some(placed(300.0, 140.0, 943.0, 642.0)), false);
        followed.saw(Some(dragged), false);
        followed.saw(None, false);
        assert_eq!(followed.placement(), Some(dragged));
    }

    #[test]
    fn a_config_that_names_a_place_keeps_it() {
        assert!(!names_its_place(&WindowConfig::default()));
        let off = WindowConfig {
            x: Some(-32000.0),
            y: Some(-32000.0),
            ..WindowConfig::default()
        };
        assert!(names_its_place(&off));

        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the app's config");
        let window = &config["app"]["windows"][0];
        assert!(window["x"].is_null() && window["y"].is_null());
    }

    #[test]
    fn a_drive_that_asks_gets_its_window_off_the_screen_and_unfocused() {
        let away = named(&WindowConfig::default(), true);
        assert_eq!((away.x, away.y), (Some(OFF), Some(OFF)));
        assert!(!away.focus);
    }

    #[test]
    fn a_named_place_is_kept_and_never_focused() {
        let built = WindowConfig {
            x: Some(-20000.0),
            y: Some(-20000.0),
            ..WindowConfig::default()
        };
        let away = named(&built, false);
        assert_eq!((away.x, away.y), (Some(-20000.0), Some(-20000.0)));
        assert!(!away.focus);
    }

    #[test]
    fn nothing_named_and_nothing_asked_changes_nothing() {
        let plain = named(&WindowConfig::default(), false);
        assert_eq!(plain.x, None);
        assert!(plain.focus);
    }

    #[test]
    fn a_file_that_is_not_a_window_is_not_read_as_one() {
        assert!(!sane(&placed(f64::NAN, 0.0, 800.0, 600.0)));
        assert!(!sane(&placed(0.0, 0.0, 0.0, 600.0)));
        assert!(!sane(&placed(0.0, f64::INFINITY, 800.0, 600.0)));
        assert!(sane(&placed(-100.0, -20.0, 800.0, 600.0)));
        assert!(serde_json::from_str::<Placement>("{\"x\":1}").is_err());
    }

    #[test]
    fn every_window_is_built_where_the_run_sends_them() {
        let excused = ["pdf.rs", "engine.rs", "engine/gate.rs"];

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sources = vec![root.clone()];
        let mut unplaced = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                let builds = text.contains("WebviewWindowBuilder::new(")
                    || text.contains("WebviewWindowBuilder::from_config(");
                let placed =
                    text.contains("placement::built(") || text.contains("placement::built_away(");
                if builds && !placed && name != "placement.rs" && !excused.contains(&&*name) {
                    unplaced.push(name);
                }
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
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sources = vec![root.clone()];
        let mut found = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
                if name == "placement.rs" || name == "foreground.rs" {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                if name == "keyboard.rs" {
                    assert_eq!(
                        text.matches("crate::placement::away().is_some()").count(),
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
        }
        assert!(
            found.is_empty(),
            "the keyboard or the front asked for past `raised` and `keyboard_to`: {found:?}"
        );
    }

    #[test]
    fn a_first_window_on_a_mac_opens_under_the_menu_bar_across_the_middle() {
        let screen = Area {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 875.0,
            scale: 2.0,
        };
        assert_eq!(
            under_the_menu_bar(&screen, 1180.0, 760.0),
            placed(130.0, 25.0, 1180.0, 760.0)
        );
        let small = Area {
            x: 0.0,
            y: 25.0,
            width: 1024.0,
            height: 640.0,
            scale: 2.0,
        };
        assert_eq!(
            under_the_menu_bar(&small, 1180.0, 760.0),
            placed(0.0, 25.0, 1024.0, 640.0)
        );
    }

    const PRIMARY: Area = Area {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1040.0,
        scale: 1.0,
    };
    const PANEL: Area = Area {
        x: if DESK_IN_PIXELS { 960.0 } else { 1920.0 },
        y: 0.0,
        width: 1440.0,
        height: 860.0,
        scale: 2.0,
    };

    fn at_scale(scale: f64, x: f64, y: f64, width: f64, height: f64) -> Placement {
        Placement {
            scale: Some(scale),
            ..placed(x, y, width, height)
        }
    }

    #[test]
    fn a_window_on_a_screen_of_another_scale_stays_on_it() {
        let was = at_scale(2.0, PANEL.x + 20.0, 100.0, 900.0, 600.0);
        assert_eq!(
            onto(was, &[PRIMARY, PANEL]),
            was,
            "on the panel, where it was"
        );
        assert!(
            PRIMARY.overlap(&was) <= 0.0,
            "nowhere on the primary screen"
        );
        if DESK_IN_PIXELS {
            let logical = placed(was.x, was.y, was.width, was.height);
            assert!(PRIMARY.overlap(&logical) >= PANEL.overlap(&logical));
        }
    }

    #[test]
    fn a_window_on_the_primary_screen_beside_a_panel_stays_on_it() {
        let was = at_scale(1.0, 100.0, 80.0, 1180.0, 760.0);
        assert_eq!(onto(was, &[PRIMARY, PANEL]), was);
    }

    #[test]
    fn a_window_from_a_panel_that_has_gone_comes_back_at_its_size() {
        let was = at_scale(2.0, PANEL.x + 140.0, 100.0, 1000.0, 600.0);
        assert!(
            PRIMARY.overlap(&was) <= 0.0,
            "nowhere on the screen there is"
        );
        let back = onto(was, &[PRIMARY]);
        assert_eq!((back.width, back.height), (1000.0, 600.0));
        assert_eq!(back.scale, Some(1.0));
        assert!(back.x >= PRIMARY.x && back.x + back.width <= PRIMARY.x + PRIMARY.width);
    }

    #[test]
    fn a_place_from_before_the_scale_is_compared_as_it_was() {
        let was = placed(100.0, 80.0, 1180.0, 760.0);
        assert_eq!(onto(was, &[PRIMARY, PANEL]), was);
        let read: Placement =
            serde_json::from_str(r#"{"x":1,"y":2,"width":800,"height":600,"maximized":false}"#)
                .expect("an older place");
        assert_eq!(read.scale, None);
        assert!(!serde_json::to_string(&read)
            .expect("written")
            .contains("scale"));
    }

    #[test]
    fn a_window_reopens_as_it_was_left() {
        let normal = at_scale(1.0, 140.0, 120.0, 887.0, 612.0);
        let screen = at_scale(1.0, -8.0, -8.0, 1936.0, 1056.0);
        for maximized in [true, false] {
            let mut followed = Followed::starting(None);
            followed.saw(Some(normal), false);
            if maximized {
                followed.saw(Some(screen), false);
                followed.saw(None, true);
            }
            let text =
                serde_json::to_string(&followed.placement().expect("a place")).expect("written");
            let read: Placement = serde_json::from_str(&text).expect("read back");
            assert!(sane(&read));
            let config = put_into(WindowConfig::default(), onto(read, &[PRIMARY, PANEL]));
            assert_eq!(config.maximized, maximized, "maximised: {maximized}");
            assert_eq!((config.x, config.y), (Some(normal.x), Some(normal.y)));
            assert_eq!((config.width, config.height), (normal.width, normal.height));
            assert!(!config.center);
        }
    }

    #[test]
    fn a_maximised_window_is_moved_only_off_the_wrong_screen() {
        let put = (1960.0, 200.0);
        let primary = Some((0.0, 0.0, 1920.0, 1080.0));
        let panel = Some((1920.0, 0.0, 2880.0, 1800.0));
        assert!(!moves(put, (1912.0, -8.0), true, panel), "on its screen");
        assert!(moves(put, (-8.0, -8.0), true, primary), "on the wrong one");
        assert!(
            !moves(put, (-8.0, -8.0), true, None),
            "a screen nobody can say"
        );
        assert!(!moves(put, (1960.5, 200.0), false, panel));
        assert!(moves(put, (980.0, 100.0), false, primary));
    }

    #[test]
    fn nothing_moves_a_window_but_moved_as_it_is() {
        let excused = ["quick_add.rs", "extensions/popup.rs"];
        let calls = [".set_position(", ".set_size(", ".set_outer_position("];
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sources = vec![root.clone()];
        let mut found = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
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
        }
        let inside_moved = found
            .iter()
            .filter(|at| at.starts_with("placement.rs:"))
            .count();
        found.retain(|at| !at.starts_with("placement.rs:"));
        assert_eq!(
            inside_moved, 1,
            "placement.rs moves a window past `moved_as_it_is`"
        );
        assert!(
            found.is_empty(),
            "a window moved past `moved_as_it_is`: {found:?}"
        );
    }
}
