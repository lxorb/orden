use std::path::Path;

use zbus::blocking::{Connection, MessageIterator};
use zbus::message::Type as Kind;
use zbus::zvariant::{DynamicType, OwnedObjectPath};
use zbus::MatchRule;

const SERVICE: &str = "org.freedesktop.PackageKit";
const PATH: &str = "/org/freedesktop/PackageKit";
const TRANSACTION: &str = "org.freedesktop.PackageKit.Transaction";

const NO_FILTER: u64 = 1 << 1;
const ONLY_TRUSTED: u64 = 1 << 1;
const UNTRUSTED: u64 = 0;
const SUCCESS: u32 = 1;
const CANCELLED: u32 = 3;
const STOPPED: u32 = 17;
const NOT_AUTHORIZED: u32 = 48;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Deb,
    Rpm,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    Absent,
    Refused,
    Failed(String),
}

impl From<zbus::Error> for Failure {
    fn from(error: zbus::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

pub struct PackageKit {
    bus: Connection,
}

impl PackageKit {
    pub fn system() -> Result<Self, Failure> {
        Connection::system()
            .map(Self::on)
            .map_err(|_| Failure::Absent)
    }

    pub fn on(bus: Connection) -> Self {
        Self { bus }
    }

    pub fn update_from_repository(
        &self,
        package: &str,
        version: &str,
        format: Format,
    ) -> Result<bool, Failure> {
        match self.run("RefreshCache", &(false,)) {
            Err(Failure::Absent) => return Err(Failure::Absent),
            Err(Failure::Refused) => return Err(Failure::Refused),
            _ => {}
        }
        let offered = self.run("GetUpdates", &(NO_FILTER,))?;
        let Some(id) = offered
            .iter()
            .find(|id| offers(id, package, version, format))
        else {
            return Ok(false);
        };
        self.run("UpdatePackages", &(ONLY_TRUSTED, vec![id.as_str()]))?;
        Ok(true)
    }

    pub fn install_file(&self, path: &Path) -> Result<(), Failure> {
        let path = path.to_str().ok_or_else(|| {
            Failure::Failed(format!("{} is not a path PackageKit takes", path.display()))
        })?;
        self.run("InstallFiles", &(UNTRUSTED, vec![path])).map(drop)
    }

    fn run<B>(&self, method: &str, body: &B) -> Result<Vec<String>, Failure>
    where
        B: serde::Serialize + DynamicType,
    {
        let made = self
            .bus
            .call_method(Some(SERVICE), PATH, Some(SERVICE), "CreateTransaction", &())
            .map_err(|error| match error {
                zbus::Error::MethodError(ref name, _, _)
                    if name.as_str() == "org.freedesktop.DBus.Error.ServiceUnknown" =>
                {
                    Failure::Absent
                }
                other => other.into(),
            })?;
        let path: OwnedObjectPath = made.body().deserialize()?;
        let rule = MatchRule::builder()
            .msg_type(Kind::Signal)
            .interface(TRANSACTION)?
            .path(path.as_str())?
            .build();
        let heard = MessageIterator::for_match_rule(rule, &self.bus, Some(256))?;
        self.bus.call_method(
            Some(SERVICE),
            path.as_str(),
            Some(TRANSACTION),
            "SetHints",
            &(vec!["interactive=true"],),
        )?;
        self.bus.call_method(
            Some(SERVICE),
            path.as_str(),
            Some(TRANSACTION),
            method,
            body,
        )?;

        let mut packages = Vec::new();
        let mut said: Option<(u32, String)> = None;
        for message in heard {
            let message = message?;
            let header = message.header();
            let body = message.body();
            match header.member().map(zbus::names::MemberName::as_str) {
                Some("Package") => {
                    let (_, id, _): (u32, String, String) = body.deserialize()?;
                    packages.push(id);
                }
                Some("ErrorCode") => said = Some(body.deserialize()?),
                Some("Finished") => {
                    let (exit, _): (u32, u32) = body.deserialize()?;
                    return ended(exit, said).map(|()| packages);
                }
                Some("Destroy") => break,
                _ => {}
            }
        }
        Err(Failure::Failed(format!("{method}: PackageKit went away")))
    }
}

fn ended(exit: u32, said: Option<(u32, String)>) -> Result<(), Failure> {
    match (exit, said) {
        (SUCCESS, _) => Ok(()),
        (CANCELLED, _) | (_, Some((STOPPED | NOT_AUTHORIZED, _))) => Err(Failure::Refused),
        (_, Some((code, details))) => Err(Failure::Failed(format!("{details} ({code})"))),
        (exit, None) => Err(Failure::Failed(format!("ended with {exit}"))),
    }
}

fn offers(id: &str, package: &str, version: &str, format: Format) -> bool {
    let mut parts = id.split(';');
    parts.next() == Some(package)
        && parts
            .next()
            .is_some_and(|its| plain(its, format) == version)
}

fn plain(version: &str, format: Format) -> String {
    let version = version
        .split_once(':')
        .filter(|(epoch, _)| epoch.bytes().all(|byte| byte.is_ascii_digit()))
        .map_or(version, |(_, rest)| rest);
    match format {
        Format::Deb => version.to_owned(),
        Format::Rpm => version
            .rsplit_once('-')
            .map_or(version, |(upstream, _)| upstream)
            .replace('~', "-"),
    }
}

#[cfg(test)]
mod tests {
    use super::{plain, Failure, Format, PackageKit, NOT_AUTHORIZED, ONLY_TRUSTED, UNTRUSTED};
    use std::os::unix::net::UnixStream;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use zbus::blocking::connection::Builder;
    use zbus::blocking::{Connection, MessageIterator};
    use zbus::message::Type as Kind;
    use zbus::zvariant::ObjectPath;
    use zbus::Guid;

    #[derive(Clone)]
    struct Ends {
        packages: Vec<&'static str>,
        error: Option<(u32, &'static str)>,
        exit: u32,
    }

    const FINE: Ends = Ends {
        packages: Vec::new(),
        error: None,
        exit: 1,
    };

    type Asked = Arc<Mutex<Vec<String>>>;

    fn mock(ends: impl Fn(&str) -> Ends + Send + 'static) -> (PackageKit, Asked) {
        let (ours, theirs) = UnixStream::pair().expect("a socket pair");
        let asked: Asked = Arc::default();
        let log = Arc::clone(&asked);
        let server = std::thread::spawn(move || {
            Builder::async_io_unix_stream(theirs)
                .server(Guid::generate())
                .expect("a guid")
                .p2p()
                .build()
                .expect("the mock's end")
        });
        let client = Builder::async_io_unix_stream(ours)
            .p2p()
            .build()
            .expect("the client's end");
        let server: Connection = server.join().expect("the mock started");
        let calls = MessageIterator::from(&server);
        std::thread::spawn(move || serve(&server, calls, &log, &ends));
        (PackageKit::on(client), asked)
    }

    fn serve(bus: &Connection, calls: MessageIterator, log: &Asked, ends: &dyn Fn(&str) -> Ends) {
        let mut made = 0;
        for message in calls {
            let Ok(message) = message else { return };
            let header = message.header();
            if header.message_type() != Kind::MethodCall {
                continue;
            }
            let member = header.member().map(ToString::to_string).unwrap_or_default();
            let path = header.path().map(ToString::to_string).unwrap_or_default();
            let body = message.body();
            let args = match member.as_str() {
                "SetHints" => format!("{:?}", body.deserialize::<(Vec<String>,)>().map(|b| b.0)),
                "RefreshCache" => format!("{:?}", body.deserialize::<(bool,)>().map(|b| b.0)),
                "GetUpdates" => format!("{:?}", body.deserialize::<(u64,)>().map(|b| b.0)),
                "UpdatePackages" | "InstallFiles" => {
                    format!("{:?}", body.deserialize::<(u64, Vec<String>)>())
                }
                _ => String::new(),
            };
            log.lock()
                .expect("the log")
                .push(format!("{member}({args})"));
            if member == "CreateTransaction" {
                made += 1;
                let tid = ObjectPath::try_from(format!("/{made}")).expect("a path");
                bus.reply(&header, &tid).expect("a reply");
                continue;
            }
            bus.reply(&header, &()).expect("a reply");
            if member == "SetHints" {
                continue;
            }
            let end = ends(&member);
            for id in &end.packages {
                signal(bus, &path, "Package", &(2_u32, *id, "Orden"));
            }
            if let Some((code, details)) = end.error {
                signal(bus, &path, "ErrorCode", &(code, details));
            }
            signal(bus, &path, "Finished", &(end.exit, 0_u32));
        }
    }

    fn signal<B: serde::Serialize + zbus::zvariant::DynamicType>(
        bus: &Connection,
        path: &str,
        name: &str,
        body: &B,
    ) {
        bus.emit_signal(None::<&str>, path, super::TRANSACTION, name, body)
            .expect("a signal");
    }

    fn asked(log: &Asked) -> Vec<String> {
        log.lock().expect("the log").clone()
    }

    fn offering(ids: &'static [&'static str]) -> impl Fn(&str) -> Ends {
        move |method| match method {
            "GetUpdates" => Ends {
                packages: ids.to_vec(),
                ..FINE
            },
            _ => FINE,
        }
    }

    #[test]
    fn a_repository_that_offers_the_version_is_what_updates_it() {
        let (kit, log) = mock(offering(&[
            "glibc;2.41-1;x86_64;fedora",
            "orden;0.20.0-1;x86_64;orden",
        ]));
        assert_eq!(
            kit.update_from_repository("orden", "0.20.0", Format::Rpm),
            Ok(true)
        );
        let asked = asked(&log);
        assert!(
            asked.contains(&r#"SetHints(Ok(["interactive=true"]))"#.to_owned()),
            "{asked:?}"
        );
        assert_eq!(
            asked
                .iter()
                .filter(
                    |call| !call.starts_with("CreateTransaction") && !call.starts_with("SetHints")
                )
                .collect::<Vec<_>>(),
            [
                "RefreshCache(Ok(false))",
                "GetUpdates(Ok(2))",
                &format!(
                    r#"UpdatePackages(Ok(({ONLY_TRUSTED}, ["orden;0.20.0-1;x86_64;orden"])))"#
                ),
            ]
        );
    }

    #[test]
    fn a_repository_with_another_version_is_left_alone() {
        let (kit, log) = mock(offering(&["orden;0.19.1~1101-1;x86_64;orden-unstable"]));
        assert_eq!(
            kit.update_from_repository("orden", "0.20.0", Format::Rpm),
            Ok(false)
        );
        assert!(!asked(&log)
            .iter()
            .any(|call| call.starts_with("UpdatePackages")));
    }

    #[test]
    fn a_build_of_main_is_found_as_rpm_and_apt_write_it() {
        let (kit, _) = mock(offering(&["orden;0.19.1~1101-1;aarch64;orden-unstable"]));
        assert_eq!(
            kit.update_from_repository("orden", "0.19.1-1101", Format::Rpm),
            Ok(true)
        );
        let (kit, _) = mock(offering(&["orden;0.19.1-1101;amd64;apt.orden.so"]));
        assert_eq!(
            kit.update_from_repository("orden", "0.19.1-1101", Format::Deb),
            Ok(true)
        );
    }

    #[test]
    fn a_refresh_that_fails_still_reads_the_index() {
        let (kit, _) = mock(|method| match method {
            "RefreshCache" => Ends {
                error: Some((2, "no network")),
                exit: 2,
                ..FINE
            },
            "GetUpdates" => Ends {
                packages: vec!["orden;0.20.0-1;x86_64;orden"],
                ..FINE
            },
            _ => FINE,
        });
        assert_eq!(
            kit.update_from_repository("orden", "0.20.0", Format::Rpm),
            Ok(true)
        );
    }

    #[test]
    fn a_file_is_installed_as_one_packagekit_cannot_vouch_for() {
        let (kit, log) = mock(|_| FINE);
        assert_eq!(
            kit.install_file(Path::new("/home/a/.cache/orden-0.20.0.rpm")),
            Ok(())
        );
        assert!(asked(&log).contains(&format!(
            r#"InstallFiles(Ok(({UNTRUSTED}, ["/home/a/.cache/orden-0.20.0.rpm"])))"#
        )));
    }

    #[test]
    fn no_password_is_refused_and_anything_else_failed() {
        let (kit, _) = mock(|_| Ends {
            error: Some((NOT_AUTHORIZED, "Failed to obtain authentication.")),
            exit: 2,
            ..FINE
        });
        assert_eq!(kit.install_file(Path::new("/x.rpm")), Err(Failure::Refused));

        let (kit, _) = mock(|_| Ends {
            error: Some((13, "nothing provides libgtk-4.so.1()(64bit)")),
            exit: 2,
            ..FINE
        });
        assert_eq!(
            kit.install_file(Path::new("/x.rpm")),
            Err(Failure::Failed(
                "nothing provides libgtk-4.so.1()(64bit) (13)".into()
            ))
        );
    }

    #[test]
    fn versions_are_read_the_way_the_app_writes_them() {
        assert_eq!(plain("0.20.0-1", Format::Rpm), "0.20.0");
        assert_eq!(plain("1:0.20.0-1", Format::Rpm), "0.20.0");
        assert_eq!(plain("0.19.1~1101-1", Format::Rpm), "0.19.1-1101");
        assert_eq!(plain("0.19.1-1101", Format::Deb), "0.19.1-1101");
        assert_eq!(plain("0.20.0", Format::Deb), "0.20.0");
    }
}
