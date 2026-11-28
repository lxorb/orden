use serde::de::DeserializeOwned;
use tauri_runtime::dpi::{PhysicalPosition, PhysicalSize, Position, Rect, Size};
use tauri_runtime::{Result, UserEvent, WebviewDispatch};
use url::Url;

use crate::pipe::{Context, Message};
use crate::wire::{Bounds, ToShell, WebviewCall};
use crate::ElectronRuntime;

#[derive(Debug, Clone)]
pub struct ElectronWebviewDispatcher {
    pub(crate) id: u32,
    pub(crate) context: Context,
}

impl ElectronWebviewDispatcher {
    fn tell(&self, call: WebviewCall) -> Result<()> {
        self.context.send(&ToShell::WebviewCall { webview: self.id, id: None, call }, &[])
    }

    fn ask<A: DeserializeOwned>(&self, call: WebviewCall) -> Result<A> {
        self.context.ask(|id| ToShell::WebviewCall { webview: self.id, id: Some(id), call })
    }

    fn placed(&self) -> Result<Bounds> {
        self.ask(WebviewCall::Bounds)
    }
}

impl<T: UserEvent> WebviewDispatch<T> for ElectronWebviewDispatcher {
    type Runtime = ElectronRuntime;

    absent_from_webview!();

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.post(Message::Task(Box::new(f)))
    }

    fn with_webview<F: FnOnce(()) + Send + 'static>(&self, f: F) -> Result<()> {
        self.context.post(Message::Task(Box::new(move || f(()))))
    }

    fn open_devtools(&self) {
        let _ = self.tell(WebviewCall::OpenDevTools);
    }

    fn close_devtools(&self) {
        let _ = self.tell(WebviewCall::CloseDevTools);
    }

    fn is_devtools_open(&self) -> Result<bool> {
        self.ask(WebviewCall::IsDevToolsOpened)
    }

    fn set_zoom(&self, scale_factor: f64) -> Result<()> {
        self.tell(WebviewCall::SetZoomFactor(scale_factor))
    }

    fn eval_script<S: Into<String>>(&self, script: S) -> Result<()> {
        self.context.send(&ToShell::Eval { webview: self.id, id: None, script: script.into() }, &[])
    }

    fn eval_script_with_callback<S: Into<String>>(
        &self,
        script: S,
        callback: impl Fn(String) + Send + 'static,
    ) -> Result<()> {
        let context = self.context.clone();
        let webview = self.id;
        let script = script.into();
        std::thread::Builder::new()
            .name("orden-electron-eval".into())
            .spawn(move || {
                let said: Result<serde_json::Value> =
                    context.ask(|id| ToShell::Eval { webview, id: Some(id), script });
                if let Ok(said) = said {
                    callback(said.to_string());
                }
            })
            .map(|_| ())
            .map_err(|_| tauri_runtime::Error::FailedToSendMessage)
    }

    fn url(&self) -> Result<String> {
        self.ask(WebviewCall::GetUrl)
    }

    fn bounds(&self) -> Result<Rect> {
        let said = self.placed()?;
        Ok(Rect {
            position: Position::Physical(PhysicalPosition::new(said.x, said.y)),
            size: Size::Physical(PhysicalSize::new(said.width, said.height)),
        })
    }

    fn position(&self) -> Result<PhysicalPosition<i32>> {
        let said = self.placed()?;
        Ok(PhysicalPosition::new(said.x, said.y))
    }

    fn size(&self) -> Result<PhysicalSize<u32>> {
        let said = self.placed()?;
        Ok(PhysicalSize::new(said.width, said.height))
    }

    fn navigate(&self, url: Url) -> Result<()> {
        self.tell(WebviewCall::LoadUrl(url.to_string()))
    }

    fn reload(&self) -> Result<()> {
        self.tell(WebviewCall::Reload)
    }

    fn go_back(&self) -> Result<()> {
        self.tell(WebviewCall::GoBack)
    }

    fn can_go_back(&self) -> Result<bool> {
        self.ask(WebviewCall::CanGoBack)
    }

    fn go_forward(&self) -> Result<()> {
        self.tell(WebviewCall::GoForward)
    }

    fn can_go_forward(&self) -> Result<bool> {
        self.ask(WebviewCall::CanGoForward)
    }

    fn print(&self) -> Result<()> {
        self.tell(WebviewCall::Print)
    }

    fn set_focus(&self) -> Result<()> {
        self.tell(WebviewCall::Focus)
    }

    fn clear_all_browsing_data(&self) -> Result<()> {
        self.tell(WebviewCall::ClearData)
    }
}
