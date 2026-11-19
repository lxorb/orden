use std::path::PathBuf;

use serde_json::Value;
use tauri::webview::{PlatformWebview, WebviewBuilder};
use tauri::{AppHandle, Runtime, Webview};

use orden_base::paths::{config_dir, made};
use orden_web_engine::NativeWindow;

pub use orden_web_engine::internal;

const ROOT: &str = orden_web_engine::ROOT;
const STORE_PROFILE: &str = orden_web_engine::STORE_PROFILE;
const APP_PROFILE: &str = orden_web_engine::APP_PROFILE;
pub type Heard = Box<dyn Fn(&str, Option<&str>, &Value) + Send + Sync>;
pub type Call =
    fn(&Webview, Option<&str>, &str, &Value, std::time::Duration) -> Result<Value, String>;
pub type Tell = fn(&Webview, Option<&str>, Vec<(&'static str, Value)>);
pub type Zooms = Box<dyn Fn(crate::web_page::Step) + Send + Sync>;
pub type Menus = Box<dyn Fn(serde_json::Value) -> bool + Send + Sync>;
pub type Dialogs = Box<dyn Fn(serde_json::Value) -> bool + Send + Sync>;
pub type Permissions = Box<dyn Fn(serde_json::Value) -> bool + Send + Sync>;
pub type Page = WebviewBuilder<orden_base::Engine>;
pub struct Engine {
    pub page_id: fn(&PlatformWebview) -> Option<NativeWindow>,
    pub call: Call,
    pub tell: Tell,
    pub hear: fn(&Webview, Heard) -> Result<(), String>,
    pub let_go_of: fn(&str),
    pub mute: fn(&Webview, bool) -> Result<(), String>,
    pub wear: fn(&PlatformWebview, crate::page_scheme::Scheme),
    pub served: fn(&PlatformWebview) -> Option<crate::web_certificate::Served>,
    pub zooms: fn(Page, Zooms) -> Page,
    pub menus: fn(Page, Menus) -> Page,
    pub menu_pick: fn(u64, Option<i32>) -> bool,
    pub dialogs: fn(Page, Dialogs) -> Page,
    pub dialog_answer: fn(u64, bool, Option<String>) -> bool,
    pub permissions: fn(Page, Permissions) -> Page,
    pub permission_answer: fn(u64, bool) -> bool,
}
static ENGINE: std::sync::OnceLock<Engine> = std::sync::OnceLock::new();
pub fn hand(engine: Engine) {
    let _ = ENGINE.set(engine);
}
pub fn menus(page: Page, menus: Menus) -> Page {
    match engine() {
        Ok(engine) => (engine.menus)(page, menus),
        Err(_) => page,
    }
}
pub fn dialogs(page: Page, dialogs: Dialogs) -> Page {
    match engine() {
        Ok(engine) => (engine.dialogs)(page, dialogs),
        Err(_) => page,
    }
}
pub fn permissions(page: Page, permissions: Permissions) -> Page {
    match engine() {
        Ok(engine) => (engine.permissions)(page, permissions),
        Err(_) => page,
    }
}
pub fn engine() -> Result<&'static Engine, String> {
    ENGINE.get().ok_or_else(|| "the engine has not started".to_owned())
}
pub fn zooms(page: Page, zooms: Zooms) -> Page {
    match engine() {
        Ok(engine) => (engine.zooms)(page, zooms),
        Err(_) => page,
    }
}
pub mod devtools {
    use std::time::Duration;

    use serde_json::Value;
    use tauri::Webview;

    pub fn call(
        view: &Webview,
        session: Option<&str>,
        method: &str,
        params: &Value,
        patience: Duration,
    ) -> Result<Value, String> {
        (super::engine()?.call)(view, session, method, params, patience)
    }
    pub fn tell(view: &Webview, session: Option<&str>, said: Vec<(&'static str, Value)>) {
        if let Ok(engine) = super::engine() {
            (engine.tell)(view, session, said);
        }
    }
    pub fn hear(
        view: &Webview,
        heard: impl Fn(&str, Option<&str>, &Value) + Send + Sync + 'static,
    ) -> Result<(), String> {
        (super::engine()?.hear)(view, Box::new(heard))
    }
    pub fn let_go_of(label: &str) {
        if let Ok(engine) = super::engine() {
            (engine.let_go_of)(label);
        }
    }
}
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join(ROOT);
    made(&dir)?;
    Ok(dir)
}
pub fn app_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root(app)?.join(APP_PROFILE);
    made(&dir)?;
    Ok(dir)
}
pub fn web_store<R: Runtime>(
    builder: WebviewBuilder<R>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<WebviewBuilder<R>, String> {
    Ok(builder.data_directory(profile(app, store)?))
}
pub fn profile(app: &AppHandle, store: Option<&str>) -> Result<PathBuf, String> {
    let root = root(app)?;
    Ok(match store {
        None => root,
        Some(name) => {
            let dir = root.join(format!("{STORE_PROFILE}{name}"));
            made(&dir)?;
            dir
        }
    })
}
pub fn add_child<R: Runtime>(
    window: &tauri::Window<R>,
    builder: WebviewBuilder<R>,
    position: impl Into<tauri::Position>,
    size: impl Into<tauri::Size>,
) -> tauri::Result<tauri::Webview<R>> {
    one_at_a_time(|| window.add_child(builder.position(position).size(size)))
}
pub fn one_at_a_time<T>(build: impl FnOnce() -> tauri::Result<T>) -> tauri::Result<T> {
    orden_web_engine::one_at_a_time(|| tauri::Error::FailedToReceiveMessage, build)
}
pub use orden_web_engine::{handed_out, once_built};

macro_rules! with_platform {
    ($page:expr, $then:expr) => {
        $crate::engine::handed_out(|f| $page.with_webview(f), $then)
    };
}
pub(crate) use with_platform;

#[cfg(test)]
mod tests {
    #[test]
    fn a_page_asked_for_while_another_is_built_waits_for_it_and_never_builds_inside_it() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let order = Rc::new(RefCell::new(Vec::new()));
        let seen = Rc::clone(&order);
        let built = super::one_at_a_time(|| {
            seen.borrow_mut().push("outer begins");
            let inner = Rc::clone(&seen);
            super::once_built(move || {
                let nested = super::one_at_a_time(|| {
                    inner.borrow_mut().push("waited");
                    Ok(())
                });
                assert!(nested.is_ok());
            });
            assert!(super::one_at_a_time(|| Ok(())).is_err());
            seen.borrow_mut().push("outer ends");
            Ok(7)
        });
        assert_eq!(built.ok(), Some(7));
        assert_eq!(*order.borrow(), ["outer begins", "outer ends", "waited"]);
        let now = Rc::new(RefCell::new(false));
        let ran = Rc::clone(&now);
        super::once_built(move || *ran.borrow_mut() = true);
        assert!(*now.borrow());
    }
}
