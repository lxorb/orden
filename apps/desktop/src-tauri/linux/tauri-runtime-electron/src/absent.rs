macro_rules! absent_from_builder {
    () => {
        fn inner_size_constraints(
            self,
            _constraints: tauri_runtime::window::WindowSizeConstraints,
        ) -> Self {
            self
        }
        fn prevent_overflow(self) -> Self {
            self
        }
        fn prevent_overflow_with_margin(self, _margin: tauri_runtime::dpi::Size) -> Self {
            self
        }
        fn always_on_bottom(self, _always_on_bottom: bool) -> Self {
            self
        }
        fn visible_on_all_workspaces(self, _visible_on_all_workspaces: bool) -> Self {
            self
        }
        fn content_protected(self, _protected: bool) -> Self {
            self
        }
        fn icon(self, _icon: tauri_runtime::Icon<'_>) -> tauri_runtime::Result<Self> {
            Ok(self)
        }
        fn window_classname<S: Into<String>>(self, _classname: S) -> Self {
            self
        }
        fn no_redirection_bitmap(self, _enable: bool) -> Self {
            self
        }
        fn theme(self, _theme: Option<tauri_utils::Theme>) -> Self {
            self
        }
        fn has_icon(&self) -> bool {
            false
        }
        fn get_theme(&self) -> Option<tauri_utils::Theme> {
            None
        }
        #[cfg(windows)]
        fn owner(self, _owner: windows::Win32::Foundation::HWND) -> Self {
            self
        }
        #[cfg(windows)]
        fn parent(self, _parent: windows::Win32::Foundation::HWND) -> Self {
            self
        }
        #[cfg(target_os = "macos")]
        fn parent(self, _parent: *mut std::ffi::c_void) -> Self {
            self
        }
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        fn transient_for(self, _parent: *mut std::ffi::c_void) -> Self {
            self
        }
        #[cfg(windows)]
        fn drag_and_drop(self, _enabled: bool) -> Self {
            self
        }
        #[cfg(target_os = "macos")]
        fn title_bar_style(self, _style: tauri_utils::TitleBarStyle) -> Self {
            self
        }
        #[cfg(target_os = "macos")]
        fn traffic_light_position<P: Into<tauri_runtime::dpi::Position>>(
            self,
            _position: P,
        ) -> Self {
            self
        }
        #[cfg(target_os = "macos")]
        fn hidden_title(self, _hidden: bool) -> Self {
            self
        }
        #[cfg(target_os = "macos")]
        fn tabbing_identifier(self, _identifier: &str) -> Self {
            self
        }
    };
}

macro_rules! absent_from_window {
    () => {
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        fn gtk_window(&self) -> tauri_runtime::Result<*mut std::ffi::c_void> {
            Err(tauri_runtime::Error::WindowNotFound)
        }
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        fn default_vbox(&self) -> tauri_runtime::Result<*mut std::ffi::c_void> {
            Err(tauri_runtime::Error::WindowNotFound)
        }
        fn window_handle(
            &self,
        ) -> std::result::Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError>
        {
            Err(raw_window_handle::HandleError::Unavailable)
        }
        fn set_decorations(&self, _decorations: bool) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_always_on_bottom(&self, _always_on_bottom: bool) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_fullscreen_on_monitor(
            &self,
            _position: tauri_runtime::dpi::PhysicalPosition<f64>,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_icon(&self, _icon: tauri_runtime::Icon<'_>) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_cursor_grab(&self, _grab: bool) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_cursor_visible(&self, _visible: bool) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_cursor_icon(
            &self,
            _icon: tauri_runtime::window::CursorIcon,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_cursor_position<Pos: Into<tauri_runtime::dpi::Position>>(
            &self,
            _position: Pos,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn start_dragging(&self) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn start_resize_dragging(
            &self,
            _direction: tauri_runtime::ResizeDirection,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_progress_bar(
            &self,
            _progress_state: tauri_runtime::ProgressBarState,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_badge_count(
            &self,
            _count: Option<i64>,
            _desktop_filename: Option<String>,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_badge_label(&self, _label: Option<String>) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_overlay_icon(
            &self,
            _icon: Option<tauri_runtime::Icon<'_>>,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_title_bar_style(
            &self,
            _style: tauri_utils::TitleBarStyle,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_traffic_light_position(
            &self,
            _position: tauri_runtime::dpi::Position,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_size_constraints(
            &self,
            _constraints: tauri_runtime::window::WindowSizeConstraints,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_background_color(
            &self,
            _color: Option<tauri_utils::config::Color>,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
    };
}

macro_rules! absent_from_webview {
    () => {
        fn on_webview_event<F: Fn(&tauri_runtime::window::WebviewEvent) + Send + 'static>(
            &self,
            _f: F,
        ) -> tauri_runtime::WebviewEventId {
            self.context.next_id()
        }
        fn close(&self) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_bounds(&self, _bounds: tauri_runtime::dpi::Rect) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_size(&self, _size: tauri_runtime::dpi::Size) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_position(
            &self,
            _position: tauri_runtime::dpi::Position,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn reparent(
            &self,
            _window_id: tauri_runtime::window::WindowId,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn cookies(&self) -> tauri_runtime::Result<Vec<tauri_runtime::Cookie<'static>>> {
            Ok(Vec::new())
        }
        fn cookies_for_url(
            &self,
            _url: url::Url,
        ) -> tauri_runtime::Result<Vec<tauri_runtime::Cookie<'static>>> {
            Ok(Vec::new())
        }
        fn set_cookie(&self, _cookie: tauri_runtime::Cookie<'_>) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn delete_cookie(&self, _cookie: tauri_runtime::Cookie<'_>) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_auto_resize(&self, _auto_resize: bool) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn hide(&self) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn show(&self) -> tauri_runtime::Result<()> {
            Ok(())
        }
        fn set_background_color(
            &self,
            _color: Option<tauri_utils::config::Color>,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
    };
}

macro_rules! absent_from_handle {
    () => {
        fn display_handle(
            &self,
        ) -> std::result::Result<raw_window_handle::DisplayHandle<'_>, raw_window_handle::HandleError>
        {
            Err(raw_window_handle::HandleError::Unavailable)
        }
        fn set_device_event_filter(&self, _filter: tauri_runtime::DeviceEventFilter) {}
        #[cfg(target_os = "macos")]
        fn set_activation_policy(
            &self,
            _activation_policy: tauri_runtime::ActivationPolicy,
        ) -> tauri_runtime::Result<()> {
            Ok(())
        }
        #[cfg(target_os = "macos")]
        fn set_dock_visibility(&self, _visible: bool) -> tauri_runtime::Result<()> {
            Ok(())
        }
        #[cfg(target_os = "macos")]
        fn show(&self) -> tauri_runtime::Result<()> {
            Ok(())
        }
        #[cfg(target_os = "macos")]
        fn hide(&self) -> tauri_runtime::Result<()> {
            Ok(())
        }
        #[cfg(target_os = "macos")]
        fn fetch_data_store_identifiers<F: FnOnce(Vec<[u8; 16]>) + Send + 'static>(
            &self,
            cb: F,
        ) -> tauri_runtime::Result<()> {
            cb(Vec::new());
            Ok(())
        }
        #[cfg(target_os = "macos")]
        fn remove_data_store<F: FnOnce(tauri_runtime::Result<()>) + Send + 'static>(
            &self,
            _uuid: [u8; 16],
            cb: F,
        ) -> tauri_runtime::Result<()> {
            cb(Ok(()));
            Ok(())
        }
    };
}

macro_rules! absent_from_runtime {
    () => {
        fn set_device_event_filter(&mut self, _filter: tauri_runtime::DeviceEventFilter) {}
        #[cfg(target_os = "macos")]
        fn set_activation_policy(&mut self, _activation_policy: tauri_runtime::ActivationPolicy) {}
        #[cfg(target_os = "macos")]
        fn set_dock_visibility(&mut self, _visible: bool) {}
        #[cfg(target_os = "macos")]
        fn set_activate_ignoring_other_apps(&mut self, _ignore: bool) {}
        #[cfg(target_os = "macos")]
        fn show(&self) {}
        #[cfg(target_os = "macos")]
        fn hide(&self) {}
    };
}
