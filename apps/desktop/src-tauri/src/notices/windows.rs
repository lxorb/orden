use tauri::AppHandle;
use windows::core::{Interface as _, HSTRING};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::{IPropertyValue, TypedEventHandler};
use windows::UI::Notifications::{
    ToastActivatedEventArgs, ToastNotification, ToastNotificationManager,
};

use super::toast::{self, REPLY_ARGUMENT, REPLY_INPUT};
use super::{Act, Notice};

const GROUP: &str = "orden.notices";

fn failed(error: &windows::core::Error) -> String {
    error.message()
}

pub fn show(app: &AppHandle, notice: &Notice, quietly: bool) -> Result<(), String> {
    let document = XmlDocument::new().map_err(|error| failed(&error))?;
    document
        .LoadXml(&HSTRING::from(toast::xml(notice)))
        .map_err(|error| failed(&error))?;
    let shown =
        ToastNotification::CreateToastNotification(&document).map_err(|error| failed(&error))?;
    shown
        .SetTag(&HSTRING::from(notice.tag.as_str()))
        .map_err(|error| failed(&error))?;
    shown
        .SetGroup(&HSTRING::from(GROUP))
        .map_err(|error| failed(&error))?;
    if quietly {
        shown
            .SetSuppressPopup(true)
            .map_err(|error| failed(&error))?;
    }

    let app_for_press = app.clone();
    let id = notice.id.clone();
    let heard =
        TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(move |_, args| {
            let (act, text) = pressed(args.as_ref());
            super::answered(&app_for_press, &id, act, text);
            Ok(())
        });
    shown.Activated(&heard).map_err(|error| failed(&error))?;

    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
        app.config().identifier.as_str(),
    ))
    .and_then(|notifier| notifier.Show(&shown))
    .map_err(|error| failed(&error))
}

fn pressed(args: Option<&windows::core::IInspectable>) -> (Act, Option<String>) {
    let Some(args) = args.and_then(|args| args.cast::<ToastActivatedEventArgs>().ok()) else {
        return (Act::Open, None);
    };
    let reply = args
        .Arguments()
        .is_ok_and(|arguments| arguments == REPLY_ARGUMENT);
    if !reply {
        return (Act::Open, None);
    }
    let text = args
        .UserInput()
        .and_then(|input| input.Lookup(&HSTRING::from(REPLY_INPUT)))
        .and_then(|value| value.cast::<IPropertyValue>())
        .and_then(|value| value.GetString())
        .map(|text| text.to_string())
        .ok();
    (Act::Reply, text)
}

pub fn clear(app: &AppHandle, tag: &str) -> Result<(), String> {
    ToastNotificationManager::History()
        .and_then(|history| {
            history.RemoveGroupedTagWithId(
                &HSTRING::from(tag),
                &HSTRING::from(GROUP),
                &HSTRING::from(app.config().identifier.as_str()),
            )
        })
        .map_err(|error| failed(&error))
}

pub fn clear_all(app: &AppHandle) {
    let _ = ToastNotificationManager::History().and_then(|history| {
        history.RemoveGroupWithId(
            &HSTRING::from(GROUP),
            &HSTRING::from(app.config().identifier.as_str()),
        )
    });
}
