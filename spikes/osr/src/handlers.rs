#![allow(clippy::transmute_ptr_to_ptr)]
use std::os::raw::c_int;

use cef::*;

use crate::{comp, log, win};

wrap_app! {
    pub struct SpikeApp;
    impl App {
        fn on_before_command_line_processing(
            &self,
            process_type: Option<&CefString>,
            command_line: Option<&mut CommandLine>,
        ) {
            let Some(line) = command_line else {
                return;
            };
            if process_type.map(|kind| kind.to_string()).unwrap_or_default().is_empty() {
                for (name, value) in [
                    ("force-color-profile", "srgb"),
                    ("force-device-scale-factor", "1"),
                    ("autoplay-policy", "no-user-gesture-required"),
                ] {
                    if line.has_switch(Some(&CefString::from(name))) == 0 {
                        line.append_switch_with_value(Some(&CefString::from(name)), Some(&CefString::from(value)));
                    }
                }
            }
        }
    }
}

wrap_client! {
    pub struct SpikeClient {
        role: u8,
    }
    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            if self.role == 0 {
                None
            } else {
                Some(Paint::new(self.role))
            }
        }
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(Life::new(self.role))
        }
        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(Console::new(self.role))
        }
    }
}

wrap_life_span_handler! {
    struct Life {
        role: u8,
    }
    impl LifeSpanHandler {
        fn on_after_created(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                win::created(self.role, browser.clone());
            }
        }
        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            win::closed(self.role);
        }
    }
}

wrap_display_handler! {
    struct Console {
        role: u8,
    }
    impl DisplayHandler {
        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            message: Option<&CefString>,
            _source: Option<&CefString>,
            _line: c_int,
        ) -> c_int {
            let text = message.map(|said| said.to_string()).unwrap_or_default();
            if text.starts_with("SPIKE") {
                log::line(format!(
                    r#"{{"ev":"console","v":{},"t":{},"msg":"{}"}}"#,
                    self.role,
                    log::qpc(),
                    log::esc(&text)
                ));
            }
            0
        }
    }
}

wrap_render_handler! {
    struct Paint {
        role: u8,
    }
    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (width, height) = win::view_size(self.role);
                *rect = Rect { x: 0, y: 0, width, height };
            }
        }
        fn screen_info(&self, _browser: Option<&mut Browser>, screen_info: Option<&mut ScreenInfo>) -> c_int {
            let Some(screen) = screen_info else {
                return 0;
            };
            let (width, height) = win::screen_size();
            let whole = Rect { x: 0, y: 0, width, height };
            screen.device_scale_factor = 1.0;
            screen.depth = 24;
            screen.depth_per_component = 8;
            screen.rect = whole.clone();
            screen.available_rect = whole;
            1
        }
        fn on_paint(
            &self,
            _browser: Option<&mut Browser>,
            type_: PaintElementType,
            dirty_rects: Option<&[Rect]>,
            buffer: *const u8,
            width: c_int,
            height: c_int,
        ) {
            if type_ == PaintElementType::VIEW {
                comp::software(self.role, dirty_rects.unwrap_or(&[]), buffer, width, height);
            }
        }
        fn on_accelerated_paint(
            &self,
            _browser: Option<&mut Browser>,
            type_: PaintElementType,
            dirty_rects: Option<&[Rect]>,
            info: Option<&AcceleratedPaintInfo>,
        ) {
            if let Some(info) = info {
                if type_ == PaintElementType::VIEW {
                    comp::accelerated(self.role, dirty_rects.unwrap_or(&[]), info);
                }
            }
        }
    }
}
