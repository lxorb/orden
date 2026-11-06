#[cfg(target_os = "macos")]
const FULL_SCREEN_ROW: &str = "NSFullScreenMenuItemEverywhere";

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "registering defaults takes a dictionary whose values the type system does not check"
)]
pub fn leave_out_system_rows() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let key = NSString::from_str(FULL_SCREEN_ROW);
    let no = NSNumber::new_bool(false);
    let defaults: objc2::rc::Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[no.as_ref() as &AnyObject]);
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StandIn {
    Undo,
    Redo,
    SelectAll,
}

#[tauri::command]
pub fn hand_to_keyboard(app: tauri::AppHandle, action: StandIn) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || send(action));
    #[cfg(not(target_os = "macos"))]
    let _ = (app, action);
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "an action is sent by selector, which the type system cannot check"
)]
fn send(action: StandIn) {
    let Some(main) = objc2::MainThreadMarker::new() else {
        return;
    };
    let selector = match action {
        StandIn::Undo => objc2::sel!(undo:),
        StandIn::Redo => objc2::sel!(redo:),
        StandIn::SelectAll => objc2::sel!(selectAll:),
    };
    unsafe {
        objc2_app_kit::NSApplication::sharedApplication(main)
            .sendAction_to_from(selector, None, None);
    }
}

#[cfg(test)]
mod tests {
    use super::StandIn;

    #[test]
    fn the_page_asks_for_an_action_by_the_name_it_writes() {
        let named = |text: &str| serde_json::from_str::<StandIn>(text).ok();

        assert_eq!(named("\"undo\""), Some(StandIn::Undo));
        assert_eq!(named("\"redo\""), Some(StandIn::Redo));
        assert_eq!(named("\"selectAll\""), Some(StandIn::SelectAll));
        assert_eq!(named("\"copy\""), None);
        assert_eq!(named("\"terminate:\""), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_full_screen_row_is_asked_to_stay_out() {
        use objc2_foundation::{NSNumber, NSString, NSUserDefaults};

        super::leave_out_system_rows();

        let said = NSUserDefaults::standardUserDefaults()
            .objectForKey(&NSString::from_str(super::FULL_SCREEN_ROW))
            .and_then(|value| value.downcast::<NSNumber>().ok())
            .map(|number| number.as_bool());
        assert_eq!(said, Some(false));
    }
}
