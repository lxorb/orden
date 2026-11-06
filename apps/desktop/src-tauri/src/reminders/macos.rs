use std::sync::mpsc;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread as _};
use objc2_foundation::{
    NSArray, NSBundle, NSCalendar, NSCalendarUnit, NSDate, NSError, NSObjectProtocol, NSSet,
    NSString,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNCalendarNotificationTrigger,
    UNMutableNotificationContent, UNNotification, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNNotificationSound, UNNotificationTrigger,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::AppHandle;

use super::link::Act;
use super::schedule::System;
use super::{Planned, Words};

const CATEGORY: &str = "nib.reminder";
const DONE: &str = "done";
const LATER: &str = "snooze-15";
const HOUR: &str = "snooze-60";

const PATIENCE: Duration = Duration::from_secs(2);

static APP: OnceLock<AppHandle> = OnceLock::new();

static WORDS: Mutex<Said> = Mutex::new((None, None));

type Said = (Option<Words>, Option<(String, String)>);

pub fn bundled() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "NibReminders"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &block2::DynBlock<dyn Fn()>,
        ) {
            answered(response);
            completion.call(());
        }
    }
);

#[allow(
    unsafe_code,
    reason = "a class of our own is initialised through the Objective-C runtime"
)]
fn delegate() -> Retained<Delegate> {
    let made = Delegate::alloc();
    unsafe { msg_send![made, init] }
}

pub fn listen(app: &AppHandle) {
    if !bundled() || APP.set(app.clone()).is_err() {
        return;
    }
    let centre = UNUserNotificationCenter::currentNotificationCenter();
    let kept = delegate();
    centre.setDelegate(Some(ProtocolObject::from_ref(&*kept)));
    std::mem::forget(kept);
}

fn answered(response: &UNNotificationResponse) {
    let Some(app) = APP.get() else {
        return;
    };
    let request = response.notification().request();
    let id = request.identifier().to_string();
    if crate::notices::macos::answer(app, response, &id) {
        return;
    }
    let action = response.actionIdentifier().to_string();
    let id = id.split('-').next().unwrap_or(&id).to_string();

    match action.as_str() {
        LATER | HOUR => {
            let minutes = if action == HOUR { 60.0 } else { 15.0 };
            let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(
                minutes * 60.0,
                false,
            );
            let trigger: &UNNotificationTrigger = &trigger;
            let again = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&format!("{id}-{}", super::now_ms())),
                &request.content(),
                Some(trigger),
            );
            UNUserNotificationCenter::currentNotificationCenter()
                .addNotificationRequest_withCompletionHandler(&again, None);
        }
        DONE => super::pressed_by_id(app, Act::Done, &id),
        _ => super::pressed_by_id(app, Act::Open, &id),
    }
}

pub fn reply_words(placeholder: &str, send: &str) {
    let wanted = Some((placeholder.to_string(), send.to_string()));
    {
        let mut words = WORDS.lock().unwrap_or_else(PoisonError::into_inner);
        if words.1 == wanted {
            return;
        }
        words.1 = wanted;
    }
    categorise(&UNUserNotificationCenter::currentNotificationCenter());
}

fn categorise(centre: &UNUserNotificationCenter) {
    let (reminders, reply) = WORDS.lock().unwrap_or_else(PoisonError::into_inner).clone();
    let category = |id: &str, actions: &[Retained<UNNotificationAction>]| {
        UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
            &NSString::from_str(id),
            &NSArray::from_retained_slice(actions),
            &NSArray::new(),
            UNNotificationCategoryOptions::empty(),
        )
    };
    let mut categories = Vec::new();
    if let Some(words) = reminders {
        let action = |id: &str, title: &str| {
            UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(id),
                &NSString::from_str(title),
                UNNotificationActionOptions::empty(),
            )
        };
        categories.push(category(
            CATEGORY,
            &[
                action(DONE, &words.done),
                action(LATER, &format!("{} {}", words.snooze, words.minutes)),
                action(HOUR, &format!("{} {}", words.snooze, words.hour)),
            ],
        ));
    }
    if let Some((placeholder, send)) = reply {
        categories.push(category(
            crate::notices::macos::CATEGORY,
            &[crate::notices::macos::reply_action(&placeholder, &send)],
        ));
    }
    centre.setNotificationCategories(&NSSet::from_retained_slice(&categories));
}

pub struct Requests {
    centre: Retained<UNUserNotificationCenter>,
}

impl Requests {
    pub fn start(app: &AppHandle, words: &Words) -> Result<Self, String> {
        if !bundled() {
            return Err("not a bundle, so no notification centre".into());
        }
        listen(app);
        let centre = UNUserNotificationCenter::currentNotificationCenter();

        let asked = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
        centre.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &asked,
        );

        WORDS.lock().unwrap_or_else(PoisonError::into_inner).0 = Some(words.clone());
        categorise(&centre);

        if authorization(&centre) == Some(UNAuthorizationStatus::Denied) {
            return Err("notifications are turned off for Orden".into());
        }

        Ok(Self { centre })
    }
}

fn authorization(centre: &UNUserNotificationCenter) -> Option<UNAuthorizationStatus> {
    let (said, heard) = mpsc::channel();
    let answer = RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
        let _ = said.send(status_of(settings));
    });
    centre.getNotificationSettingsWithCompletionHandler(&answer);
    heard.recv_timeout(PATIENCE).ok()
}

impl System for Requests {
    fn scheduled(&self) -> Result<Vec<String>, String> {
        let (said, heard) = mpsc::channel();
        let answer = RcBlock::new(
            move |requests: std::ptr::NonNull<NSArray<UNNotificationRequest>>| {
                let ids = ids_of(requests);
                let _ = said.send(ids);
            },
        );
        self.centre
            .getPendingNotificationRequestsWithCompletionHandler(&answer);
        let ids = heard
            .recv_timeout(PATIENCE)
            .map_err(|_| "the notification centre did not say what it holds".to_string())?;
        Ok(ids.into_iter().filter(|id| !id.contains('-')).collect())
    }

    fn add(&self, one: &Planned, _nonce: &str, _words: &Words) -> Result<(), String> {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&one.title));
        content.setBody(&NSString::from_str(&one.body));
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));
        let sound = UNNotificationSound::defaultSound();
        content.setSound(Some(&*sound));

        #[allow(
            clippy::cast_precision_loss,
            reason = "milliseconds since 1970 are well inside a double's exact integers"
        )]
        let seconds = one.at as f64 / 1000.0;
        let date = NSDate::dateWithTimeIntervalSince1970(seconds);
        let units = NSCalendarUnit::Year
            | NSCalendarUnit::Month
            | NSCalendarUnit::Day
            | NSCalendarUnit::Hour
            | NSCalendarUnit::Minute;
        let parts = NSCalendar::currentCalendar().components_fromDate(units, &date);
        let trigger =
            UNCalendarNotificationTrigger::triggerWithDateMatchingComponents_repeats(&parts, false);
        let trigger: &UNNotificationTrigger = &trigger;

        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&one.id),
            &content,
            Some(trigger),
        );
        self.centre
            .addNotificationRequest_withCompletionHandler(&request, None);
        Ok(())
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        let ids = NSArray::from_retained_slice(&[NSString::from_str(id)]);
        self.centre
            .removePendingNotificationRequestsWithIdentifiers(&ids);
        Ok(())
    }
}

#[allow(
    unsafe_code,
    reason = "the centre hands its answer over as a bare pointer for the length of the call"
)]
fn status_of(settings: std::ptr::NonNull<UNNotificationSettings>) -> UNAuthorizationStatus {
    unsafe { settings.as_ref() }.authorizationStatus()
}

#[allow(
    unsafe_code,
    reason = "the centre hands its answer over as a bare pointer for the length of the call"
)]
fn ids_of(requests: std::ptr::NonNull<NSArray<UNNotificationRequest>>) -> Vec<String> {
    let requests = unsafe { requests.as_ref() };
    requests
        .iter()
        .map(|request| request.identifier().to_string())
        .collect()
}
