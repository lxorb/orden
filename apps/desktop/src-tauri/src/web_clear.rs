use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager as _, Webview, WebviewBuilder, WebviewUrl,
};

const PATIENCE: Duration = Duration::from_secs(30);

static NEXT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clearing {
    pub since: f64,
    pub site: bool,
    pub cache: bool,
}

impl Clearing {
    const fn any(self) -> bool {
        self.site || self.cache
    }

    fn always(self) -> bool {
        self.since <= 0.0
    }
}

#[tauri::command]
pub async fn web_clear(
    webview: Webview,
    stores: Vec<Option<String>>,
    clearing: Clearing,
    sites: Option<Vec<String>>,
) -> Result<(), String> {
    let sites = sites.unwrap_or_default();
    if !clearing.any() {
        return Ok(());
    }
    let app = webview.app_handle().clone();
    for store in stores {
        let store = crate::web_stores::named(store.as_deref())?.map(str::to_string);
        let page = page_in_store(&app, &webview.window(), store.as_deref()).await?;
        let cleared = engine::clear(&page, clearing, &sites).await;
        let _ = page.close();
        cleared?;
    }
    Ok(())
}

async fn page_in_store(
    app: &AppHandle,
    window: &tauri::Window,
    store: Option<&str>,
) -> Result<Webview, String> {
    let label = format!("web-clearing-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let blank: tauri::Url = "about:blank"
        .parse()
        .map_err(|_| "the data could not be reached".to_string())?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(blank))
        .focused(false)
        .disable_drag_drop_handler();
    let builder = crate::engine::web_store(builder, app, store)?;

    let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
    let building = window.clone();
    app.run_on_main_thread(move || {
        let made = crate::engine::add_child(
            &building,
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map(|view| {
            let _ = view.hide();
        })
        .map_err(|error| format!("the data could not be reached: {error}"));
        let _ = sending.try_send(made);
    })
    .map_err(|error| format!("the data could not be reached: {error}"))?;

    waiting
        .recv()
        .await
        .unwrap_or_else(|| Err("the data could not be reached".to_string()))?;
    app.get_webview(&label)
        .ok_or_else(|| "the data could not be reached".to_string())
}

mod engine {
    use serde_json::{json, Value};

    use super::{Clearing, PATIENCE};

    pub(super) fn asks(clearing: Clearing, sites: &[String]) -> Vec<(&'static str, Value)> {
        let mut asks = Vec::new();
        if clearing.site {
            if clearing.always() {
                asks.push(("Network.clearBrowserCookies", json!({})));
            }
            for origin in sites {
                asks.push((
                    "Storage.clearDataForOrigin",
                    json!({ "origin": origin, "storageTypes": "all" }),
                ));
            }
        }
        if clearing.cache {
            asks.push(("Network.clearBrowserCache", json!({})));
        }
        asks
    }

    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        sites: &[String],
    ) -> Result<(), String> {
        let page = page.clone();
        let asks = asks(clearing, sites);
        tauri::async_runtime::spawn_blocking(move || {
            for (method, params) in asks {
                crate::engine::devtools::call(&page, None, method, &params, PATIENCE)?;
            }
            Ok(())
        })
        .await
        .map_err(|error| format!("the data could not be deleted: {error}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::Clearing;

    #[test]
    fn what_the_window_says_is_read() {
        let said: Clearing =
            serde_json::from_str(r#"{"since":1700000000000,"site":true,"cache":false}"#)
                .expect("a clearing");
        assert_eq!(
            said,
            Clearing {
                since: 1_700_000_000_000.0,
                site: true,
                cache: false
            }
        );
        assert!(!said.always());
    }

    #[test]
    fn chromium_is_asked_site_by_site() {
        let sites = vec!["https://a.example".to_string()];
        let ranged = Clearing {
            since: 5.0,
            site: true,
            cache: true,
        };
        let methods: Vec<&str> = super::engine::asks(ranged, &sites)
            .into_iter()
            .map(|(method, _)| method)
            .collect();
        assert_eq!(
            methods,
            ["Storage.clearDataForOrigin", "Network.clearBrowserCache"]
        );

        let always = Clearing {
            since: 0.0,
            ..ranged
        };
        assert_eq!(
            super::engine::asks(always, &sites)[0].0,
            "Network.clearBrowserCookies"
        );
    }
}
