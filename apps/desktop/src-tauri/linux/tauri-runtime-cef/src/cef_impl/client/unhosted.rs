// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! A browser Chrome makes by itself, through its own UI, rather than one the runtime made
//! or a page's popup: a tab an extension opens - its page about its own install, its
//! dashboard - with no Chrome window to put it in. Chrome puts it in a window of Chrome's
//! own, tab strip, address bar and all, which a desktop shows as Chromium (lxorb/orden#1148);
//! and with no client the browser is one nothing hears of and shutdown waits on. It is
//! closed as soon as it is there.

use cef::*;

wrap_life_span_handler! {
  struct UnhostedLifeSpanHandler;

  impl LifeSpanHandler {
    fn on_after_created(&self, browser: Option<&mut Browser>) {
      let Some(browser) = browser else {
        return;
      };
      let address = browser
        .main_frame()
        .map(|frame| CefString::from(&frame.url()).to_string())
        .unwrap_or_default();
      log::info!("closed a window Chrome opened by itself: {address}");
      if let Some(host) = browser.host() {
        host.close_browser(1);
      }
    }
  }
}

wrap_client! {
  struct UnhostedClient;

  impl Client {
    fn life_span_handler(&self) -> Option<LifeSpanHandler> {
      Some(UnhostedLifeSpanHandler::new())
    }
  }
}

/// The client every browser Chrome's own UI makes is given.
pub(crate) fn client() -> Client {
  UnhostedClient::new()
}
