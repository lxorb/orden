use tauri::Theme;
use zbus::blocking::{Connection, MessageIterator};
use zbus::message::Type as Kind;
use zbus::zvariant::{OwnedValue, Value};
use zbus::MatchRule;

const DESKTOP: &str = "org.freedesktop.portal.Desktop";
const PATH: &str = "/org/freedesktop/portal/desktop";
const SETTINGS: &str = "org.freedesktop.portal.Settings";
const APPEARANCE: &str = "org.freedesktop.appearance";
const SCHEME: &str = "color-scheme";
pub fn follow() {
    let _ = std::thread::Builder::new().name("orden-portal-scheme".into()).spawn(|| {
        if let Ok(bus) = Connection::session() {
            let _ = hear(&bus, tauri_runtime_cef::set_system_theme);
        }
    });
}
fn hear(bus: &Connection, tell: impl Fn(Theme)) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(Kind::Signal)
        .interface(SETTINGS)?
        .member("SettingChanged")?
        .path(PATH)?
        .build();
    let changes = MessageIterator::for_match_rule(rule, bus, Some(16))?;
    if let Some(theme) = read(bus) {
        tell(theme);
    }
    for message in changes {
        let message = message?;
        let Ok((namespace, key, value)) =
            message.body().deserialize::<(String, String, OwnedValue)>()
        else {
            continue;
        };
        if namespace != APPEARANCE || key != SCHEME {
            continue;
        }
        if let Some(theme) = worn(&value) {
            tell(theme);
        }
    }
    Ok(())
}
fn read(bus: &Connection) -> Option<Theme> {
    ["ReadOne", "Read"].into_iter().find_map(|method| {
        let reply =
            bus.call_method(Some(DESKTOP), PATH, Some(SETTINGS), method, &(APPEARANCE, SCHEME));
        let value: OwnedValue = reply.ok()?.body().deserialize().ok()?;
        worn(&value)
    })
}
fn worn(value: &Value<'_>) -> Option<Theme> {
    match value {
        Value::Value(inner) => worn(inner),
        Value::U32(1) => Some(Theme::Dark),
        Value::U32(_) => Some(Theme::Light),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::{hear, worn, APPEARANCE, PATH, SCHEME, SETTINGS};
    use std::os::unix::net::UnixStream;
    use std::sync::mpsc::{self, Receiver};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri::Theme;
    use zbus::blocking::connection::Builder;
    use zbus::blocking::{Connection, MessageIterator};
    use zbus::message::Type as Kind;
    use zbus::zvariant::Value;
    use zbus::Guid;

    #[derive(Clone, Copy)]
    enum Portal {
        Current(u32),
        Older(u32),
        Absent,
    }
    type Asked = Arc<Mutex<Vec<String>>>;
    struct Faked {
        portal: Connection,
        told: Receiver<Theme>,
        asked: Asked,
    }
    fn fake(portal: Portal) -> Faked {
        let (ours, theirs) = UnixStream::pair().expect("a socket pair");
        let server = std::thread::spawn(move || {
            Builder::async_io_unix_stream(theirs)
                .server(Guid::generate())
                .expect("a guid")
                .p2p()
                .build()
                .expect("the portal's end")
        });
        let client = Builder::async_io_unix_stream(ours).p2p().build().expect("the app's end");
        let server: Connection = server.join().expect("the portal started");
        let calls = MessageIterator::from(&server);
        let asked: Asked = Arc::default();
        let log = Arc::clone(&asked);
        let answering = server.clone();
        std::thread::spawn(move || answer(&answering, calls, &log, portal));
        let (tell, told) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = hear(&client, |theme| {
                let _ = tell.send(theme);
            });
        });
        Faked { portal: server, told, asked }
    }
    fn answer(bus: &Connection, calls: MessageIterator, log: &Asked, portal: Portal) {
        for message in calls {
            let Ok(message) = message else { return };
            let header = message.header();
            if header.message_type() != Kind::MethodCall {
                continue;
            }
            let member = header.member().map(ToString::to_string).unwrap_or_default();
            let (namespace, key) =
                message.body().deserialize::<(String, String)>().unwrap_or_default();
            log.lock().expect("the log").push(format!("{member}({namespace} {key})"));
            let unknown = "org.freedesktop.DBus.Error.UnknownMethod";
            match (portal, member.as_str()) {
                (Portal::Current(scheme), "ReadOne") => {
                    bus.reply(&header, &Value::U32(scheme)).expect("a reply");
                }
                (Portal::Current(scheme) | Portal::Older(scheme), "Read") => {
                    bus.reply(&header, &Value::new(Value::U32(scheme))).expect("a reply");
                }
                (Portal::Absent, _) => {
                    let gone = "org.freedesktop.DBus.Error.ServiceUnknown";
                    bus.reply_error(&header, gone, &"no portal").expect("an error");
                }
                _ => bus.reply_error(&header, unknown, &"no such method").expect("an error"),
            }
        }
    }
    fn change(portal: &Connection, namespace: &str, key: &str, scheme: u32) {
        portal
            .emit_signal(
                None::<&str>,
                PATH,
                SETTINGS,
                "SettingChanged",
                &(namespace, key, Value::U32(scheme)),
            )
            .expect("a signal");
    }
    fn next(faked: &Faked) -> Option<Theme> {
        faked.told.recv_timeout(Duration::from_secs(10)).ok()
    }
    fn asked(faked: &Faked) -> Vec<String> {
        faked.asked.lock().expect("the log").clone()
    }
    #[test]
    fn the_scheme_the_portal_holds_at_start_is_told_then_each_change() {
        let faked = fake(Portal::Current(1));
        assert_eq!(next(&faked), Some(Theme::Dark));
        assert_eq!(asked(&faked), [format!("ReadOne({APPEARANCE} {SCHEME})")]);
        change(&faked.portal, APPEARANCE, SCHEME, 2);
        assert_eq!(next(&faked), Some(Theme::Light));
        change(&faked.portal, APPEARANCE, "accent-color", 1);
        change(&faked.portal, "org.gnome.desktop.interface", SCHEME, 1);
        change(&faked.portal, APPEARANCE, SCHEME, 1);
        assert_eq!(next(&faked), Some(Theme::Dark));
        change(&faked.portal, APPEARANCE, SCHEME, 0);
        assert_eq!(next(&faked), Some(Theme::Light));
    }
    #[test]
    fn a_portal_older_than_read_one_is_read_the_old_way() {
        let faked = fake(Portal::Older(1));
        assert_eq!(next(&faked), Some(Theme::Dark));
        assert_eq!(
            asked(&faked),
            [format!("ReadOne({APPEARANCE} {SCHEME})"), format!("Read({APPEARANCE} {SCHEME})")]
        );
    }
    #[test]
    fn no_portal_tells_nothing_so_the_window_stays_light() {
        let faked = fake(Portal::Absent);
        let until = std::time::Instant::now() + Duration::from_secs(10);
        while asked(&faked).len() < 2 && std::time::Instant::now() < until {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(asked(&faked).len(), 2, "{:?}", asked(&faked));
        change(&faked.portal, APPEARANCE, SCHEME, 1);
        assert_eq!(next(&faked), Some(Theme::Dark));
    }
    #[test]
    fn one_is_dark_and_no_preference_or_light_are_light() {
        assert_eq!(worn(&Value::U32(1)), Some(Theme::Dark));
        assert_eq!(worn(&Value::U32(0)), Some(Theme::Light));
        assert_eq!(worn(&Value::U32(2)), Some(Theme::Light));
        assert_eq!(worn(&Value::new(Value::U32(1))), Some(Theme::Dark));
        assert_eq!(worn(&Value::from("dark")), None);
    }
}
