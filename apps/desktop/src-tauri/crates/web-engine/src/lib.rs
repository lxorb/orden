pub const MODULE: &str = "web-engine";

mod engine;
pub mod host;
pub mod policy;
pub mod profiles;
pub mod sequence;
pub mod switches;

pub use engine::{
    debug_port, embed_allowed, Cookie, Download, Embed, EngineSettings, Heard, Listener, Picture,
    SandboxPolicy, WebEngine, WebPage, LOWEST_DEBUG_PORT,
};
pub use host::{left_to_the_platform, Edge, NativeWindow, Plain, WindowSystem};
pub use orden_contracts::{Failure, FailureKind, Outcome};
pub use policy::{
    allowed, app_host, becomes, blank, frame_may_open, internal, signs_in, tab_may_open, Asked,
    Becomes, ExtensionUrls, NoExtensions,
};
pub use profiles::{Profiles, StoreName, APP_PROFILE, LONGEST_STORE_NAME, ROOT, STORE_PROFILE};
pub use sequence::{handed_out, once_built, one_at_a_time, Outbox, Sending};
pub use switches::{
    from_run, overlay_scrollbars, switches, with_extensions, Switch, ENGINE_SWIPE, LOAD_EXTENSION,
    LOAD_EXTENSION_OFF,
};
pub use url::Url;
