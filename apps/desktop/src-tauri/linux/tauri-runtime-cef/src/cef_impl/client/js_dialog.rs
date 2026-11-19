use std::sync::Arc;

use cef::*;
use tauri_runtime::window::WindowId;

wrap_jsdialog_handler! {
  pub struct TauriCefJsDialogHandler {
    window: WindowId,
    handler: Arc<crate::JsDialogHandler>,
  }

  impl JsdialogHandler {
    fn on_jsdialog(
      &self,
      browser: Option<&mut Browser>,
      origin_url: Option<&CefString>,
      dialog_type: JsdialogType,
      message_text: Option<&CefString>,
      default_prompt_text: Option<&CefString>,
      callback: Option<&mut JsdialogCallback>,
      _suppress_message: Option<&mut ::std::os::raw::c_int>,
    ) -> ::std::os::raw::c_int {
      ::std::os::raw::c_int::from(crate::js_dialog::asked(
        &self.handler,
        self.window,
        browser,
        crate::js_dialog::kind_of(dialog_type),
        message_text,
        default_prompt_text,
        origin_url,
        false,
        callback,
      ))
    }

    fn on_before_unload_dialog(
      &self,
      browser: Option<&mut Browser>,
      message_text: Option<&CefString>,
      is_reload: ::std::os::raw::c_int,
      callback: Option<&mut JsdialogCallback>,
    ) -> ::std::os::raw::c_int {
      ::std::os::raw::c_int::from(crate::js_dialog::asked(
        &self.handler,
        self.window,
        browser,
        "beforeunload",
        message_text,
        None,
        None,
        is_reload != 0,
        callback,
      ))
    }

    fn on_reset_dialog_state(&self, browser: Option<&mut Browser>) {
      if let Some(browser) = browser {
        let id = browser.identifier();
        crate::js_dialog::drop_where(|one, _| one == id);
      }
    }
  }
}
