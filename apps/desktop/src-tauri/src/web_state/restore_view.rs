use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::async_runtime::{channel, Receiver};
use tauri::webview::PageLoadEvent;
use tauri::{
    LogicalPosition, LogicalSize, Manager as _, Url, Webview, WebviewBuilder, WebviewUrl, Window,
};

use super::PATIENCE;

pub(crate) const PATH: &str = "/__orden_restore";

const VISIT: Duration = Duration::from_secs(15);

static MADE: AtomicU64 = AtomicU64::new(0);

pub(crate) struct Hidden {
    view: Webview,
    loads: Receiver<String>,
}

impl Hidden {
    pub(crate) async fn open(window: &Window, store: Option<&str>) -> Result<Self, String> {
        let app = window.app_handle().clone();
        let label = format!("web-state-{}", MADE.fetch_add(1, Ordering::Relaxed));
        let (loaded, loads) = channel(16);
        let blank: Url = "about:blank"
            .parse()
            .map_err(|_| "no blank page to start from".to_owned())?;

        let builder = WebviewBuilder::new(label, WebviewUrl::External(blank))
            .focused(false)
            .disable_drag_drop_handler()
            .on_page_load(move |_view, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    let _ = loaded.try_send(payload.url().to_string());
                }
            });
        let builder = crate::engine::web_store(builder, &app, store)?;

        let (made, mut waiting) = channel(1);
        let holder = window.clone();
        app.run_on_main_thread(move || {
            let built = crate::engine::add_child(
                &holder,
                builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|error| format!("no page could be made to restore into: {error}"));
            if let Ok(view) = &built {
                let _ = view.hide();
            }
            let _ = made.try_send(built);
        })
        .map_err(|error| error.to_string())?;

        let view = match tokio::time::timeout(PATIENCE, waiting.recv()).await {
            Ok(Some(built)) => built?,
            _ => return Err("no page could be made to restore into".to_owned()),
        };
        let hidden = Self { view, loads };
        engine::prepared(&hidden.view).await?;
        Ok(hidden)
    }

    pub(crate) fn view(&self) -> &Webview {
        &self.view
    }

    pub(crate) async fn visit(&mut self, origin: &str) -> Result<(), String> {
        let address = format!("{origin}{PATH}");
        engine::show(&self.view, &address)?;
        loop {
            match tokio::time::timeout(VISIT, self.loads.recv()).await {
                Ok(Some(loaded)) if loaded.starts_with(&address) => return Ok(()),
                Ok(Some(_)) => {}
                _ => return Err(format!("{origin} could not be opened to restore into")),
            }
        }
    }
}

impl Drop for Hidden {
    fn drop(&mut self) {
        let _ = self.view.close();
    }
}

mod engine {
    use serde_json::{json, Value};
    use tauri::{Url, Webview};

    use super::super::cdp;
    use super::PATH;

    pub(super) async fn prepared(view: &Webview) -> Result<(), String> {
        let answering = view.clone();
        crate::engine::devtools::hear(view, move |method, session, params: &Value| {
            if method != "Fetch.requestPaused" || session.is_some() {
                return;
            }
            let Some(id) = params["requestId"].as_str() else {
                return;
            };
            crate::engine::devtools::tell(
                &answering,
                None,
                vec![(
                    "Fetch.fulfillRequest",
                    json!({
                        "requestId": id,
                        "responseCode": 200,
                        "responseHeaders": [
                            { "name": "Content-Type", "value": "text/html; charset=utf-8" }
                        ],
                        "body": "",
                    }),
                )],
            );
        })?;
        cdp::call(
            view,
            "Fetch.enable",
            &json!({ "patterns": [{ "urlPattern": format!("*{PATH}"), "requestStage": "Request" }] }),
        )
        .await
        .map(|_| ())
    }

    pub(super) fn show(view: &Webview, address: &str) -> Result<(), String> {
        let url: Url = address
            .parse()
            .map_err(|_| format!("{address} is not an address"))?;
        view.navigate(url).map_err(|error| error.to_string())
    }
}
