use cef::*;

wrap_focus_handler! {
  pub struct TauriCefFocusHandler {
    label: Option<String>,
  }

  impl FocusHandler {
    fn on_take_focus(&self, browser: Option<&mut Browser>, next: ::std::os::raw::c_int) {
      if let Some(label) = self.label.as_deref()
        && browser.is_some_and(|browser| browser.is_popup() == 0)
      {
        crate::keys::left(label, next != 0);
      }
    }
  }
}
