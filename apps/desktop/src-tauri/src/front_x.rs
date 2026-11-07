use std::sync::{LazyLock, Mutex, PoisonError};

use x11rb::connection::Connection as _;
use x11rb::protocol::screensaver::ConnectionExt as _;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, Window};
use x11rb::rust_connection::RustConnection;

struct X {
    connection: RustConnection,
    root: Window,
    active: u32,
    class: u32,
    pid: u32,
}

static X: LazyLock<Mutex<Option<X>>> = LazyLock::new(|| Mutex::new(opened()));

fn opened() -> Option<X> {
    std::env::var_os("DISPLAY")?;
    let (connection, screen) = x11rb::connect(None).ok()?;
    let root = connection.setup().roots.get(screen)?.root;
    let atom = |name: &[u8]| Some(connection.intern_atom(false, name).ok()?.reply().ok()?.atom);
    let active = atom(b"_NET_ACTIVE_WINDOW")?;
    let pid = atom(b"_NET_WM_PID")?;
    Some(X {
        connection,
        root,
        active,
        class: AtomEnum::WM_CLASS.into(),
        pid,
    })
}

fn asked<T>(ask: impl Fn(&X) -> Option<T>) -> Option<T> {
    let mut held = X.lock().unwrap_or_else(PoisonError::into_inner);
    let found = held.as_ref().and_then(&ask);
    if found.is_none() && held.as_ref().is_none_or(|x| x.connection.flush().is_err()) {
        *held = opened();
    }
    found
}

fn active(x: &X) -> Option<Window> {
    x.connection
        .get_property(false, x.root, x.active, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()
        .filter(|one| *one != 0)
}

pub fn front_class() -> Option<String> {
    asked(|x| {
        let class = x
            .connection
            .get_property(false, active(x)?, x.class, AtomEnum::STRING, 0, 256)
            .ok()?
            .reply()
            .ok()?
            .value;
        let mut parts = class.split(|one| *one == 0).filter(|one| !one.is_empty());
        let instance = parts.next();
        let named = parts.next().or(instance)?;
        Some(String::from_utf8_lossy(named).into_owned())
    })
}

pub struct Input {
    pub idle_ms: u64,
    pub front: bool,
}

pub fn input() -> Option<Input> {
    asked(|x| {
        let idle_ms = x
            .connection
            .screensaver_query_info(x.root)
            .ok()?
            .reply()
            .ok()?
            .ms_since_user_input;
        let front = active(x).and_then(|window| {
            x.connection
                .get_property(false, window, x.pid, AtomEnum::CARDINAL, 0, 1)
                .ok()?
                .reply()
                .ok()?
                .value32()?
                .next()
        }) == Some(std::process::id());
        Some(Input {
            idle_ms: u64::from(idle_ms),
            front,
        })
    })
}
