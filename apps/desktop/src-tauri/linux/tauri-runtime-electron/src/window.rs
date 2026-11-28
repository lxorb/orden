use serde::de::DeserializeOwned;
use tauri_runtime::dpi::{PhysicalPosition, PhysicalRect, PhysicalSize, Position, Size};
use tauri_runtime::monitor::Monitor;
use tauri_runtime::webview::{DetachedWebview, PendingWebview};
use tauri_runtime::window::{
    DetachedWindow, PendingWindow, RawWindow, WindowBuilder, WindowBuilderBase, WindowEvent,
};
use tauri_runtime::{Result, UserAttentionType, UserEvent, WindowDispatch, WindowEventId};
use tauri_utils::config::WindowConfig;
use tauri_utils::Theme;

use crate::pipe::{held, Context, Message};
use crate::wire::{Bounds, Display, Extent, Place, Screens, ToShell, WindowCall, WindowOptions};
use crate::ElectronRuntime;

pub(crate) fn monitors(context: &Context, screens: Screens) -> Result<Vec<Monitor>> {
    let said: Vec<Display> = context.ask(|id| ToShell::Screen { id, screens })?;
    Ok(said
        .into_iter()
        .map(|one| Monitor {
            name: one.name,
            size: PhysicalSize::new(one.bounds.width, one.bounds.height),
            position: PhysicalPosition::new(one.bounds.x, one.bounds.y),
            work_area: PhysicalRect {
                position: PhysicalPosition::new(one.work_area.x, one.work_area.y),
                size: PhysicalSize::new(one.work_area.width, one.work_area.height),
            },
            scale_factor: one.scale,
        })
        .collect())
}

pub(crate) fn dark(context: &Context) -> Result<bool> {
    context.ask(|id| ToShell::Dark { id })
}

pub(crate) fn wear(context: &Context, theme: Option<Theme>) -> Result<()> {
    context.send(&ToShell::Theme { theme: theme.map(|one| one.to_string()) }, &[])
}

fn extent(size: Size) -> Extent {
    match size {
        Size::Physical(size) => {
            Extent { width: f64::from(size.width), height: f64::from(size.height), physical: true }
        }
        Size::Logical(size) => Extent { width: size.width, height: size.height, physical: false },
    }
}

fn place(position: Position) -> Place {
    match position {
        Position::Physical(position) => {
            Place { x: f64::from(position.x), y: f64::from(position.y), physical: true }
        }
        Position::Logical(position) => Place { x: position.x, y: position.y, physical: false },
    }
}

#[derive(Debug, Clone)]
pub struct ElectronWindowDispatcher {
    pub(crate) raw: u32,
    pub(crate) context: Context,
}

impl ElectronWindowDispatcher {
    fn tell(&self, call: WindowCall) -> Result<()> {
        self.context.send(&ToShell::WindowCall { window: self.raw, id: None, call }, &[])
    }

    fn ask<A: DeserializeOwned>(&self, call: WindowCall) -> Result<A> {
        self.context.ask(|id| ToShell::WindowCall { window: self.raw, id: Some(id), call })
    }

    fn bounds(&self, call: WindowCall) -> Result<Bounds> {
        self.ask(call)
    }
}

#[derive(Debug, Clone, Default)]
pub struct ElectronWindowBuilder {
    pub(crate) options: WindowOptions,
}

impl WindowBuilderBase for ElectronWindowBuilder {}

impl WindowBuilder for ElectronWindowBuilder {
    absent_from_builder!();

    fn new() -> Self {
        Self::default()
    }

    fn with_config(config: &WindowConfig) -> Self {
        let mut building = Self::default()
            .title(config.title.clone())
            .inner_size(config.width, config.height)
            .resizable(config.resizable)
            .maximizable(config.maximizable)
            .minimizable(config.minimizable)
            .closable(config.closable)
            .fullscreen(config.fullscreen)
            .focused(config.focus)
            .maximized(config.maximized)
            .visible(config.visible)
            .transparent(config.transparent)
            .decorations(config.decorations)
            .always_on_top(config.always_on_top)
            .skip_taskbar(config.skip_taskbar)
            .shadow(config.shadow);
        if let (Some(width), Some(height)) = (config.min_width, config.min_height) {
            building = building.min_inner_size(width, height);
        }
        if let (Some(width), Some(height)) = (config.max_width, config.max_height) {
            building = building.max_inner_size(width, height);
        }
        if let (Some(x), Some(y)) = (config.x, config.y) {
            building = building.position(x, y);
        }
        if config.center {
            building = building.center();
        }
        if let Some(color) = config.background_color {
            building = building.background_color(color);
        }
        building
    }

    fn center(mut self) -> Self {
        self.options.center = Some(true);
        self
    }

    fn position(mut self, x: f64, y: f64) -> Self {
        self.options.x = Some(x);
        self.options.y = Some(y);
        self
    }

    fn inner_size(mut self, width: f64, height: f64) -> Self {
        self.options.width = Some(width);
        self.options.height = Some(height);
        self
    }

    fn min_inner_size(mut self, min_width: f64, min_height: f64) -> Self {
        self.options.min_width = Some(min_width);
        self.options.min_height = Some(min_height);
        self
    }

    fn max_inner_size(mut self, max_width: f64, max_height: f64) -> Self {
        self.options.max_width = Some(max_width);
        self.options.max_height = Some(max_height);
        self
    }

    fn resizable(mut self, resizable: bool) -> Self {
        self.options.resizable = Some(resizable);
        self
    }

    fn maximizable(mut self, maximizable: bool) -> Self {
        self.options.maximizable = Some(maximizable);
        self
    }

    fn minimizable(mut self, minimizable: bool) -> Self {
        self.options.minimizable = Some(minimizable);
        self
    }

    fn closable(mut self, closable: bool) -> Self {
        self.options.closable = Some(closable);
        self
    }

    fn title<S: Into<String>>(mut self, title: S) -> Self {
        self.options.title = Some(title.into());
        self
    }

    fn fullscreen(mut self, fullscreen: bool) -> Self {
        self.options.fullscreen = Some(fullscreen);
        self
    }

    fn focused(mut self, focused: bool) -> Self {
        self.options.focused = Some(focused);
        self
    }

    fn focusable(mut self, focusable: bool) -> Self {
        self.options.focusable = Some(focusable);
        self
    }

    fn maximized(mut self, maximized: bool) -> Self {
        self.options.maximized = Some(maximized);
        self
    }

    fn visible(mut self, visible: bool) -> Self {
        self.options.show = Some(visible);
        self
    }

    fn transparent(mut self, transparent: bool) -> Self {
        self.options.transparent = Some(transparent);
        self
    }

    fn decorations(mut self, decorations: bool) -> Self {
        self.options.frame = Some(decorations);
        self
    }

    fn always_on_top(mut self, always_on_top: bool) -> Self {
        self.options.always_on_top = Some(always_on_top);
        self
    }

    fn skip_taskbar(mut self, skip: bool) -> Self {
        self.options.skip_taskbar = Some(skip);
        self
    }

    fn shadow(mut self, enable: bool) -> Self {
        self.options.has_shadow = Some(enable);
        self
    }

    fn background_color(mut self, color: tauri_utils::config::Color) -> Self {
        self.options.background_color =
            Some(format!("#{:02x}{:02x}{:02x}", color.0, color.1, color.2));
        self
    }
}

impl<T: UserEvent> WindowDispatch<T> for ElectronWindowDispatcher {
    type Runtime = ElectronRuntime;
    type WindowBuilder = ElectronWindowBuilder;

    absent_from_window!();

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.post(Message::Task(Box::new(f)))
    }

    fn on_window_event<F: Fn(&WindowEvent) + Send + 'static>(&self, f: F) -> WindowEventId {
        let id = self.context.next_id();
        if let Some(window) = self.context.window(self.raw) {
            held(&window.listeners).push((id, Box::new(f)));
        }
        id
    }

    fn scale_factor(&self) -> Result<f64> {
        self.ask(WindowCall::ScaleFactor)
    }

    fn inner_position(&self) -> Result<PhysicalPosition<i32>> {
        let said = self.bounds(WindowCall::InnerBounds)?;
        Ok(PhysicalPosition::new(said.x, said.y))
    }

    fn outer_position(&self) -> Result<PhysicalPosition<i32>> {
        let said = self.bounds(WindowCall::OuterBounds)?;
        Ok(PhysicalPosition::new(said.x, said.y))
    }

    fn inner_size(&self) -> Result<PhysicalSize<u32>> {
        let said = self.bounds(WindowCall::InnerBounds)?;
        Ok(PhysicalSize::new(said.width, said.height))
    }

    fn outer_size(&self) -> Result<PhysicalSize<u32>> {
        let said = self.bounds(WindowCall::OuterBounds)?;
        Ok(PhysicalSize::new(said.width, said.height))
    }

    fn is_fullscreen(&self) -> Result<bool> {
        self.ask(WindowCall::IsFullScreen)
    }

    fn is_minimized(&self) -> Result<bool> {
        self.ask(WindowCall::IsMinimized)
    }

    fn is_maximized(&self) -> Result<bool> {
        self.ask(WindowCall::IsMaximized)
    }

    fn is_focused(&self) -> Result<bool> {
        self.ask(WindowCall::IsFocused)
    }

    fn is_decorated(&self) -> Result<bool> {
        self.ask(WindowCall::IsDecorated)
    }

    fn is_resizable(&self) -> Result<bool> {
        self.ask(WindowCall::IsResizable)
    }

    fn is_maximizable(&self) -> Result<bool> {
        self.ask(WindowCall::IsMaximizable)
    }

    fn is_minimizable(&self) -> Result<bool> {
        self.ask(WindowCall::IsMinimizable)
    }

    fn is_closable(&self) -> Result<bool> {
        self.ask(WindowCall::IsClosable)
    }

    fn is_visible(&self) -> Result<bool> {
        self.ask(WindowCall::IsVisible)
    }

    fn is_enabled(&self) -> Result<bool> {
        self.ask(WindowCall::IsEnabled)
    }

    fn is_always_on_top(&self) -> Result<bool> {
        self.ask(WindowCall::IsAlwaysOnTop)
    }

    fn title(&self) -> Result<String> {
        self.ask(WindowCall::GetTitle)
    }

    fn current_monitor(&self) -> Result<Option<Monitor>> {
        Ok(monitors(&self.context, Screens::Window { window: self.raw })?.into_iter().next())
    }

    fn primary_monitor(&self) -> Result<Option<Monitor>> {
        Ok(monitors(&self.context, Screens::Primary)?.into_iter().next())
    }

    fn monitor_from_point(&self, x: f64, y: f64) -> Result<Option<Monitor>> {
        Ok(monitors(&self.context, Screens::Point { x, y })?.into_iter().next())
    }

    fn available_monitors(&self) -> Result<Vec<Monitor>> {
        monitors(&self.context, Screens::All)
    }

    fn theme(&self) -> Result<Theme> {
        Ok(if dark(&self.context)? { Theme::Dark } else { Theme::Light })
    }

    fn center(&self) -> Result<()> {
        self.tell(WindowCall::Center)
    }

    fn request_user_attention(&self, request_type: Option<UserAttentionType>) -> Result<()> {
        self.tell(WindowCall::FlashFrame(request_type.is_some()))
    }

    fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
        &mut self,
        pending: PendingWindow<T, Self::Runtime>,
        _after_window_creation: Option<F>,
    ) -> Result<DetachedWindow<T, Self::Runtime>> {
        crate::create_window(&self.context, pending)
    }

    fn create_webview(
        &mut self,
        pending: PendingWebview<T, Self::Runtime>,
    ) -> Result<DetachedWebview<T, Self::Runtime>> {
        crate::create_webview(&self.context, self.raw, pending)
    }

    fn set_resizable(&self, resizable: bool) -> Result<()> {
        self.tell(WindowCall::SetResizable(resizable))
    }

    fn set_maximizable(&self, maximizable: bool) -> Result<()> {
        self.tell(WindowCall::SetMaximizable(maximizable))
    }

    fn set_minimizable(&self, minimizable: bool) -> Result<()> {
        self.tell(WindowCall::SetMinimizable(minimizable))
    }

    fn set_closable(&self, closable: bool) -> Result<()> {
        self.tell(WindowCall::SetClosable(closable))
    }

    fn set_title<S: Into<String>>(&self, title: S) -> Result<()> {
        self.tell(WindowCall::SetTitle(title.into()))
    }

    fn maximize(&self) -> Result<()> {
        self.tell(WindowCall::Maximize)
    }

    fn unmaximize(&self) -> Result<()> {
        self.tell(WindowCall::Unmaximize)
    }

    fn minimize(&self) -> Result<()> {
        self.tell(WindowCall::Minimize)
    }

    fn unminimize(&self) -> Result<()> {
        self.tell(WindowCall::Restore)
    }

    fn show(&self) -> Result<()> {
        self.tell(WindowCall::Show)
    }

    fn hide(&self) -> Result<()> {
        self.tell(WindowCall::Hide)
    }

    fn close(&self) -> Result<()> {
        self.tell(WindowCall::Close)
    }

    fn destroy(&self) -> Result<()> {
        self.tell(WindowCall::Destroy)
    }

    fn set_shadow(&self, shadow: bool) -> Result<()> {
        self.tell(WindowCall::SetHasShadow(shadow))
    }

    fn set_always_on_top(&self, always_on_top: bool) -> Result<()> {
        self.tell(WindowCall::SetAlwaysOnTop(always_on_top))
    }

    fn set_visible_on_all_workspaces(&self, visible_on_all_workspaces: bool) -> Result<()> {
        self.tell(WindowCall::SetVisibleOnAllWorkspaces(visible_on_all_workspaces))
    }

    fn set_content_protected(&self, protected: bool) -> Result<()> {
        self.tell(WindowCall::SetContentProtection(protected))
    }

    fn set_size(&self, size: Size) -> Result<()> {
        self.tell(WindowCall::SetSize(extent(size)))
    }

    fn set_min_size(&self, size: Option<Size>) -> Result<()> {
        self.tell(WindowCall::SetMinSize(size.map(extent)))
    }

    fn set_max_size(&self, size: Option<Size>) -> Result<()> {
        self.tell(WindowCall::SetMaxSize(size.map(extent)))
    }

    fn set_position(&self, position: Position) -> Result<()> {
        self.tell(WindowCall::SetPosition(place(position)))
    }

    fn set_fullscreen(&self, fullscreen: bool) -> Result<()> {
        self.tell(WindowCall::SetFullScreen(fullscreen))
    }

    #[cfg(target_os = "macos")]
    fn set_simple_fullscreen(&self, enable: bool) -> Result<()> {
        self.tell(WindowCall::SetSimpleFullScreen(enable))
    }

    fn set_focus(&self) -> Result<()> {
        self.tell(WindowCall::Focus)
    }

    fn set_focusable(&self, focusable: bool) -> Result<()> {
        self.tell(WindowCall::SetFocusable(focusable))
    }

    fn set_skip_taskbar(&self, skip: bool) -> Result<()> {
        self.tell(WindowCall::SetSkipTaskbar(skip))
    }

    fn set_ignore_cursor_events(&self, ignore: bool) -> Result<()> {
        self.tell(WindowCall::SetIgnoreMouseEvents(ignore))
    }

    fn set_theme(&self, theme: Option<Theme>) -> Result<()> {
        wear(&self.context, theme)
    }

    fn set_enabled(&self, enabled: bool) -> Result<()> {
        self.tell(WindowCall::SetEnabled(enabled))
    }
}
