// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! A browser Chrome makes by itself, through its own UI, rather than one the runtime made
//! or a page's popup: a tab an extension opens - its page about its own install, its
//! dashboard - with no Chrome window to put it in. Chrome puts it in a window of Chrome's
//! own, tab strip, address bar and all, which a desktop shows as Chromium (lxorb/orden#1148);
//! and with no client the browser is one nothing hears of and shutdown waits on. Its window
//! is taken off the screen as it is made, before it has an address; its first navigation is
//! where the address is, which is handed to [`crate::Cef::on_unhosted_tab`] - the
//! application opens it where it opens pages (lxorb/orden#1161) - and the navigation
//! cancelled and the browser closed, so the page never runs in it.

use std::sync::Arc;

use cef::*;

wrap_life_span_handler! {
  struct UnhostedLifeSpanHandler;

  impl LifeSpanHandler {
    fn on_after_created(&self, browser: Option<&mut Browser>) {
      #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
      ))]
      if let Some(host) = browser.and_then(|browser| browser.host()) {
        crate::platform::linux::put_out_of_sight(host.window_handle());
      }
      #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
      )))]
      let _ = browser;
    }
  }
}

wrap_request_handler! {
  struct UnhostedRequestHandler {
    handler: Option<Arc<crate::UnhostedTabHandler>>,
  }

  impl RequestHandler {
    fn on_before_browse(
      &self,
      browser: Option<&mut Browser>,
      frame: Option<&mut Frame>,
      request: Option<&mut Request>,
      _user_gesture: std::os::raw::c_int,
      _is_redirect: std::os::raw::c_int,
    ) -> std::os::raw::c_int {
      let (Some(browser), Some(frame), Some(request)) = (browser, frame, request) else {
        return 0;
      };
      let address = CefString::from(&request.url()).to_string();
      if frame.is_main() == 0 || address.is_empty() || address == "about:blank" {
        return 0;
      }
      log::info!("a window Chrome opened by itself, handed over as a tab: {address}");
      if let (Some(handler), Ok(url)) = (&self.handler, url::Url::parse(&address)) {
        handler(url);
      }
      if let Some(host) = browser.host() {
        host.close_browser(1);
      }
      1
    }
  }
}

wrap_client! {
  struct UnhostedClient {
    handler: Option<Arc<crate::UnhostedTabHandler>>,
  }

  impl Client {
    fn life_span_handler(&self) -> Option<LifeSpanHandler> {
      Some(UnhostedLifeSpanHandler::new())
    }

    fn request_handler(&self) -> Option<RequestHandler> {
      Some(UnhostedRequestHandler::new(self.handler.clone()))
    }
  }
}

/// The client every browser Chrome's own UI makes is given.
pub(crate) fn client(handler: Option<Arc<crate::UnhostedTabHandler>>) -> Client {
  UnhostedClient::new(handler)
}
