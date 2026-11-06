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
    #[cfg(all(windows, not(feature = "cef")))]
    let (anchoring, storing) = (app.clone(), store.map(str::to_string));
    app.run_on_main_thread(move || {
        #[cfg(all(windows, not(feature = "cef")))]
        let builder =
            crate::web_tabs::on_shared_session(builder, &building, &anchoring, storing.as_deref());
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

#[cfg_attr(
    feature = "cef",
    allow(dead_code, reason = "CEF has no range; see the top of this file")
)]
fn seconds(clearing: Clearing) -> f64 {
    clearing.since / 1000.0
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS,
        COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    };
    use windows_core::Interface as _;

    use super::{seconds, Clearing, PATIENCE};

    fn kinds(clearing: Clearing) -> COREWEBVIEW2_BROWSING_DATA_KINDS {
        let mut kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(0);
        if clearing.site {
            kinds |= COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE;
        }
        if clearing.cache {
            kinds |= COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE;
        }
        kinds
    }

    #[allow(
        unsafe_code,
        reason = "a profile's data is cleared through WebView2's own COM interfaces, on the page's own thread"
    )]
    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
        page.with_webview(move |platform| {
            let failed = sending.clone();
            let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
                let _ = sending.try_send(
                    result.map_err(|error| format!("the data could not be deleted: {error}")),
                );
                Ok(())
            }));
            let asked = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_13>())
                    .and_then(|core| core.Profile())
                    .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
                    .and_then(|profile| {
                        if clearing.always() {
                            profile.ClearBrowsingData(kinds(clearing), &handler)
                        } else {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map_or(0.0, |since| since.as_secs_f64());
                            profile.ClearBrowsingDataInTimeRange(
                                kinds(clearing),
                                seconds(clearing),
                                now + 60.0,
                                &handler,
                            )
                        }
                    })
            };
            if let Err(error) = asked {
                let _ = failed.try_send(Err(format!("the data could not be deleted: {error}")));
            }
        })
        .map_err(|error| format!("the data could not be reached: {error}"))?;

        super::within(PATIENCE, waiting.recv()).await
    }
}

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod engine {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSDate, NSSet, NSString};
    use objc2_web_kit::{
        WKWebView, WKWebsiteDataStore, WKWebsiteDataTypeCookies, WKWebsiteDataTypeDiskCache,
        WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeIndexedDBDatabases,
        WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeMemoryCache,
        WKWebsiteDataTypeOfflineWebApplicationCache, WKWebsiteDataTypeServiceWorkerRegistrations,
        WKWebsiteDataTypeSessionStorage, WKWebsiteDataTypeWebSQLDatabases,
    };

    use super::{seconds, Clearing, PATIENCE};

    #[allow(
        unsafe_code,
        reason = "a constant only some versions of WebKit export is found through dlsym"
    )]
    pub(super) fn file_system_type() -> Option<&'static NSString> {
        let found =
            unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"WKWebsiteDataTypeFileSystem".as_ptr()) };
        (!found.is_null()).then(|| unsafe { *found.cast::<&'static NSString>() })
    }

    #[allow(
        unsafe_code,
        reason = "the data types are WebKit's own constants, read as the statics they are"
    )]
    fn types(clearing: Clearing, mtm: MainThreadMarker) -> Retained<NSSet<NSString>> {
        if clearing.site && clearing.cache {
            return unsafe { WKWebsiteDataStore::allWebsiteDataTypes(mtm) };
        }
        let mut named: Vec<&NSString> = unsafe {
            if clearing.site {
                vec![
                    WKWebsiteDataTypeCookies,
                    WKWebsiteDataTypeLocalStorage,
                    WKWebsiteDataTypeSessionStorage,
                    WKWebsiteDataTypeIndexedDBDatabases,
                    WKWebsiteDataTypeWebSQLDatabases,
                    WKWebsiteDataTypeServiceWorkerRegistrations,
                    WKWebsiteDataTypeFetchCache,
                    WKWebsiteDataTypeOfflineWebApplicationCache,
                ]
            } else {
                vec![WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
            }
        };
        if clearing.site {
            named.extend(file_system_type());
        }
        NSSet::from_slice(&named)
    }

    #[allow(
        unsafe_code,
        reason = "the data store is reached through WKWebView's Objective-C interface, from the pointer wry hands out"
    )]
    pub async fn clear(
        page: &tauri::Webview,
        clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        let (sending, mut waiting) = tauri::async_runtime::channel::<Result<(), String>>(1);
        page.with_webview(move |platform| {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = sending.try_send(Err("the data could not be reached".to_string()));
                return;
            };
            let Some(view) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) })
            else {
                let _ = sending.try_send(Err("the data could not be reached".to_string()));
                return;
            };
            let since = if clearing.always() {
                NSDate::distantPast()
            } else {
                NSDate::dateWithTimeIntervalSince1970(seconds(clearing))
            };
            let done = RcBlock::new(move || {
                let _ = sending.try_send(Ok(()));
            });
            unsafe {
                view.configuration()
                    .websiteDataStore()
                    .removeDataOfTypes_modifiedSince_completionHandler(
                        &types(clearing, mtm),
                        &since,
                        &done,
                    );
            }
        })
        .map_err(|error| format!("the data could not be reached: {error}"))?;

        super::within(PATIENCE, waiting.recv()).await
    }
}

#[cfg(feature = "cef")]
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

#[cfg(not(any(feature = "cef", windows, target_os = "macos")))]
mod engine {
    use super::Clearing;

    pub async fn clear(
        _page: &tauri::Webview,
        _clearing: Clearing,
        _sites: &[String],
    ) -> Result<(), String> {
        Ok(())
    }
}

#[cfg_attr(
    feature = "cef",
    allow(dead_code, reason = "the protocol's calls wait for themselves")
)]
async fn within(
    patience: Duration,
    answer: impl std::future::Future<Output = Option<Result<(), String>>>,
) -> Result<(), String> {
    match tokio::time::timeout(patience, answer).await {
        Ok(Some(said)) => said,
        Ok(None) => Err("the data could not be deleted".to_string()),
        Err(_) => Err("the engine did not answer in time".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::Clearing;

    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    #[test]
    fn a_mac_finds_the_file_systems_type() {
        let found = super::engine::file_system_type().expect("macOS 14 or later");
        assert_eq!(found.to_string(), "WKWebsiteDataTypeFileSystem");
    }

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

    #[cfg(feature = "cef")]
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
